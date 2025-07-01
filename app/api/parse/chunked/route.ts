import type { NextRequest } from "next/server"
import fs from "fs/promises"
import path from "path"
import { Worker } from "worker_threads"
import { isRemotePath, scanRemoteDirectory, createTempDirectory, cleanupTempDirectory } from "@/lib/remote-file-handler"
import { getPauseState, resetPauseState } from "../pause/route"

// Global state for chunked processing - use imported pause state instead
let currentProcessingState: any = null
let shouldPause = false
let shouldPauseBetweenChunks = false

// Save processing state for resume capability
async function saveProcessingState(state: any) {
  try {
    const statePath = path.join(process.cwd(), "processing_state.json")
    await fs.writeFile(statePath, JSON.stringify(state, null, 2))
    currentProcessingState = state
    console.log("Processing state saved")
  } catch (error) {
    console.error("Error saving processing state:", error)
  }
}

// Load processing state
async function loadProcessingState() {
  try {
    const statePath = path.join(process.cwd(), "processing_state.json")
    const stateContent = await fs.readFile(statePath, "utf-8")
    return JSON.parse(stateContent)
  } catch (error) {
    return null
  }
}

// Clear processing state
async function clearProcessingState() {
  const statePath = path.join(process.cwd(), "processing_state.json")
  try {
    await fs.unlink(statePath)
  } catch (error) {
    // File doesn't exist, that's fine
  }
  currentProcessingState = null
}

// Save chunk results to CSV
async function saveChunkCSV(csvData: any[], filename: string, includeHeader: boolean) {
  if (!csvData || csvData.length === 0) return

  const csvPath = path.join(process.cwd(), filename)
  let csvContent = ""

  if (includeHeader && csvData.length > 0) {
    // Add header row
    const headers = Object.keys(csvData[0])
    csvContent += headers.join(",") + "\n"
  }

  // Add data rows
  csvData.forEach((row) => {
    const values = Object.values(row).map((value) => {
      const stringValue = String(value || "")
      // Escape quotes and wrap in quotes if contains comma or quote
      if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
        return `"${stringValue.replace(/"/g, '""')}"`
      }
      return stringValue
    })
    csvContent += values.join(",") + "\n"
  })

  await fs.writeFile(csvPath, csvContent, "utf-8")
}

// Consolidate all chunk CSVs into final CSV file
async function consolidateCSVFiles(finalOutputFile: string, totalChunks: number) {
  const finalPath = path.join(process.cwd(), finalOutputFile)
  let consolidatedContent = ""
  let headerWritten = false

  for (let i = 1; i <= totalChunks; i++) {
    const chunkFile = `${finalOutputFile.replace(".csv", "")}_chunk_${i}.csv`
    const chunkPath = path.join(process.cwd(), chunkFile)

    try {
      const chunkContent = await fs.readFile(chunkPath, "utf-8")
      const lines = chunkContent.split("\n").filter((line) => line.trim())

      if (lines.length > 0) {
        if (!headerWritten && i === 1) {
          // Include header from first chunk
          consolidatedContent += lines.join("\n") + "\n"
          headerWritten = true
        } else {
          // Skip header for subsequent chunks
          const dataLines = lines.slice(1)
          if (dataLines.length > 0) {
            consolidatedContent += dataLines.join("\n") + "\n"
          }
        }
      }

      // Clean up chunk file
      await fs.unlink(chunkPath)
    } catch (error) {
      console.error(`Error processing chunk file ${chunkFile}:`, error)
    }
  }

  await fs.writeFile(finalPath, consolidatedContent, "utf-8")
}

