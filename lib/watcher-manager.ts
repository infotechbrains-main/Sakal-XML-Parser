import chokidar from "chokidar"
import path from "path"
import fs from "fs"
import { Worker } from "worker_threads"
import { createObjectCsvWriter } from "csv-writer"
import { CSV_HEADERS } from "@/app/api/parse/route" // Assuming CSV_HEADERS is exported or defined here

let watcher: chokidar.FSWatcher | null = null

export function startWatcher(
  rootDir: string,
  filterConfig: any, // This will now contain moveDestinationPath and moveFolderStructureOption
  outputFile: string,
  numWorkers: number, // Though watcher processes one by one, numWorkers might be for consistency
  verbose: boolean,
  onLog: (message: string) => void,
  onUpdate: (stats: any) => void,
) {
  if (watcher) {
    watcher.close()
    onLog("Closed existing watcher to start a new session.")
  }

  onLog(`Starting to watch directory: ${rootDir}`)
  watcher = chokidar.watch(rootDir, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    depth: 99,
  })

  const workerScriptPath = path.resolve(process.cwd(), "./app/api/parse/xml-parser-worker.js")
  const outputPath = path.join(process.cwd(), outputFile)

  watcher.on("add", async (filePath) => {
    if (filePath.toLowerCase().endsWith(".xml")) {
      onLog(`[Watcher] New XML file detected: ${path.basename(filePath)}`)

      const worker = new Worker(workerScriptPath, {
        workerData: {
          xmlFilePath: filePath,
          filterConfig, // Pass the full filterConfig
          originalRootDir: rootDir, // Pass rootDir for path replication logic
          workerId: 0,
          verbose,
        },
      })

      worker.on("message", async (result: any) => {
        if (result.error) {
          onLog(`[Watcher] Error processing ${path.basename(filePath)}: ${result.error}`)
          onUpdate({ errorFiles: 1 })
        } else if (result.record) {
          onLog(`[Watcher] Successfully processed ${path.basename(filePath)}. Appending to CSV.`)
          onUpdate({ successfulFiles: 1, processedFiles: 1, recordsWritten: 1, movedFiles: result.imageMoved ? 1 : 0 })

          // Check if CSV exists, if not, write headers first
          let fileExists = false
          try {
            await fs.promises.access(outputPath)
            fileExists = true
          } catch (e) {
            // File doesn't exist
          }

          const csvWriter = createObjectCsvWriter({
            path: outputPath,
            header: CSV_HEADERS, // Use the defined CSV_HEADERS
            append: fileExists, // Append if file exists, otherwise create with headers
          })

          try {
            await csvWriter.writeRecords([result.record])
            onLog(`[Watcher] Record for ${path.basename(filePath)} appended to ${outputFile}.`)
          } catch (csvError: any) {
            onLog(`[Watcher] Error appending to CSV: ${csvError.message}`)
          }
        } else {
          onLog(`[Watcher] File ${path.basename(filePath)} was filtered out or not processed.`)
          onUpdate({ processedFiles: 1 })
        }
        worker.terminate().catch((err) => onLog(`[Watcher] Error terminating worker: ${err.message}`))
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

export function getWatcherStatus() {
  return {
    isWatching: !!watcher,
    path: watcher ? watcher.getWatched() : null,
  }
}
