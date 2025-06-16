import type { NextRequest } from "next/server"
import fs from "fs/promises"
import path from "path"
import { createObjectCsvWriter } from "csv-writer"
import { Worker } from "worker_threads"
import { CSV_HEADERS } from "../route"
import {
  isRemotePath,
  scanRemoteDirectory,
  downloadFile,
  createTempDirectory,
  cleanupTempDirectory,
  tryDirectFileAccess,
  type RemoteFile,
} from "@/lib/remote-file-handler"

// Global state for graceful shutdown
let isShuttingDown = false
let currentProcessingState: any = null

// Manual directory traversal function
async function findXmlFilesManually(rootDir: string): Promise<string[]> {
  const xmlFiles: string[] = []
  async function traverse(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await traverse(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".xml")) {
          xmlFiles.push(fullPath)
        }
      }
    } catch (error) {
      console.log(`Error traversing ${dir}:`, error)
    }
  }
  await traverse(rootDir)
  return xmlFiles
}

// Save partial results to CSV
async function savePartialResults(records: any[], outputPath: string, isPartial = false) {
  if (records.length === 0) return

  try {
    const suffix = isPartial ? "_partial" : ""
    const finalPath = outputPath.replace(".csv", `${suffix}.csv`)

    const csvWriterInstance = createObjectCsvWriter({
      path: finalPath,
      header: CSV_HEADERS,
    })

    await csvWriterInstance.writeRecords(records)
    console.log(`Saved ${records.length} records to ${path.basename(finalPath)}`)
    return finalPath
  } catch (error) {
    console.error("Error saving partial results:", error)
  }
}

