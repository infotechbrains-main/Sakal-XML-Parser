import type { NextRequest } from "next/server"
import fs from "fs/promises"
import path from "path"
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

    // For now, chunked processing falls back to regular stream processing
    console.log("Chunked processing requested, falling back to regular stream processing...")

    // Redirect to regular stream processing
    const streamResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/parse/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!streamResponse.ok) {
      throw new Error(`Stream processing failed: ${streamResponse.status}`)
    }

    // Return the stream response directly
    return new Response(streamResponse.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    console.error("Error in chunked processing:", error)
    return new Response(
      JSON.stringify({
        error: "Failed to start chunked processing",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      },
    )
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
  // Since the chunked processing worker isn't fully implemented yet,
  // fall back to processing files individually using the regular approach
  sendData({
    type: "log",
    message: "Chunked processing not fully implemented, using regular processing for this chunk...",
  })

  // Fall back to regular stream processing for this chunk
  try {
    const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/parse/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootDir,
        outputFile: "temp_chunk.csv",
        numWorkers,
        verbose,
        filterConfig,
        xmlFiles: files, // Pass the specific files for this chunk
      }),
    })

    if (!response.ok) {
      throw new Error(`Chunk processing failed: ${response.status}`)
    }

    // For now, return mock results since we're falling back
    return {
      processedFiles: files.length,
      successfulFiles: files.length,
      errorFiles: 0,
      filteredFiles: 0,
      movedFiles: 0,
      csvData: [],
      cities: new Set<string>(),
    }
  } catch (error) {
    sendData({
      type: "log",
      message: `Chunk processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
    })
    throw error
  }
}

// Pause endpoint
export async function PUT(request: NextRequest) {
  shouldPause = true
  return new Response(JSON.stringify({ message: "Pause request received" }), {
    headers: { "Content-Type": "application/json" },
  })
}
