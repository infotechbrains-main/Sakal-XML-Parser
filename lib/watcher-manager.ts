import chokidar from "chokidar"
import path from "path"
import fs from "fs"
import { Worker } from "worker_threads"
import { createObjectCsvWriter } from "csv-writer"

// Define CSV headers for image metadata
const CSV_HEADERS = [
  { id: "filename", title: "Filename" },
  { id: "filepath", title: "Filepath" },
  { id: "filesize", title: "File Size (bytes)" },
  { id: "width", title: "Width" },
  { id: "height", title: "Height" },
  { id: "format", title: "Format" },
  { id: "colorSpace", title: "Color Space" },
  { id: "hasAlpha", title: "Has Alpha" },
  { id: "density", title: "Density" },
  { id: "orientation", title: "Orientation" },
  { id: "compression", title: "Compression" },
  { id: "quality", title: "Quality" },
  { id: "dateCreated", title: "Date Created" },
  { id: "dateModified", title: "Date Modified" },
  { id: "aspectRatio", title: "Aspect Ratio" },
  { id: "megapixels", title: "Megapixels" },
  { id: "bitDepth", title: "Bit Depth" },
  { id: "iccProfile", title: "ICC Profile" },
  { id: "exifData", title: "EXIF Data" },
  { id: "filtersPassed", title: "Filters Passed" },
  { id: "imageMoved", title: "Image Moved" },
  { id: "destinationPath", title: "Destination Path" },
  { id: "xmlFile", title: "Associated XML File" },
  { id: "xmlExists", title: "XML Exists" },
]

interface WatcherConfig {
  rootDir: string
  filterConfig?: any
  outputFile: string
  numWorkers: number
  verbose: boolean
}

interface WatcherStats {
  filesProcessed: number
  filesSuccessful: number
  filesMoved: number
  filesErrored: number
  xmlFilesDetected: number
  imageFilesDetected: number
  pairsProcessed: number
  startTime: Date
}

interface FilePair {
  xmlPath?: string
  imagePath?: string
  baseName: string
  isComplete: boolean
}

class WatcherManager {
  private watcher: chokidar.FSWatcher | null = null
  private isWatching = false
  private config: WatcherConfig | null = null
  private stats: WatcherStats = {
    filesProcessed: 0,
    filesSuccessful: 0,
    filesMoved: 0,
    filesErrored: 0,
    xmlFilesDetected: 0,
    imageFilesDetected: 0,
    pairsProcessed: 0,
    startTime: new Date(),
  }
  private watcherId: string | null = null
  private filePairs: Map<string, FilePair> = new Map()

