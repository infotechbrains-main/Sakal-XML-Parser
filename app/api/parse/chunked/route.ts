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
  processedChunks: string[][] // Track which files were processed in each chunk
}

const CHUNKED_STATE_FILE = path.join(process.cwd(), "chunked_processing_state.json")
const history = new PersistentHistory()

// Save processing state to file
async function saveProcessingState(state: ChunkedProcessingState): Promise<void> {
  try {
    await fs.writeFile(CHUNKED_STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    console.log("[Chunked API] Saved processing state to file")
  } catch (error) {
    console.error("[Chunked API] Error saving processing state:", error)
  }
}

// Load processing state from file
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

// Clear processing state file
async function clearProcessingState(): Promise<void> {
  try {
    await fs.unlink(CHUNKED_STATE_FILE)
    console.log("[Chunked API] Cleared processing state file")
  } catch (error) {
    // File doesn't exist, which is fine
  }
}

// Find XML files in a specific directory (for chunk-by-chunk processing)
async function findXMLFilesInDirectory(dir: string, maxFiles?: number): Promise<string[]> {
  const xmlFiles: string[] = []

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (maxFiles && xmlFiles.length >= maxFiles) {
        break
      }

      const fullPath = path.join(dir, entry.name)

      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".xml") {
        xmlFiles.push(fullPath)
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error)
  }

  return xmlFiles
}

