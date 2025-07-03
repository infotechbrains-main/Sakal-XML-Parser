import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { scanRemoteDirectory } from "@/lib/remote-file-handler"
import { PersistentHistory } from "@/lib/persistent-history" // Import PersistentHistory

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

// Helper function to check if a path is remote
function isRemotePath(filePath: string): boolean {
  return filePath && (filePath.startsWith("http://") || filePath.startsWith("https://"))
}

// Helper function to find XML files recursively
async function findXMLFiles(dir: string): Promise<string[]> {
  const xmlFiles: string[] = []

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        const subFiles = await findXMLFiles(fullPath)
        xmlFiles.push(...subFiles)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".xml")) {
        xmlFiles.push(fullPath)
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error)
    throw error
  }

  return xmlFiles
}

// Stream processing function
async function processFilesStream(
  rootDir: string,
  filterConfig: any,
  outputFile: string,
  outputFolder: string,
  verbose: boolean,
  maxWorkers: number,
  pauseDuration: number,
  controller: ReadableStreamDefaultController,
) {
  const sessionId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  let totalFiles = 0
  let processedFiles = 0
  let successfulFiles = 0
  let errorFiles = 0
  let filteredFiles = 0
  let movedFiles = 0
  let recordsWritten = 0

  const isRemote = isRemotePath(rootDir)

  try {
    controller.enqueue(`data: ${JSON.stringify({ type: "start", message: "Starting stream processing..." })}\n\n`)

    // Find XML files
    let xmlFiles: string[] = []
    if (isRemote) {
      controller.enqueue(`data: ${JSON.stringify({ type: "log", message: "Scanning remote directory..." })}\n\n`)
      xmlFiles = await scanRemoteDirectory(rootDir)
      if (verbose) {
        console.log(`[Stream API] Found ${xmlFiles.length} remote XML files`)
      }
    } else {
      xmlFiles = await findXMLFiles(rootDir)
      if (verbose) {
        console.log(`[Stream API] Found ${xmlFiles.length} local XML files`)
      }
    }

    if (xmlFiles.length === 0) {
      controller.enqueue(
        `data: ${JSON.stringify({ type: "error", message: "No XML files found in the specified directory" })}\n\n`,
      )
      return
    }

    totalFiles = xmlFiles.length
    controller.enqueue(
      `data: ${JSON.stringify({ type: "log", message: `Found ${totalFiles} XML files to process` })}\n\n`,
    )

    // Prepare output file
    const outputPath = path.join(outputFolder, outputFile)
    const csvHeaders = [
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
    ]

    await fs.writeFile(outputPath, csvHeaders.join(",") + "\n", "utf-8")

    // Process files with workers
    const workers: Worker[] = [] // Declare workers variable
    const activeWorkers = new Set<number>()
    let currentFileIndex = 0

    const processFile = (xmlFilePath: string, workerId: number): Promise<any> => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(process.cwd(), "app/api/parse/xml-parser-worker.js"), {
          workerData: {
            xmlFilePath,
            filterConfig,
            originalRootDir: rootDir,
            workerId,
            verbose,
            isRemote,
            originalRemoteXmlUrl: isRemote ? xmlFilePath : null,
            associatedImagePath: null,
          },
        })

        workers.push(worker)
        activeWorkers.add(workerId)

        worker.on("message", async (result) => {
          try {
            processedFiles++

            if (result.error) {
              errorFiles++
              if (verbose) {
                console.log(`[Stream API] Error processing file: ${result.error}`)
              }
            } else if (result.record) {
              successfulFiles++

              // Check if record passed filters for display purposes
              if (result.passedFilter) {
                // Record passed filters - always write to CSV
                const csvRow = csvHeaders
                  .map((header) => {
                    const value = result.record[header] || ""
                    return `"${String(value).replace(/"/g, '""')}"`
                  })
                  .join(",")

                await fs.appendFile(outputPath, csvRow + "\n", "utf-8")
                recordsWritten++

                if (result.imageMoved) {
                  movedFiles++
                }
              } else {
                // Record didn't pass filters but still count as filtered
                filteredFiles++
                controller.enqueue(
                  `data: ${JSON.stringify({ type: "log", message: `File filtered out: ${workerId}` })}\n\n`,
                )
              }
            } else {
              // No record returned
              filteredFiles++
              controller.enqueue(
                `data: ${JSON.stringify({ type: "log", message: `File filtered out: ${workerId}` })}\n\n`,
              )
            }

            // Send progress update
            const percentage = Math.round((processedFiles / totalFiles) * 100)
            const progressData = {
              type: "progress",
              data: {
                percentage,
                total: totalFiles,
                processed: processedFiles,
                successful: successfulFiles,
                errors: errorFiles,
                filtered: filteredFiles,
                moved: movedFiles,
                stats: {
                  totalFiles,
                  processedFiles,
                  successCount: successfulFiles,
                  errorCount: errorFiles,
                },
              },
            }
            controller.enqueue(`data: ${JSON.stringify(progressData)}\n\n`)

            if (verbose) {
              console.log(`[Stream API] Worker ${workerId} completed successfully`)
            }

            resolve(result)
          } catch (error) {
            console.error(`[Stream API] Error handling worker result:`, error)
            reject(error)
          }
        })

        worker.on("error", (error) => {
          console.error(`[Stream API] Worker ${workerId} error:`, error)
          errorFiles++
          processedFiles++
          reject(error)
        })

        worker.on("exit", (code) => {
          activeWorkers.delete(workerId)
          if (code !== 0 && verbose) {
            console.log(`[Stream API] Worker ${workerId} exited with code ${code}`)
          }
        })
      })
    }

    // Process files in batches
    const processingPromises: Promise<any>[] = []

    for (let i = 0; i < Math.min(maxWorkers, xmlFiles.length); i++) {
      if (currentFileIndex < xmlFiles.length) {
        const xmlFile = xmlFiles[currentFileIndex]
        currentFileIndex++
        processingPromises.push(processFile(xmlFile, i + 1))
      }
    }

    // Process remaining files as workers complete
    while (processingPromises.length > 0) {
      try {
        await Promise.race(processingPromises)

        // Remove completed promises and add new ones
        const completedIndex = processingPromises.findIndex(async (p) => {
          try {
            await p
            return true
          } catch {
            return true
          }
        })

        if (completedIndex !== -1) {
          processingPromises.splice(completedIndex, 1)
        }

        // Add new file if available
        if (currentFileIndex < xmlFiles.length) {
          const xmlFile = xmlFiles[currentFileIndex]
          const workerId = Math.max(...Array.from(activeWorkers)) + 1 || processingPromises.length + 1
          currentFileIndex++
          processingPromises.push(processFile(xmlFile, workerId))
        }

        // Add pause between batches
        if (pauseDuration > 0) {
          await new Promise((resolve) => setTimeout(resolve, pauseDuration))
        }
      } catch (error) {
        console.error(`[Stream API] Error in processing loop:`, error)
        errorFiles++
      }
    }

    // Wait for all workers to complete
    await Promise.allSettled(processingPromises)

    // Cleanup workers
    for (const worker of workers) {
      try {
        await worker.terminate()
      } catch (error) {
        console.error("Error terminating worker:", error)
      }
    }

    // Final progress update
    if (verbose) {
      console.log(`[Stream API] Progress: ${processedFiles}/${totalFiles} (100%)`)
      console.log(
        `[Stream API] Success: ${successfulFiles}, Errors: ${errorFiles}, Filtered: ${filteredFiles}, Moved: ${movedFiles}`,
      )
    }

    controller.enqueue(
      `data: ${JSON.stringify({ type: "log", message: `Progress: ${processedFiles}/${totalFiles} (100%) - Success: ${successfulFiles}, Errors: ${errorFiles}` })}\n\n`,
    )

    const finalStats = {
      totalFiles,
      processedFiles,
      successfulFiles,
      errorFiles,
      recordsWritten,
      filteredFiles,
      movedFiles,
    }

    if (verbose) {
      console.log(
        `[Stream API] Stream processing completed! Processed ${totalFiles} files, ${successfulFiles} successful, ${errorFiles} errors.`,
      )
      console.log(`[Stream API] Final stats:`, finalStats)
      console.log(`[Stream API] Output file: ${outputPath}`)
      console.log(`[Stream API] Session ${sessionId} completed successfully`)
    }

    // Send completion message
    controller.enqueue(
      `data: ${JSON.stringify({
        type: "complete",
        data: {
          stats: finalStats,
          outputFile: outputPath,
          message: `Stream processing completed! Processed ${totalFiles} files, ${successfulFiles} successful, ${errorFiles} errors.`,
        },
      })}\n\n`,
    )
  } catch (error) {
    console.error(`[Stream API] Stream processing error:`, error)
    controller.enqueue(`data: ${JSON.stringify({ type: "error", message: `Processing failed: ${error.message}` })}\n\n`)
  } finally {
    // Cleanup any remaining workers
    for (const worker of workers) {
      try {
        await worker.terminate()
      } catch (error) {
        console.error("Error terminating worker:", error)
      }
    }

    if (verbose) {
      console.log(`[Stream API] Controller closed safely`)
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      rootDir,
      outputFile = "image_metadata.csv",
      outputFolder,
      filterConfig = {},
      verbose = false,
      maxWorkers = 4,
      pauseDuration = 0,
    } = body

    if (!rootDir || !outputFolder) {
      return new NextResponse().json({ error: "Root directory and output folder are required" }, { status: 400 })
    }

    // Create readable stream
    const stream = new ReadableStream({
      start(controller) {
        processFilesStream(
          rootDir,
          filterConfig,
          outputFile,
          outputFolder,
          verbose,
          maxWorkers,
          pauseDuration,
          controller,
        )
          .then(() => {
            controller.close()
          })
          .catch((error) => {
            console.error("Stream processing failed:", error)
            controller.error(error)
          })
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
    console.error("Stream API error:", error)
    return new NextResponse().json({ error: "Internal server error" }, { status: 500 })
  }
}
