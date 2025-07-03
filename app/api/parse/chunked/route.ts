import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { getPauseState, resetPauseState } from "../pause/route"
import { PersistentHistory } from "@/lib/persistent-history"
import { isRemotePath, scanRemoteDirectory } from "@/lib/remote-file-handler"

interface ProcessingStats {
  totalFiles: number
  processedFiles: number
  successfulFiles: number
  errorFiles: number
  recordsWritten: number
  filteredFiles: number
  movedFiles: number
}

interface WorkerResult {
  record: any
  passedFilter: boolean
  imageMoved: boolean
  error?: string
  workerId: number
}

interface ChunkedProcessingState {
  sessionId: string
  config: any
  stats: ProcessingStats
  currentChunk: number
  totalChunks: number
  chunkSize: number
  xmlFiles: string[]
  outputPath: string
  startTime: string
  pauseTime?: string
  processedChunks: string[][]
}

const CHUNKED_STATE_FILE = path.join(process.cwd(), "chunked_processing_state.json")
const history = new PersistentHistory()

async function saveProcessingState(state: ChunkedProcessingState): Promise<void> {
  try {
    await fs.writeFile(CHUNKED_STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    console.log("[Chunked API] Saved processing state to file")
  } catch (error) {
    console.error("[Chunked API] Error saving processing state:", error)
  }
}

async function loadProcessingState(): Promise<ChunkedProcessingState | null> {
  try {
    const data = await fs.readFile(CHUNKED_STATE_FILE, "utf8")
    const state = JSON.parse(data)
    console.log("[Chunked API] Loaded processing state from file")
    return state
  } catch (error) {
    console.log("[Chunked API] No saved processing state found")
    return null
  }
}

async function clearProcessingState(): Promise<void> {
  try {
    await fs.unlink(CHUNKED_STATE_FILE)
    console.log("[Chunked API] Cleared processing state file")
  } catch (error) {
    // File doesn't exist, which is fine
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
  let controllerClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      let sessionId: string | null = null
      let processingState: ChunkedProcessingState | null = null

      const safeCloseController = () => {
        if (!controllerClosed) {
          try {
            controller.close()
            controllerClosed = true
            console.log("[Chunked API] Controller closed safely")
          } catch (error) {
            console.error("[Chunked API] Error closing controller:", error)
          }
        }
      }

      const sendMessage = (type: string, message: any) => {
        if (controllerClosed) {
          console.log(`[Chunked API] Skipping message (controller closed): ${type}`)
          return
        }

        try {
          const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() })
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch (error) {
          console.error("[Chunked API] Error sending message:", error)
        }
      }

      try {
        const body = await request.json()
        const {
          rootDir,
          outputFile = "image_metadata.csv",
          outputFolder = "",
          chunkSize = 100,
          pauseDuration = 1000,
          numWorkers = 4,
          verbose = false,
          filterConfig = null,
        } = body

        resetPauseState()
        sessionId = `chunked_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        sendMessage("start", "Starting chunked processing...")

        if (verbose) {
          console.log(`[Chunked API] Configuration:`)
          console.log(`  - Session ID: ${sessionId}`)
          console.log(`  - Root Directory: ${rootDir}`)
          console.log(`  - Output File: ${outputFile}`)
          console.log(`  - Output Folder: ${outputFolder || "current directory"}`)
          console.log(`  - Chunk Size: ${chunkSize}`)
          console.log(`  - Pause Duration: ${pauseDuration}ms`)
          console.log(`  - Workers: ${numWorkers}`)
          console.log(`  - Verbose: ${verbose}`)
          console.log(`  - Filters Enabled: ${filterConfig?.enabled || false}`)
        }

        // Check if this is a remote path
        const isRemote = await isRemotePath(rootDir)
        let xmlFiles: string[] = []

        if (isRemote) {
          sendMessage("log", "Scanning remote directory for XML files...")

          try {
            // Limit scanning depth to prevent infinite loops
            const remoteFiles = await scanRemoteDirectory(
              rootDir,
              (message) => {
                sendMessage("log", message)
              },
              4,
            ) // Max depth of 4 levels

            xmlFiles = remoteFiles.map((file) => file.url)

            if (verbose) {
              console.log(`[Chunked API] Found ${xmlFiles.length} remote XML files`)
            }

            if (xmlFiles.length === 0) {
              sendMessage("log", "No XML files found in remote directory. Scanning may have been limited by depth.")
              sendMessage("error", "No XML files found in the specified remote directory")
              safeCloseController()
              return
            }
          } catch (error) {
            const errorMsg = `Failed to scan remote directory: ${error instanceof Error ? error.message : "Unknown error"}`
            console.error(`[Chunked API] ${errorMsg}`)
            sendMessage("error", errorMsg)
            safeCloseController()
            return
          }
        } else {
          // Local file processing
          xmlFiles = await findXMLFiles(rootDir)
        }

        if (xmlFiles.length === 0) {
          sendMessage("error", "No XML files found in the specified directory")
          safeCloseController()
          return
        }

        const totalChunks = Math.ceil(xmlFiles.length / chunkSize)
        const stats: ProcessingStats = {
          totalFiles: xmlFiles.length,
          processedFiles: 0,
          successfulFiles: 0,
          errorFiles: 0,
          recordsWritten: 0,
          filteredFiles: 0,
          movedFiles: 0,
        }

        // Determine output path
        let outputPath: string
        if (outputFolder) {
          if (path.isAbsolute(outputFolder)) {
            outputPath = path.join(outputFolder, outputFile)
          } else {
            outputPath = path.resolve(process.cwd(), outputFolder, outputFile)
          }
        } else {
          outputPath = path.join(process.cwd(), outputFile)
        }

        // Create processing state
        processingState = {
          sessionId,
          config: {
            rootDir,
            outputFile,
            outputFolder,
            chunkSize,
            pauseDuration,
            numWorkers,
            verbose,
            filterConfig,
          },
          stats,
          currentChunk: 0,
          totalChunks,
          chunkSize,
          xmlFiles,
          outputPath,
          startTime: new Date().toISOString(),
          processedChunks: [],
        }

        await saveProcessingState(processingState)

        // Create session
        const session = {
          id: sessionId,
          startTime: new Date().toISOString(),
          status: "running" as const,
          config: {
            rootDir,
            outputFile: outputPath,
            chunkSize,
            pauseDuration,
            numWorkers,
            verbose,
            filterConfig,
            processingMode: "chunked",
          },
          progress: {
            totalFiles: stats.totalFiles,
            processedFiles: 0,
            successCount: 0,
            errorCount: 0,
            processedFilesList: [] as string[],
          },
        }

        await history.addSession(session)
        await history.setCurrentSession(session)

        if (verbose) {
          console.log(`[Chunked API] Created session: ${sessionId}`)
          console.log(`[Chunked API] Output path: ${outputPath}`)
        }

        sendMessage("log", `Processing ${xmlFiles.length} files in ${totalChunks} chunks of ${chunkSize}`)

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath)
        await fs.mkdir(outputDir, { recursive: true })
        if (verbose) {
          console.log(`[Chunked API] Created output directory: ${outputDir}`)
        }

        // Initialize CSV file with headers
        const headers =
          [
            "city",
            "year",
            "month",
            "newsItemId",
            "dateId",
            "providerId",
            "headline",
            "byline",
            "dateline",
            "creditline",
            "copyrightLine",
            "slugline",
            "keywords",
            "edition",
            "location",
            "country",
            "city_meta",
            "pageNumber",
            "status",
            "urgency",
            "language",
            "subject",
            "processed",
            "published",
            "usageType",
            "rightsHolder",
            "imageWidth",
            "imageHeight",
            "imageSize",
            "actualFileSize",
            "imageHref",
            "xmlPath",
            "imagePath",
            "imageExists",
            "creationDate",
            "revisionDate",
            "commentData",
          ].join(",") + "\n"

        await fs.writeFile(outputPath, headers, "utf8")

        if (verbose) {
          console.log(`[Chunked API] Initialized CSV file: ${outputPath}`)
        }

        // Process files in chunks
        let wasInterrupted = false

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          processingState.currentChunk = chunkIndex + 1
          await saveProcessingState(processingState)

          // Check for pause/stop before processing chunk
          const pauseState = getPauseState()
          if (pauseState.shouldStop) {
            if (verbose) {
              console.log(`[Chunked API] Stop requested before chunk ${chunkIndex + 1}`)
            }
            wasInterrupted = true
            processingState.pauseTime = new Date().toISOString()
            await saveProcessingState(processingState)
            sendMessage("shutdown", {
              reason: "Processing stopped by user",
              stats,
              outputFile: outputPath,
              canResume: true,
              currentChunk: chunkIndex + 1,
              totalChunks,
            })
            safeCloseController()
            return
          }

          if (pauseState.isPaused) {
            if (verbose) {
              console.log(`[Chunked API] Pause requested before chunk ${chunkIndex + 1}`)
            }
            processingState.pauseTime = new Date().toISOString()
            await saveProcessingState(processingState)

            await history.updateSession(sessionId, {
              status: "paused",
              progress: {
                totalFiles: stats.totalFiles,
                processedFiles: stats.processedFiles,
                successCount: stats.successfulFiles,
                errorCount: stats.errorFiles,
              },
            })

            sendMessage("paused", {
              message: "Processing paused - state saved",
              canResume: true,
              currentChunk: chunkIndex + 1,
              totalChunks,
            })
            safeCloseController()
            return
          }

          const startIndex = chunkIndex * chunkSize
          const endIndex = Math.min(startIndex + chunkSize, xmlFiles.length)
          const chunk = xmlFiles.slice(startIndex, endIndex)

          sendMessage("chunk", `Starting chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`)

          if (verbose) {
            console.log(`[Chunked API] Processing chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`)
          }

          // Process chunk with workers
          const activeWorkers = new Set<Worker>()
          const chunkPromises = chunk.map((xmlFile, index) =>
            processFile(xmlFile, filterConfig, verbose, activeWorkers, rootDir, startIndex + index + 1, isRemote),
          )

          try {
            const chunkResults = await Promise.all(chunkPromises)

            // Check for pause/stop during batch processing
            const midProcessPauseState = getPauseState()
            if (midProcessPauseState.shouldStop || midProcessPauseState.isPaused) {
              if (verbose) {
                console.log(`[Chunked API] Pause/Stop requested during batch processing`)
              }

              // Cleanup workers
              for (const worker of activeWorkers) {
                try {
                  worker.terminate()
                } catch (error) {
                  if (verbose) {
                    console.error("[Chunked API] Error terminating worker:", error)
                  }
                }
              }
              activeWorkers.clear()

              // Process results we got before interruption
              await processChunkResults(chunkResults, outputPath, stats, verbose)

              processingState.stats = stats
              processingState.pauseTime = new Date().toISOString()
              processingState.processedChunks.push(chunk)
              await saveProcessingState(processingState)

              if (midProcessPauseState.shouldStop) {
                wasInterrupted = true
                sendMessage("shutdown", {
                  reason: "Processing stopped during batch",
                  stats,
                  outputFile: outputPath,
                  canResume: true,
                  currentChunk: chunkIndex + 1,
                  totalChunks,
                })
              } else {
                sendMessage("paused", {
                  message: "Processing paused during batch - state saved",
                  canResume: true,
                  currentChunk: chunkIndex + 1,
                  totalChunks,
                })
              }

              safeCloseController()
              return
            }

            // Process results normally
            await processChunkResults(chunkResults, outputPath, stats, verbose)

            processingState.stats = stats
            processingState.processedChunks.push(chunk)
            await saveProcessingState(processingState)

            // Update session progress
            await history.updateSession(sessionId, {
              progress: {
                totalFiles: stats.totalFiles,
                processedFiles: stats.processedFiles,
                successCount: stats.successfulFiles,
                errorCount: stats.errorFiles,
              },
            })

            // Cleanup workers
            for (const worker of activeWorkers) {
              try {
                worker.terminate()
              } catch (error) {
                if (verbose) {
                  console.error("[Chunked API] Error terminating worker:", error)
                }
              }
            }
            activeWorkers.clear()

            sendMessage("chunk", `Completed chunk ${chunkIndex + 1}/${totalChunks}`)

            // Send progress update
            const percentage = Math.round((stats.processedFiles / stats.totalFiles) * 100)
            sendMessage("progress", {
              percentage,
              total: stats.totalFiles,
              processed: stats.processedFiles,
              successful: stats.successfulFiles,
              errors: stats.errorFiles,
              filtered: stats.filteredFiles,
              moved: stats.movedFiles,
              currentChunk: chunkIndex + 1,
              totalChunks,
            })

            if (verbose) {
              console.log(`[Chunked API] Chunk ${chunkIndex + 1}/${totalChunks} completed`)
              console.log(`[Chunked API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
              console.log(
                `[Chunked API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
              )
            }

            // Pause between chunks (except for the last chunk)
            if (chunkIndex < totalChunks - 1 && pauseDuration > 0) {
              if (verbose) {
                console.log(`[Chunked API] Pausing for ${pauseDuration}ms between chunks`)
              }

              const pauseStartTime = Date.now()
              while (Date.now() - pauseStartTime < pauseDuration) {
                const pauseCheckState = getPauseState()
                if (pauseCheckState.shouldStop || pauseCheckState.isPaused) {
                  if (verbose) {
                    console.log(`[Chunked API] Pause/Stop requested during chunk pause`)
                  }

                  processingState.pauseTime = new Date().toISOString()
                  await saveProcessingState(processingState)

                  if (pauseCheckState.shouldStop) {
                    wasInterrupted = true
                    sendMessage("shutdown", {
                      reason: "Processing stopped during chunk pause",
                      stats,
                      outputFile: outputPath,
                      canResume: true,
                      currentChunk: chunkIndex + 2,
                      totalChunks,
                    })
                  } else {
                    sendMessage("paused", {
                      message: "Processing paused during chunk pause - state saved",
                      canResume: true,
                      currentChunk: chunkIndex + 2,
                      totalChunks,
                    })
                  }

                  safeCloseController()
                  return
                }
                await new Promise((resolve) => setTimeout(resolve, 200))
              }
            }
          } catch (error) {
            const errorMsg = `Chunk ${chunkIndex + 1} processing error: ${error instanceof Error ? error.message : "Unknown error"}`
            if (verbose) {
              console.error(`[Chunked API] ${errorMsg}`)
            }
            sendMessage("error", errorMsg)
            stats.errorFiles += chunk.length
            stats.processedFiles += chunk.length

            processingState.stats = stats
            await saveProcessingState(processingState)
          }
        }

        // Clear processing state file on successful completion
        await clearProcessingState()

        // Update final session status
        const finalStatus = wasInterrupted ? "interrupted" : "completed"
        const endTime = new Date().toISOString()

        await history.updateSession(sessionId, {
          status: finalStatus,
          endTime,
          progress: {
            totalFiles: stats.totalFiles,
            processedFiles: stats.processedFiles,
            successCount: stats.successfulFiles,
            errorCount: stats.errorFiles,
          },
          results: {
            outputPath,
          },
        })

        await history.setCurrentSession(null)

        // Send completion message
        if (!wasInterrupted) {
          const completionMessage = `Chunked processing completed! Processed ${stats.processedFiles} files in ${totalChunks} chunks, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`

          if (verbose) {
            console.log(`[Chunked API] ${completionMessage}`)
            console.log(`[Chunked API] Final stats:`, stats)
            console.log(`[Chunked API] Output file: ${outputPath}`)
            console.log(`[Chunked API] Session ${sessionId} completed successfully`)
          }

          sendMessage("complete", {
            stats,
            outputFile: outputPath,
            message: completionMessage,
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        console.error("[Chunked API] Fatal error:", errorMessage)

        if (sessionId) {
          await history.updateSession(sessionId, {
            status: "failed",
            endTime: new Date().toISOString(),
          })
          await history.setCurrentSession(null)
        }

        await clearProcessingState()

        if (!controllerClosed) {
          try {
            const data = JSON.stringify({
              type: "error",
              message: `Chunked processing error: ${errorMessage}`,
              timestamp: new Date().toISOString(),
            })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          } catch (encodeError) {
            console.error("Error encoding error message:", encodeError)
          }
        }
      } finally {
        safeCloseController()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

async function processChunkResults(
  chunkResults: WorkerResult[],
  outputPath: string,
  stats: ProcessingStats,
  verbose: boolean,
): Promise<void> {
  for (const result of chunkResults) {
    stats.processedFiles++

    if (result.record) {
      stats.successfulFiles++
      stats.recordsWritten++

      const csvLine =
        Object.values(result.record)
          .map((value) =>
            typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))
              ? `"${String(value).replace(/"/g, '""')}"`
              : value || "",
          )
          .join(",") + "\n"

      await fs.appendFile(outputPath, csvLine, "utf8")
    } else {
      stats.errorFiles++
      if (verbose && result.error) {
        console.log(`[Chunked API] Error processing file: ${result.error}`)
      }
    }

    if (!result.passedFilter) {
      stats.filteredFiles++
    }

    if (result.imageMoved) {
      stats.movedFiles++
    }
  }
}