// Get all subdirectories for chunk-based processing
async function getSubdirectories(rootDir: string): Promise<string[]> {
  const subdirs: string[] = [rootDir] // Include root directory

  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(rootDir, entry.name)
        subdirs.push(fullPath)

        // Recursively get subdirectories
        const nestedDirs = await getSubdirectories(fullPath)
        subdirs.push(...nestedDirs)
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${rootDir}:`, error)
  }

  return subdirs
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

        // Reset pause state at the start of processing
        resetPauseState()

        // Create session ID
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

        // Check if this is a remote path and handle accordingly
        const isRemote = await isRemotePath(rootDir)
        let allDirectories: string[] = []
        let totalEstimatedFiles = 0

        if (isRemote) {
          sendMessage("log", "Remote chunked processing - scanning all files first...")

          try {
            const remoteFiles = await scanRemoteDirectory(rootDir, (message) => {
              sendMessage("log", message)
            })

            // For remote files, we'll process them in chunks directly
            const xmlFiles = remoteFiles.map((file) => file.url)
            const totalChunks = Math.ceil(xmlFiles.length / chunkSize)

            if (verbose) {
              console.log(`[Chunked API] Found ${xmlFiles.length} remote XML files`)
              console.log(`[Chunked API] Will process in ${totalChunks} chunks`)
            }

            // Use the existing remote processing logic but with chunked approach
            await processRemoteFilesInChunks(
              xmlFiles,
              chunkSize,
              pauseDuration,
              numWorkers,
              verbose,
              filterConfig,
              outputFolder,
              outputFile,
              sessionId,
              sendMessage,
              rootDir,
            )

            return
          } catch (error) {
            const errorMsg = `Failed to scan remote directory: ${error instanceof Error ? error.message : "Unknown error"}`
            console.error(`[Chunked API] ${errorMsg}`)
            sendMessage("error", errorMsg)
            safeCloseController()
            return
          }
        } else {
          // Local processing - get all directories for chunk-based processing
          sendMessage("log", "Scanning directory structure for chunked processing...")
          allDirectories = await getSubdirectories(rootDir)

          // Estimate total files for progress tracking
          for (const dir of allDirectories) {
            try {
              const files = await findXMLFilesInDirectory(dir)
              totalEstimatedFiles += files.length
            } catch (error) {
              console.log(`[Chunked API] Error estimating files in ${dir}:`, error)
            }
          }

          if (verbose) {
            console.log(`[Chunked API] Found ${allDirectories.length} directories`)
            console.log(`[Chunked API] Estimated ${totalEstimatedFiles} XML files total`)
          }
        }

        if (totalEstimatedFiles === 0) {
          sendMessage("error", "No XML files found in the specified directory")
          safeCloseController()
          return
        }

        // Determine output path - handle both absolute and relative paths
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

        if (verbose) {
          console.log(`[Chunked API] Resolved output path: ${outputPath}`)
        }

        const stats: ProcessingStats = {
          totalFiles: totalEstimatedFiles,
          processedFiles: 0,
          successfulFiles: 0,
          errorFiles: 0,
          recordsWritten: 0,
          filteredFiles: 0,
          movedFiles: 0,
        }

        // Calculate total chunks based on directories and chunk size
        const totalChunks = Math.ceil(allDirectories.length / Math.max(1, Math.floor(chunkSize / 10))) // Adjust chunk calculation

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
          xmlFiles: [], // Will be populated per chunk
          outputPath,
          startTime: new Date().toISOString(),
          processedChunks: [],
        }

        // Save initial processing state
        await saveProcessingState(processingState)

        // Create initial session record
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

        // Save initial session
        await history.addSession(session)
        await history.setCurrentSession(session)

        if (verbose) {
          console.log(`[Chunked API] Created session: ${sessionId}`)
          console.log(`[Chunked API] Output path: ${outputPath}`)
        }

        sendMessage(
          "log",
          `Processing directories in chunks. Estimated ${totalEstimatedFiles} files in ${totalChunks} chunks`,
        )

        // Ensure output directory exists
        if (outputFolder) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true })
          if (verbose) {
            console.log(`[Chunked API] Created output directory: ${path.dirname(outputPath)}`)
          }
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

        // Process directories in chunks
        let wasInterrupted = false
        let directoryIndex = 0

        while (directoryIndex < allDirectories.length) {
          const chunkNumber = Math.floor(directoryIndex / Math.max(1, Math.floor(chunkSize / 10))) + 1

          // Update current chunk in processing state
          processingState.currentChunk = chunkNumber
          await saveProcessingState(processingState)

          // Check for pause/stop before processing chunk
          const pauseState = getPauseState()
          if (pauseState.shouldStop) {
            if (verbose) {
              console.log(`[Chunked API] Stop requested before chunk ${chunkNumber}`)
            }
            wasInterrupted = true
            processingState.pauseTime = new Date().toISOString()
            await saveProcessingState(processingState)
            sendMessage("shutdown", {
              reason: "Processing stopped by user",
              stats,
              outputFile: outputPath,
              canResume: true,
              currentChunk: chunkNumber,
              totalChunks,
            })
            safeCloseController()
            return
          }

          if (pauseState.isPaused) {
            if (verbose) {
              console.log(`[Chunked API] Pause requested before chunk ${chunkNumber}`)
            }
            processingState.pauseTime = new Date().toISOString()
            await saveProcessingState(processingState)

            // Update session status to paused
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
              currentChunk: chunkNumber,
              totalChunks,
            })
            safeCloseController()
            return
          }

          // Process current chunk of directories
          const chunkDirectories = allDirectories.slice(
            directoryIndex,
            Math.min(directoryIndex + Math.max(1, Math.floor(chunkSize / 10)), allDirectories.length),
          )

          sendMessage(
            "chunk",
            `Starting chunk ${chunkNumber}/${totalChunks} - Processing ${chunkDirectories.length} directories`,
          )

          if (verbose) {
            console.log(`[Chunked API] Processing chunk ${chunkNumber}/${totalChunks}`)
            console.log(`[Chunked API] Directories in this chunk: ${chunkDirectories.length}`)
          }

          // Scan and process files in current chunk directories
          const chunkXmlFiles: string[] = []
          for (const directory of chunkDirectories) {
            try {
              const dirFiles = await findXMLFilesInDirectory(directory, chunkSize)
              chunkXmlFiles.push(...dirFiles)

              if (verbose) {
                console.log(`[Chunked API] Found ${dirFiles.length} XML files in ${directory}`)
              }
            } catch (error) {
              console.error(`[Chunked API] Error scanning directory ${directory}:`, error)
            }
          }

          if (chunkXmlFiles.length === 0) {
            if (verbose) {
              console.log(`[Chunked API] No XML files found in chunk ${chunkNumber}, skipping`)
            }
            directoryIndex += chunkDirectories.length
            continue
          }

          sendMessage("log", `Chunk ${chunkNumber}: Found ${chunkXmlFiles.length} XML files to process`)

          // Process files in this chunk with workers
          const activeWorkers = new Set<Worker>()
          const chunkPromises = chunkXmlFiles.map((xmlFile, index) =>
            processFile(xmlFile, filterConfig, verbose, activeWorkers, rootDir, index + 1, false),
          )

          try {
            const chunkResults = await Promise.all(chunkPromises)

            // Check for pause/stop during batch processing
            const midProcessPauseState = getPauseState()
            if (midProcessPauseState.shouldStop || midProcessPauseState.isPaused) {
              if (verbose) {
                console.log(`[Chunked API] Pause/Stop requested during chunk processing`)
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

              // Update processing state with current progress
              processingState.stats = stats
              processingState.pauseTime = new Date().toISOString()
              processingState.processedChunks.push(chunkXmlFiles)
              await saveProcessingState(processingState)

              if (midProcessPauseState.shouldStop) {
                wasInterrupted = true
                sendMessage("shutdown", {
                  reason: "Processing stopped during chunk",
                  stats,
                  outputFile: outputPath,
                  canResume: true,
                  currentChunk: chunkNumber,
                  totalChunks,
                })
              } else {
                sendMessage("paused", {
                  message: "Processing paused during chunk - state saved",
                  canResume: true,
                  currentChunk: chunkNumber,
                  totalChunks,
                })
              }

              safeCloseController()
              return
            }

            // Process results normally
            await processChunkResults(chunkResults, outputPath, stats, verbose)

            // Update processing state with current progress
            processingState.stats = stats
            processingState.processedChunks.push(chunkXmlFiles)
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

            sendMessage("chunk", `Completed chunk ${chunkNumber}/${totalChunks}`)

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
              currentChunk: chunkNumber,
              totalChunks,
            })

            if (verbose) {
              console.log(`[Chunked API] Chunk ${chunkNumber}/${totalChunks} completed`)
              console.log(`[Chunked API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
              console.log(
                `[Chunked API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
              )
            }

            // Pause between chunks (except for the last chunk)
            if (directoryIndex + chunkDirectories.length < allDirectories.length && pauseDuration > 0) {
              if (verbose) {
                console.log(`[Chunked API] Pausing for ${pauseDuration}ms between chunks`)
              }

              // Check for pause/stop during the pause period
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
                      currentChunk: chunkNumber + 1,
                      totalChunks,
                    })
                  } else {
                    sendMessage("paused", {
                      message: "Processing paused during chunk pause - state saved",
                      canResume: true,
                      currentChunk: chunkNumber + 1,
                      totalChunks,
                    })
                  }

                  safeCloseController()
                  return
                }
                await new Promise((resolve) => setTimeout(resolve, 200)) // Check every 200ms
              }
            }
          } catch (error) {
            const errorMsg = `Chunk ${chunkNumber} processing error: ${error instanceof Error ? error.message : "Unknown error"}`
            if (verbose) {
              console.error(`[Chunked API] ${errorMsg}`)
            }
            sendMessage("error", errorMsg)
            stats.errorFiles += chunkXmlFiles.length
            stats.processedFiles += chunkXmlFiles.length

            // Update processing state even on error
            processingState.stats = stats
            await saveProcessingState(processingState)
          }

          // Move to next chunk
          directoryIndex += chunkDirectories.length
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

        // Clear current session
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

        // Update session with error status
        if (sessionId) {
          await history.updateSession(sessionId, {
            status: "failed",
            endTime: new Date().toISOString(),
          })
          await history.setCurrentSession(null)
        }

        // Clear processing state on error
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

// Helper function to process chunk results
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

      // Append to CSV file
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

// Helper function for remote file processing in chunks
async function processRemoteFilesInChunks(
  xmlFiles: string[],
  chunkSize: number,
  pauseDuration: number,
  numWorkers: number,
  verbose: boolean,
  filterConfig: any,
  outputFolder: string,
  outputFile: string,
  sessionId: string,
  sendMessage: (type: string, message: any) => void,
  rootDir: string,
): Promise<void> {
  const totalChunks = Math.ceil(xmlFiles.length / chunkSize)

  // Determine output path - handle both absolute and relative paths
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

  if (verbose) {
    console.log(`[Chunked API] Remote processing - Output path: ${outputPath}`)
  }

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

  const stats: ProcessingStats = {
    totalFiles: xmlFiles.length,
    processedFiles: 0,
    successfulFiles: 0,
    errorFiles: 0,
    recordsWritten: 0,
    filteredFiles: 0,
    movedFiles: 0,
  }

  // Create processing state for remote files
  const processingState: ChunkedProcessingState = {
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

  // Save initial processing state
  await saveProcessingState(processingState)

  // Create initial session record
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
      isRemote: true,
    },
    progress: {
      totalFiles: stats.totalFiles,
      processedFiles: 0,
      successCount: 0,
      errorCount: 0,
      processedFilesList: [] as string[],
    },
  }

  // Save initial session
  await history.addSession(session)
  await history.setCurrentSession(session)

  sendMessage("log", `Processing ${xmlFiles.length} remote files in ${totalChunks} chunks`)

  let wasInterrupted = false

  // Process files in chunks
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    // Update current chunk in processing state
    processingState.currentChunk = chunkIndex + 1
    await saveProcessingState(processingState)

    // Check for pause/stop before processing chunk
    const pauseState = getPauseState()
    if (pauseState.shouldStop) {
      if (verbose) {
        console.log(`[Chunked API] Stop requested before remote chunk ${chunkIndex + 1}`)
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
      return
    }

    if (pauseState.isPaused) {
      if (verbose) {
        console.log(`[Chunked API] Pause requested before remote chunk ${chunkIndex + 1}`)
      }
      processingState.pauseTime = new Date().toISOString()
      await saveProcessingState(processingState)

      // Update session status to paused
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
      return
    }

    const startIndex = chunkIndex * chunkSize
    const endIndex = Math.min(startIndex + chunkSize, xmlFiles.length)
    const chunk = xmlFiles.slice(startIndex, endIndex)

    sendMessage("chunk", `Starting remote chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`)

    if (verbose) {
      console.log(`[Chunked API] Processing remote chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`)
    }

    // Process chunk with workers
    const activeWorkers = new Set<Worker>()
    const chunkPromises = chunk.map((xmlFile, index) =>
      processFile(xmlFile, filterConfig, verbose, activeWorkers, rootDir, startIndex + index + 1, true),
    )

    try {
      const chunkResults = await Promise.all(chunkPromises)

      // Check for pause/stop during batch processing
      const midProcessPauseState = getPauseState()
      if (midProcessPauseState.shouldStop || midProcessPauseState.isPaused) {
        if (verbose) {
          console.log(`[Chunked API] Pause/Stop requested during remote batch processing`)
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

        // Update processing state with current progress
        processingState.stats = stats
        processingState.pauseTime = new Date().toISOString()
        processingState.processedChunks.push(chunk)
        await saveProcessingState(processingState)

        if (midProcessPauseState.shouldStop) {
          wasInterrupted = true
          sendMessage("shutdown", {
            reason: "Processing stopped during remote batch",
            stats,
            outputFile: outputPath,
            canResume: true,
            currentChunk: chunkIndex + 1,
            totalChunks,
          })
        } else {
          sendMessage("paused", {
            message: "Processing paused during remote batch - state saved",
            canResume: true,
            currentChunk: chunkIndex + 1,
            totalChunks,
          })
        }

        return
      }

      // Process results normally
      await processChunkResults(chunkResults, outputPath, stats, verbose)

      // Update processing state with current progress
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

      sendMessage("chunk", `Completed remote chunk ${chunkIndex + 1}/${totalChunks}`)

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
        console.log(`[Chunked API] Remote chunk ${chunkIndex + 1}/${totalChunks} completed`)
        console.log(`[Chunked API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
        console.log(
          `[Chunked API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
        )
      }

      // Pause between chunks (except for the last chunk)
      if (chunkIndex < totalChunks - 1 && pauseDuration > 0) {
        if (verbose) {
          console.log(`[Chunked API] Pausing for ${pauseDuration}ms between remote chunks`)
        }

        // Check for pause/stop during the pause period
        const pauseStartTime = Date.now()
        while (Date.now() - pauseStartTime < pauseDuration) {
          const pauseCheckState = getPauseState()
          if (pauseCheckState.shouldStop || pauseCheckState.isPaused) {
            if (verbose) {
              console.log(`[Chunked API] Pause/Stop requested during remote chunk pause`)
            }

            processingState.pauseTime = new Date().toISOString()
            await saveProcessingState(processingState)

            if (pauseCheckState.shouldStop) {
              wasInterrupted = true
              sendMessage("shutdown", {
                reason: "Processing stopped during remote chunk pause",
                stats,
                outputFile: outputPath,
                canResume: true,
                currentChunk: chunkIndex + 2, // Next chunk to process
                totalChunks,
              })
            } else {
              sendMessage("paused", {
                message: "Processing paused during remote chunk pause - state saved",
                canResume: true,
                currentChunk: chunkIndex + 2, // Next chunk to process
                totalChunks,
              })
            }

            return
          }
          await new Promise((resolve) => setTimeout(resolve, 200)) // Check every 200ms
        }
      }
    } catch (error) {
      const errorMsg = `Remote chunk ${chunkIndex + 1} processing error: ${error instanceof Error ? error.message : "Unknown error"}`
      if (verbose) {
        console.error(`[Chunked API] ${errorMsg}`)
      }
      sendMessage("error", errorMsg)
      stats.errorFiles += chunk.length
      stats.processedFiles += chunk.length

      // Update processing state even on error
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

  // Clear current session
  await history.setCurrentSession(null)

  // Send completion message
  if (!wasInterrupted) {
    const completionMessage = `Remote chunked processing completed! Processed ${stats.processedFiles} files in ${totalChunks} chunks, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`

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
    // Check for pause/stop before creating worker
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
    }, 30000) // 30 second timeout

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
