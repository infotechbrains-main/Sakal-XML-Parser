import chokidar from "chokidar"
import path from "path"
import { Worker } from "worker_threads"
import { createObjectCsvWriter } from "csv-writer"

// This will hold our single watcher instance
let watcher: chokidar.FSWatcher | null = null

// This function will be called from the API route to start watching
export function startWatcher(
  rootDir: string,
  filterConfig: any,
  outputFile: string,
  numWorkers: number,
  verbose: boolean,
  onLog: (message: string) => void,
  onUpdate: (stats: any) => void,
) {
  // If a watcher is already running, stop it before starting a new one
  if (watcher) {
    watcher.close()
    onLog("Closed existing watcher to start a new session.")
  }

  onLog(`Starting to watch directory: ${rootDir}`)
  watcher = chokidar.watch(rootDir, {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true, // Don't process existing files on start, only new ones
    depth: 99, // Watch subdirectories deeply
  })

  const workerScriptPath = path.resolve(process.cwd(), "./app/api/parse/xml-parser-worker.js")
  const outputPath = path.join(process.cwd(), outputFile)

  // Listen for new files being added
  watcher.on("add", async (filePath) => {
    if (filePath.toLowerCase().endsWith(".xml")) {
      onLog(`[Watcher] New XML file detected: ${path.basename(filePath)}`)

      // Use a worker to process the single file
      const worker = new Worker(workerScriptPath, {
        workerData: {
          xmlFilePath: filePath,
          filterConfig,
          filteredImagesPath: filterConfig?.moveImages ? path.join(rootDir, filterConfig.outputFolder) : "",
          workerId: 0, // Simple ID for single file processing
          verbose,
        },
      })

      worker.on("message", async (result: any) => {
        if (result.error) {
          onLog(`[Watcher] Error processing ${path.basename(filePath)}: ${result.error}`)
          onUpdate({ errorFiles: 1 })
        } else if (result.record) {
          onLog(`[Watcher] Successfully processed ${path.basename(filePath)}. Appending to CSV.`)
          onUpdate({ successfulFiles: 1, processedFiles: 1, recordsWritten: 1 })

          // Append the single record to the CSV
          const csvWriter = createObjectCsvWriter({
            path: outputPath,
            header: result.record ? Object.keys(result.record).map((key) => ({ id: key, title: key })) : [],
            append: true, // IMPORTANT: Append to existing file
          })

          try {
            await csvWriter.writeRecords([result.record])
            onLog(`[Watcher] Record for ${path.basename(filePath)} appended to ${outputFile}.`)
          } catch (csvError: any) {
            onLog(`[Watcher] Error appending to CSV: ${csvError.message}`)
          }
        } else {
          onLog(`[Watcher] File ${path.basename(filePath)} was filtered out and not processed.`)
          onUpdate({ processedFiles: 1 }) // Still counts as processed
        }
        worker.terminate()
      })

      worker.on("error", (err) => {
        onLog(`[Watcher] Worker error for ${path.basename(filePath)}: ${err.message}`)
        onUpdate({ errorFiles: 1 })
      })
    }
  })

  watcher.on("error", (error) => onLog(`[Watcher] Watcher error: ${error}`))
  watcher.on("ready", () => onLog("[Watcher] Initial scan complete. Ready for changes."))
}

// This function will be called to stop the watcher
export function stopWatcher(onLog: (message: string) => void) {
  if (watcher) {
    watcher.close()
    watcher = null
    onLog("[Watcher] File watcher has been stopped.")
    return true
  }
  onLog("[Watcher] No active watcher to stop.")
  return false
}

// Function to check the status
export function getWatcherStatus() {
  return {
    isWatching: !!watcher,
    path: watcher ? watcher.getWatched() : null,
  }
}
