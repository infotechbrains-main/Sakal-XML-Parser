import type { NextRequest } from "next/server"
import fs from "fs/promises"
import path from "path"
import { createObjectCsvWriter } from "csv-writer"
import { Worker } from "worker_threads"
import { CSV_HEADERS_MAIN } from "../route"

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

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { rootDir, outputFile = "image_metadata.csv", numWorkers = 4, verbose = false, filterConfig = null } = body

  if (!rootDir) {
    return new Response("Root directory is required", { status: 400 })
  }

  // Create SSE response
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send initial message
      const data = `data: ${JSON.stringify({ type: "start", message: "Starting XML processing..." })}\n\n`
      controller.enqueue(encoder.encode(data))

      // Start processing in background
      processFiles(controller, encoder, { rootDir, outputFile, numWorkers, verbose, filterConfig })
        .then(() => {
          controller.close()
        })
        .catch((error) => {
          const errorData = `data: ${JSON.stringify({
            type: "error",
            message: `Processing failed: ${error.message}`,
          })}\n\n`
          controller.enqueue(encoder.encode(errorData))
          controller.close()
        })
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

  const sendMessage = (type: string, data: any) => {
    const message = `data: ${JSON.stringify({ type, ...data })}\n\n`
    controller.enqueue(encoder.encode(message))
  }

  try {
    sendMessage("log", { message: "Searching for XML files..." })

    const xmlFiles = await findXmlFilesManually(rootDir)
    sendMessage("log", { message: `Found ${xmlFiles.length} XML files` })

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

    const allRecords: any[] = []
    let processedCount = 0
    let successCount = 0
    let errorCount = 0
    let filteredCount = 0
    let movedCount = 0
    const errors: string[] = []
    const activeWorkers = new Set<Worker>()

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

    await new Promise<void>((resolveAllFiles) => {
      let fileIndex = 0
      let workersLaunched = 0
      let lastProgressReport = 0

      const launchWorkerIfNeeded = () => {
        while (activeWorkers.size < numWorkers && fileIndex < xmlFiles.length) {
          const currentFile = xmlFiles[fileIndex++]
          const workerId = workersLaunched++

          const worker = new Worker(workerScriptPath, {
            workerData: {
              xmlFilePath: currentFile,
              filterConfig,
              originalRootDir: rootDir,
              workerId,
              verbose,
            },
          })
          activeWorkers.add(worker)

          worker.on("message", (result: any) => {
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

            if (fileIndex < xmlFiles.length) {
              launchWorkerIfNeeded()
            } else if (activeWorkers.size === 0) {
              resolveAllFiles()
            }
          })

          worker.on("error", (err) => {
            errorCount++
            errors.push(`Worker error for ${path.basename(currentFile)}: ${err.message}`)
            sendMessage("log", { message: `Worker error for ${path.basename(currentFile)}: ${err.message}` })
            activeWorkers.delete(worker)

            if (fileIndex < xmlFiles.length) {
              launchWorkerIfNeeded()
            } else if (activeWorkers.size === 0) {
              resolveAllFiles()
            }
          })

          worker.on("exit", (code) => {
            activeWorkers.delete(worker)
            if (code !== 0) {
              sendMessage("log", { message: `Worker exited with code ${code} for ${path.basename(currentFile)}` })
            }
            if (fileIndex >= xmlFiles.length && activeWorkers.size === 0) {
              resolveAllFiles()
            }
          })
        }
      }

      launchWorkerIfNeeded()
      if (xmlFiles.length === 0) resolveAllFiles()
    })

    // Write CSV file
    if (allRecords.length > 0) {
      sendMessage("log", { message: "Writing CSV file..." })
      const csvWriterInstance = createObjectCsvWriter({
        path: outputPath,
        header: CSV_HEADERS_MAIN,
      })
      await csvWriterInstance.writeRecords(allRecords)
      sendMessage("log", { message: `CSV file written: ${path.basename(outputPath)}` })
    } else {
      sendMessage("log", { message: "No records to write to CSV" })
    }

    // Send final results
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
  } catch (error) {
    sendMessage("error", { message: `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}` })
  }
}
