import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { getPauseState, resetPauseState } from "./pause/route"

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
  success: boolean
  data?: any
  error?: string
  filtered?: boolean
  moved?: boolean
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
          verbose = false,
          filterConfig = null,
        } = body

        // Reset pause state at start
        resetPauseState()

        const sendMessage = (type: string, message: any) => {
          const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() })
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }

        sendMessage("start", "Starting stream processing...")

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

        sendMessage("progress", {
          percentage: 0,
          total: stats.totalFiles,
          processed: 0,
          successful: 0,
          errors: 0,
          filtered: 0,
          moved: 0,
        })

        // Determine output path
        const outputPath = outputFolder ? path.join(outputFolder, outputFile) : path.join(process.cwd(), outputFile)

        // Ensure output directory exists
        if (outputFolder) {
          await fs.mkdir(outputFolder, { recursive: true })
        }

        // Initialize CSV file with headers
        const headers =
          [
            "filename",
            "filepath",
            "filesize",
            "width",
            "height",
            "format",
            "colorspace",
            "compression",
            "quality",
            "orientation",
            "resolution",
            "created",
            "modified",
            "camera_make",
            "camera_model",
            "lens_model",
            "focal_length",
            "aperture",
            "shutter_speed",
            "iso",
            "flash",
            "gps_latitude",
            "gps_longitude",
            "gps_altitude",
            "keywords",
            "description",
            "title",
            "subject",
            "creator",
            "copyright",
            "usage_terms",
            "credit_line",
            "source",
            "instructions",
            "category",
            "supplemental_categories",
            "urgency",
            "location",
            "city",
            "state",
            "country",
            "headline",
            "caption",
          ].join(",") + "\n"

        await fs.writeFile(outputPath, headers, "utf8")

        // Process files with worker pool
        const activeWorkers = new Set<Worker>()
        const results: any[] = []
        let processedCount = 0

        const processFile = async (xmlFile: string): Promise<WorkerResult> => {
          return new Promise((resolve) => {
            // Check for pause/stop before creating worker
            const pauseState = getPauseState()
            if (pauseState.shouldStop) {
              resolve({ success: false, error: "Processing stopped by user" })
              return
            }

            const worker = new Worker(path.join(process.cwd(), "app/api/parse/xml-parser-worker.js"))
            activeWorkers.add(worker)

            const timeout = setTimeout(() => {
              worker.terminate()
              activeWorkers.delete(worker)
              resolve({ success: false, error: "Worker timeout" })
            }, 30000) // 30 second timeout

            worker.on("message", (result: WorkerResult) => {
              clearTimeout(timeout)
              activeWorkers.delete(worker)
              worker.terminate()
              resolve(result)
            })

            worker.on("error", (error) => {
              clearTimeout(timeout)
              activeWorkers.delete(worker)
              resolve({ success: false, error: error.message })
            })

            worker.postMessage({
              xmlFile,
              filterConfig,
              verbose,
            })
          })
        }

        // Process files in batches
        const batchSize = Math.min(numWorkers, 10)

        for (let i = 0; i < xmlFiles.length; i += batchSize) {
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

          const batch = xmlFiles.slice(i, i + batchSize)
          const batchPromises = batch.map(processFile)

          try {
            const batchResults = await Promise.all(batchPromises)

            for (const result of batchResults) {
              processedCount++

              if (result.success && result.data) {
                stats.successfulFiles++
                stats.recordsWritten++
                results.push(result.data)

                // Append to CSV file
                const csvLine =
                  Object.values(result.data)
                    .map((value) =>
                      typeof value === "string" && value.includes(",") ? `"${value.replace(/"/g, '""')}"` : value || "",
                    )
                    .join(",") + "\n"

                await fs.appendFile(outputPath, csvLine, "utf8")
              } else {
                stats.errorFiles++
                if (verbose && result.error) {
                  sendMessage("log", `Error processing file: ${result.error}`)
                }
              }

              if (result.filtered) {
                stats.filteredFiles++
              }

              if (result.moved) {
                stats.movedFiles++
              }

              stats.processedFiles = processedCount

              // Send progress update
              const percentage = Math.round((processedCount / stats.totalFiles) * 100)
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
                sendMessage("log", `Processed ${processedCount}/${stats.totalFiles} files`)
              }
            }
          } catch (error) {
            sendMessage("error", `Batch processing error: ${error instanceof Error ? error.message : "Unknown error"}`)
            stats.errorFiles += batch.length
            stats.processedFiles += batch.length
          }
        }

        // Cleanup any remaining workers
        for (const worker of activeWorkers) {
          worker.terminate()
        }

        // Send completion message
        if (!getPauseState().shouldStop) {
          sendMessage("complete", {
            stats,
            outputFile: outputPath,
            message: `Processing completed! Processed ${stats.processedFiles} files, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`,
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        const data = JSON.stringify({
          type: "error",
          message: `Stream processing error: ${errorMessage}`,
          timestamp: new Date().toISOString(),
        })
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      } finally {
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
