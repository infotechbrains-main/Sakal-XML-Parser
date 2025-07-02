import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"
import { createObjectCsvWriter } from "csv-writer"
import { Worker } from "worker_threads"
import { PersistentHistory } from "@/lib/persistent-history"

export const CSV_HEADERS = [
  { id: "city", title: "City" },
  { id: "year", title: "Year" },
  { id: "month", title: "Month" },
  { id: "newsItemId", title: "News Item ID" },
  { id: "dateId", title: "Date ID" },
  { id: "providerId", title: "Provider ID" },
  { id: "headline", title: "Headline" },
  { id: "byline", title: "Byline" },
  { id: "dateline", title: "Date Line" },
  { id: "creditline", title: "Credit Line" },
  { id: "copyrightLine", title: "Copyright Line" },
  { id: "slugline", title: "Slug Line" },
  { id: "keywords", title: "Keywords" },
  { id: "edition", title: "Edition" },
  { id: "location", title: "Location (AdminMeta)" },
  { id: "country", title: "Country" },
  { id: "city_meta", title: "City (Metadata)" },
  { id: "pageNumber", title: "Page Number" },
  { id: "status", title: "Status" },
  { id: "urgency", title: "Urgency" },
  { id: "language", title: "Language" },
  { id: "subject", title: "Subject" },
  { id: "processed", title: "Processed" },
  { id: "published", title: "Published" },
  { id: "usageType", title: "Usage Type" },
  { id: "rightsHolder", title: "Rights Holder" },
  { id: "imageWidth", title: "Image Width" },
  { id: "imageHeight", title: "Image Height" },
  { id: "imageSize", title: "Image Size (bytes from XML)" },
  { id: "actualFileSize", title: "Actual File Size (bytes)" },
  { id: "imageHref", title: "Image Href" },
  { id: "xmlPath", title: "XML Path" },
  { id: "imagePath", title: "Image Path" },
  { id: "imageExists", title: "Image Exists" },
  { id: "creationDate", title: "Creation Date" },
  { id: "revisionDate", title: "Revision Date" },
  { id: "commentData", title: "Comment Data" },
]

