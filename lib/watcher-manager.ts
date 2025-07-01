import chokidar from "chokidar"
import path from "path"
import fs from "fs"
import { Worker } from "worker_threads"
import { createObjectCsvWriter } from "csv-writer"

// Define CSV headers here since we can't import from the route
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
  startTime: Date
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
    startTime: new Date(),
  }
  private watcherId: string | null = null

  async startWatcher(config: WatcherConfig) {
    try {
      if (this.isWatching) {
        return { success: false, error: "Watcher is already running" }
      }

      // Validate directory exists
      if (!fs.existsSync(config.rootDir)) {
        return { success: false, error: `Directory does not exist: ${config.rootDir}` }
      }

      this.config = config
      this.watcherId = `watcher_${Date.now()}`
      this.stats = {
        filesProcessed: 0,
        filesSuccessful: 0,
        filesMoved: 0,
        filesErrored: 0,
        startTime: new Date(),
      }

      // Initialize CSV file with headers if it doesn't exist
      const csvPath = path.resolve(config.outputFile)
      if (!fs.existsSync(csvPath)) {
        const csvWriter = createObjectCsvWriter({
          path: csvPath,
          header: CSV_HEADERS,
        })
        await csvWriter.writeRecords([]) // Write headers only
      }

      // Start watching for image files
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
        }
      })

      this.isWatching = true

      if (config.verbose) {
        console.log(`✅ Watcher started for directory: ${config.rootDir}`)
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
      this.config = null
      this.watcherId = null

      console.log("🛑 Watcher stopped")
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
    }
  }

  private async handleNewFile(filePath: string) {
    if (!this.config) return

    // Check if it's an image file
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".svg"]
    const ext = path.extname(filePath).toLowerCase()

    if (!imageExtensions.includes(ext)) {
      return
    }

    if (this.config.verbose) {
      console.log(`📁 New image detected: ${filePath}`)
    }

    try {
      this.stats.filesProcessed++

      // Process the file using the worker
      const workerScriptPath = path.resolve(process.cwd(), "app/api/parse/xml-parser-worker.js")

      if (!fs.existsSync(workerScriptPath)) {
        console.error(`Worker script not found: ${workerScriptPath}`)
        this.stats.filesErrored++
        return
      }

      const worker = new Worker(workerScriptPath, {
        workerData: {
          imagePath: filePath,
          filterConfig: this.config.filterConfig,
          originalRootDir: this.config.rootDir,
          workerId: 0,
          verbose: this.config.verbose,
          isWatchMode: true,
        },
      })

      const timeout = setTimeout(() => {
        worker.terminate()
        this.stats.filesErrored++
        if (this.config?.verbose) {
          console.error(`❌ Worker timeout for ${path.basename(filePath)}`)
        }
      }, 30000) // 30 second timeout

      worker.on("message", async (result: any) => {
        clearTimeout(timeout)

        try {
          if (result.error) {
            this.stats.filesErrored++
            if (this.config?.verbose) {
              console.error(`❌ Error processing ${path.basename(filePath)}:`, result.error)
            }
          } else if (result.record) {
            this.stats.filesSuccessful++
            if (result.imageMoved) {
              this.stats.filesMoved++
            }

            if (this.config?.verbose) {
              console.log(`✅ Successfully processed ${path.basename(filePath)}`)
            }

            // Append to CSV
            await this.appendToCsv(this.config!.outputFile, result.record)
          } else {
            if (this.config?.verbose) {
              console.log(`⏭️ File ${path.basename(filePath)} was filtered out`)
            }
          }

          await worker.terminate()
        } catch (err: any) {
          await worker.terminate()
          this.stats.filesErrored++
          console.error(`❌ Error handling worker result for ${path.basename(filePath)}:`, err)
        }
      })

      worker.on("error", async (err) => {
        clearTimeout(timeout)
        this.stats.filesErrored++
        if (this.config?.verbose) {
          console.error(`❌ Worker error for ${path.basename(filePath)}:`, err.message)
        }
        await worker.terminate()
      })

      worker.on("exit", (code) => {
        clearTimeout(timeout)
        if (code !== 0 && this.config?.verbose) {
          console.error(`❌ Worker exited with code ${code} for ${path.basename(filePath)}`)
        }
      })
    } catch (error: any) {
      this.stats.filesErrored++
      console.error(`❌ Error handling file ${filePath}:`, error)
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
