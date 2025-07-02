import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { getPauseState, setPauseState, resetPauseState } from "../pause/route"
import { PersistentHistory } from "@/lib/persistent-history"

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

interface ProcessingState {
  sessionId: string
  currentChunk: number
  totalChunks: number
  processedFiles: number
  stats: ProcessingStats
  outputPath: string
  chunks: string[][]
  config: any
}

const history = new PersistentHistory()
const PROCESSING_STATE_FILE = path.join(process.cwd(), "chunked_processing_state.json")

// Save processing state
async function saveProcessingState(state: ProcessingState): Promise<void> {
  try {
    await fs.writeFile(PROCESSING_STATE_FILE, JSON.stringify(state, null, 2))
    console.log(`[Chunked API] Saved processing state for session ${state.sessionId}`)
  } catch (error) {
    console.error("[Chunked API] Failed to save processing state:", error)
  }
}

// Load processing state
async function loadProcessingState(): Promise<ProcessingState | null> {
  try {
    const data = await fs.readFile(PROCESSING_STATE_FILE, "utf-8")
    const state = JSON.parse(data)
    console.log(`[Chunked API] Loaded processing state for session ${state.sessionId}`)
    return state
  } catch (error) {
    console.log("[Chunked API] No saved processing state found")
    return null
  }
}