async function processFile(
  xmlFile: string,
  filterConfig: any,
  verbose: boolean,
  activeWorkers: Set<Worker>,
  originalRootDir: string,
  workerId: number,
  isRemote = false,
): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const pauseState = getPauseState()
    if (pauseState.shouldStop) {
      resolve({
        record: null,
        passedFilter: false,
        imageMoved: false,
        error: "Processing stopped by user",
        workerId,
      })
      return
    }

    if (verbose) {
      console.log(`[Chunked API] Creating worker ${workerId} for file: ${isRemote ? xmlFile : path.basename(xmlFile)}`)
    }

    const worker = new Worker(path.join(process.cwd(), "app/api/parse/xml-parser-worker.js"), {
      workerData: {
        xmlFilePath: xmlFile,
        filterConfig: filterConfig,
        originalRootDir: originalRootDir,
        workerId: workerId,
        verbose: verbose,
        isRemote: isRemote,
        originalRemoteXmlUrl: isRemote ? xmlFile : null,
        associatedImagePath: null,
        isWatchMode: false,
      },
    })

    activeWorkers.add(worker)

    const timeout = setTimeout(() => {
      try {
        if (verbose) {
          console.log(`[Chunked API] Worker ${workerId} timed out after 30 seconds`)
        }
        worker.terminate()
        activeWorkers.delete(worker)
        resolve({
          record: null,
          passedFilter: false,
          imageMoved: false,
          error: "Worker timeout",
          workerId,
        })
      } catch (error) {
        console.error("Error during worker timeout:", error)
      }
    }, 30000)

    worker.on("message", (result: WorkerResult) => {
      try {
        clearTimeout(timeout)
        activeWorkers.delete(worker)
        worker.terminate()

        if (verbose) {
          console.log(`[Chunked API] Worker ${workerId} completed successfully`)
        }

        resolve(result)
      } catch (error) {
        console.error("Error handling worker message:", error)
        resolve({
          record: null,
          passedFilter: false,
          imageMoved: false,
          error: "Error handling worker result",
          workerId,
        })
      }
    })

    worker.on("error", (error) => {
      try {
        clearTimeout(timeout)
        activeWorkers.delete(worker)

        if (verbose) {
          console.error(`[Chunked API] Worker ${workerId} error:`, error.message)
        }

        resolve({
          record: null,
          passedFilter: false,
          imageMoved: false,
          error: error.message,
          workerId,
        })
      } catch (handleError) {
        console.error("Error handling worker error:", handleError)
      }
    })

    worker.on("exit", (code) => {
      if (code !== 0) {
        try {
          clearTimeout(timeout)
          activeWorkers.delete(worker)

          if (verbose) {
            console.log(`[Chunked API] Worker ${workerId} exited with code ${code}`)
          }

          resolve({
            record: null,
            passedFilter: false,
            imageMoved: false,
            error: `Worker exited with code ${code}`,
            workerId,
          })
        } catch (error) {
          console.error("Error handling worker exit:", error)
        }
      }
    })
  })
}

async function findXMLFiles(dir: string): Promise<string[]> {
  const xmlFiles: string[] = []

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        const subFiles = await findXMLFiles(fullPath)
        xmlFiles.push(...subFiles)
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".xml") {
        xmlFiles.push(fullPath)
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error)
  }

  return xmlFiles
}
