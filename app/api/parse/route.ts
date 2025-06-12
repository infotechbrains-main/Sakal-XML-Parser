import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"
// parseStringPromise is now used in the worker
import { createObjectCsvWriter } from "csv-writer"
import { Worker } from "worker_threads" // Import Worker

// CSV header definition (remains the same)
const CSV_HEADERS = [
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
  { id: "imageSize", title: "Image Size (bytes)" },
  { id: "imageHref", title: "Image Href" },
  { id: "xmlPath", title: "XML Path" },
  { id: "imagePath", title: "Image Path" },
  { id: "imageExists", title: "Image Exists" },
  { id: "creationDate", title: "Creation Date" },
  { id: "revisionDate", title: "Revision Date" },
  { id: "commentData", title: "Comment Data" },
]

// Manual directory traversal function (remains the same)
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
  try {
    const body = await request.json()
    // Use 'numWorkers' to avoid conflict with Worker class
    const { rootDir, outputFile = "image_metadata.csv", numWorkers = 4, verbose = false, filterConfig = null } = body

    console.log("Received request:", { rootDir, outputFile, numWorkers, verbose, filterConfig })

    if (!rootDir) {
      return NextResponse.json({ error: "Root directory is required" }, { status: 400 })
    }

    const outputPath = path.join(process.cwd(), outputFile)
    console.log("Output path:", outputPath)

    let filteredImagesPath = ""
    if (filterConfig?.moveImages && filterConfig?.outputFolder) {
      filteredImagesPath = path.join(rootDir, filterConfig.outputFolder) // Ensure this is an absolute path or resolvable
      try {
        await fs.mkdir(filteredImagesPath, { recursive: true })
        console.log(`Created filtered images folder: ${filteredImagesPath}`)
      } catch (error) {
        console.log(`Error creating filtered folder: ${error}`)
        // Decide if this is a fatal error or if processing should continue without moving
      }
    }

    console.log("Searching for XML files...")
    const xmlFiles = await findXmlFilesManually(rootDir)
    console.log(`Found ${xmlFiles.length} XML files`)

    if (xmlFiles.length === 0) {
      // ... (no XML files found response remains the same)
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

    const allRecords: any[] = []
    let processedCount = 0
    let successCount = 0
    let errorCount = 0
    let filteredCount = 0 // Files that passed the filter
    let movedCount = 0
    const errors: string[] = []
    const activeWorkers = new Set<Worker>()

    console.log(`Starting to process ${xmlFiles.length} XML files with ${numWorkers} worker(s)`)
    if (filterConfig?.enabled) {
      console.log("Filtering enabled:", filterConfig)
    }

    // Path to the worker script. Ensure this resolves correctly.
    // In Next.js, API routes are typically bundled, so relative paths might need care.
    // Using path.resolve assumes the worker script is at the specified location relative to project root after build.
    const workerScriptPath = path.resolve(process.cwd(), "./app/api/parse/xml-parser-worker.js")
    // Check if worker file exists (for debugging, remove in prod)
    try {
      await fs.access(workerScriptPath)
    } catch (e) {
      console.error("Worker script not found at:", workerScriptPath)
      console.error(
        "Make sure 'app/api/parse/xml-parser-worker.ts' is compiled to 'app/api/parse/xml-parser-worker.js' in the output directory (e.g. .next/server/app/api/parse/) or adjust path accordingly.",
      )
      return NextResponse.json({ error: "Worker script misconfiguration." }, { status: 500 })
    }

    await new Promise<void>((resolveAllFiles) => {
      let fileIndex = 0
      let workersLaunched = 0

      const launchWorkerIfNeeded = () => {
        while (activeWorkers.size < numWorkers && fileIndex < xmlFiles.length) {
          const currentFile = xmlFiles[fileIndex++]
          const workerId = workersLaunched++

          // Check if workerScriptPath is correct. For Next.js, it might be tricky due to bundling.
          // A common pattern is to place worker files in `public` or ensure they are correctly copied/referenced post-build.
          // For server-side workers, they should be part of the server bundle.
          // The path needs to point to the *transpiled* JavaScript file.
          const worker = new Worker(workerScriptPath, {
            workerData: {
              xmlFilePath: currentFile,
              filterConfig,
              filteredImagesPath,
              workerId,
              verbose,
            },
          })
          activeWorkers.add(worker)

          if (verbose) console.log(`[Main] Worker ${workerId} started for ${currentFile}`)

          worker.on("message", (result: any) => {
            processedCount++
            if (result.record) {
              allRecords.push(result.record)
              successCount++
            }
            if (result.passedFilter && result.record) {
              // Only count if record was processed and passed
              filteredCount++
            }
            if (result.imageMoved) {
              movedCount++
            }
            if (result.error) {
              errorCount++
              errors.push(`Error in ${currentFile} (Worker ${result.workerId}): ${result.error}`)
            }

            if (verbose && processedCount % 50 === 0) {
              console.log(`[Main] Progress: ${processedCount}/${xmlFiles.length} files processed by workers.`)
            }

            activeWorkers.delete(worker)
            worker.terminate()

            if (fileIndex < xmlFiles.length) {
              launchWorkerIfNeeded() // Launch another worker for the next file
            } else if (activeWorkers.size === 0) {
              resolveAllFiles() // All files processed and all workers finished
            }
          })

          worker.on("error", (err) => {
            console.error(`[Main] Worker ${workerId} for ${currentFile} errored:`, err)
            errorCount++
            errors.push(`Worker error for ${currentFile}: ${err.message}`)
            activeWorkers.delete(worker)
            // worker.terminate(); // Already terminated on error?

            if (fileIndex < xmlFiles.length) {
              launchWorkerIfNeeded()
            } else if (activeWorkers.size === 0) {
              resolveAllFiles()
            }
          })

          worker.on("exit", (code) => {
            if (code !== 0) {
              // console.warn(`[Main] Worker ${workerId} for ${currentFile} exited with code ${code}`);
              // This might already be handled by 'error' event if it was an unhandled exception.
            }
            // Ensure worker is removed if it exits unexpectedly
            activeWorkers.delete(worker)
            if (fileIndex < xmlFiles.length && activeWorkers.size < numWorkers) {
              // If a worker exited and there are still files and capacity, try to launch a new one.
              // This is a simple retry, more robust handling might be needed for persistent worker failures.
              // launchWorkerIfNeeded();
            } else if (fileIndex >= xmlFiles.length && activeWorkers.size === 0) {
              resolveAllFiles()
            }
          })
        }
      }

      launchWorkerIfNeeded() // Start initial batch of workers

      if (xmlFiles.length === 0) {
        // Handle case with no files to process by workers
        resolveAllFiles()
      }
    })

    console.log(
      `Processing complete. ${successCount} successful, ${errorCount} errors, ${filteredCount} passed filter, ${movedCount} moved.`,
    )

    if (allRecords.length > 0) {
      const csvWriter = createObjectCsvWriter({
        path: outputPath,
        header: CSV_HEADERS,
      })
      await csvWriter.writeRecords(allRecords)
      console.log(`CSV file written to: ${outputPath}`)
    } else {
      console.log("No records to write to CSV")
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
      outputFile: path.basename(outputPath), // Send only filename for download URL
      errors: verbose ? errors : errors.slice(0, 10), // Full errors if verbose
    })
  } catch (error) {
    console.error("Error in parse API:", error)
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// processXmlFile, passesFilter, moveImageToFilteredFolder, findMainNewsComponent, extractCData
// are now moved to xml-parser-worker.ts
