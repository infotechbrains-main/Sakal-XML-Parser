import { NextResponse } from "next/server"
import { ReadableStream } from "stream/web"
import { getPauseState, resetPauseState } from "../pause/route"

const numWorkers = 4 // Number of worker threads
let activeWorkers = new Set<Worker>()
let fileIndex = 0
let processedCount = 0

const sendMessage = (event: string, data: any) => {
  self.postMessage({ event, data })
}

const createStream = () => {
  let controller: ReadableStreamDefaultController
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(c) {
      controller = c
    },
    cancel() {
      console.log("Stream cancelled")
    },
  })

  const send = (message: string) => {
    controller.enqueue(encoder.encode(message))
  }

  const close = () => {
    controller.close()
  }

  return { stream, send, close }
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const files = formData.getAll("files") as File[]

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 })
  }

  const xmlFiles = files.filter((file) => file.type === "text/xml" || file.name.endsWith(".xml"))

  if (xmlFiles.length === 0) {
    return NextResponse.json({ error: "No XML files provided" }, { status: 400 })
  }

  fileIndex = 0
  processedCount = 0
  activeWorkers = new Set<Worker>()

  const { stream, send, close } = createStream()

  const launchWorker = async (file: File) => {
    const worker = new Worker(new URL("./worker", import.meta.url))
    activeWorkers.add(worker)

    worker.postMessage({ file, fileName: file.name })

    worker.onmessage = (event) => {
      if (event.data.event === "result") {
        send(`data: ${JSON.stringify(event.data.data)}\n\n`)
        processedCount++
      } else if (event.data.event === "done") {
        activeWorkers.delete(worker)
        worker.terminate().catch(console.error)
        launchWorkerIfNeeded()
      } else if (event.data.event === "error") {
        console.error("Worker error:", event.data.error)
        send(`data: ${JSON.stringify({ error: event.data.error })}\n\n`)
        activeWorkers.delete(worker)
        worker.terminate().catch(console.error)
        launchWorkerIfNeeded()
      }
    }

    worker.onerror = (error) => {
      console.error("Worker error:", error)
      send(`data: ${JSON.stringify({ error: error.message })}\n\n`)
      activeWorkers.delete(worker)
      worker.terminate().catch(console.error)
      launchWorkerIfNeeded()
    }
  }

  const launchWorkerIfNeeded = () => {
    while (activeWorkers.size < numWorkers && fileIndex < xmlFiles.length) {
      // Check for pause/stop requests
      const pauseState = getPauseState()
      if (pauseState.shouldPause) {
        sendMessage("paused", {
          message: "Processing has been paused",
          processed: processedCount,
          total: xmlFiles.length,
          canResume: true,
        })
        // Terminate all active workers
        activeWorkers.forEach((worker) => {
          worker.terminate().catch(console.error)
        })
        activeWorkers.clear()
        resetPauseState()
        return
      }

      const currentFile = xmlFiles[fileIndex++]
      launchWorker(currentFile)
    }

    if (processedCount === xmlFiles.length && activeWorkers.size === 0) {
      send(`data: ${JSON.stringify({ completed: true, message: "All files processed" })}\n\n`)
      close()
    }
  }

  launchWorkerIfNeeded()

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