async function scanForXMLFiles(rootDir: string, progressCallback?: (message: string) => void): Promise<string[]> {
  // Check if this is a remote path
  if (await isRemotePath(rootDir)) {
    console.log(`Scanning remote directory: ${rootDir}`)
    progressCallback?.(`Scanning remote directory: ${rootDir}`)

    const remoteFiles = await scanRemoteDirectory(rootDir, (message) => {
      console.log(`Remote scan: ${message}`)
      progressCallback?.(message)
    })

    // Return the URLs of the remote XML files
    return remoteFiles.map((file) => file.url)
  }

  // Local file system scanning
  const xmlFiles: string[] = []

  async function scanDirectory(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          await scanDirectory(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".xml")) {
          xmlFiles.push(fullPath)
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error)
    }
  }

  await scanDirectory(rootDir)
  return xmlFiles
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    rootDir,
    outputFile = "image_metadata.csv",
    outputFolder = "",
    numWorkers = 4,
    verbose = false,
    filterConfig = null,
    chunkSize = 100,
    pauseBetweenChunks = false,
    pauseDuration = 5,
  } = body

  if (!rootDir) {
    return new Response("Root directory is required", { status: 400 })
  }

  // Reset pause states
  shouldPause = false
  shouldPauseBetweenChunks = pauseBetweenChunks

  // Create full output path
  const fullOutputPath = outputFolder ? path.join(outputFolder, outputFile) : outputFile

  // Create SSE response
  const encoder = new TextEncoder()
  let isControllerClosed = false

  const stream = new ReadableStream({
    start(controller) {
      // Send initial message
      const data = `data: ${JSON.stringify({ type: "start", message: "Starting chunked XML processing..." })}\n\n`
      controller.enqueue(encoder.encode(data))

      // Start chunked processing in background
      processFilesInChunks(controller, encoder, {
        rootDir,
        outputFile: fullOutputPath,
        numWorkers,
        verbose,
        filterConfig,
        chunkSize,
        pauseBetweenChunks,
        pauseDuration,
      })
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
              message: `Chunked processing failed: ${error.message}`,
            })}\n\n`
            controller.enqueue(encoder.encode(errorData))
            isControllerClosed = true
            controller.close()
          }
        })
    },
    cancel() {
      isControllerClosed = true
      shouldPause = true
      console.log("Chunked stream cancelled - initiating graceful shutdown")
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

async function processFilesInChunks(controller: ReadableStreamDefaultController, encoder: TextEncoder, config: any) {
  const { rootDir, outputFile, numWorkers, verbose, filterConfig, chunkSize, pauseBetweenChunks, pauseDuration } =
    config

  let isControllerClosed = false
  let tempDir: string | null = null
  const allRecords: any[] = []
  let totalProcessedCount = 0
  let totalSuccessCount = 0
  let totalErrorCount = 0
  let totalFilteredCount = 0
  let totalMovedCount = 0
  const allErrors: string[] = []

  const sendMessage = (type: string, data: any) => {
    if (isControllerClosed) return
    try {
      const message = `data: ${JSON.stringify({ type, ...data })}\n\n`
      controller.enqueue(encoder.encode(message))
    } catch (error) {
      console.error("Error sending SSE message:", error)
      isControllerClosed = true
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputFile)
  if (outputDir !== "." && outputDir !== "") {
    try {
      await fs.mkdir(outputDir, { recursive: true })
      sendMessage("log", { message: `Created output directory: ${outputDir}` })
    } catch (error) {
      sendMessage("error", { message: `Failed to create output directory: ${outputDir}` })
      return
    }
  }

  try {
    sendMessage("log", { message: "Scanning for XML files..." })

    // Scan for all XML files
    const xmlFiles = await scanForXMLFiles(rootDir, (message) => {
      sendMessage("log", { message })
    })

    if (xmlFiles.length === 0) {
      sendMessage("error", { message: "No XML files found in the specified directory" })
      return
    }

    sendMessage("log", { message: `Found ${xmlFiles.length} XML files` })

    // Calculate chunks
    const totalChunks = Math.ceil(xmlFiles.length / chunkSize)
    sendMessage("log", { message: `Processing in ${totalChunks} chunks of ${chunkSize} files each` })

    if (pauseBetweenChunks) {
      sendMessage("log", { message: `Pause between chunks enabled: ${pauseDuration} seconds` })
    }

    // Handle remote files if needed
    if (await isRemotePath(rootDir)) {
      sendMessage("log", { message: "Detected remote path, downloading files..." })
      tempDir = await createTempDirectory()
      // Download logic would go here - simplified for now
    }

    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      // Check for pause/stop requests
      const pauseState = getPauseState()
      if (pauseState.shouldPause) {
        sendMessage("log", { message: "Processing paused by user request" })
        sendMessage("paused", {
          message: "Processing has been paused",
          chunkNumber: chunkIndex + 1,
          totalChunks,
          canResume: true,
        })
        return
      }
      const chunkNumber = chunkIndex + 1
      const startIndex = chunkIndex * chunkSize
      const endIndex = Math.min(startIndex + chunkSize, xmlFiles.length)
      const chunkFiles = xmlFiles.slice(startIndex, endIndex)

      sendMessage("chunk_start", {
        chunkNumber,
        totalChunks,
        filesInChunk: chunkFiles.length,
      })

      sendMessage("log", {
        message: `Processing chunk ${chunkNumber}/${totalChunks} (${chunkFiles.length} files)`,
      })

      try {
        // Process this chunk
        const chunkResult = await processChunk(chunkFiles, rootDir, numWorkers, verbose, filterConfig, sendMessage)

        // Accumulate results
        allRecords.push(...chunkResult.csvData)
        totalProcessedCount += chunkResult.processedFiles
        totalSuccessCount += chunkResult.successfulFiles
        totalErrorCount += chunkResult.errorFiles
        totalFilteredCount += chunkResult.filteredFiles
        totalMovedCount += chunkResult.movedFiles
        allErrors.push(...chunkResult.errors)

        // Save chunk results
        const chunkFileName = `${outputFile.replace(".csv", "")}_chunk_${chunkNumber}.csv`
        await saveChunkCSV(chunkResult.csvData, chunkFileName, true)

        sendMessage("chunk_complete", {
          chunkNumber,
          totalChunks,
          recordsInChunk: chunkResult.csvData.length,
        })

        // Send progress update
        const overallProgress = Math.round((chunkNumber / totalChunks) * 100)
        sendMessage("progress", {
          processed: totalProcessedCount,
          total: xmlFiles.length,
          successful: totalSuccessCount,
          filtered: totalFilteredCount,
          moved: totalMovedCount,
          errors: totalErrorCount,
          percentage: overallProgress,
          currentChunk: chunkNumber,
          totalChunks,
        })

        // Pause between chunks if requested and not the last chunk
        if (pauseBetweenChunks && chunkNumber < totalChunks) {
          sendMessage("log", { message: `Pausing for ${pauseDuration} seconds before next chunk...` })
          sendMessage("pause_start", {
            duration: pauseDuration,
            chunkCompleted: chunkNumber,
            nextChunk: chunkNumber + 1,
          })

          // Wait for the specified duration with pause checking
          await new Promise((resolve) => {
            const startTime = Date.now()
            const checkPause = () => {
              const pauseState = getPauseState()
              if (pauseState.shouldPause) {
                sendMessage("log", { message: "Processing paused by user during chunk break" })
                resolve(void 0)
                return
              }

              const elapsed = Date.now() - startTime
              if (elapsed >= pauseDuration * 1000) {
                resolve(void 0)
                return
              }

              // Send countdown update every second
              const remaining = Math.ceil((pauseDuration * 1000 - elapsed) / 1000)
              if (elapsed % 1000 < 100) {
                sendMessage("pause_countdown", { remaining })
              }

              setTimeout(checkPause, 100)
            }
            checkPause()
          })

          sendMessage("pause_end", { message: "Resuming processing..." })
        }
      } catch (error) {
        sendMessage("log", {
          message: `Error processing chunk ${chunkNumber}: ${error instanceof Error ? error.message : "Unknown error"}`,
        })
        totalErrorCount++
      }
    }

    if (shouldPause) {
      sendMessage("log", { message: "Processing paused by user" })
      return
    }

    // Consolidate all chunk files into final output
    sendMessage("log", { message: "Consolidating chunk results into final CSV..." })
    await consolidateCSVFiles(outputFile, totalChunks)

    // Send final results
    sendMessage("complete", {
      stats: {
        totalFiles: xmlFiles.length,
        processedFiles: totalProcessedCount,
        successfulFiles: totalSuccessCount,
        errorFiles: totalErrorCount,
        recordsWritten: allRecords.length,
        filteredFiles: totalFilteredCount,
        movedFiles: totalMovedCount,
        chunksProcessed: totalChunks,
      },
      outputFile: path.basename(outputFile),
      errors: allErrors.slice(0, 10),
    })

    sendMessage("log", { message: "Chunked processing completed successfully!" })
  } catch (error) {
    sendMessage("error", {
      message: `Chunked processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    })
  } finally {
    // Clean up temporary directory if it was created
    if (tempDir) {
      try {
        await cleanupTempDirectory(tempDir)
        sendMessage("log", { message: "Cleaned up temporary files" })
      } catch (error) {
        console.error("Error cleaning up temporary directory:", error)
      }
    }

    // Clear processing state and reset pause state
    await clearProcessingState()
    resetPauseState()
    isControllerClosed = true
  }
}

