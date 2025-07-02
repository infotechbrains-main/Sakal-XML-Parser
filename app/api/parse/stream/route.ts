import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { getPauseState, resetPauseState } from "./pause/route"
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

const history = new PersistentHistory()

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let sessionId: string | null = null

      try {
        const body = await request.json()
        const {
          rootDir,
          outputFile = "image_metadata.csv",
          outputFolder = "",
          numWorkers = 4,
          verbose = false,
          filterConfig = null,
        } = body

        // Reset pause state at the start of processing
        resetPauseState()

        // Create session ID
        sessionId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        const sendMessage = (type: string, message: any) => {
          try {
            const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))

            if (verbose) {
              console.log(`[Stream API] ${type.toUpperCase()}: ${JSON.stringify(message)}`)
            }
          } catch (error) {
            console.error("Error sending message:", error)
          }
        }

        sendMessage("start", "Starting stream processing...")

        if (verbose) {
          console.log(`[Stream API] Configuration:`)
          console.log(`  - Session ID: ${sessionId}`)
          console.log(`  - Root Directory: ${rootDir}`)
          console.log(`  - Output File: ${outputFile}`)
          console.log(`  - Output Folder: ${outputFolder || "current directory"}`)
          console.log(`  - Workers: ${numWorkers}`)
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

        // Determine output path - FIXED: Use full path including output folder
        const outputPath = outputFolder ? path.join(outputFolder, outputFile) : path.join(process.cwd(), outputFile)

        // Create initial session record
        const session = {
          id: sessionId,
          startTime: new Date().toISOString(),
          status: "running" as const,
          config: {
            rootDir,
            outputFile: outputPath, // Store full path in session
            numWorkers,
            verbose,
            filterConfig,
            processingMode: "stream",
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
          console.log(`[Stream API] Created session: ${sessionId}`)
          console.log(`[Stream API] Output path: ${outputPath}`)
        }

        sendMessage("log", `Processing ${xmlFiles.length} files with ${numWorkers} workers`)

        // Ensure output directory exists
        if (outputFolder) {
          await fs.mkdir(outputFolder, { recursive: true })
          if (verbose) {
            console.log(`[Stream API] Created output directory: ${outputFolder}`)
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
          console.log(`[Stream API] Initialized CSV file: ${outputPath}`)
        }

        // Process files in batches
        const activeWorkers = new Set<Worker>()
        let wasInterrupted = false

        for (let i = 0; i < xmlFiles.length; i += numWorkers) {
          // Check for pause/stop - FIXED: Check more frequently
          const pauseState = getPauseState()
          if (pauseState.shouldStop) {
            if (verbose) {
              console.log(`[Stream API] Stop requested, terminating processing`)
            }
            wasInterrupted = true
            sendMessage("shutdown", {
              reason: "Processing stopped by user",
              stats,
              outputFile: outputPath,
            })
            break
          }

          if (pauseState.isPaused) {
            if (verbose) {
              console.log(`[Stream API] Pause requested, waiting for resume`)
            }
            sendMessage("paused", "Processing paused - waiting for resume...")

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

            // Wait for resume - FIXED: Check more frequently
            while (getPauseState().isPaused && !getPauseState().shouldStop) {
              await new Promise((resolve) => setTimeout(resolve, 500)) // Check every 500ms instead of 1000ms
            }

            if (getPauseState().shouldStop) {
              if (verbose) {
                console.log(`[Stream API] Stop requested while paused, terminating processing`)
              }
              wasInterrupted = true
              sendMessage("shutdown", {
                reason: "Processing stopped while paused",
                stats,
                outputFile: outputPath,
              })
              break
            }

            // Update session status back to running
            await history.updateSession(sessionId, {
              status: "running",
            })

            if (verbose) {
              console.log(`[Stream API] Processing resumed`)
            }
            sendMessage("log", "Processing resumed")
          }

          const batch = xmlFiles.slice(i, i + numWorkers)
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
                      typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))
                        ? `"${String(value).replace(/"/g, '""')}"`
                        : value || "",
                    )
                    .join(",") + "\n"

                await fs.appendFile(outputPath, csvLine, "utf8")
              } else {
                stats.errorFiles++
                if (verbose && result.error) {
                  console.log(`[Stream API] Error processing file: ${result.error}`)
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

            // Update session progress periodically
            if (stats.processedFiles % 50 === 0 || stats.processedFiles === stats.totalFiles) {
              await history.updateSession(sessionId, {
                progress: {
                  totalFiles: stats.totalFiles,
                  processedFiles: stats.processedFiles,
                  successCount: stats.successfulFiles,
                  errorCount: stats.errorFiles,
                },
              })
            }

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
              console.log(`[Stream API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
              console.log(
                `[Stream API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
              )
            }
          } catch (error) {
            const errorMsg = `Batch processing error: ${error instanceof Error ? error.message : "Unknown error"}`
            if (verbose) {
              console.error(`[Stream API] ${errorMsg}`)
            }
            sendMessage("error", errorMsg)
            stats.errorFiles += batch.length
            stats.processedFiles += batch.length
          }

          // FIXED: Check pause/stop after each batch
          const postBatchPauseState = getPauseState()
          if (postBatchPauseState.shouldStop) {
            if (verbose) {
              console.log(`[Stream API] Stop requested after batch, terminating processing`)
            }
            wasInterrupted = true
            sendMessage("shutdown", {
              reason: "Processing stopped after batch",
              stats,
              outputFile: outputPath,
            })
            break
          }

          if (postBatchPauseState.isPaused) {
            if (verbose) {
              console.log(`[Stream API] Pause requested after batch`)
            }
            sendMessage("paused", "Processing paused after batch - waiting for resume...")

            // Wait for resume
            while (getPauseState().isPaused && !getPauseState().shouldStop) {
              await new Promise((resolve) => setTimeout(resolve, 500))
            }

            if (getPauseState().shouldStop) {
              wasInterrupted = true
              sendMessage("shutdown", {
                reason: "Processing stopped while paused after batch",
                stats,
                outputFile: outputPath,
              })
              break
            }

            sendMessage("log", "Processing resumed after batch")
          }
        }

        // Cleanup workers
        for (const worker of activeWorkers) {
          try {
            worker.terminate()
          } catch (error) {
            if (verbose) {
              console.error("[Stream API] Error terminating worker:", error)
            }
          }
        }
        activeWorkers.clear()

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
          const completionMessage = `Stream processing completed! Processed ${stats.processedFiles} files, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`

          if (verbose) {
            console.log(`[Stream API] ${completionMessage}`)
            console.log(`[Stream API] Final stats:`, stats)
            console.log(`[Stream API] Output file: ${outputPath}`)
            console.log(`[Stream API] Session ${sessionId} completed successfully`)
          }

          sendMessage("complete", {
            stats,
            outputFile: outputPath,
            message: completionMessage,
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        console.error("[Stream API] Fatal error:", errorMessage)

        // Update session with error status
        if (sessionId) {
          await history.updateSession(sessionId, {
            status: "failed",
            endTime: new Date().toISOString(),
          })
          await history.setCurrentSession(null)
        }

        try {
          const data = JSON.stringify({
            type: "error",
            message: `Stream processing error: ${errorMessage}`,
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
      console.log(`[Stream API] Creating worker ${workerId} for file: ${path.basename(xmlFile)}`)
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
          console.log(`[Stream API] Worker ${workerId} timed out after 30 seconds`)
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
          console.log(`[Stream API] Worker ${workerId} completed successfully`)
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
          console.error(`[Stream API] Worker ${workerId} error:`, error.message)
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
            console.log(`[Stream API] Worker ${workerId} exited with code ${code}`)
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
