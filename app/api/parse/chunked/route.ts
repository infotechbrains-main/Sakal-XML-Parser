import type { NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { Worker } from "worker_threads"
import { getPauseState, resetPauseState } from "../pause/route"
import { PersistentHistory, type FailedMoveRecord } from "@/lib/persistent-history"
import { isRemotePath, scanRemoteDirectory } from "@/lib/remote-file-handler"
import { scanLocalDirectoryForAssets } from "@/lib/media-stats"
import { processImagesWithoutXml } from "@/lib/no-xml-processor"

interface ProcessingStats {
  totalFiles: number
  processedFiles: number
  successfulFiles: number
  errorFiles: number
  recordsWritten: number
  filteredFiles: number
  movedFiles: number
  moveFailures: number
  totalMediaFiles: number
  mediaFilesMatched: number
  localMediaFilesMatched: number
  remoteMediaFilesMatched: number
  mediaFilesUnmatched: number
  xmlFilesWithMedia: number
  xmlFilesMissingMedia: number
  xmlProcessedWithoutMedia: number
  mediaCountsByExtension: Record<string, number>
  noXmlImagesConsidered: number
  noXmlImagesRecorded: number
  noXmlImagesFilteredOut: number
  noXmlImagesMoved: number
  noXmlDestinationPath?: string
}

interface WorkerResult {
  record: any
  passedFilter: boolean
  imageMoved: boolean
  error?: string
  workerId: number
  imageFailure?: ImageFailure | null
}

interface ImageFailure {
  reason: string
  reasonCode: string
  details?: string
  destinationPath?: string
  imageHref?: string
  imagePath?: string
  xmlPath?: string
  filterStatus?: string
}

interface ChunkedProcessingState {
  sessionId: string
  config: any
  stats: ProcessingStats
  currentChunk: number
  totalChunks: number
  chunkSize: number
  xmlFiles: string[]
  mediaFiles: string[]
  matchedImagePaths: string[]
  remoteMediaMatches: number
  outputPath: string
  startTime: string
  pauseTime?: string
  processedChunks: string[][]
  scanWarnings?: string[]
  failureOutputPath?: string
  moveFailureCount?: number
  failurePreview?: FailedMoveRecord[]
}

const CHUNKED_STATE_FILE = path.join(process.cwd(), "chunked_processing_state.json")
const history = new PersistentHistory()
const FAILURE_PREVIEW_LIMIT = 50

async function saveProcessingState(state: ChunkedProcessingState): Promise<void> {
  try {
    await fs.writeFile(CHUNKED_STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    console.log("[Chunked API] Saved processing state to file")
  } catch (error) {
    console.error("[Chunked API] Error saving processing state:", error)
  }
}

async function loadProcessingState(): Promise<ChunkedProcessingState | null> {
  try {
    const data = await fs.readFile(CHUNKED_STATE_FILE, "utf8")
    const state = JSON.parse(data)
    console.log("[Chunked API] Loaded processing state from file")
    return state
  } catch (error) {
    console.log("[Chunked API] No saved processing state found")
    return null
  }
}

async function clearProcessingState(): Promise<void> {
  try {
    await fs.unlink(CHUNKED_STATE_FILE)
    console.log("[Chunked API] Cleared processing state file")
  } catch (error) {
    // File doesn't exist, which is fine
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
  let controllerClosed = false

  const stream = new ReadableStream({
    async start(controller) {
  let sessionId: string | null = null
  let processingState: ChunkedProcessingState | null = null

      const safeCloseController = () => {
        if (!controllerClosed) {
          try {
            controller.close()
            controllerClosed = true
            console.log("[Chunked API] Controller closed safely")
          } catch (error) {
            console.error("[Chunked API] Error closing controller:", error)
          }
        }
      }

      const sendMessage = (type: string, message: any) => {
        if (controllerClosed) {
          console.log(`[Chunked API] Skipping message (controller closed): ${type}`)
          return
        }

        try {
          const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() })
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch (error) {
          console.error("[Chunked API] Error sending message:", error)
        }
      }

      try {
        const body = await request.json()
        const {
          rootDir,
          outputFile = "image_metadata.csv",
          outputFolder = "",
          chunkSize = 100,
          pauseDuration = 1000,
          numWorkers = 4,
          verbose = false,
          filterConfig = null,
        } = body

        resetPauseState()
        sessionId = `chunked_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        sendMessage("start", "Starting chunked processing...")

        if (verbose) {
          console.log(`[Chunked API] Configuration:`)
          console.log(`  - Session ID: ${sessionId}`)
          console.log(`  - Root Directory: ${rootDir}`)
          console.log(`  - Output File: ${outputFile}`)
          console.log(`  - Output Folder: ${outputFolder || "current directory"}`)
          console.log(`  - Chunk Size: ${chunkSize}`)
          console.log(`  - Pause Duration: ${pauseDuration}ms`)
          console.log(`  - Workers: ${numWorkers}`)
          console.log(`  - Verbose: ${verbose}`)
          console.log(`  - Filters Enabled: ${filterConfig?.enabled || false}`)
        }

        // Check if this is a remote path
        const isRemote = await isRemotePath(rootDir)
  let xmlFiles: string[] = []
  let mediaFiles: string[] = []
  let mediaCountsByExtension: Record<string, number> = {}
  let scanWarnings: string[] = []

        if (isRemote) {
          sendMessage("log", "Scanning remote directory for XML files...")
          sendMessage("log", "This may take a few minutes for large directories...")

          try {
            // Enhanced scanning with better progress reporting
            const remoteScan = await scanRemoteDirectory(
              rootDir,
              (message) => {
                sendMessage("log", message)
                console.log(`[Remote Scanner] ${message}`)
              },
              {
                maxDepth: 5, // City/year/month/processed structure
                includeMedia: true,
              },
            )

            xmlFiles = remoteScan.xmlFiles.map((file) => file.url)
            mediaFiles = remoteScan.mediaFiles.map((file) => file.url)
            mediaCountsByExtension = remoteScan.mediaCountsByExtension
            scanWarnings = remoteScan.warnings

            if (scanWarnings.length > 0) {
              scanWarnings.forEach((warning) => sendMessage("log", `Scan warning: ${warning}`))
            }

            if (verbose) {
              console.log(
                `[Chunked API] Found ${xmlFiles.length} remote XML files and ${mediaFiles.length} media files`,
              )
            }

            sendMessage(
              "log",
              `Found ${xmlFiles.length} XML files and ${mediaFiles.length} media files in remote directory`,
            )

            if (xmlFiles.length === 0) {
              sendMessage("log", "No XML files found. This could be due to:")
              sendMessage("log", "1. Server directory listing format not recognized")
              sendMessage("log", "2. XML files are in deeper nested directories")
              sendMessage("log", "3. Access permissions or server configuration")
              sendMessage("error", "No XML files found in the specified remote directory")
              safeCloseController()
              return
            }

            // Limit to first 10000 files to prevent memory issues
            if (xmlFiles.length > 10000) {
              sendMessage("log", `Limiting processing to first 10,000 files (found ${xmlFiles.length} total)`)
              xmlFiles = xmlFiles.slice(0, 10000)
            }
          } catch (error) {
            const errorMsg = `Failed to scan remote directory: ${error instanceof Error ? error.message : "Unknown error"}`
            console.error(`[Chunked API] ${errorMsg}`)
            sendMessage("error", errorMsg)
            safeCloseController()
            return
          }
        } else {
          // Local file processing
          sendMessage("log", "Scanning local directory for XML and media files...")
          const scanResult = await scanLocalDirectoryForAssets(path.resolve(rootDir))
          xmlFiles = scanResult.xmlFiles
          mediaFiles = scanResult.mediaFiles
          mediaCountsByExtension = scanResult.mediaCountsByExtension
          scanWarnings = scanResult.errors

          if (scanWarnings.length > 0) {
            console.warn("[Chunked API] Directory scan completed with warnings:", scanWarnings)
            scanWarnings.forEach((warning) => sendMessage("log", `Scan warning: ${warning}`))
          }
        }

        if (xmlFiles.length === 0) {
          sendMessage("error", "No XML files found in the specified directory")
          safeCloseController()
          return
        }

        const totalChunks = Math.ceil(xmlFiles.length / chunkSize)
        const stats: ProcessingStats = {
          totalFiles: xmlFiles.length,
          processedFiles: 0,
          successfulFiles: 0,
          errorFiles: 0,
          recordsWritten: 0,
          filteredFiles: 0,
          movedFiles: 0,
          moveFailures: 0,
          totalMediaFiles: mediaFiles.length,
          mediaFilesMatched: 0,
          localMediaFilesMatched: 0,
          remoteMediaFilesMatched: 0,
          mediaFilesUnmatched: mediaFiles.length,
          xmlFilesWithMedia: 0,
          xmlFilesMissingMedia: xmlFiles.length,
          xmlProcessedWithoutMedia: 0,
          mediaCountsByExtension,
          noXmlImagesConsidered: 0,
          noXmlImagesRecorded: 0,
          noXmlImagesFilteredOut: 0,
          noXmlImagesMoved: 0,
        }

        const matchedLocalMediaPaths = new Set<string>()
        let remoteMediaMatches = 0
  const failurePreview: FailedMoveRecord[] = []

        const updateMediaStatsFromRecord = (record: any) => {
          if (!record) return

          const imageExistsValue =
            typeof record.imageExists === "string"
              ? record.imageExists.toLowerCase() === "yes"
              : Boolean(record.imageExists)

          if (imageExistsValue) {
            stats.xmlFilesWithMedia++
            const imagePath = typeof record.imagePath === "string" ? record.imagePath : ""
            if (imagePath) {
              if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
                remoteMediaMatches++
              } else {
                matchedLocalMediaPaths.add(path.normalize(imagePath))
              }
            }
          } else {
            stats.xmlProcessedWithoutMedia++
          }

          stats.localMediaFilesMatched = matchedLocalMediaPaths.size
          stats.remoteMediaFilesMatched = remoteMediaMatches
          stats.mediaFilesMatched = matchedLocalMediaPaths.size + remoteMediaMatches
          stats.mediaFilesUnmatched = Math.max(stats.totalMediaFiles - stats.mediaFilesMatched, 0)
          stats.xmlFilesMissingMedia = Math.max(stats.totalFiles - stats.xmlFilesWithMedia, 0)
        }

        // Determine output path
        let outputPath: string
        if (outputFolder) {
          if (path.isAbsolute(outputFolder)) {
            outputPath = path.join(outputFolder, outputFile)
          } else {
            outputPath = path.resolve(process.cwd(), outputFolder, outputFile)
          }
        } else {
          outputPath = path.join(process.cwd(), outputFile)
        }

        const parsedOutputPath = path.parse(outputPath)
        const failureOutputPath = path.join(
          parsedOutputPath.dir,
          `${parsedOutputPath.name}_move_failures${parsedOutputPath.ext || ".csv"}`,
        )

        // Create processing state
        processingState = {
          sessionId,
          config: {
            rootDir,
            outputFile,
            outputFolder,
            chunkSize,
            pauseDuration,
            numWorkers,
            verbose,
            filterConfig,
            isRemote,
          },
          stats,
          currentChunk: 0,
          totalChunks,
          chunkSize,
          xmlFiles,
          mediaFiles,
          matchedImagePaths: [],
          remoteMediaMatches: 0,
          outputPath,
          failureOutputPath,
          startTime: new Date().toISOString(),
          processedChunks: [],
          scanWarnings,
          moveFailureCount: 0,
          failurePreview: [],
        }

        const updateProcessingState = (mutator: (state: ChunkedProcessingState) => void) => {
          if (processingState) {
            mutator(processingState)
          }
        }

        const persistProcessingState = async () => {
          if (!processingState) return
          processingState.matchedImagePaths = Array.from(matchedLocalMediaPaths)
          processingState.mediaFiles = mediaFiles
          processingState.remoteMediaMatches = remoteMediaMatches
          processingState.scanWarnings = scanWarnings
          processingState.moveFailureCount = stats.moveFailures
          processingState.failurePreview = failurePreview
          processingState.failureOutputPath = failureOutputPath
          await saveProcessingState(processingState)
        }

        await persistProcessingState()

        // Create session
        const session = {
          id: sessionId,
          startTime: new Date().toISOString(),
          status: "running" as const,
          config: {
            rootDir: path.resolve(rootDir),
            outputFile: outputPath,
            chunkSize,
            pauseDuration,
            numWorkers,
            verbose,
            filterConfig,
            processingMode: "chunked",
            isRemote,
          },
          progress: {
            totalFiles: stats.totalFiles,
            processedFiles: 0,
            successCount: 0,
            errorCount: 0,
            processedFilesList: [] as string[],
            mediaFilesTotal: stats.totalMediaFiles,
            mediaFilesMatched: 0,
            mediaFilesUnmatched: stats.totalMediaFiles,
            xmlFilesWithMedia: 0,
            xmlFilesMissingMedia: stats.totalFiles,
            moveFailures: 0,
          },
        }

        await history.addSession(session)
        await history.setCurrentSession(session)

        if (verbose) {
          console.log(`[Chunked API] Created session: ${sessionId}`)
          console.log(`[Chunked API] Output path: ${outputPath}`)
        }

        sendMessage("log", `Processing ${xmlFiles.length} files in ${totalChunks} chunks of ${chunkSize}`)

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath)
        await fs.mkdir(outputDir, { recursive: true })
        if (verbose) {
          console.log(`[Chunked API] Created output directory: ${outputDir}`)
        }

        const failureHeaders =
          [
            "imageHref",
            "imagePath",
            "xmlPath",
            "failureReason",
            "failureDetails",
            "filterStatus",
          ].join(",") + "\n"

        await fs.writeFile(failureOutputPath, failureHeaders, "utf8")

        if (verbose) {
          console.log(`[Chunked API] Initialized failure CSV file: ${failureOutputPath}`)
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
            "haveXml",
            "creationDate",
            "revisionDate",
            "commentData",
          ].join(",") + "\n"

        await fs.writeFile(outputPath, headers, "utf8")

        if (verbose) {
          console.log(`[Chunked API] Initialized CSV file: ${outputPath}`)
        }

        // Process files in chunks
        let wasInterrupted = false

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          updateProcessingState((state) => {
            state.currentChunk = chunkIndex + 1
          })
          await persistProcessingState()

          // Check for pause/stop before processing chunk
          const pauseState = getPauseState()
          if (pauseState.shouldStop) {
            if (verbose) {
              console.log(`[Chunked API] Stop requested before chunk ${chunkIndex + 1}`)
            }
            wasInterrupted = true
            updateProcessingState((state) => {
              state.pauseTime = new Date().toISOString()
            })
            await persistProcessingState()
            sendMessage("shutdown", {
              reason: "Processing stopped by user",
              stats,
              outputFile: outputPath,
              canResume: true,
              currentChunk: chunkIndex + 1,
              totalChunks,
            })
            safeCloseController()
            return
          }

          if (pauseState.isPaused) {
            if (verbose) {
              console.log(`[Chunked API] Pause requested before chunk ${chunkIndex + 1}`)
            }
            updateProcessingState((state) => {
              state.pauseTime = new Date().toISOString()
            })
            await persistProcessingState()

            if (sessionId) {
              await history.updateSession(sessionId, {
                status: "paused",
                progress: {
                  totalFiles: stats.totalFiles,
                  processedFiles: stats.processedFiles,
                  successCount: stats.successfulFiles,
                  errorCount: stats.errorFiles,
                  mediaFilesTotal: stats.totalMediaFiles,
                  mediaFilesMatched: stats.mediaFilesMatched,
                  mediaFilesUnmatched: stats.mediaFilesUnmatched,
                  xmlFilesWithMedia: stats.xmlFilesWithMedia,
                  xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
                  moveFailures: stats.moveFailures,
                },
              })
            }

            sendMessage("paused", {
              message: "Processing paused - state saved",
              canResume: true,
              currentChunk: chunkIndex + 1,
              totalChunks,
            })
            safeCloseController()
            return
          }

          const startIndex = chunkIndex * chunkSize
          const endIndex = Math.min(startIndex + chunkSize, xmlFiles.length)
          const chunk = xmlFiles.slice(startIndex, endIndex)

          sendMessage("chunk", `Starting chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`)

          if (verbose) {
            console.log(`[Chunked API] Processing chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`)
          }

          // Process chunk with workers
          const activeWorkers = new Set<Worker>()
          const chunkPromises = chunk.map((xmlFile, index) =>
            processFile(xmlFile, filterConfig, verbose, activeWorkers, rootDir, startIndex + index + 1, isRemote),
          )

          try {
            const chunkResults = await Promise.all(chunkPromises)

            // Check for pause/stop during batch processing
            const midProcessPauseState = getPauseState()
            if (midProcessPauseState.shouldStop || midProcessPauseState.isPaused) {
              if (verbose) {
                console.log(`[Chunked API] Pause/Stop requested during batch processing`)
              }

              // Cleanup workers
              for (const worker of activeWorkers) {
                try {
                  worker.terminate()
                } catch (error) {
                  if (verbose) {
                    console.error("[Chunked API] Error terminating worker:", error)
                  }
                }
              }
              activeWorkers.clear()

              // Process results we got before interruption
              await processChunkResults(
                chunkResults,
                outputPath,
                failureOutputPath,
                stats,
                verbose,
                updateMediaStatsFromRecord,
                failurePreview,
                FAILURE_PREVIEW_LIMIT,
              )

              updateProcessingState((state) => {
                state.stats = stats
                state.pauseTime = new Date().toISOString()
                state.processedChunks.push(chunk)
                state.moveFailureCount = stats.moveFailures
                state.failurePreview = failurePreview
              })
              await persistProcessingState()

              if (midProcessPauseState.shouldStop) {
                wasInterrupted = true
                sendMessage("shutdown", {
                  reason: "Processing stopped during batch",
                  stats,
                  outputFile: outputPath,
                  canResume: true,
                  currentChunk: chunkIndex + 1,
                  totalChunks,
                })
              } else {
                sendMessage("paused", {
                  message: "Processing paused during batch - state saved",
                  canResume: true,
                  currentChunk: chunkIndex + 1,
                  totalChunks,
                })
              }

              safeCloseController()
              return
            }

            // Process results normally
            await processChunkResults(
              chunkResults,
              outputPath,
              failureOutputPath,
              stats,
              verbose,
              updateMediaStatsFromRecord,
              failurePreview,
              FAILURE_PREVIEW_LIMIT,
            )

            updateProcessingState((state) => {
              state.stats = stats
              state.processedChunks.push(chunk)
              state.moveFailureCount = stats.moveFailures
              state.failurePreview = failurePreview
            })
            await persistProcessingState()

            // Update session progress
            if (sessionId) {
              await history.updateSession(sessionId, {
                progress: {
                  totalFiles: stats.totalFiles,
                  processedFiles: stats.processedFiles,
                  successCount: stats.successfulFiles,
                  errorCount: stats.errorFiles,
                  mediaFilesTotal: stats.totalMediaFiles,
                  mediaFilesMatched: stats.mediaFilesMatched,
                  mediaFilesUnmatched: stats.mediaFilesUnmatched,
                  xmlFilesWithMedia: stats.xmlFilesWithMedia,
                  xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
                  moveFailures: stats.moveFailures,
                },
              })
            }

            // Cleanup workers
            for (const worker of activeWorkers) {
              try {
                worker.terminate()
              } catch (error) {
                if (verbose) {
                  console.error("[Chunked API] Error terminating worker:", error)
                }
              }
            }
            activeWorkers.clear()

            sendMessage("chunk", `Completed chunk ${chunkIndex + 1}/${totalChunks}`)

            // Send progress update
            const percentage = Math.round((stats.processedFiles / stats.totalFiles) * 100)
            sendMessage("progress", {
              percentage,
              total: stats.totalFiles,
              processed: stats.processedFiles,
              successful: stats.successfulFiles,
              errors: stats.errorFiles,
              filtered: stats.filteredFiles,
              moved: stats.movedFiles,
              moveFailures: stats.moveFailures,
              currentChunk: chunkIndex + 1,
              totalChunks,
              stats: {
                totalFiles: stats.totalFiles,
                processedFiles: stats.processedFiles,
                successCount: stats.successfulFiles,
                errorCount: stats.errorFiles,
                totalMediaFiles: stats.totalMediaFiles,
                mediaFilesMatched: stats.mediaFilesMatched,
                localMediaFilesMatched: stats.localMediaFilesMatched,
                remoteMediaFilesMatched: stats.remoteMediaFilesMatched,
                mediaFilesUnmatched: stats.mediaFilesUnmatched,
                xmlFilesWithMedia: stats.xmlFilesWithMedia,
                xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
                xmlProcessedWithoutMedia: stats.xmlProcessedWithoutMedia,
                moveFailures: stats.moveFailures,
                noXmlImagesConsidered: stats.noXmlImagesConsidered,
                noXmlImagesRecorded: stats.noXmlImagesRecorded,
                noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
                noXmlImagesMoved: stats.noXmlImagesMoved,
                noXmlDestinationPath: stats.noXmlDestinationPath,
              },
            })

            if (verbose) {
              console.log(`[Chunked API] Chunk ${chunkIndex + 1}/${totalChunks} completed`)
              console.log(`[Chunked API] Progress: ${stats.processedFiles}/${stats.totalFiles} (${percentage}%)`)
              console.log(
                `[Chunked API] Success: ${stats.successfulFiles}, Errors: ${stats.errorFiles}, Filtered: ${stats.filteredFiles}, Moved: ${stats.movedFiles}`,
              )
            }

            // Pause between chunks (except for the last chunk) - FIXED PAUSE CHECKING
            if (chunkIndex < totalChunks - 1 && pauseDuration > 0) {
              if (verbose) {
                console.log(`[Chunked API] Pausing for ${pauseDuration}ms between chunks`)
              }

              const pauseStartTime = Date.now()
              while (Date.now() - pauseStartTime < pauseDuration) {
                // Check pause state more frequently during pause
                const pauseCheckState = getPauseState()
                if (pauseCheckState.shouldStop || pauseCheckState.isPaused) {
                  if (verbose) {
                    console.log(`[Chunked API] Pause/Stop requested during chunk pause`)
                  }

                  updateProcessingState((state) => {
                    state.pauseTime = new Date().toISOString()
                  })
                  await persistProcessingState()

                  if (pauseCheckState.shouldStop) {
                    wasInterrupted = true
                    sendMessage("shutdown", {
                      reason: "Processing stopped during chunk pause",
                      stats,
                      outputFile: outputPath,
                      canResume: true,
                      currentChunk: chunkIndex + 2,
                      totalChunks,
                    })
                  } else {
                    sendMessage("paused", {
                      message: "Processing paused during chunk pause - state saved",
                      canResume: true,
                      currentChunk: chunkIndex + 2,
                      totalChunks,
                    })
                  }

                  safeCloseController()
                  return
                }
                // Check every 100ms instead of 200ms for more responsive pause
                await new Promise((resolve) => setTimeout(resolve, 100))
              }
            }
          } catch (error) {
            const errorMsg = `Chunk ${chunkIndex + 1} processing error: ${error instanceof Error ? error.message : "Unknown error"}`
            if (verbose) {
              console.error(`[Chunked API] ${errorMsg}`)
            }
            sendMessage("error", errorMsg)
            stats.errorFiles += chunk.length
            stats.processedFiles += chunk.length

            updateProcessingState((state) => {
              state.stats = stats
            })
            await persistProcessingState()
          }
        }

        // Clear processing state file on successful completion
        await clearProcessingState()

        if (!wasInterrupted && !isRemote) {
          const noXmlResult = await processImagesWithoutXml({
            rootDir: path.resolve(rootDir),
            mediaFiles,
            matchedImagePaths: matchedLocalMediaPaths,
            filterConfig,
            verbose,
            collectRecords: false,
            onRecord: async (record) => {
              const csvLine =
                Object.values(record)
                  .map((value) =>
                    typeof value === "string" && (value.includes(",") || value.includes("\"") || value.includes("\n"))
                      ? `"${String(value).replace(/"/g, '""')}"`
                      : value || "",
                  )
                  .join(",") + "\n"

              await fs.appendFile(outputPath, csvLine, "utf8")
              stats.recordsWritten++
            },
            onLog: (message) => {
              if (verbose) {
                sendMessage("log", message)
              }
            },
          })

          stats.noXmlImagesConsidered = noXmlResult.stats.considered
          stats.noXmlImagesRecorded = noXmlResult.stats.recorded
          stats.noXmlImagesFilteredOut = noXmlResult.stats.filteredOut
          stats.noXmlImagesMoved = noXmlResult.stats.moved
          stats.noXmlDestinationPath = noXmlResult.destinationPath

          if (noXmlResult.errors.length > 0 && verbose) {
            noXmlResult.errors.forEach((err) => sendMessage("log", err))
          }
        }

        // Update final session status
        const finalStatus = wasInterrupted ? "interrupted" : "completed"
        const endTime = new Date().toISOString()

        stats.localMediaFilesMatched = matchedLocalMediaPaths.size
        stats.remoteMediaFilesMatched = remoteMediaMatches
        stats.mediaFilesMatched = matchedLocalMediaPaths.size + remoteMediaMatches
        stats.mediaFilesUnmatched = Math.max(stats.totalMediaFiles - stats.mediaFilesMatched, 0)
        stats.xmlFilesMissingMedia = Math.max(stats.totalFiles - stats.xmlFilesWithMedia, 0)

        const statsSummary = {
          totalFiles: stats.totalFiles,
          processedFiles: stats.processedFiles,
          successfulFiles: stats.successfulFiles,
          errorFiles: stats.errorFiles,
          recordsWritten: stats.recordsWritten,
          filteredFiles: stats.filteredFiles,
          movedFiles: stats.movedFiles,
          moveFailures: stats.moveFailures,
          totalMediaFiles: stats.totalMediaFiles,
          mediaFilesMatched: stats.mediaFilesMatched,
          localMediaFilesMatched: stats.localMediaFilesMatched,
          remoteMediaFilesMatched: stats.remoteMediaFilesMatched,
          mediaFilesUnmatched: stats.mediaFilesUnmatched,
          xmlFilesWithMedia: stats.xmlFilesWithMedia,
          xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
          xmlProcessedWithoutMedia: stats.xmlProcessedWithoutMedia,
          mediaCountsByExtension: stats.mediaCountsByExtension,
          noXmlImagesConsidered: stats.noXmlImagesConsidered,
          noXmlImagesRecorded: stats.noXmlImagesRecorded,
          noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
          noXmlImagesMoved: stats.noXmlImagesMoved,
          noXmlDestinationPath: stats.noXmlDestinationPath,
        }

        if (sessionId) {
          await history.updateSession(sessionId, {
            status: finalStatus,
            endTime,
            progress: {
              totalFiles: stats.totalFiles,
              processedFiles: stats.processedFiles,
              successCount: stats.successfulFiles,
              errorCount: stats.errorFiles,
              mediaFilesTotal: stats.totalMediaFiles,
              mediaFilesMatched: stats.mediaFilesMatched,
              mediaFilesUnmatched: stats.mediaFilesUnmatched,
              xmlFilesWithMedia: stats.xmlFilesWithMedia,
              xmlFilesMissingMedia: stats.xmlFilesMissingMedia,
              noXmlImagesRecorded: stats.noXmlImagesRecorded,
              noXmlImagesFilteredOut: stats.noXmlImagesFilteredOut,
              moveFailures: stats.moveFailures,
            },
            results: {
              outputPath,
              failureOutputPath,
              failureCount: stats.moveFailures,
              failurePreview,
              stats: statsSummary,
            },
          })
        }

        await history.setCurrentSession(null)

        // Send completion message
        if (!wasInterrupted) {
          const completionMessage = `Chunked processing completed! Processed ${stats.processedFiles} files in ${totalChunks} chunks, ${stats.successfulFiles} successful, ${stats.errorFiles} errors.`

          if (verbose) {
            console.log(`[Chunked API] ${completionMessage}`)
            console.log(`[Chunked API] Final stats:`, stats)
            console.log(`[Chunked API] Output file: ${outputPath}`)
            console.log(`[Chunked API] Session ${sessionId} completed successfully`)
          }

          sendMessage("complete", {
            stats,
            outputFile: outputPath,
            failureOutputFile: failureOutputPath,
            failureCount: stats.moveFailures,
            failurePreview,
            message: completionMessage,
            scanWarnings,
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        console.error("[Chunked API] Fatal error:", errorMessage)

        if (sessionId) {
          await history.updateSession(sessionId, {
            status: "failed",
            endTime: new Date().toISOString(),
          })
          await history.setCurrentSession(null)
        }

        await clearProcessingState()

        if (!controllerClosed) {
          try {
            const data = JSON.stringify({
              type: "error",
              message: `Chunked processing error: ${errorMessage}`,
              timestamp: new Date().toISOString(),
            })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          } catch (encodeError) {
            console.error("Error encoding error message:", encodeError)
          }
        }
      } finally {
        safeCloseController()
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

async function processChunkResults(
  chunkResults: WorkerResult[],
  outputPath: string,
  failureOutputPath: string,
  stats: ProcessingStats,
  verbose: boolean,
  updateMediaStatsFromRecord: (record: any) => void,
  failurePreview: FailedMoveRecord[],
  previewLimit: number,
): Promise<void> {
  const formatFailureValue = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    const stringValue = String(value)
    if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
      return `"${stringValue.replace(/"/g, '""')}"`
    }
    return stringValue
  }

  for (const result of chunkResults) {
    stats.processedFiles++

    if (result.record) {
      stats.successfulFiles++
      stats.recordsWritten++
      updateMediaStatsFromRecord(result.record)

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
      if (verbose && result.error) {
        console.log(`[Chunked API] Error processing file: ${result.error}`)
      }
    }

    if (!result.passedFilter) {
      stats.filteredFiles++
    }

    if (result.imageMoved) {
      stats.movedFiles++
    } else if (result.imageFailure) {
      stats.moveFailures++

      const failureRecord: FailedMoveRecord = {
        imageHref: result.imageFailure.imageHref || result.record?.imageHref || "",
        imagePath: result.imageFailure.imagePath || result.record?.imagePath || "",
        xmlPath: result.imageFailure.xmlPath || result.record?.xmlPath || "",
        failureReason: result.imageFailure.reason,
        failureDetails: result.imageFailure.details,
        filterStatus: result.imageFailure.filterStatus,
      }

      const failureLine =
        [
          failureRecord.imageHref,
          failureRecord.imagePath,
          failureRecord.xmlPath,
          failureRecord.failureReason,
          failureRecord.failureDetails,
          failureRecord.filterStatus,
        ]
          .map(formatFailureValue)
          .join(",") + "\n"

      await fs.appendFile(failureOutputPath, failureLine, "utf8")

      if (failurePreview.length < previewLimit) {
        failurePreview.push(failureRecord)
      }
    }
  }
}

async function processFile(
  xmlFile: string,
  filterConfig: any,
  verbose: boolean,
  activeWorkers: Set<Worker>,
  originalRootDir: string,
  workerId: number,
  isRemote = false,
): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const pauseState = getPauseState()
    if (pauseState.shouldStop) {
      resolve({
        record: null,
        passedFilter: false,
        imageMoved: false,
        error: "Processing stopped by user",
        workerId,
      })
      return
    }

    if (verbose) {
      console.log(`[Chunked API] Creating worker ${workerId} for file: ${isRemote ? xmlFile : path.basename(xmlFile)}`)
    }

    const worker = new Worker(path.join(process.cwd(), "app/api/parse/xml-parser-worker.js"), {
      workerData: {
        xmlFilePath: xmlFile,
        filterConfig: filterConfig,
        originalRootDir: originalRootDir,
        workerId: workerId,
        verbose: verbose,
        isRemote: isRemote,
        originalRemoteXmlUrl: isRemote ? xmlFile : null,
        associatedImagePath: null,
        isWatchMode: false,
      },
    })

    activeWorkers.add(worker)

    const timeout = setTimeout(() => {
      try {
        if (verbose) {
          console.log(`[Chunked API] Worker ${workerId} timed out after 30 seconds`)
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
    }, 30000)

    worker.on("message", (result: WorkerResult) => {
      try {
        clearTimeout(timeout)
        activeWorkers.delete(worker)
        worker.terminate()

        if (verbose) {
          console.log(`[Chunked API] Worker ${workerId} completed successfully`)
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
          console.error(`[Chunked API] Worker ${workerId} error:`, error.message)
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
            console.log(`[Chunked API] Worker ${workerId} exited with code ${code}`)
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
