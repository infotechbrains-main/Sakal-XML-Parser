import type { NextRequest } from "next/server"
import fs from "fs/promises"
import path from "path"
import { Worker } from "worker_threads"
import { isRemotePath, scanRemoteDirectory } from "@/lib/remote-file-handler"

// Global state for chunked processing
let shouldPause = false
let currentProcessingState: any = null

// Save processing state for resume capability
async function saveProcessingState(state: any) {
  const statePath = path.join(process.cwd(), "processing_state.json")
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8")
  currentProcessingState = state
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

async function scanForXMLFiles(rootDir: string): Promise<string[]> {
  // Check if this is a remote path
  if (await isRemotePath(rootDir)) {
    console.log(`Scanning remote directory: ${rootDir}`)

    const remoteFiles = await scanRemoteDirectory(rootDir, (message) => {
      console.log(`Remote scan: ${message}`)
    })

    // Return the URLs of the remote XML files
    return remoteFiles.map((file) => file.url)
  }

  // Local file system scanning (existing code)
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
  try {
    const body = await request.json()
    const {
      rootDir,
      outputFile = "image_metadata.csv",
      numWorkers = 4,
      verbose = false,
      filterConfig,
      chunkSize = 1000,
      organizeByCity = false,
      resumeFromState = null,
    } = body

    if (!rootDir) {
      return { error: "Root directory is required" }
    }

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial log
          const sendData = (data: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          }

          sendData({ type: "log", message: "Starting chunked processing..." })

          // Scan for XML files
          sendData({ type: "log", message: `Scanning directory: ${rootDir}` })

          const xmlFiles = await scanForXMLFiles(rootDir)
          const totalFiles = xmlFiles.length

          if (totalFiles === 0) {
            sendData({ type: "error", message: "No XML files found in the specified directory" })
            controller.close()
            return
          }

          sendData({ type: "log", message: `Found ${totalFiles} XML files` })

          // Calculate chunks
          const actualChunkSize = chunkSize > 0 ? chunkSize : totalFiles
          const totalChunks = Math.ceil(totalFiles / actualChunkSize)
          const startChunk = resumeFromState ? resumeFromState.chunksCompleted + 1 : 1

          sendData({ type: "log", message: `Processing in ${totalChunks} chunks of ${actualChunkSize} files each` })

          if (resumeFromState) {
            sendData({ type: "log", message: `Resuming from chunk ${startChunk}` })
          }

          const totalStats = {
            totalFiles,
            processedFiles: resumeFromState ? resumeFromState.processedFiles || 0 : 0,
            successfulFiles: resumeFromState ? resumeFromState.successfulFiles || 0 : 0,
            errorFiles: resumeFromState ? resumeFromState.errorFiles || 0 : 0,
            filteredFiles: resumeFromState ? resumeFromState.filteredFiles || 0 : 0,
            movedFiles: resumeFromState ? resumeFromState.movedFiles || 0 : 0,
            chunksCompleted: resumeFromState ? resumeFromState.chunksCompleted || 0 : 0,
            citiesProcessed: resumeFromState ? resumeFromState.citiesProcessed || 0 : 0,
          }

          const citiesFound = new Set<string>()

          // Process chunks
          for (let chunkIndex = startChunk; chunkIndex <= totalChunks; chunkIndex++) {
            if (shouldPause) {
              // Save current state
              const state = {
                ...totalStats,
                chunksCompleted: chunkIndex - 1,
                totalChunks,
                timestamp: new Date().toISOString(),
              }
              await saveProcessingState(state)
              sendData({ type: "paused", state })
              controller.close()
              return
            }

            const startIndex = (chunkIndex - 1) * actualChunkSize
            const endIndex = Math.min(startIndex + actualChunkSize, totalFiles)
            const chunkFiles = xmlFiles.slice(startIndex, endIndex)

            sendData({
              type: "chunk_start",
              chunkNumber: chunkIndex,
              totalChunks,
              chunkSize: chunkFiles.length,
            })

            // Process chunk
            const chunkResults = await processChunk(
              chunkFiles,
              rootDir,
              numWorkers,
              verbose,
              filterConfig,
              organizeByCity,
              sendData,
            )

            // Update stats
            totalStats.processedFiles += chunkResults.processedFiles
            totalStats.successfulFiles += chunkResults.successfulFiles
            totalStats.errorFiles += chunkResults.errorFiles
            totalStats.filteredFiles += chunkResults.filteredFiles
            totalStats.movedFiles += chunkResults.movedFiles
            totalStats.chunksCompleted = chunkIndex

            // Track cities
            if (chunkResults.cities) {
              chunkResults.cities.forEach((city: string) => citiesFound.add(city))
              totalStats.citiesProcessed = citiesFound.size
            }

            // Save chunk CSV
            const chunkCsvFile = `${outputFile.replace(".csv", "")}_chunk_${chunkIndex}.csv`
            await saveChunkCSV(chunkResults.csvData, chunkCsvFile, chunkIndex === 1)

            sendData({
              type: "chunk_complete",
              chunkNumber: chunkIndex,
              csvFile: chunkCsvFile,
              citiesSaved: chunkResults.cities ? Array.from(chunkResults.cities) : [],
              citiesProcessed: citiesFound.size,
            })

            // Update overall progress
            const overallProgress = (totalStats.processedFiles / totalFiles) * 100
            sendData({
              type: "progress",
              percentage: overallProgress,
              processed: totalStats.processedFiles,
              total: totalFiles,
              successful: totalStats.successfulFiles,
              filtered: totalStats.filteredFiles,
              moved: totalStats.movedFiles,
              errors: totalStats.errorFiles,
            })

            // Save state after each chunk
            const state = {
              ...totalStats,
              totalChunks,
              timestamp: new Date().toISOString(),
            }
            await saveProcessingState(state)
          }

          // Consolidate all chunk CSVs into final CSV
          sendData({ type: "log", message: "Consolidating chunk CSV files..." })
          await consolidateCSVFiles(outputFile, totalChunks)

          // Clean up processing state
          await clearProcessingState()

          sendData({
            type: "complete",
            outputFile,
            stats: totalStats,
          })

          controller.close()
        } catch (error) {
          console.error("Chunked processing error:", error)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                message: error instanceof Error ? error.message : "Unknown error occurred",
              })}\n\n`,
            ),
          )
          controller.close()
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
  } catch (error) {
    console.error("Error in chunked processing:", error)
    return {
      error: "Failed to start chunked processing",
      details: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

async function processChunk(
  files: string[],
  rootDir: string,
  numWorkers: number,
  verbose: boolean,
  filterConfig: any,
  organizeByCity: boolean,
  sendData: (data: any) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(process.cwd(), "app/api/parse/xml-parser-worker.js")
    const worker = new Worker(workerPath)

    let chunkProgress = 0
    const results = {
      processedFiles: 0,
      successfulFiles: 0,
      errorFiles: 0,
      filteredFiles: 0,
      movedFiles: 0,
      csvData: [],
      cities: new Set<string>(),
    }

    worker.on("message", (message) => {
      switch (message.type) {
        case "progress":
          chunkProgress = message.percentage
          sendData({
            type: "chunk_progress",
            percentage: chunkProgress,
          })
          break
        case "complete":
          results.processedFiles = message.stats.processedFiles
          results.successfulFiles = message.stats.successfulFiles
          results.errorFiles = message.stats.errorFiles
          results.filteredFiles = message.stats.filteredFiles
          results.movedFiles = message.stats.movedFiles
          results.csvData = message.csvData

          // Extract cities from CSV data
          if (organizeByCity && message.csvData) {
            message.csvData.forEach((row: any) => {
              if (row.City) {
                results.cities.add(row.City)
              }
            })
          }

          resolve(results)
          break
        case "error":
          reject(new Error(message.message))
          break
        case "log":
          if (verbose) {
            sendData({ type: "log", message: message.message })
          }
          break
      }
    })

    worker.on("error", (error) => {
      reject(error)
    })

    // Start processing
    worker.postMessage({
      xmlFiles: files,
      rootDir,
      numWorkers,
      verbose,
      filterConfig,
      organizeByCity,
    })
  })
}

// Pause endpoint
export async function PUT(request: NextRequest) {
  shouldPause = true
  return new Response(JSON.stringify({ message: "Pause request received" }), {
    headers: { "Content-Type": "application/json" },
  })
}