// Clear processing state
async function clearProcessingState(): Promise<void> {
  try {
    await fs.unlink(PROCESSING_STATE_FILE)
    console.log("[Chunked API] Cleared processing state file")
  } catch (error) {
    // File doesn't exist - that's fine
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let sessionId: string | null = null
      let processingState: ProcessingState | null = null
      let controllerClosed = false

      // Helper function to safely close controller
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

      // Helper function to safely send messages
      const sendMessage = (type: string, message: any) => {
        if (controllerClosed) {
          console.log(`[Chunked API] Skipping message (controller closed): ${type}`)
          return
        }

        try {
          const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() })
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))

          if (processingState?.config?.verbose) {
            console.log(`[Chunked API] ${type.toUpperCase()}: ${JSON.stringify(message)}`)
          }
        } catch (error) {
          console.error("Error sending message:", error)
          controllerClosed = true
        }
      }

      try {
        const body = await request.json()
        const {
          rootDir,
          outputFile = "image_metadata.csv",
          outputFolder = "",
          numWorkers = 4,
          chunkSize = 100,
          pauseBetweenChunks = false,
          pauseDuration = 0,
          verbose = false,
          filterConfig = null,
          resumeFromState = false,
        } = body

        // Check if we should resume from saved state
        const savedState = await loadProcessingState()
        const pauseState = getPauseState()

        if (resumeFromState && savedState && (pauseState.isPaused || pauseState.shouldStop)) {
          // Resume from saved state
          processingState = savedState
          sessionId = processingState.sessionId
          sendMessage(
            "log",
            `Resuming from saved state - Session: ${sessionId}, Chunk: ${processingState.currentChunk}/${processingState.totalChunks}`,
          )

          // Reset pause state for resuming
          setPauseState({
            isPaused: false,
            shouldStop: false,
            pauseRequested: false,
            stopRequested: false,
            sessionId,
          })
        } else {
          // Start new processing
          resetPauseState()
          sessionId = `chunked_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

          sendMessage("start", "Starting chunked processing...")

          if (verbose) {
            console.log(`[Chunked API] Configuration:`)
            console.log(`  - Session ID: ${sessionId}`)
            console.log(`  - Root Directory: ${rootDir}`)
            console.log(`  - Output File: ${outputFile}`)
            console.log(`  - Output Folder: ${outputFolder || "current directory"}`)
            console.log(`  - Workers: ${numWorkers}`)
            console.log(`  - Chunk Size: ${chunkSize}`)
            console.log(`  - Pause Between Chunks: ${pauseBetweenChunks}`)
            console.log(`  - Pause Duration: ${pauseDuration}s`)
            console.log(`  - Verbose: ${verbose}`)
            console.log(`  - Filters Enabled: ${filterConfig?.enabled || false}`)
          }

          // Find all XML files
          const xmlFiles = await findXMLFiles(rootDir)

          if (xmlFiles.length === 0) {
            sendMessage("error", "No XML files found in the specified directory")
            safeCloseController()
            return
          }

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
          const outputPath = outputFolder ? path.join(outputFolder, outputFile) : path.join(process.cwd(), outputFile)

          // Calculate chunks
          const chunks = []
          for (let i = 0; i < xmlFiles.length; i += chunkSize) {
            chunks.push(xmlFiles.slice(i, i + chunkSize))
          }

          // Create processing state
          processingState = {
            sessionId,
            currentChunk: 0,
            totalChunks: chunks.length,
            processedFiles: 0,
            stats,
            outputPath,
            chunks,
            config: {
              rootDir,
              outputFile,
              outputFolder,
              numWorkers,
              chunkSize,
              pauseBetweenChunks,
              pauseDuration,
              verbose,
              filterConfig,
            },
          }

          // Create initial session record
          const session = {
            id: sessionId,
            startTime: new Date().toISOString(),
            status: "running" as const,
            config: {
              rootDir,
              outputFile: outputPath,
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

          sendMessage("log", `Processing ${xmlFiles.length} files in ${chunks.length} chunks of ${chunkSize}`)

          // Ensure output directory exists
          if (outputFolder) {
            await fs.mkdir(outputFolder, { recursive: true })
            if (verbose) {
              console.log(`[Chunked API] Created output directory: ${outputFolder}`)
            }
          }

          // Initialize CSV file with headers (only for new processing)
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
        }

        // Save initial processing state
        await saveProcessingState(processingState)

        // Process chunks starting from current chunk
        let wasInterrupted = false
        const startChunk = processingState.currentChunk

        for (let chunkIndex = startChunk; chunkIndex < processingState.totalChunks; chunkIndex++) {
          const currentChunkNumber = chunkIndex + 1

          if (verbose) {
            console.log(`[Chunked API] Starting chunk ${currentChunkNumber}/${processingState.totalChunks}`)
          }

          // Update current chunk in processing state
          processingState.currentChunk = chunkIndex
          await saveProcessingState(processingState)

          // Check for pause/stop using the global pause state
          const currentPauseState = getPauseState()
          if (currentPauseState.shouldStop) {
            if (verbose) {
              console.log(`[Chunked API] Stop requested, saving state and terminating`)
            }
            wasInterrupted = true

            // Update pause state with current progress
            setPauseState({
              sessionId,
              currentChunk: chunkIndex,
              processedFiles: processingState.stats.processedFiles,
            })

            sendMessage("shutdown", {
              reason: "Processing stopped by user",
              stats: processingState.stats,
              outputFile: processingState.outputPath,
              canResume: true,
              currentChunk: chunkIndex,
              totalChunks: processingState.totalChunks,
            })
            break
          }

          if (currentPauseState.isPaused) {
            if (verbose) {
              console.log(`[Chunked API] Pause requested, saving state and waiting for resume`)
            }

            // Update pause state with current progress
            setPauseState({
              sessionId,
              currentChunk: chunkIndex,
              processedFiles: processingState.stats.processedFiles,
            })

            sendMessage("paused", {
              message: "Processing paused - state saved for resume",
              canResume: true,
              currentChunk: chunkIndex,
              totalChunks: processingState.totalChunks,
            })

            // Update session status to paused
            await history.updateSession(sessionId, {
              status: "paused",
              progress: {
                totalFiles: processingState.stats.totalFiles,
                processedFiles: processingState.stats.processedFiles,
                successCount: processingState.stats.successfulFiles,
                errorCount: processingState.stats.errorFiles,
              },
            })

            // Wait for resume with frequent checks
            while (getPauseState().isPaused && !getPauseState().shouldStop) {
              await new Promise((resolve) => setTimeout(resolve, 200))
            }

            if (getPauseState().shouldStop) {
              if (verbose) {
                console.log(`[Chunked API] Stop requested while paused, saving state and terminating`)
              }
              wasInterrupted = true
              sendMessage("shutdown", {
                reason: "Processing stopped while paused",
                stats: processingState.stats,
                outputFile: processingState.outputPath,
                canResume: true,
                currentChunk: chunkIndex,
                totalChunks: processingState.totalChunks,
              })
              break
            }

            // Update session status back to running
            await history.updateSession(sessionId, {
              status: "running",
            })

            if (verbose) {
              console.log(`[Chunked API] Processing resumed from chunk ${currentChunkNumber}`)
            }
            sendMessage("log", `Processing resumed from chunk ${currentChunkNumber}`)
          }

          const chunk = processingState.chunks[chunkIndex]
          sendMessage("chunk_start", {
            chunkNumber: currentChunkNumber,
            totalChunks: processingState.totalChunks,
            chunkSize: chunk.length,
          })

          // Process chunk with frequent pause/stop checks
          const activeWorkers = new Set<Worker>()
          const batchSize = Math.min(processingState.config.numWorkers, chunk.length)

          for (let i = 0; i < chunk.length; i += batchSize) {
            // Check pause/stop before each batch
            const batchPauseState = getPauseState()
            if (batchPauseState.shouldStop || batchPauseState.isPaused) {
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

              if (batchPauseState.shouldStop) {
                wasInterrupted = true
                sendMessage("shutdown", {
                  reason: "Processing stopped during batch processing",
                  stats: processingState.stats,
                  outputFile: processingState.outputPath,
                  canResume: true,
                  currentChunk: chunkIndex,
                  totalChunks: processingState.totalChunks,
                })
                safeCloseController()
                return
              } else {
                sendMessage("paused", {
                  message: "Processing paused during batch - state saved",
                  canResume: true,
                  currentChunk: chunkIndex,
                  totalChunks: processingState.totalChunks,
                })
                safeCloseController()
                return
              }
            }

            const batch = chunk.slice(i, i + batchSize)
            const batchPromises = batch.map((xmlFile, index) =>
              processFile(
                xmlFile,
                processingState.config.filterConfig,
                verbose,
                activeWorkers,
                processingState.config.rootDir,
                i + index + 1,
              ),
            )

            try {
              const batchResults = await Promise.all(batchPromises)

              for (const result of batchResults) {
                processingState.stats.processedFiles++

                if (result.record) {
                  processingState.stats.successfulFiles++
                  processingState.stats.recordsWritten++

                  // Append to CSV file
                  const csvLine =
                    Object.values(result.record)
                      .map((value) =>
                        typeof value === "string" &&
                        (value.includes(",") || value.includes('"') || value.includes("\n"))
                          ? `"${String(value).replace(/"/g, '""')}"`
                          : value || "",
                      )
                      .join(",") + "\n"

                  await fs.appendFile(processingState.outputPath, csvLine, "utf8")
                } else {
                  processingState.stats.errorFiles++
                  if (verbose && result.error) {
                    console.log(`[Chunked API] Error processing file: ${result.error}`)
                    sendMessage("log", `Error processing file: ${result.error}`)
                  }
                }

                if (!result.passedFilter) {
                  processingState.stats.filteredFiles++
                }

                if (result.imageMoved) {
                  processingState.stats.movedFiles++
                }
              }

              // Update processing state and session progress
              await saveProcessingState(processingState)

              if (processingState.stats.processedFiles % 50 === 0) {
                await history.updateSession(sessionId, {
                  progress: {
                    totalFiles: processingState.stats.totalFiles,
                    processedFiles: processingState.stats.processedFiles,
                    successCount: processingState.stats.successfulFiles,
                    errorCount: processingState.stats.errorFiles,
                  },
                })
              }
            } catch (error) {
              const errorMsg = `Batch processing error: ${error instanceof Error ? error.message : "Unknown error"}`
              if (verbose) {
                console.error(`[Chunked API] ${errorMsg}`)
              }
              sendMessage("error", errorMsg)
              processingState.stats.errorFiles += batch.length
              processingState.stats.processedFiles += batch.length
            }
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

          sendMessage("chunk_complete", {
            chunkNumber: currentChunkNumber,
            totalChunks: processingState.totalChunks,
          })

          // Send progress update
          const percentage = Math.round((processingState.stats.processedFiles / processingState.stats.totalFiles) * 100)
          sendMessage("progress", {
            percentage,
            total: processingState.stats.totalFiles,
            processed: processingState.stats.processedFiles,
            successful: processingState.stats.successfulFiles,
            errors: processingState.stats.errorFiles,
            filtered: processingState.stats.filteredFiles,
            moved: processingState.stats.movedFiles,
          })

          if (verbose) {
            console.log(`[Chunked API] Chunk ${currentChunkNumber}/${processingState.totalChunks} completed`)
            console.log(
              `[Chunked API] Progress: ${processingState.stats.processedFiles}/${processingState.stats.totalFiles} (${percentage}%)`,
            )
          }

          // Pause between chunks if configured
          if (
            processingState.config.pauseBetweenChunks &&
            processingState.config.pauseDuration > 0 &&
            chunkIndex < processingState.totalChunks - 1
          ) {
            sendMessage("pause_start", {
              duration: processingState.config.pauseDuration,
              message: `Pausing for ${processingState.config.pauseDuration} seconds before next chunk...`,
            })

            for (let countdown = processingState.config.pauseDuration; countdown > 0; countdown--) {
              // Check for stop/pause during countdown
              const countdownPauseState = getPauseState()
              if (countdownPauseState.shouldStop || countdownPauseState.isPaused) {
                if (countdownPauseState.shouldStop) {
                  wasInterrupted = true
                  sendMessage("shutdown", {
                    reason: "Processing stopped during chunk pause",
                    stats: processingState.stats,
                    outputFile: processingState.outputPath,
                    canResume: true,
                    currentChunk: chunkIndex + 1,
                    totalChunks: processingState.totalChunks,
                  })
                } else {
                  sendMessage("paused", {
                    message: "Processing paused during chunk countdown",
                    canResume: true,
                    currentChunk: chunkIndex + 1,
                    totalChunks: processingState.totalChunks,
                  })
                }
                safeCloseController()
                return
              }

              sendMessage("pause_countdown", {
                remaining: countdown,
                message: `Resuming in ${countdown} seconds...`,
              })

              await new Promise((resolve) => setTimeout(resolve, 1000))
            }

            sendMessage("pause_end", "Resuming processing...")
          }
        }

        // Processing completed successfully
        if (!wasInterrupted) {
          // Clear processing state file
          await clearProcessingState()

          // Update final session status
          const endTime = new Date().toISOString()
          await history.updateSession(sessionId, {
            status: "completed",
            endTime,
            progress: {
              totalFiles: processingState.stats.totalFiles,
              processedFiles: processingState.stats.processedFiles,
              successCount: processingState.stats.successfulFiles,
              errorCount: processingState.stats.errorFiles,
            },
            results: {
              outputPath: processingState.outputPath,
            },
          })

          // Clear current session and pause state
          await history.setCurrentSession(null)
          resetPauseState()

          const completionMessage = `Chunked processing completed! Processed ${processingState.stats.processedFiles} files, ${processingState.stats.successfulFiles} successful, ${processingState.stats.errorFiles} errors.`

          if (verbose) {
            console.log(`[Chunked API] ${completionMessage}`)
            console.log(`[Chunked API] Session ${sessionId} completed successfully`)
          }

          sendMessage("complete", {
            stats: processingState.stats,
            outputFile: processingState.outputPath,
            message: completionMessage,
          })
        } else {
          // Update session as interrupted
          await history.updateSession(sessionId, {
            status: "interrupted",
            progress: {
              totalFiles: processingState.stats.totalFiles,
              processedFiles: processingState.stats.processedFiles,
              successCount: processingState.stats.successfulFiles,
              errorCount: processingState.stats.errorFiles,
            },
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        console.error("[Chunked API] Fatal error:", errorMessage)

        // Clear processing state on error
        await clearProcessingState()

        // Update session with error status
        if (sessionId) {
          await history.updateSession(sessionId, {
            status: "failed",
            endTime: new Date().toISOString(),
          })
          await history.setCurrentSession(null)
        }

        resetPauseState()

        try {
          const data = JSON.stringify({
            type: "error",
            message: `Chunked processing error: ${errorMessage}`,
            timestamp: new Date().toISOString(),
          })
          if (!controllerClosed) {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
        } catch (encodeError) {
          console.error("Error encoding error message:", encodeError)
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

async function processFile(
  xmlFile: string,
  filterConfig: any,
  verbose: boolean,
  activeWorkers: Set<Worker>,
  originalRootDir: string,
  workerId: number,
): Promise<WorkerResult> {
  return new Promise((resolve) => {
    // Check for pause/stop before creating worker
    const pauseState = getPauseState()
    if (pauseState.shouldStop || pauseState.isPaused) {
      resolve({
        record: null,
        passedFilter: false,
        imageMoved: false,
        error: "Processing stopped/paused by user",
        workerId,
      })
      return
    }

    if (verbose) {
      console.log(`[Chunked API] Creating worker ${workerId} for file: ${path.basename(xmlFile)}`)
    }

    const worker = new Worker(path.join(process.cwd(), "app/api/parse/xml-parser-worker.js"), {
      workerData: {
        xmlFilePath: xmlFile,
        filterConfig: filterConfig,
        originalRootDir: originalRootDir,
        workerId: workerId,
        verbose: verbose,
        isRemote: false,
        originalRemoteXmlUrl: null,
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
