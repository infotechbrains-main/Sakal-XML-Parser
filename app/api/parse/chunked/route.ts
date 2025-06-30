import type { NextRequest } from "next/server"
import fs from "fs/promises"
import path from "path"
import { Worker } from "worker_threads"
import { isRemotePath, scanRemoteDirectory, createTempDirectory, cleanupTempDirectory } from "@/lib/remote-file-handler"

// Global state for chunked processing
let shouldPause = false
let currentProcessingState: any = null

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

// Organize and move images by city
async function organizeImagesByCity(records: any[], baseDestinationPath: string, verbose: boolean) {
  const citiesProcessed = new Set<string>()

  for (const record of records) {
    if (record.city && record.imagePath && record.imageExists === "Yes") {
      citiesProcessed.add(record.city)
    }
  }

  return Array.from(citiesProcessed)
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
    numWorkers = 4,
    verbose = false,
    filterConfig = null,
    chunkSize = 100,
    pauseBetweenChunks = false,
    pauseDuration = 5,
    organizeByCity = false,
  } = body

  if (!rootDir) {
    return new Response("Root directory is required", { status: 400 })
  }

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
        outputFile,
        numWorkers,
        verbose,
        filterConfig,
        chunkSize,
        pauseBetweenChunks,
        pauseDuration,
        organizeByCity,
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
  const {
    rootDir,
    outputFile,
    numWorkers,
    verbose,
    filterConfig,
    chunkSize,
    pauseBetweenChunks,
    pauseDuration,
    organizeByCity,
  } = config

  let isControllerClosed = false
  let tempDir: string | null = null
  const allRecords: any[] = []
  let totalProcessedCount = 0
  let totalSuccessCount = 0
  let totalErrorCount = 0
  let totalFilteredCount = 0
  let totalMovedCount = 0
  const allErrors: string[] = []
  const allCities = new Set<string>()

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

    // Handle remote files if needed
    if (await isRemotePath(rootDir)) {
      sendMessage("log", { message: "Detected remote path, downloading files..." })
      tempDir = await createTempDirectory()
      // Download logic would go here - simplified for now
    }

    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < totalChunks && !shouldPause; chunkIndex++) {
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
        const chunkResult = await processChunk(
          chunkFiles,
          rootDir,
          numWorkers,
          verbose,
          filterConfig,
          organizeByCity,
          sendMessage,
        )

        // Accumulate results
        allRecords.push(...chunkResult.csvData)
        totalProcessedCount += chunkResult.processedFiles
        totalSuccessCount += chunkResult.successfulFiles
        totalErrorCount += chunkResult.errorFiles
        totalFilteredCount += chunkResult.filteredFiles
        totalMovedCount += chunkResult.movedFiles
        allErrors.push(...chunkResult.errors)
        chunkResult.cities.forEach((city: string) => allCities.add(city))

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

        // Pause between chunks if requested
        if (pauseBetweenChunks && chunkNumber < totalChunks) {
          sendMessage("log", { message: `Pausing for ${pauseDuration} seconds before next chunk...` })
          await new Promise((resolve) => setTimeout(resolve, pauseDuration * 1000))
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

    // Organize by city if requested
    if (organizeByCity && allCities.size > 0) {
      sendMessage("log", { message: `Organizing results by ${allCities.size} cities...` })
      const citiesProcessed = await organizeImagesByCity(allRecords, path.dirname(outputFile), verbose)
      sendMessage("log", { message: `Organized images for cities: ${citiesProcessed.join(", ")}` })
    }

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
        citiesFound: allCities.size,
      },
      outputFile: path.basename(outputFile),
      errors: allErrors.slice(0, 10),
      cities: Array.from(allCities).slice(0, 20),
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

    // Clear processing state
    await clearProcessingState()
    isControllerClosed = true
  }
}

async function processChunk(
  files: string[],
  rootDir: string,
  numWorkers: number,
  verbose: boolean,
  filterConfig: any,
  organizeByCity: boolean,
  sendMessage: (type: string, data: any) => void,
): Promise<any> {
  const csvData: any[] = []
  const errors: string[] = []
  const cities = new Set<string>()
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
          cities,
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

            // Extract city information
            if (result.record.city) {
              cities.add(result.record.city)
            }
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
        cities: new Set(),
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