const history = new PersistentHistory()

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

    console.log("Received request:", { rootDir, outputFile, outputFolder, numWorkers, verbose, filterConfig })

    if (!rootDir) {
      return NextResponse.json({ error: "Root directory is required" }, { status: 400 })
    }
    if (filterConfig?.moveImages && !filterConfig?.moveDestinationPath) {
      return NextResponse.json({ error: "Move destination path is required when moving images." }, { status: 400 })
    }

    // Create full output path - FIXED: Use full path including output folder
    const fullOutputPath = outputFolder ? path.join(outputFolder, outputFile) : outputFile
    const outputPath = path.resolve(fullOutputPath)

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
        processingMode: "regular",
      },
      progress: {
        totalFiles: 0,
        processedFiles: 0,
        successCount: 0,
        errorCount: 0,
        processedFilesList: [] as string[],
      },
    }

    // Ensure output directory exists
    if (outputFolder) {
      try {
        await fs.mkdir(outputFolder, { recursive: true })
        console.log(`Created output directory: ${outputFolder}`)
      } catch (error) {
        console.error("Error creating output directory:", error)
        return NextResponse.json({ error: `Failed to create output directory: ${outputFolder}` }, { status: 400 })
      }
    }

    console.log("Output path:", outputPath)

    console.log("Searching for XML files...")
    const xmlFiles = await findXmlFilesManually(rootDir)
    console.log(`Found ${xmlFiles.length} XML files`)

    if (xmlFiles.length === 0) {
      try {
        const dirContents = await fs.readdir(rootDir, { recursive: true })
        const allFiles = dirContents.map((f) => f.toString())
        const xmlInDir = allFiles.filter((file) => file.toLowerCase().endsWith(".xml"))
        const sampleFiles = allFiles.slice(0, 20)

        return NextResponse.json(
          {
            error: "No XML files found",
            message: `Searched in: ${rootDir}`,
            debug: {
              totalFiles: allFiles.length,
              xmlFiles: xmlInDir.length,
              sampleFiles: sampleFiles,
              xmlFilesFound: xmlInDir.slice(0, 10),
            },
          },
          { status: 404 },
        )
      } catch (dirError) {
        return NextResponse.json(
          {
            error: "Directory read error",
            message: `Could not read directory: ${rootDir}`,
          },
          { status: 404 },
        )
      }
    }

    // Update session with total files and save
    session.progress.totalFiles = xmlFiles.length
    await history.addSession(session)
    await history.setCurrentSession(session)

    if (verbose) {
      console.log(`[Regular API] Created session: ${sessionId}`)
      console.log(`[Regular API] Output path: ${outputPath}`)
    }

    const allRecords: any[] = []
    let processedCount = 0
    let successCount = 0
    let errorCount = 0
    let filteredCount = 0
    let movedCount = 0
    const errors: string[] = []
    const activeWorkers = new Set<Worker>()

    console.log(`Starting to process ${xmlFiles.length} XML files with ${numWorkers} worker(s)`)
    if (filterConfig?.enabled) {
      console.log("Filtering enabled:", filterConfig)

      // Log filter details for debugging
      if (filterConfig.minWidth || filterConfig.minHeight) {
        console.log(`Image size filter: min ${filterConfig.minWidth || 0}x${filterConfig.minHeight || 0} pixels`)
      }
      if (filterConfig.minFileSize) {
        console.log(
          `Min file size filter: ${filterConfig.minFileSize} bytes (${Math.round((filterConfig.minFileSize / 1024 / 1024) * 100) / 100}MB)`,
        )
      }
      if (filterConfig.maxFileSize) {
        console.log(
          `Max file size filter: ${filterConfig.maxFileSize} bytes (${Math.round((filterConfig.maxFileSize / 1024 / 1024) * 100) / 100}MB)`,
        )
      }
    }

    const workerScriptPath = path.resolve(process.cwd(), "./app/api/parse/xml-parser-worker.js")
    try {
      await fs.access(workerScriptPath)
    } catch (e) {
      console.error("Worker script not found at:", workerScriptPath)
      return NextResponse.json({ error: "Worker script misconfiguration." }, { status: 500 })
    }

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

          if (verbose) console.log(`[Main] Worker ${workerId} started for ${path.basename(currentFile)}`)

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
              errors.push(`Error in ${path.basename(currentFile)} (Worker ${result.workerId}): ${result.error}`)
            }

            // Progress reporting every 100 files or every 10% of total files
            const progressInterval = Math.max(100, Math.floor(xmlFiles.length / 10))
            if (processedCount - lastProgressReport >= progressInterval || processedCount === xmlFiles.length) {
              const progressPercent = Math.round((processedCount / xmlFiles.length) * 100)
              console.log(`[Main] Progress: ${processedCount}/${xmlFiles.length} files processed (${progressPercent}%)`)
              console.log(
                `[Main] Current stats: ${successCount} successful, ${filteredCount} filtered, ${movedCount} moved, ${errorCount} errors`,
              )
              lastProgressReport = processedCount

              // Update session progress
              history.updateSession(sessionId, {
                progress: {
                  totalFiles: xmlFiles.length,
                  processedFiles: processedCount,
                  successCount: successCount,
                  errorCount: errorCount,
                },
              })
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
            console.error(`[Main] Worker ${workerId} for ${path.basename(currentFile)} errored:`, err)
            errorCount++
            errors.push(`Worker error for ${path.basename(currentFile)}: ${err.message}`)
            activeWorkers.delete(worker)

            if (fileIndex < xmlFiles.length) {
              launchWorkerIfNeeded()
            } else if (activeWorkers.size === 0) {
              resolveAllFiles()
            }
          })

          worker.on("exit", (code) => {
            activeWorkers.delete(worker)
            if (code !== 0 && verbose) {
              console.warn(`[Main] Worker ${workerId} for ${path.basename(currentFile)} exited with code ${code}`)
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

    console.log(
      `Processing complete. ${successCount} successful, ${errorCount} errors, ${filteredCount} passed filter, ${movedCount} moved.`,
    )

    if (allRecords.length > 0) {
      const csvWriterInstance = createObjectCsvWriter({
        path: outputPath,
        header: CSV_HEADERS,
      })
      await csvWriterInstance.writeRecords(allRecords)
      console.log(`CSV file written to: ${outputPath}`)
    } else {
      console.log("No records to write to CSV")
    }

    // Update final session status
    const endTime = new Date().toISOString()
    await history.updateSession(sessionId, {
      status: "completed",
      endTime,
      progress: {
        totalFiles: xmlFiles.length,
        processedFiles: processedCount,
        successCount: successCount,
        errorCount: errorCount,
      },
      results: {
        outputPath,
      },
    })

    // Clear current session
    await history.setCurrentSession(null)

    if (verbose) {
      console.log(`[Regular API] Session ${sessionId} completed successfully`)
      console.log(`[Regular API] Output file: ${outputPath}`)
    }

    return NextResponse.json({
      success: true,
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
      errors: verbose ? errors : errors.slice(0, 10),
    })
  } catch (error) {
    console.error("Error in parse API:", error)

    // Update session with error status
    if (sessionId) {
      await history.updateSession(sessionId, {
        status: "failed",
        endTime: new Date().toISOString(),
      })
      await history.setCurrentSession(null)
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
