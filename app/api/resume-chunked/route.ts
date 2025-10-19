import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { getPauseState, resetPauseState } from "../parse/pause/route"
import { PersistentHistory } from "@/lib/persistent-history"
import { scanLocalDirectoryForAssets } from "@/lib/media-stats"
import { processImagesWithoutXml } from "@/lib/no-xml-processor"
import { isRemotePath } from "@/lib/remote-file-handler"

interface ProcessingStats {
  totalFiles: number
  processedFiles: number
  successfulFiles: number
  errorFiles: number
  recordsWritten: number
  filteredFiles: number
  movedFiles: number
  totalMediaFiles: number
  mediaFilesMatched: number
  localMediaFilesMatched: number
  remoteMediaFilesMatched: number
  mediaFilesUnmatched: number
  xmlFilesWithMedia: number
  xmlFilesMissingMedia: number
  xmlProcessedWithoutMedia: number
  mediaCountsByExtension: Record<string, number>
  noXmlImagesConsidered: number
  noXmlImagesRecorded: number
  noXmlImagesFilteredOut: number
  noXmlImagesMoved: number
  noXmlDestinationPath?: string
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
  mediaFiles: string[]
  matchedImagePaths: string[]
  remoteMediaMatches: number
  outputPath: string
  startTime: string
  pauseTime?: string
  processedChunks?: string[][]
  scanWarnings?: string[]
}

const CHUNKED_STATE_FILE = path.join(process.cwd(), "chunked_processing_state.json")
const history = new PersistentHistory()

// Load processing state from file
async function loadProcessingState(): Promise<ChunkedProcessingState | null> {
  try {
    const data = await fs.readFile(CHUNKED_STATE_FILE, "utf8")
    const state = JSON.parse(data)
    console.log("[Resume API] Loaded processing state from file")
    return state
  } catch (error) {
    console.log("[Resume API] No saved processing state found")
    return null
  }
}