// Save processing state for resume capability
async function saveProcessingState(state: any) {
  try {
    const statePath = path.join(process.cwd(), "processing_state.json")
    await fs.writeFile(statePath, JSON.stringify(state, null, 2))
    console.log("Processing state saved")
  } catch (error) {
    console.error("Error saving processing state:", error)
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { rootDir, outputFile = "image_metadata.csv", numWorkers = 4, verbose = false, filterConfig = null } = body

  if (!rootDir) {
    return new Response("Root directory is required", { status: 400 })
  }

  // Create SSE response
  const encoder = new TextEncoder()
  let isControllerClosed = false

  const stream = new ReadableStream({
    start(controller) {
      // Send initial message
      const data = `data: ${JSON.stringify({ type: "start", message: "Starting XML processing..." })}\n\n`
      controller.enqueue(encoder.encode(data))

      // Start processing in background
      processFiles(controller, encoder, { rootDir, outputFile, numWorkers, verbose, filterConfig })
        .then(() => {
          if (!isControllerClosed) {
            isControllerClosed = true
            controller.close()
          }
        })
        .catch((error) => {
          if (!isControllerClosed) {
            const errorData = `data: ${JSON.stringify({
              type: "error",
              message: `Processing failed: ${error.message}`,
            })}\n\n`
            controller.enqueue(encoder.encode(errorData))
            isControllerClosed = true
            controller.close()
          }
        })
    },
    cancel() {
      isControllerClosed = true
      isShuttingDown = true
      console.log("Stream cancelled - initiating graceful shutdown")
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  })
}

async function processFiles(controller: ReadableStreamDefaultController, encoder: TextEncoder, config: any) {
  const { rootDir, outputFile, numWorkers, verbose, filterConfig } = config
  let isControllerClosed = false
  let tempDir: string | null = null
  const allRecords: any[] = []
  let processedCount = 0
  let successCount = 0
  let errorCount = 0
  let filteredCount = 0
  let movedCount = 0
  const errors: string[] = []
  const activeWorkers = new Set<Worker>()
  let lastSaveTime = Date.now()
  const SAVE_INTERVAL = 30000 // Save every 30 seconds

  const sendMessage = (type: string, data: any) => {
    if (isControllerClosed) {
      return // Don't try to send if controller is closed
    }
    try {
      const message = `data: ${JSON.stringify({ type, ...data })}\n\n`
      controller.enqueue(encoder.encode(message))
    } catch (error) {
      console.error("Error sending SSE message:", error)
      isControllerClosed = true
    }
  }

  // Graceful shutdown handler
  const gracefulShutdown = async (reason: string) => {
    console.log(`Initiating graceful shutdown: ${reason}`)
    isShuttingDown = true
    isControllerClosed = true

    sendMessage("log", { message: `Shutting down gracefully: ${reason}` })
    sendMessage("log", { message: "Saving current progress..." })

    // Terminate all workers
    activeWorkers.forEach((worker) => {
      worker.terminate().catch((err) => console.error("Error terminating worker:", err))
    })
    activeWorkers.clear()

    // Save current results
    const outputPath = path.join(process.cwd(), outputFile)
    if (allRecords.length > 0) {
      const savedPath = await savePartialResults(allRecords, outputPath, true)
      sendMessage("log", { message: `Partial results saved to ${path.basename(savedPath || outputPath)}` })
    }

    // Save processing state
    const state = {
      rootDir,
      outputFile,
      processedCount,
      successCount,
      errorCount,
      filteredCount,
      movedCount,
      errors,
      timestamp: new Date().toISOString(),
      reason,
      recordsCount: allRecords.length,
    }

    currentProcessingState = state
    await saveProcessingState(state)

    // Clean up temp directory
    if (tempDir) {
      try {
        await cleanupTempDirectory(tempDir)
        sendMessage("log", { message: "Cleaned up temporary files" })
      } catch (error) {
        console.error("Error cleaning up temporary directory:", error)
      }
    }

    // Send final shutdown message
    sendMessage("shutdown", {
      stats: {
        totalFiles: processedCount,
        processedFiles: processedCount,
        successfulFiles: successCount,
        errorFiles: errorCount,
        recordsWritten: allRecords.length,
        filteredFiles: filteredCount,
        movedFiles: movedCount,
      },
      outputFile: path.basename(outputPath),
      errors: errors.slice(0, 10),
      reason,
    })
  }

  // Handle process signals for graceful shutdown
  process.on("SIGINT", () => gracefulShutdown("SIGINT received"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM received"))
  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error)
    gracefulShutdown(`Uncaught exception: ${error.message}`)
  })

  try {
    sendMessage("log", { message: "Checking if path is remote or local..." })

    let xmlFiles: string[] = []
    let remoteFiles: RemoteFile[] = []
    const isRemote = await isRemotePath(rootDir)

    if (isRemote) {
      sendMessage("log", { message: `Detected remote path: ${rootDir}` })
      sendMessage("log", { message: "Scanning remote directory for XML files recursively..." })

      try {
        // Enhanced remote scanning with progress callback
        remoteFiles = await scanRemoteDirectory(rootDir, (message: string) => {
          if (!isShuttingDown) {
            sendMessage("log", { message })
          }
        })

        if (isShuttingDown) {
          await gracefulShutdown("User requested shutdown during scanning")
          return
        }

        sendMessage("log", { message: `Found ${remoteFiles.length} XML files in remote directory tree` })

        // If no files found with directory listing, try direct file access
        if (remoteFiles.length === 0) {
          sendMessage("log", { message: "No XML files found via directory listing, trying direct file access..." })

          try {
            const directFiles = await tryDirectFileAccess(rootDir)
            remoteFiles.push(...directFiles)
            sendMessage("log", { message: `Found ${directFiles.length} XML files via direct access` })
          } catch (error) {
            sendMessage("log", {
              message: `Direct file access failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            })
          }
        }

        if (remoteFiles.length === 0) {
          sendMessage("error", { message: "No XML files found in the remote directory or its subdirectories" })
          return
        }

        // Create temp directory for downloaded files
        tempDir = await createTempDirectory()
        sendMessage("log", { message: `Created temporary directory: ${tempDir}` })

        // Download files with interruption handling
        sendMessage("log", { message: "Downloading XML files to temporary directory..." })
        let downloadedCount = 0

        for (let i = 0; i < remoteFiles.length && !isShuttingDown; i++) {
          const file = remoteFiles[i]
          try {
            const localPath = await downloadFile(file.url, tempDir)
            remoteFiles[i].localPath = localPath
            downloadedCount++

            sendMessage("log", {
              message: `Downloaded ${downloadedCount}/${remoteFiles.length}: ${file.name}`,
            })
          } catch (error) {
            sendMessage("log", {
              message: `Error downloading ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
            })
          }
        }

        if (isShuttingDown) {
          await gracefulShutdown("User requested shutdown during download")
          return
        }

        // Get local paths of downloaded files
        xmlFiles = remoteFiles.filter((file) => file.localPath).map((file) => file.localPath!)

        sendMessage("log", { message: `Successfully downloaded ${xmlFiles.length} XML files` })

        if (xmlFiles.length === 0) {
          sendMessage("error", { message: "Failed to download any XML files" })
          return
        }
      } catch (error) {
        sendMessage("error", {
          message: `Error accessing remote directory: ${error instanceof Error ? error.message : "Unknown error"}`,
        })
        return
      }
    } else {
      sendMessage("log", { message: "Searching for XML files in local directory..." })
      xmlFiles = await findXmlFilesManually(rootDir)
      sendMessage("log", { message: `Found ${xmlFiles.length} XML files` })
    }

    if (xmlFiles.length === 0) {
      sendMessage("error", { message: "No XML files found in the specified directory" })
      return
    }

    const outputPath = path.join(process.cwd(), outputFile)

    // Send filter configuration info
    if (filterConfig?.enabled) {
      sendMessage("log", { message: "Filtering enabled with the following criteria:" })

      if (filterConfig.minWidth || filterConfig.minHeight) {
        sendMessage("log", {
          message: `  Image size: min ${filterConfig.minWidth || 0}x${filterConfig.minHeight || 0} pixels`,
        })
      }

      if (filterConfig.minFileSize) {
        const minSizeMB = Math.round((filterConfig.minFileSize / 1024 / 1024) * 100) / 100
        sendMessage("log", { message: `  Min file size: ${minSizeMB}MB` })
      }

      if (filterConfig.maxFileSize) {
        const maxSizeMB = Math.round((filterConfig.maxFileSize / 1024 / 1024) * 100) / 100
        sendMessage("log", { message: `  Max file size: ${maxSizeMB}MB` })
      }

      if (filterConfig.moveImages && filterConfig.moveDestinationPath) {
        sendMessage("log", { message: `  Filtered images will be moved to: ${filterConfig.moveDestinationPath}` })
        sendMessage("log", {
          message: `  Folder structure: ${filterConfig.moveFolderStructureOption === "replicate" ? "Replicate source structure" : "Single folder"}`,
        })
      }
    }

    const workerScriptPath = path.resolve(process.cwd(), "./app/api/parse/xml-parser-worker.js")

    try {
      await fs.access(workerScriptPath)
    } catch (e) {
      sendMessage("error", { message: "Worker script not found" })
      return
    }

    sendMessage("progress", {
      processed: 0,
      total: xmlFiles.length,
      successful: 0,
      filtered: 0,
      moved: 0,
      errors: 0,
      percentage: 0,
    })

    await new Promise<void>((resolveAllFiles, rejectAllFiles) => {
      let fileIndex = 0
      let workersLaunched = 0
      let lastProgressReport = 0

      const cleanup = () => {
        // Terminate all active workers
        activeWorkers.forEach((worker) => {
          worker.terminate().catch((err) => console.error("Error terminating worker:", err))
        })
        activeWorkers.clear()
      }

      const checkCompletion = () => {
        if ((fileIndex >= xmlFiles.length && activeWorkers.size === 0) || isShuttingDown) {
          cleanup()
          resolveAllFiles()
        }
      }

      const launchWorkerIfNeeded = () => {
        while (
          activeWorkers.size < numWorkers &&
          fileIndex < xmlFiles.length &&
          !isControllerClosed &&
          !isShuttingDown
        ) {
          const currentFile = xmlFiles[fileIndex++]
          const workerId = workersLaunched++

          const worker = new Worker(workerScriptPath, {
            workerData: {
              xmlFilePath: currentFile,
              filterConfig,
              originalRootDir: isRemote ? tempDir : rootDir,
              workerId,
              verbose,
              isRemote,
            },
          })
          activeWorkers.add(worker)

          worker.on("message", async (result: any) => {
            processedCount++

            if (result.record) {
              allRecords.push(result.record)
              successCount++
            }
            if (result.passedFilter && result.record) {
              filteredCount++
            }
            if (result.imageMoved) {
              movedCount++
            }
            if (result.error) {
              errorCount++
              errors.push(`Error in ${path.basename(currentFile)}: ${result.error}`)
              sendMessage("log", { message: `Error processing ${path.basename(currentFile)}: ${result.error}` })
            }

            // Auto-save every 30 seconds or every 50 files
            const now = Date.now()
            if (now - lastSaveTime > SAVE_INTERVAL || allRecords.length % 50 === 0) {
              if (allRecords.length > 0) {
                await savePartialResults(allRecords, outputPath, true)
                sendMessage("log", { message: `Auto-saved ${allRecords.length} records` })
                lastSaveTime = now
              }
            }

            // Send progress update every 10 files or significant milestones
            if (processedCount - lastProgressReport >= 10 || processedCount === xmlFiles.length) {
              const percentage = Math.round((processedCount / xmlFiles.length) * 100)

              sendMessage("progress", {
                processed: processedCount,
                total: xmlFiles.length,
                successful: successCount,
                filtered: filteredCount,
                moved: movedCount,
                errors: errorCount,
                percentage,
              })

              sendMessage("log", {
                message: `Progress: ${processedCount}/${xmlFiles.length} files processed (${percentage}%)`,
              })

              lastProgressReport = processedCount
            }

            activeWorkers.delete(worker)
            worker.terminate().catch((err) => console.error(`Error terminating worker ${workerId}:`, err))

            if (fileIndex < xmlFiles.length && !isControllerClosed && !isShuttingDown) {
              launchWorkerIfNeeded()
            } else {
              checkCompletion()
            }
          })

          worker.on("error", (err) => {
            errorCount++
            errors.push(`Worker error for ${path.basename(currentFile)}: ${err.message}`)
            sendMessage("log", { message: `Worker error for ${path.basename(currentFile)}: ${err.message}` })
            activeWorkers.delete(worker)

            if (fileIndex < xmlFiles.length && !isControllerClosed && !isShuttingDown) {
              launchWorkerIfNeeded()
            } else {
              checkCompletion()
            }
          })

          worker.on("exit", (code) => {
            activeWorkers.delete(worker)
            if (code !== 0) {
              sendMessage("log", { message: `Worker exited with code ${code} for ${path.basename(currentFile)}` })
            }
            checkCompletion()
          })
        }
      }

      // Handle controller being closed early or shutdown
      const checkInterval = setInterval(() => {
        if (isControllerClosed || isShuttingDown) {
          clearInterval(checkInterval)
          cleanup()
          rejectAllFiles(new Error("Stream was closed or shutdown requested"))
        }
      }, 1000)

      launchWorkerIfNeeded()

      if (xmlFiles.length === 0) {
        clearInterval(checkInterval)
        resolveAllFiles()
      }
    })

    // Final save of all results
    if (allRecords.length > 0 && !isControllerClosed) {
      sendMessage("log", { message: "Writing final CSV file..." })
      const csvWriterInstance = createObjectCsvWriter({
        path: outputPath,
        header: CSV_HEADERS,
      })
      await csvWriterInstance.writeRecords(allRecords)
      sendMessage("log", { message: `Final CSV file written: ${path.basename(outputPath)}` })
    } else if (allRecords.length === 0) {
      sendMessage("log", { message: "No records to write to CSV" })
    }

    // Send final results
    if (!isControllerClosed && !isShuttingDown) {
      sendMessage("complete", {
        stats: {
          totalFiles: xmlFiles.length,
          processedFiles: processedCount,
          successfulFiles: successCount,
          errorFiles: errorCount,
          recordsWritten: allRecords.length,
          filteredFiles: filteredCount,
          movedFiles: movedCount,
        },
        outputFile: path.basename(outputPath),
        errors: errors.slice(0, 10),
      })

      sendMessage("log", { message: "Processing completed successfully!" })
      sendMessage("log", { message: `Processed ${processedCount} files` })
      sendMessage("log", { message: `Successful: ${successCount}` })
      sendMessage("log", { message: `Filtered: ${filteredCount}` })
      sendMessage("log", { message: `Moved: ${movedCount}` })
      sendMessage("log", { message: `Errors: ${errorCount}` })
    }
  } catch (error) {
    if (!isControllerClosed && !isShuttingDown) {
      sendMessage("error", {
        message: `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
      await gracefulShutdown(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  } finally {
    // Clean up temporary directory if it was created
    if (tempDir && !isShuttingDown) {
      try {
        await cleanupTempDirectory(tempDir)
        if (!isControllerClosed) {
          sendMessage("log", { message: "Cleaned up temporary files" })
        }
      } catch (error) {
        console.error("Error cleaning up temporary directory:", error)
      }
    }

    isControllerClosed = true
  }
}
