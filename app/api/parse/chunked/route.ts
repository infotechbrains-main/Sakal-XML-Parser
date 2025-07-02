import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"

// Global pause state - moved inline to avoid import issues
let globalPauseState = {
  isPaused: false,
  shouldStop: false,
  pauseRequested: false,
  stopRequested: false,
}

function getPauseState() {
  return globalPauseState
}

function resetPauseState() {
  globalPauseState = {
    isPaused: false,
    shouldStop: false,
    pauseRequested: false,
    stopRequested: false,
  }
}

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

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await request.json()
        const {
          rootDir,
          outputFile = "image_metadata.csv",
          outputFolder = "",
          numWorkers = 4,
          chunkSize = 100,
          pauseBetweenChunks = false, // This should be a boolean
          pauseDuration = 0, // This should be the actual duration in seconds
          verbose = false,
          filterConfig = null,
        } = body

        // Reset pause state at start
        resetPauseState()

        const sendMessage = (type: string, message: any) => {
          try {
            const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))

            // Also log to console if verbose
            if (verbose) {
              console.log(`[Chunked API] ${type.toUpperCase()}: ${JSON.stringify(message)}`)
            }
          } catch (error) {
            console.error("Error sending message:", error)
          }
        }

        sendMessage("start", "Starting chunked processing...")

        if (verbose) {
          console.log(`[Chunked API] Configuration:`)
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
          controller.close()
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

        // Calculate chunks
        const chunks = []
        for (let i = 0; i < xmlFiles.length; i += chunkSize) {
          chunks.push(xmlFiles.slice(i, i + chunkSize))
        }

        sendMessage("log", `Processing ${xmlFiles.length} files in ${chunks.length} chunks of ${chunkSize}`)

        if (verbose) {
          console.log(`[Chunked API] Created ${chunks.length} chunks from ${xmlFiles.length} files`)
          if (pauseBetweenChunks) {
            console.log(`[Chunked API] Will pause ${pauseDuration}s between each chunk`)
          }
        }

        // Determine output path
        const outputPath = outputFolder ? path.join(outputFolder, outputFile) : path.join(process.cwd(), outputFile)

        // Ensure output directory exists
        if (outputFolder) {
          await fs.mkdir(outputFolder, { recursive: true })
          if (verbose) {
            console.log(`[Chunked API] Created output directory: ${outputFolder}`)
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

        // Process chunks
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const currentChunkNumber = chunkIndex + 1

          if (verbose) {
            console.log(`[Chunked API] Starting chunk ${currentChunkNumber}/${chunks.length}`)
          }

          // Check for pause/stop
          const pauseState = getPauseState()
          if (pauseState.shouldStop) {
            sendMessage("shutdown", {
              reason: "Processing stopped by user",
              stats,
              outputFile: outputPath,
            })
            break
          }

          if (pauseState.isPaused) {
            sendMessage("paused", "Processing paused - waiting for resume...")

            // Wait for resume
            while (getPauseState().isPaused && !getPauseState().shouldStop) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }

            if (getPauseState().shouldStop) {
              sendMessage("shutdown", {
                reason: "Processing stopped while paused",
                stats,
                outputFile: outputPath,
              })
              break
            }

            sendMessage("log", "Processing resumed")
          }

          const chunk = chunks[chunkIndex]
          sendMessage("chunk_start", {
            chunkNumber: currentChunkNumber,
            totalChunks: chunks.length,
            chunkSize: chunk.length,
          })

          // Process chunk
          const activeWorkers = new Set<Worker>()
          const batchSize = Math.min(numWorkers, chunk.length)

          for (let i = 0; i < chunk.length; i += batchSize) {
            const batch = chunk.slice(i, i + batchSize)
            const batchPromises = batch.map((xmlFile, index) =>
              processFile(xmlFile, filterConfig, verbose, activeWorkers, rootDir, i + index + 1),
            )

            try {
              const batchResults = await Promise.all(batchPromises)

              for (const result of batchResults) {
                stats.processedFiles++

                if (result.record) {
                  stats.successfulFiles++
                  stats.recordsWritten++

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
                  if (verbose && result.error) {
                    console.log(`[Chunked API] Error processing file: ${result.error}`)
                    sendMessage("log", `Error processing file: ${result.error}`)
                  }
                }

                if (!result.passedFilter) {
                  stats.filteredFiles++
                }

                if (result.imageMoved) {
                  stats.movedFiles++
                }
              }
            } catch (error) {
              const errorMsg = `Batch processing error: ${error instanceof Error ? error.message : "Unknown error"}`
              if (verbose) {
                console.error(`[Chunked API] ${errorMsg}`)
              }
              sendMessage("error", errorMsg)
              stats.errorFiles += batch.length
              stats.processedFiles += batch.length
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
            totalChunks: chunks.length,
          })

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
          })

          if (verbose) {
            console.log(`[Chunked API] Chunk ${currentChunkNumber}/${chunks.length} completed`)
            console.log(`[Chunked API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
            console.log(
              `[Chunked API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
            )
          }

          // Pause between chunks if configured
          if (pauseBetweenChunks && pauseDuration > 0 && chunkIndex < chunks.length - 1) {
            sendMessage("pause_start", {
              duration: pauseDuration,
              message: `Pausing for ${pauseDuration} seconds before next chunk...`,
            })

            if (verbose) {
              console.log(`[Chunked API] Pausing for ${pauseDuration} seconds before next chunk...`)
            }

            for (let countdown = pauseDuration; countdown > 0; countdown--) {
              sendMessage("pause_countdown", {
                remaining: countdown,
                message: `Resuming in ${countdown} seconds...`,
              })

              if (verbose && countdown % 5 === 0) {
                // Log every 5 seconds to avoid spam
                console.log(`[Chunked API] Resuming in ${countdown} seconds...`)
              }

              await new Promise((resolve) => setTimeout(resolve, 1000))

              // Check for stop during pause
              if (getPauseState().shouldStop) {
                sendMessage("shutdown", {
                  reason: "Processing stopped during chunk pause",
                  stats,
                  outputFile: outputPath,
                })
                controller.close()
                return
              }
            }

            sendMessage("pause_end", "Resuming processing...")

            if (verbose) {
              console.log(`[Chunked API] Pause completed, resuming processing...`)
            }
          }
        }

        // Send completion message
        if (!getPauseState().shouldStop) {
          const completionMessage = `Chunked processing completed! Processed ${stats.processedFiles} files, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`

          if (verbose) {
            console.log(`[Chunked API] ${completionMessage}`)
            console.log(`[Chunked API] Final stats:`, stats)
            console.log(`[Chunked API] Output file: ${outputPath}`)
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
      } finally {
        try {
          controller.close()
        } catch (closeError) {
          console.error("Error closing controller:", closeError)
        }
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
