import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
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

    // Create session ID
    sessionId = `regular_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    if (verbose) {
      console.log(`[Regular API] Configuration:`)
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
      return Response.json(
        {
          success: false,
          message: "No XML files found in the specified directory",
        },
        { status: 400 },
      )
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

    // Determine output path
    const outputPath = outputFolder ? path.join(outputFolder, outputFile) : path.join(process.cwd(), outputFile)

    // Create initial session record
    const session = {
      id: sessionId,
      startTime: new Date().toISOString(),
      status: "running" as const,
      config: {
        rootDir,
        outputFile,
        numWorkers,
        verbose,
        filterConfig,
        processingMode: "regular",
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
      console.log(`[Regular API] Created session: ${sessionId}`)
      console.log(`[Regular API] Processing ${xmlFiles.length} files with ${numWorkers} workers`)
    }

    // Ensure output directory exists
    if (outputFolder) {
      await fs.mkdir(outputFolder, { recursive: true })
      if (verbose) {
        console.log(`[Regular API] Created output directory: ${outputFolder}`)
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
      console.log(`[Regular API] Initialized CSV file: ${outputPath}`)
    }

    // Process files in batches
    const activeWorkers = new Set<Worker>()
    const errors: string[] = []

    for (let i = 0; i < xmlFiles.length; i += numWorkers) {
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
            if (result.error) {
              errors.push(result.error)
              if (verbose) {
                console.log(`[Regular API] Error processing file: ${result.error}`)
              }
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

        if (verbose) {
          const percentage = Math.round((stats.processedFiles / stats.totalFiles) * 100)
          console.log(`[Regular API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
          console.log(
            `[Regular API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
          )
        }
      } catch (error) {
        const errorMsg = `Batch processing error: ${error instanceof Error ? error.message : "Unknown error"}`
        if (verbose) {
          console.error(`[Regular API] ${errorMsg}`)
        }
        errors.push(errorMsg)
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
          console.error("[Regular API] Error terminating worker:", error)
        }
      }
    }
    activeWorkers.clear()

    // Update final session status
    const endTime = new Date().toISOString()

    await history.updateSession(sessionId, {
      status: "completed",
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

    const completionMessage = `Regular processing completed! Processed ${stats.processedFiles} files, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`

    if (verbose) {
      console.log(`[Regular API] ${completionMessage}`)
      console.log(`[Regular API] Final stats:`, stats)
      console.log(`[Regular API] Output file: ${outputPath}`)
      console.log(`[Regular API] Session ${sessionId} completed successfully`)
    }

    return Response.json({
      success: true,
      message: completionMessage,
      stats,
      outputFile: outputPath,
      errors: errors.slice(-10), // Return last 10 errors
      downloadURL: `/api/download?file=${encodeURIComponent(outputPath)}`,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error("[Regular API] Fatal error:", errorMessage)

    // Update session with error status
    if (sessionId) {
      await history.updateSession(sessionId, {
        status: "failed",
        endTime: new Date().toISOString(),
      })
      await history.setCurrentSession(null)
    }

    return Response.json(
      {
        success: false,
        message: `Regular processing error: ${errorMessage}`,
      },
      { status: 500 },
    )
  }
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
    if (verbose) {
      console.log(`[Regular API] Creating worker ${workerId} for file: ${path.basename(xmlFile)}`)
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
          console.log(`[Regular API] Worker ${workerId} timed out after 30 seconds`)
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
          console.log(`[Regular API] Worker ${workerId} completed successfully`)
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
          console.error(`[Regular API] Worker ${workerId} error:`, error.message)
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
            console.log(`[Regular API] Worker ${workerId} exited with code ${code}`)
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
