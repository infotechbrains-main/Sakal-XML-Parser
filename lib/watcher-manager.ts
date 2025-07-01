import { watch, type FSWatcher } from "chokidar"
import { Worker } from "worker_threads"
import path from "path"
import fs from "fs"

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
  private watcher: FSWatcher | null = null
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
        const headers = [
          "filename",
          "filepath",
          "filesize",
          "width",
          "height",
          "format",
          "colorSpace",
          "hasAlpha",
          "density",
          "orientation",
          "created",
          "modified",
          "title",
          "description",
          "keywords",
          "creator",
          "copyright",
          "creditLine",
          "usageType",
          "rightsHolder",
          "location",
          "city",
          "state",
          "country",
          "gpsLatitude",
          "gpsLongitude",
          "cameraModel",
          "lensMake",
          "lensModel",
          "focalLength",
          "aperture",
          "shutterSpeed",
          "iso",
          "flash",
          "whiteBalance",
          "exposureMode",
          "meteringMode",
          "sceneCaptureType",
          "contrast",
          "saturation",
          "sharpness",
          "digitalZoomRatio",
          "colorTemperature",
          "tint",
          "exposure",
          "highlights",
          "shadows",
          "whites",
          "blacks",
          "clarity",
          "vibrance",
          "saturationAdj",
          "luminanceSmoothing",
          "colorNoiseReduction",
          "vignetting",
          "chromaticAberration",
          "distortionCorrection",
          "perspectiveCorrection",
          "cropTop",
          "cropLeft",
          "cropBottom",
          "cropRight",
          "rotation",
          "flipHorizontal",
          "flipVertical",
        ].join(",")
        fs.writeFileSync(csvPath, headers + "\n")
      }

      // Start watching for image files
      this.watcher = watch(config.rootDir, {
        ignored: /[/\\]\./,
        persistent: true,
        ignoreInitial: true,
        depth: 10,
      })

      this.watcher.on("add", (filePath) => {
        this.handleNewFile(filePath)
      })

      this.watcher.on("error", (error) => {
        console.error("Watcher error:", error)
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

  getStatus() {
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
      const worker = new Worker(path.join(process.cwd(), "app/api/parse/xml-parser-worker.js"), {
        workerData: {
          filePath,
          filterConfig: this.config.filterConfig,
          outputFile: this.config.outputFile,
          verbose: this.config.verbose,
          isWatchMode: true,
        },
      })

      worker.on("message", (result) => {
        if (result.success) {
          this.stats.filesSuccessful++
          if (result.moved) {
            this.stats.filesMoved++
          }
          if (this.config?.verbose) {
            console.log(`✅ Processed: ${path.basename(filePath)}`)
          }
        } else {
          this.stats.filesErrored++
          if (this.config?.verbose) {
            console.error(`❌ Error processing ${path.basename(filePath)}:`, result.error)
          }
        }
      })

      worker.on("error", (error) => {
        this.stats.filesErrored++
        console.error(`❌ Worker error for ${path.basename(filePath)}:`, error)
      })

      worker.on("exit", (code) => {
        if (code !== 0 && this.config?.verbose) {
          console.error(`❌ Worker exited with code ${code} for ${path.basename(filePath)}`)
        }
      })
    } catch (error: any) {
      this.stats.filesErrored++
      console.error(`❌ Error handling file ${filePath}:`, error)
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