// Save processing state to file
async function saveProcessingState(state: ChunkedProcessingState): Promise<void> {
  try {
    await fs.writeFile(CHUNKED_STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    console.log("[Resume API] Saved processing state to file")
  } catch (error) {
    console.error("[Resume API] Error saving processing state:", error)
  }
}

// Clear processing state file
async function clearProcessingState(): Promise<void> {
  try {
    await fs.unlink(CHUNKED_STATE_FILE)
    console.log("[Resume API] Cleared processing state file")
  } catch (error) {
    // File doesn't exist, which is fine
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
  let controllerClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      const safeCloseController = () => {
        if (!controllerClosed) {
          try {
            controller.close()
            controllerClosed = true
            console.log("[Resume API] Controller closed safely")
          } catch (error) {
            console.error("[Resume API] Error closing controller:", error)
          }
        }
      }

      const sendMessage = (type: string, message: any) => {
        if (controllerClosed) {
          console.log(`[Resume API] Skipping message (controller closed): ${type}`)
          return
        }

        try {
          const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() })
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch (error) {
          console.error("[Resume API] Error sending message:", error)
        }
      }

      try {
        // Load saved processing state
        const savedState = await loadProcessingState()

        if (!savedState) {
          sendMessage("error", "No saved processing state found. Cannot resume.")
          safeCloseController()
          return
        }

        // Reset pause state
        resetPauseState()

        const { sessionId, config, stats, currentChunk, totalChunks, chunkSize, xmlFiles, outputPath } = savedState
        const { pauseDuration, numWorkers, verbose, filterConfig, rootDir } = config

        const normalizedRootDir = path.resolve(rootDir)
        let mediaFiles = Array.isArray(savedState.mediaFiles) ? [...savedState.mediaFiles] : []
        const matchedLocalMediaPaths = new Set<string>(
          Array.isArray(savedState.matchedImagePaths) ? savedState.matchedImagePaths : [],
        )
        let remoteMediaMatches =
          typeof savedState.remoteMediaMatches === "number"
            ? savedState.remoteMediaMatches
            : stats.remoteMediaFilesMatched ?? 0
        const scanWarnings = Array.isArray(savedState.scanWarnings) ? [...savedState.scanWarnings] : []
        const isRemote = config?.isRemote ?? (await isRemotePath(rootDir))

        if (!isRemote && mediaFiles.length === 0) {
          try {
            const scanResult = await scanLocalDirectoryForAssets(normalizedRootDir)
            mediaFiles = scanResult.mediaFiles
            if (scanResult.mediaCountsByExtension && Object.keys(scanResult.mediaCountsByExtension).length > 0) {
              stats.mediaCountsByExtension = scanResult.mediaCountsByExtension
            }
            if (scanResult.errors.length > 0) {
              scanWarnings.push(...scanResult.errors)
            }
          } catch (error) {
            if (verbose) {
              console.error("[Resume API] Error scanning directory while resuming:", error)
            }
          }
        }

        stats.totalMediaFiles = mediaFiles.length
        stats.mediaFilesUnmatched = Math.max(stats.totalMediaFiles - matchedLocalMediaPaths.size, 0)
        stats.mediaCountsByExtension = stats.mediaCountsByExtension || {}
  stats.remoteMediaFilesMatched = stats.remoteMediaFilesMatched ?? 0
  stats.noXmlImagesConsidered = stats.noXmlImagesConsidered ?? 0
  stats.noXmlImagesRecorded = stats.noXmlImagesRecorded ?? 0
  stats.noXmlImagesFilteredOut = stats.noXmlImagesFilteredOut ?? 0
  stats.noXmlImagesMoved = stats.noXmlImagesMoved ?? 0

        const updateMediaStatsFromRecord = (record: any) => {
          if (!record) return

          const imageExistsValue =
            typeof record.imageExists === "string"
              ? record.imageExists.toLowerCase() === "yes"
              : Boolean(record.imageExists)

          if (imageExistsValue) {
            stats.xmlFilesWithMedia++
            const imagePath = typeof record.imagePath === "string" ? record.imagePath : ""
            if (imagePath) {
              if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
                remoteMediaMatches++
              } else {
                matchedLocalMediaPaths.add(path.normalize(imagePath))
              }
            }
          } else {
            stats.xmlProcessedWithoutMedia++
          }

          stats.localMediaFilesMatched = matchedLocalMediaPaths.size
          stats.remoteMediaFilesMatched = remoteMediaMatches
          stats.mediaFilesMatched = matchedLocalMediaPaths.size + remoteMediaMatches
          stats.mediaFilesUnmatched = Math.max(stats.totalMediaFiles - matchedLocalMediaPaths.size, 0)
          stats.xmlFilesMissingMedia = Math.max(stats.totalFiles - stats.xmlFilesWithMedia, 0)
        }

        const persistProcessingState = async () => {
          savedState.mediaFiles = mediaFiles
          savedState.matchedImagePaths = Array.from(matchedLocalMediaPaths)
          savedState.remoteMediaMatches = remoteMediaMatches
          savedState.stats = stats
          savedState.scanWarnings = scanWarnings
          await saveProcessingState(savedState)
        }

        sendMessage("start", `Resuming chunked processing from chunk ${currentChunk}/${totalChunks}`)

        if (verbose) {
          console.log(`[Resume API] Resuming processing:`)
          console.log(`  - Session ID: ${sessionId}`)
          console.log(`  - Current Chunk: ${currentChunk}/${totalChunks}`)
          console.log(`  - Files Processed: ${stats.processedFiles}/${stats.totalFiles}`)
          console.log(`  - Output Path: ${outputPath}`)
          console.log(`  - Resuming ${isRemote ? "remote" : "local"} processing`)
        }

        // Update session to running
        await history.updateSession(sessionId, {
          status: "running",
        })
        await history.setCurrentSession({ id: sessionId } as any)

        // Continue processing from current chunk
        let wasInterrupted = false
        const startChunkIndex = currentChunk - 1 // Convert to 0-based index

        for (let chunkIndex = startChunkIndex; chunkIndex < totalChunks; chunkIndex++) {
          // Update current chunk in processing state
          savedState.currentChunk = chunkIndex + 1
          await persistProcessingState()

          // Check for pause/stop before processing chunk
          const pauseState = getPauseState()
          if (pauseState.shouldStop) {
            if (verbose) {
              console.log(`[Resume API] Stop requested before chunk ${chunkIndex + 1}`)
            }
            wasInterrupted = true
            savedState.pauseTime = new Date().toISOString()
            await persistProcessingState()
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
              console.log(`[Resume API] Pause requested before chunk ${chunkIndex + 1}`)
            }
            savedState.pauseTime = new Date().toISOString()
            await persistProcessingState()

            // Update session status to paused
            await history.updateSession(sessionId, {
              status: "paused",
              progress: {
                totalFiles: stats.totalFiles,
                processedFiles: stats.processedFiles,
                successCount: stats.successfulFiles,
                errorCount: stats.errorFiles,
                mediaFilesTotal: stats.totalMediaFiles,
                mediaFilesMatched: stats.mediaFilesMatched,
                mediaFilesUnmatched: stats.mediaFilesUnmatched,
                xmlFilesWithMedia: stats.xmlFilesWithMedia,
                xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
                noXmlImagesRecorded: stats.noXmlImagesRecorded,
                noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
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

          sendMessage("chunk", `Starting chunk ${chunkIndex + 1}/${totalChunks}`)

          if (verbose) {
            console.log(`[Resume API] Processing chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`)
          }

          // Process chunk with workers
          const activeWorkers = new Set<Worker>()
          const chunkPromises = chunk.map((xmlFile, index) =>
            processFile(xmlFile, filterConfig, verbose, activeWorkers, rootDir, startIndex + index + 1),
          )

          try {
            const chunkResults = await Promise.all(chunkPromises)

            // Check for pause/stop during batch processing
            const midProcessPauseState = getPauseState()
            if (midProcessPauseState.shouldStop || midProcessPauseState.isPaused) {
              if (verbose) {
                console.log(`[Resume API] Pause/Stop requested during batch processing`)
              }

              // Cleanup workers
              for (const worker of activeWorkers) {
                try {
                  worker.terminate()
                } catch (error) {
                  if (verbose) {
                    console.error("[Resume API] Error terminating worker:", error)
                  }
                }
              }
              activeWorkers.clear()

              // Process results we got before interruption
              for (const result of chunkResults) {
                if (result) {
                  stats.processedFiles++

                  if (result.record) {
                    stats.successfulFiles++
                    stats.recordsWritten++
                    updateMediaStatsFromRecord(result.record)

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

                    await fs.appendFile(outputPath, csvLine, "utf8")
                  } else {
                    stats.errorFiles++
                  }

                  if (!result.passedFilter) {
                    stats.filteredFiles++
                  }

                  if (result.imageMoved) {
                    stats.movedFiles++
                  }
                }
              }

              // Update processing state with current progress
              savedState.pauseTime = new Date().toISOString()
              await persistProcessingState()

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
            for (const result of chunkResults) {
              stats.processedFiles++

              if (result.record) {
                stats.successfulFiles++
                stats.recordsWritten++
                updateMediaStatsFromRecord(result.record)

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
                  console.log(`[Resume API] Error processing file: ${result.error}`)
                }
              }

              if (!result.passedFilter) {
                stats.filteredFiles++
              }

              if (result.imageMoved) {
                stats.movedFiles++
              }
            }

            // Update processing state with current progress
            await persistProcessingState()

            // Update session progress
            await history.updateSession(sessionId, {
              progress: {
                totalFiles: stats.totalFiles,
                processedFiles: stats.processedFiles,
                successCount: stats.successfulFiles,
                errorCount: stats.errorFiles,
                mediaFilesTotal: stats.totalMediaFiles,
                mediaFilesMatched: stats.mediaFilesMatched,
                mediaFilesUnmatched: stats.mediaFilesUnmatched,
                xmlFilesWithMedia: stats.xmlFilesWithMedia,
                xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
                noXmlImagesRecorded: stats.noXmlImagesRecorded,
                noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
              },
            })

            // Cleanup workers
            for (const worker of activeWorkers) {
              try {
                worker.terminate()
              } catch (error) {
                if (verbose) {
                  console.error("[Resume API] Error terminating worker:", error)
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
              stats: {
                totalFiles: stats.totalFiles,
                processedFiles: stats.processedFiles,
                successCount: stats.successfulFiles,
                errorCount: stats.errorFiles,
                filteredCount: stats.filteredFiles,
                movedCount: stats.movedFiles,
                mediaFilesTotal: stats.totalMediaFiles,
                mediaFilesMatched: stats.mediaFilesMatched,
                localMediaFilesMatched: stats.localMediaFilesMatched,
                remoteMediaFilesMatched: stats.remoteMediaFilesMatched,
                mediaFilesUnmatched: stats.mediaFilesUnmatched,
                xmlFilesWithMedia: stats.xmlFilesWithMedia,
                xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
                xmlProcessedWithoutMedia: stats.xmlProcessedWithoutMedia,
                noXmlImagesConsidered: stats.noXmlImagesConsidered,
                noXmlImagesRecorded: stats.noXmlImagesRecorded,
                noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
                noXmlImagesMoved: stats.noXmlImagesMoved,
                noXmlDestinationPath: stats.noXmlDestinationPath,
              },
            })

            if (verbose) {
              console.log(`[Resume API] Chunk ${chunkIndex + 1}/${totalChunks} completed`)
              console.log(`[Resume API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
              console.log(
                `[Resume API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
              )
            }

            // Pause between chunks (except for the last chunk)
            if (chunkIndex < totalChunks - 1 && pauseDuration > 0) {
              if (verbose) {
                console.log(`[Resume API] Pausing for ${pauseDuration}ms between chunks`)
              }

              // Check for pause/stop during the pause period
              const pauseStartTime = Date.now()
              while (Date.now() - pauseStartTime < pauseDuration) {
                const pauseCheckState = getPauseState()
                if (pauseCheckState.shouldStop || pauseCheckState.isPaused) {
                  if (verbose) {
                    console.log(`[Resume API] Pause/Stop requested during chunk pause`)
                  }

                  savedState.pauseTime = new Date().toISOString()
                  await persistProcessingState()

                  if (pauseCheckState.shouldStop) {
                    wasInterrupted = true
                    sendMessage("shutdown", {
                      reason: "Processing stopped during chunk pause",
                      stats,
                      outputFile: outputPath,
                      canResume: true,
                      currentChunk: chunkIndex + 2, // Next chunk to process
                      totalChunks,
                    })
                  } else {
                    sendMessage("paused", {
                      message: "Processing paused during chunk pause - state saved",
                      canResume: true,
                      currentChunk: chunkIndex + 2, // Next chunk to process
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
            const errorMsg = `Chunk ${chunkIndex + 1} processing error: ${error instanceof Error ? error.message : "Unknown error"}`
            if (verbose) {
              console.error(`[Resume API] ${errorMsg}`)
            }
            sendMessage("error", errorMsg)
            stats.errorFiles += chunk.length
            stats.processedFiles += chunk.length

            // Update processing state even on error
            await persistProcessingState()
          }
        }

        // Clear processing state file on successful completion
        await clearProcessingState()

        if (!wasInterrupted && !isRemote) {
          if (mediaFiles.length === 0) {
            try {
              const scanResult = await scanLocalDirectoryForAssets(normalizedRootDir)
              mediaFiles = scanResult.mediaFiles
              if (scanResult.mediaCountsByExtension && Object.keys(scanResult.mediaCountsByExtension).length > 0) {
                stats.mediaCountsByExtension = scanResult.mediaCountsByExtension
              }
              if (scanResult.errors.length > 0) {
                scanWarnings.push(...scanResult.errors)
              }
              stats.totalMediaFiles = mediaFiles.length
            } catch (error) {
              if (verbose) {
                console.error("[Resume API] Error rescanning media files for no-XML processing:", error)
              }
            }
          }

          const noXmlResult = await processImagesWithoutXml({
            rootDir: normalizedRootDir,
            mediaFiles,
            matchedImagePaths: matchedLocalMediaPaths,
            filterConfig,
            verbose,
            collectRecords: false,
            onRecord: async (record) => {
              const csvLine =
                Object.values(record)
                  .map((value) =>
                    typeof value === "string" && (value.includes(",") || value.includes("\"") || value.includes("\n"))
                      ? `"${String(value).replace(/"/g, '""')}"`
                      : value || "",
                  )
                  .join(",") + "\n"

              await fs.appendFile(outputPath, csvLine, "utf8")
              stats.recordsWritten++
            },
            onLog: (message) => {
              if (verbose) {
                sendMessage("log", message)
              }
            },
          })

          stats.noXmlImagesConsidered = noXmlResult.stats.considered
          stats.noXmlImagesRecorded = noXmlResult.stats.recorded
          stats.noXmlImagesFilteredOut = noXmlResult.stats.filteredOut
          stats.noXmlImagesMoved = noXmlResult.stats.moved
          stats.noXmlDestinationPath = noXmlResult.destinationPath

          if (noXmlResult.errors.length > 0 && verbose) {
            noXmlResult.errors.forEach((err) => sendMessage("log", err))
          }

          stats.localMediaFilesMatched = matchedLocalMediaPaths.size
          stats.remoteMediaFilesMatched = remoteMediaMatches
          stats.mediaFilesMatched = matchedLocalMediaPaths.size + remoteMediaMatches
          stats.mediaFilesUnmatched = Math.max(stats.totalMediaFiles - matchedLocalMediaPaths.size, 0)
          stats.xmlFilesMissingMedia = Math.max(stats.totalFiles - stats.xmlFilesWithMedia, 0)
        }

        // Update final session status
        const finalStatus = wasInterrupted ? "interrupted" : "completed"
        const endTime = new Date().toISOString()

        const statsSummary = {
          totalFiles: stats.totalFiles,
          processedFiles: stats.processedFiles,
          successfulFiles: stats.successfulFiles,
          errorFiles: stats.errorFiles,
          recordsWritten: stats.recordsWritten,
          filteredFiles: stats.filteredFiles,
          movedFiles: stats.movedFiles,
          totalMediaFiles: stats.totalMediaFiles,
          mediaFilesMatched: stats.mediaFilesMatched,
          localMediaFilesMatched: stats.localMediaFilesMatched,
          remoteMediaFilesMatched: stats.remoteMediaFilesMatched,
          mediaFilesUnmatched: stats.mediaFilesUnmatched,
          xmlFilesWithMedia: stats.xmlFilesWithMedia,
          xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
          xmlProcessedWithoutMedia: stats.xmlProcessedWithoutMedia,
          mediaCountsByExtension: stats.mediaCountsByExtension,
          noXmlImagesConsidered: stats.noXmlImagesConsidered,
          noXmlImagesRecorded: stats.noXmlImagesRecorded,
          noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
          noXmlImagesMoved: stats.noXmlImagesMoved,
          noXmlDestinationPath: stats.noXmlDestinationPath,
        }

        await history.updateSession(sessionId, {
          status: finalStatus,
          endTime,
          progress: {
            totalFiles: stats.totalFiles,
            processedFiles: stats.processedFiles,
            successCount: stats.successfulFiles,
            errorCount: stats.errorFiles,
            mediaFilesTotal: stats.totalMediaFiles,
            mediaFilesMatched: stats.mediaFilesMatched,
            mediaFilesUnmatched: stats.mediaFilesUnmatched,
            xmlFilesWithMedia: stats.xmlFilesWithMedia,
            xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
            noXmlImagesRecorded: stats.noXmlImagesRecorded,
            noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
          },
          results: {
            outputPath,
            stats: statsSummary,
          },
        })

        // Clear current session
        await history.setCurrentSession(null)

        // Send completion message
        if (!wasInterrupted) {
          const completionMessage = `Resumed chunked processing completed! Processed ${stats.processedFiles} files in ${totalChunks} chunks, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`

          if (verbose) {
            console.log(`[Resume API] ${completionMessage}`)
            console.log(`[Resume API] Final stats:`, stats)
            console.log(`[Resume API] Output file: ${outputPath}`)
            console.log(`[Resume API] Session ${sessionId} completed successfully`)
          }

          sendMessage("complete", {
            stats,
            outputFile: outputPath,
            message: completionMessage,
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        console.error("[Resume API] Fatal error:", errorMessage)

        // Clear processing state on error
        await clearProcessingState()

        if (!controllerClosed) {
          try {
            const data = JSON.stringify({
              type: "error",
              message: `Resume processing error: ${errorMessage}`,
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
      console.log(`[Resume API] Creating worker ${workerId} for file: ${path.basename(xmlFile)}`)
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
          console.log(`[Resume API] Worker ${workerId} timed out after 30 seconds`)
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
          console.log(`[Resume API] Worker ${workerId} completed successfully`)
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
          console.error(`[Resume API] Worker ${workerId} error:`, error.message)
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
            console.log(`[Resume API] Worker ${workerId} exited with code ${code}`)
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

export async function GET() {
  try {
    const savedState = await loadProcessingState()

    if (!savedState) {
      return NextResponse.json({
        success: false,
        message: "No saved processing state found",
        canResume: false,
      })
    }

    return NextResponse.json({
      success: true,
      message: "Processing state found",
      canResume: true,
      state: {
        sessionId: savedState.sessionId,
        currentChunk: savedState.currentChunk,
        totalChunks: savedState.totalChunks,
        processedFiles: savedState.stats.processedFiles,
        totalFiles: savedState.stats.totalFiles,
        pauseTime: savedState.pauseTime,
      },
    })
  } catch (error) {
    console.error("[Resume API] Error checking resume state:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Error checking resume state",
        canResume: false,
      },
      { status: 500 },
    )
  }
}