  async startWatcher(config: WatcherConfig) {
    try {
      if (this.isWatching) {
        return { success: false, error: "Watcher is already running" }
      }

      // Validate directory exists and is accessible
      try {
        const stats = fs.statSync(config.rootDir)
        if (!stats.isDirectory()) {
          return { success: false, error: `Path exists but is not a directory: ${config.rootDir}` }
        }

        // Test read access
        fs.readdirSync(config.rootDir)
      } catch (err: any) {
        return { success: false, error: `Directory not accessible: ${config.rootDir} - ${err.message}` }
      }

      this.config = config
      this.watcherId = `watcher_${Date.now()}`
      this.stats = {
        filesProcessed: 0,
        filesSuccessful: 0,
        filesMoved: 0,
        filesErrored: 0,
        xmlFilesDetected: 0,
        imageFilesDetected: 0,
        pairsProcessed: 0,
        startTime: new Date(),
      }
      this.filePairs.clear()

      // Initialize CSV file with headers if it doesn't exist
      const csvPath = path.resolve(config.outputFile)
      try {
        if (!fs.existsSync(csvPath)) {
          const csvWriter = createObjectCsvWriter({
            path: csvPath,
            header: CSV_HEADERS,
          })
          await csvWriter.writeRecords([]) // Write headers only
          if (config.verbose) {
            console.log(`📄 Created CSV file: ${csvPath}`)
          }
        }
      } catch (err: any) {
        return { success: false, error: `Failed to create CSV file: ${err.message}` }
      }

      // Start watching for both XML and image files
      this.watcher = chokidar.watch(config.rootDir, {
        ignored: /[/\\]\./,
        persistent: true,
        ignoreInitial: true,
        depth: 10,
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 100,
        },
      })

      this.watcher.on("add", (filePath) => {
        this.handleNewFile(filePath)
      })

      this.watcher.on("error", (error) => {
        console.error("Watcher error:", error)
      })

      this.watcher.on("ready", () => {
        if (config.verbose) {
          console.log(`✅ Watcher ready and monitoring: ${config.rootDir}`)
          console.log(`🔍 Looking for XML-Image pairs...`)
        }
      })

      this.isWatching = true

      if (config.verbose) {
        console.log(`✅ Watcher started for directory: ${config.rootDir}`)
        console.log(`📄 Output file: ${csvPath}`)
        console.log(`🔍 Filters enabled: ${config.filterConfig?.enabled ? "YES" : "NO"}`)
        console.log(`📋 Will process XML-Image pairs only`)
      }

      return { success: true, watcherId: this.watcherId }
    } catch (error: any) {
      console.error("Error starting watcher:", error)
      return { success: false, error: error.message }
    }
  }

  async stopWatcher() {
    try {
      if (!this.isWatching || !this.watcher) {
        return { success: false, error: "No watcher is currently running" }
      }

      await this.watcher.close()
      this.watcher = null
      this.isWatching = false

      const duration = Math.round((Date.now() - this.stats.startTime.getTime()) / 1000)

      console.log("🛑 Watcher stopped")
      console.log(
        `📊 Final stats: ${this.stats.pairsProcessed} pairs processed, ${this.stats.filesSuccessful}/${this.stats.filesProcessed} files successful, ${this.stats.filesMoved} moved, ${this.stats.filesErrored} errors, ${duration}s total`,
      )

      this.config = null
      this.watcherId = null
      this.filePairs.clear()

      return { success: true }
    } catch (error: any) {
      console.error("Error stopping watcher:", error)
      return { success: false, error: error.message }
    }
  }

  async getStatus() {
    return {
      isWatching: this.isWatching,
      watcherId: this.watcherId,
      config: this.config,
      stats: this.stats,
      uptime: this.isWatching ? Date.now() - this.stats.startTime.getTime() : 0,
      pendingPairs: Array.from(this.filePairs.values()).filter((pair) => !pair.isComplete).length,
      completePairs: Array.from(this.filePairs.values()).filter((pair) => pair.isComplete).length,
    }
  }

  private getBaseName(filePath: string): string {
    // Extract base name without extension for pairing
    // For files like "2025-05-16_ABD25J42542_MED_1_Org_pr.jpg" and "2025-05-16_ABD25J42542_MED_1_Org_pr.xml"
    const fileName = path.basename(filePath)
    const nameWithoutExt = path.parse(fileName).name
    return nameWithoutExt
  }

  private isXmlFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === ".xml"
  }

  private isImageFile(filePath: string): boolean {
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".svg"]
    const ext = path.extname(filePath).toLowerCase()
    return imageExtensions.includes(ext)
  }

  private async handleNewFile(filePath: string) {
    if (!this.config) return

    const isXml = this.isXmlFile(filePath)
    const isImage = this.isImageFile(filePath)

    // Only process XML and image files
    if (!isXml && !isImage) {
      return
    }

    const baseName = this.getBaseName(filePath)

    if (this.config.verbose) {
      console.log(`📁 New ${isXml ? "XML" : "image"} file detected: ${path.basename(filePath)}`)
      console.log(`🔗 Base name for pairing: ${baseName}`)
    }

    // Update stats
    if (isXml) {
      this.stats.xmlFilesDetected++
    } else {
      this.stats.imageFilesDetected++
    }

    // Get or create file pair
    let pair = this.filePairs.get(baseName)
    if (!pair) {
      pair = {
        baseName,
        isComplete: false,
      }
      this.filePairs.set(baseName, pair)
    }

    // Update the pair
    if (isXml) {
      pair.xmlPath = filePath
    } else {
      pair.imagePath = filePath
    }

    // Check if pair is complete
    pair.isComplete = !!(pair.xmlPath && pair.imagePath)

    if (pair.isComplete) {
      if (this.config.verbose) {
        console.log(`✅ Complete pair found for ${baseName}:`)
        console.log(`  📄 XML: ${path.basename(pair.xmlPath!)}`)
        console.log(`  🖼️  Image: ${path.basename(pair.imagePath!)}`)
      }

      // Process the complete pair
      await this.processPair(pair)

      // Remove from pending pairs
      this.filePairs.delete(baseName)
    } else {
      if (this.config.verbose) {
        console.log(`⏳ Waiting for ${pair.xmlPath ? "image" : "XML"} file to complete pair: ${baseName}`)
      }
    }
  }

  private async processPair(pair: FilePair) {
    if (!this.config || !pair.xmlPath || !pair.imagePath) return

    try {
      this.stats.filesProcessed++
      this.stats.pairsProcessed++

      if (this.config.verbose) {
        console.log(`🔄 Processing pair: ${pair.baseName}`)
      }

      // Use the XML parser worker to process the XML file and find associated image
      const workerScriptPath = path.resolve(process.cwd(), "app/api/parse/xml-parser-worker.js")

      if (!fs.existsSync(workerScriptPath)) {
        console.error(`Worker script not found: ${workerScriptPath}`)
        this.stats.filesErrored++
        return
      }

      const worker = new Worker(workerScriptPath, {
        workerData: {
          xmlFilePath: pair.xmlPath,
          filterConfig: this.config.filterConfig,
          originalRootDir: this.config.rootDir,
          workerId: 0,
          verbose: this.config.verbose,
          isWatchMode: true,
          associatedImagePath: pair.imagePath, // Pass the known image path
        },
      })

      const timeout = setTimeout(() => {
        worker.terminate()
        this.stats.filesErrored++
        if (this.config?.verbose) {
          console.error(`❌ Worker timeout for pair ${pair.baseName}`)
        }
      }, 30000) // 30 second timeout

      worker.on("message", async (result: any) => {
        clearTimeout(timeout)

        try {
          if (result.error) {
            this.stats.filesErrored++
            if (this.config?.verbose) {
              console.error(`❌ Error processing pair ${pair.baseName}:`, result.error)
            }
          } else if (result.record) {
            this.stats.filesSuccessful++
            if (result.imageMoved) {
              this.stats.filesMoved++
            }

            if (this.config?.verbose) {
              console.log(`✅ Successfully processed pair ${pair.baseName}`)
            }

            // Add XML file info to the record
            result.record.xmlFile = path.basename(pair.xmlPath!)
            result.record.xmlExists = "Yes"

            // Append to CSV
            await this.appendToCsv(this.config!.outputFile, result.record)
          } else {
            if (this.config?.verbose) {
              console.log(`⏭️ Pair ${pair.baseName} was filtered out`)
            }
          }

          await worker.terminate()
        } catch (err: any) {
          await worker.terminate()
          this.stats.filesErrored++
          console.error(`❌ Error handling worker result for pair ${pair.baseName}:`, err)
        }
      })

      worker.on("error", async (err) => {
        clearTimeout(timeout)
        this.stats.filesErrored++
        if (this.config?.verbose) {
          console.error(`❌ Worker error for pair ${pair.baseName}:`, err.message)
        }
        await worker.terminate()
      })

      worker.on("exit", (code) => {
        clearTimeout(timeout)
        if (code !== 0 && this.config?.verbose) {
          console.error(`❌ Worker exited with code ${code} for pair ${pair.baseName}`)
        }
      })
    } catch (error: any) {
      this.stats.filesErrored++
      console.error(`❌ Error processing pair ${pair.baseName}:`, error)
    }
  }

  private async appendToCsv(outputPath: string, record: any) {
    try {
      const csvWriter = createObjectCsvWriter({
        path: outputPath,
        header: CSV_HEADERS,
        append: true,
      })

      await csvWriter.writeRecords([record])

      if (this.config?.verbose) {
        console.log(`📝 Record appended to CSV: ${outputPath}`)
      }
    } catch (csvError: any) {
      console.error(`❌ Error writing to CSV:`, csvError)
      throw csvError
    }
  }
}

// Global instance
const watcherManager = new WatcherManager()

export async function startWatcher(config: WatcherConfig) {
  return watcherManager.startWatcher(config)
}

export async function stopWatcher() {
  return watcherManager.stopWatcher()
}

export async function getWatcherStatus() {
  return watcherManager.getStatus()
}