async function processChunk(
  files: string[],
  rootDir: string,
  numWorkers: number,
  verbose: boolean,
  filterConfig: any,
  sendMessage: (type: string, data: any) => void,
): Promise<any> {
  const csvData: any[] = []
  const errors: string[] = []
  let processedFiles = 0
  let successfulFiles = 0
  let errorFiles = 0
  let filteredFiles = 0
  let movedFiles = 0

  const workerScriptPath = path.resolve(process.cwd(), "./app/api/parse/xml-parser-worker.js")

  return new Promise((resolve, reject) => {
    let fileIndex = 0
    const activeWorkers = new Set<Worker>()

    const checkCompletion = () => {
      if (fileIndex >= files.length && activeWorkers.size === 0) {
        resolve({
          processedFiles,
          successfulFiles,
          errorFiles,
          filteredFiles,
          movedFiles,
          csvData,
          errors,
        })
      }
    }

    const launchWorkerIfNeeded = () => {
      while (activeWorkers.size < numWorkers && fileIndex < files.length) {
        const currentFile = files[fileIndex++]
        const workerId = Date.now() + Math.random()

        const worker = new Worker(workerScriptPath, {
          workerData: {
            xmlFilePath: currentFile,
            filterConfig,
            originalRootDir: rootDir,
            workerId,
            verbose,
            isRemote: false, // Simplified for chunked processing
            originalRemoteXmlUrl: null,
          },
        })
        activeWorkers.add(worker)

        worker.on("message", (result: any) => {
          processedFiles++

          if (result.record) {
            csvData.push(result.record)
            successfulFiles++
          }
          if (result.passedFilter && result.record) {
            filteredFiles++
          }
          if (result.imageMoved) {
            movedFiles++
          }
          if (result.error) {
            errorFiles++
            errors.push(`Error in ${path.basename(currentFile)}: ${result.error}`)
          }

          activeWorkers.delete(worker)
          worker.terminate().catch((err) => console.error(`Error terminating worker ${workerId}:`, err))

          if (fileIndex < files.length) {
            launchWorkerIfNeeded()
          } else {
            checkCompletion()
          }
        })

        worker.on("error", (err) => {
          errorFiles++
          errors.push(`Worker error for ${path.basename(currentFile)}: ${err.message}`)
          activeWorkers.delete(worker)

          if (fileIndex < files.length) {
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

    launchWorkerIfNeeded()

    if (files.length === 0) {
      resolve({
        processedFiles: 0,
        successfulFiles: 0,
        errorFiles: 0,
        filteredFiles: 0,
        movedFiles: 0,
        csvData: [],
        errors: [],
      })
    }
  })
}

// Pause endpoint
export async function PUT(request: NextRequest) {
  shouldPause = true
  return new Response(JSON.stringify({ message: "Pause request received" }), {
    headers: { "Content-Type": "application/json" },
  })
}
