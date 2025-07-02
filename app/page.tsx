"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Toaster } from "sonner"

interface Message {
  type: string
  message: any
  timestamp?: string
}

interface ProcessingStats {
  totalFiles: number
  processedFiles: number
  successCount: number
  errorCount: number
  currentFile?: string
  estimatedTimeRemaining?: string
}

interface FilterConfig {
  enabled: boolean
  fileTypes: string[]
  customExtensions: string
  allowedFileTypes: string[]
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  minFileSize?: number
  maxFileSize?: number
  minFileSizeValue?: number
  maxFileSizeValue?: number
  minFileSizeUnit?: string
  maxFileSizeUnit?: string

  // Complete metadata filters
  creditLine?: {
    operator: string
    value: string
  }
  copyright?: {
    operator: string
    value: string
  }
  usageType?: {
    operator: string
    value: string
  }
  rightsHolder?: {
    operator: string
    value: string
  }
  location?: {
    operator: string
    value: string
  }

  // Image moving configuration
  moveImages: boolean
  moveDestinationPath?: string
  moveFolderStructureOption?: "replicate" | "flat"
}

interface ProcessingSession {
  id: string
  startTime: string
  endTime?: string
  status: string
  config: {
    rootDir: string
    outputFile: string
    numWorkers: number
    verbose: boolean
    filterConfig: FilterConfig | null
    processingMode: string
  }
  progress: {
    totalFiles: number
    processedFiles: number
    successCount: number
    errorCount: number
  }
  results?: {
    outputPath: string
  }
}

interface ProcessingResults {
  stats: {
    totalFiles: number
    processedFiles: number
    successfulFiles: number
    errorFiles: number
    recordsWritten: number
    filteredFiles: number
    movedFiles: number
  }
  outputFile: string
  errors: string[]
  processingTime?: string
  startTime?: string
  endTime?: string
}

export default function Home() {
  // Basic configuration
  const [rootDir, setRootDir] = useState("")
  const [outputFile, setOutputFile] = useState("image_metadata.csv")
  const [outputFolder, setOutputFolder] = useState("")
  const [numWorkers, setNumWorkers] = useState(4)
  const [verbose, setVerbose] = useState(false)
  const [processingMode, setProcessingMode] = useState<"regular" | "stream" | "chunked">("stream")

  // Processing state
  const [messages, setMessages] = useState<Message[]>([])
  const [errorMessages, setErrorMessages] = useState<Message[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [canResume, setCanResume] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState<ProcessingStats>({
    totalFiles: 0,
    processedFiles: 0,
    successCount: 0,
    errorCount: 0,
  })

  // Chunked processing
  const [chunkSize, setChunkSize] = useState(100)
  const [pauseBetweenChunks, setPauseBetweenChunks] = useState(false)
  const [pauseDuration, setPauseDuration] = useState(5)
  const [currentChunk, setCurrentChunk] = useState(0)
  const [totalChunks, setTotalChunks] = useState(0)

  // Filter configuration
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [filterConfig, setFilterConfig] = useState<FilterConfig>({
    enabled: false,
    fileTypes: ["jpg", "jpeg", "png", "tiff", "bmp"],
    customExtensions: "",
    allowedFileTypes: ["jpg", "jpeg", "png", "tiff", "bmp"],
    moveImages: false,
    moveFolderStructureOption: "replicate",
  })

  // Watch mode
  const [watchMode, setWatchMode] = useState(false)
  const [watchInterval, setWatchInterval] = useState(30)
  const [watchDirectory, setWatchDirectory] = useState("/Users/amangupta/Desktop/test-images")
  const [watchOutputFile, setWatchOutputFile] = useState("watched_images.csv")
  const [watchOutputFolder, setWatchOutputFolder] = useState("")
  const [useFiltersForWatch, setUseFiltersForWatch] = useState(true)
  const [watcherStatus, setWatcherStatus] = useState<any>(null)

  // Results
  const [downloadURL, setDownloadURL] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [processingResults, setProcessingResults] = useState<ProcessingResults | null>(null)
  const [processingStartTime, setProcessingStartTime] = useState<string | null>(null)
  const [processingEndTime, setProcessingEndTime] = useState<string | null>(null)

  // History - Initialize as empty array and add proper error handling
  const [history, setHistory] = useState<ProcessingSession[]>([])
  const [resumeSession, setResumeSession] = useState<ProcessingSession | null>(null)
  const [showResumeDialog, setShowResumeDialog] = useState(false)

  // Tab management
  const [activeTab, setActiveTab] = useState("basic")

  const logsEndRef = useRef<HTMLDivElement>(null)
  const errorLogsEndRef = useRef<HTMLDivElement>(null)
  const ws = useRef<WebSocket | null>(null)

  // Update filterConfig.enabled when filterEnabled changes
  useEffect(() => {
    setFilterConfig((prev) => ({
      ...prev,
      enabled: filterEnabled,
    }))
  }, [filterEnabled])

  // Update allowedFileTypes when fileTypes changes
  useEffect(() => {
    setFilterConfig((prev) => ({
      ...prev,
      allowedFileTypes: prev.fileTypes,
    }))
  }, [filterConfig.fileTypes])

  useEffect(() => {
    if (ws.current) {
      ws.current.onopen = () => {
        addMessage("system", "WebSocket Connected")
      }

      ws.current.onclose = () => {
        addMessage("system", "WebSocket Disconnected")
      }

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleStreamMessage(data)
        } catch (e) {
          console.error("Error parsing WebSocket message:", e)
        }
      }

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error)
        addMessage("error", "WebSocket connection error")
      }
    }

    return () => {
      if (ws.current) {
        ws.current.close()
      }
    }
  }, [])

  // Add this useEffect after the existing ones
  useEffect(() => {
    loadHistory()
    checkResumeStatus()
  }, [])

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // Auto-scroll error logs to bottom
  useEffect(() => {
    if (errorLogsEndRef.current) {
      errorLogsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [errorMessages])

  // Auto-switch tabs based on processing state
  useEffect(() => {
    if (isRunning && activeTab !== "logs") {
      setActiveTab("logs")
    }
  }, [isRunning])

  const loadHistory = async () => {
    try {
      const response = await fetch("/api/history")

      if (!response.ok) {
        console.error("History API error:", response.status)
        setHistory([])
        return
      }

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        console.error("History response is not JSON")
        setHistory([])
        return
      }

      const data = await response.json()

      // Fix: Ensure we always set an array
      if (Array.isArray(data)) {
        setHistory(data)
      } else if (data && Array.isArray(data.history)) {
        setHistory(data.history)
      } else if (data && data.success && Array.isArray(data.history)) {
        setHistory(data.history)
      } else {
        console.error("Invalid history data:", data)
        setHistory([])
        if (data && data.error) {
          addMessage("error", `Failed to load history: ${data.error}`)
        }
      }
    } catch (error) {
      console.error("Failed to load history:", error)
      setHistory([])
      addMessage("error", `Failed to load history: ${error.message}`)
    }
  }

  const checkResumeStatus = async () => {
    try {
      // Check for chunked processing state first
      const chunkedResumeResponse = await fetch("/api/resume-chunked")
      if (chunkedResumeResponse.ok) {
        const chunkedData = await chunkedResumeResponse.json()
        if (chunkedData.success && chunkedData.canResume) {
          setCanResume(true)
          addMessage("system", "Previous chunked processing session can be resumed")
          return
        }
      }

      // Check pause state for resume capability
      const pauseResponse = await fetch("/api/parse/pause")
      if (pauseResponse.ok) {
        const pauseData = await pauseResponse.json()
        if (pauseData.success && pauseData.state) {
          const canResumeFromPause = pauseData.state.isPaused || pauseData.state.shouldStop
          setCanResume(canResumeFromPause)
          setIsPaused(pauseData.state.isPaused)

          if (canResumeFromPause) {
            addMessage("system", "Previous processing session can be resumed")
          }
        }
      }

      const response = await fetch("/api/resume")

      if (!response.ok) {
        console.error("Resume check failed:", response.status)
        return
      }

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        console.error("Resume response is not JSON")
        return
      }

      const data = await response.json()

      if (data.success) {
        if (data.canResume && data.session) {
          setResumeSession(data.session)
          setShowResumeDialog(true)
        }
      }
    } catch (error) {
      console.error("Failed to check resume status:", error)
    }
  }

  const addMessage = (type: string, message: any) => {
    const newMessage: Message = {
      type,
      message,
      timestamp: new Date().toLocaleTimeString(),
    }

    console.log(`[UI] Adding message: ${type} - ${JSON.stringify(message)}`)

    if (type === "error") {
      setErrorMessages((prev) => [...prev, newMessage])
    } else {
      setMessages((prev) => [...prev, newMessage])
    }
  }

  const formatLogMessage = (message: any): string => {
    if (typeof message === "string") {
      return message
    }

    if (message && typeof message === "object") {
      // Handle specific message types
      if (message.message) {
        return typeof message.message === "string" ? message.message : JSON.stringify(message.message)
      }
      if (message.reason) {
        return message.reason
      }
      if (message.stats) {
        return `Progress: ${message.stats.processedFiles}/${message.stats.totalFiles} files processed`
      }
      return JSON.stringify(message)
    }

    return String(message)
  }

  const handleStreamMessage = (data: any) => {
    console.log(`[UI] Received stream message:`, data)

    switch (data.type) {
      case "start":
        addMessage("system", data.message)
        break
      case "log":
        addMessage("log", data.message)
        break
      case "error":
        addMessage("error", data.message)
        break
      case "paused":
        setIsPaused(true)
        setIsRunning(false)
        setCanResume(true)
        addMessage("system", formatLogMessage(data.message))
        break
      case "shutdown":
        setIsRunning(false)
        setCanResume(data.message.canResume || false)
        addMessage("system", formatLogMessage(data.message))
        break
      case "progress":
        setProgress(data.message.percentage || 0)
        if (data.message.stats) {
          setStats({
            totalFiles: data.message.stats.totalFiles || data.message.total || 0,
            processedFiles: data.message.stats.processedFiles || data.message.processed || 0,
            successCount: data.message.stats.successCount || data.message.successful || 0,
            errorCount: data.message.stats.errorCount || data.message.errors || 0,
          })
        }
        if (data.message.currentChunk) {
          setCurrentChunk(data.message.currentChunk)
        }
        if (data.message.totalChunks) {
          setTotalChunks(data.message.totalChunks)
        }
        break
      case "chunk_start":
        setCurrentChunk(data.message.chunkNumber || 0)
        setTotalChunks(data.message.totalChunks || 0)
        addMessage("chunk", `Starting chunk ${data.message.chunkNumber}/${data.message.totalChunks}`)
        break
      case "chunk_complete":
        addMessage("chunk", `Completed chunk ${data.message.chunkNumber}/${data.message.totalChunks}`)
        break
      case "chunk":
        addMessage("chunk", data.message)
        break
      case "pause_start":
        addMessage("system", `Pausing for ${data.message.duration} seconds before next chunk...`)
        break
      case "pause_countdown":
        addMessage("system", `Resuming in ${data.message.remaining} seconds...`)
        break
      case "pause_end":
        addMessage("system", data.message)
        break
      case "complete":
        // Handle processing completion
        setProcessingEndTime(new Date().toISOString())
        const processingTime = processingStartTime
          ? formatDuration(processingStartTime, new Date().toISOString())
          : "Unknown"

        setProcessingResults({
          stats: data.message.stats || stats,
          outputFile: data.message.outputFile || outputFile,
          errors: data.message.errors || [],
          processingTime,
          startTime: processingStartTime,
          endTime: new Date().toISOString(),
        })

        setIsRunning(false)
        setCanResume(false)
        addMessage("success", "Processing completed successfully!")
        setActiveTab("results") // Auto-switch to results tab
        break
      case "download":
        setDownloadURL(data.message.url)
        addMessage("success", "Processing complete! Download ready.")
        break
      case "job_created":
        setJobId(data.message.jobId)
        break
      default:
        addMessage("info", formatLogMessage(data.message))
        break
    }
  }

  const handleFileTypeChange = (fileType: string, checked: boolean) => {
    setFilterConfig((prev) => ({
      ...prev,
      fileTypes: checked ? [...prev.fileTypes, fileType] : prev.fileTypes.filter((type) => type !== fileType),
    }))
  }

  const selectAllCommonTypes = () => {
    setFilterConfig((prev) => ({
      ...prev,
      fileTypes: ["jpg", "jpeg", "png", "tiff", "bmp", "gif", "webp", "raw", "cr2", "nef"],
    }))
  }

  const clearAllTypes = () => {
    setFilterConfig((prev) => ({
      ...prev,
      fileTypes: [],
    }))
  }

  const startProcessing = async () => {
    setIsRunning(true)
    setMessages([])
    setErrorMessages([])
    setProgress(0)
    setDownloadURL(null)
    setProcessingResults(null)
    setProcessingStartTime(new Date().toISOString())
    setProcessingEndTime(null)
    setCanResume(false)
    setIsPaused(false)
    setStats({
      totalFiles: 0,
      processedFiles: 0,
      successCount: 0,
      errorCount: 0,
    })

    // Auto-switch to logs tab
    setActiveTab("logs")

    try {
      // Prepare the final filter config
      const finalFilterConfig = filterEnabled
        ? {
            ...filterConfig,
            enabled: true,
            allowedFileTypes: filterConfig.fileTypes, // Ensure this is set
          }
        : null

      // Debug log the filter config being sent
      console.log("Filter config being sent:", finalFilterConfig)

      const requestBody = {
        rootDir,
        outputFile,
        outputFolder, // Add this line
        numWorkers,
        verbose,
        filterConfig: finalFilterConfig,
        // Fix: Send the correct chunked processing parameters
        chunkSize: processingMode === "chunked" ? chunkSize : undefined,
        pauseBetweenChunks: processingMode === "chunked" ? pauseBetweenChunks : undefined,
        pauseDuration: processingMode === "chunked" ? pauseDuration : undefined,
      }

      console.log("Full request body:", requestBody)

      let endpoint = "/api/parse"
      if (processingMode === "stream") {
        endpoint = "/api/parse/stream"
      } else if (processingMode === "chunked") {
        endpoint = "/api/parse/chunked"
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      if (processingMode === "regular") {
        const data = await response.json()
        addMessage("success", data.message)
        if (data.downloadURL) {
          setDownloadURL(data.downloadURL)
        }

        // Set results for regular mode
        setProcessingEndTime(new Date().toISOString())
        const processingTime = processingStartTime
          ? formatDuration(processingStartTime, new Date().toISOString())
          : "Unknown"

        setProcessingResults({
          stats: data.stats || stats,
          outputFile: data.outputFile || outputFile,
          errors: data.errors || [],
          processingTime,
          startTime: processingStartTime,
          endTime: new Date().toISOString(),
        })

        setActiveTab("results") // Auto-switch to results tab
      } else {
        // Handle streaming response
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error("No response body")
        }

        const textDecoder = new TextDecoder()
        let partialData = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          partialData += textDecoder.decode(value)

          let completeLines
          if (partialData.includes("\n")) {
            completeLines = partialData.split("\n")
            partialData = completeLines.pop() || ""
          } else {
            completeLines = []
          }

          for (const line of completeLines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6))
                handleStreamMessage(data)
              } catch (e) {
                console.error("Error parsing SSE data:", e)
              }
            }
          }
        }

        if (partialData.startsWith("data: ")) {
          try {
            const data = JSON.parse(partialData.slice(6))
            handleStreamMessage(data)
          } catch (e) {
            console.error("Error parsing SSE data:", e)
          }
        }
      }
    } catch (error: any) {
      addMessage("error", `Error: ${error.message}`)
      setActiveTab("logs") // Show logs on error
    } finally {
      setIsRunning(false)
    }
  }

  const resumeProcessing = async () => {
    setIsRunning(true)
    setCanResume(false)
    setIsPaused(false)
    setActiveTab("logs")

    try {
      // Check if we have chunked processing state to resume
      const chunkedResumeResponse = await fetch("/api/resume-chunked")
      if (chunkedResumeResponse.ok) {
        const chunkedData = await chunkedResumeResponse.json()
        if (chunkedData.success && chunkedData.canResume) {
          // Resume chunked processing
          const response = await fetch("/api/resume-chunked", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          })

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          // Handle streaming response
          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error("No response body")
          }

          const textDecoder = new TextDecoder()
          let partialData = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            partialData += textDecoder.decode(value)

            let completeLines
            if (partialData.includes("\n")) {
              completeLines = partialData.split("\n")
              partialData = completeLines.pop() || ""
            } else {
              completeLines = []
            }

            for (const line of completeLines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6))
                  handleStreamMessage(data)
                } catch (e) {
                  console.error("Error parsing SSE data:", e)
                }
              }
            }
          }

          if (partialData.startsWith("data: ")) {
            try {
              const data = JSON.parse(partialData.slice(6))
              handleStreamMessage(data)
            } catch (e) {
              console.error("Error parsing SSE data:", e)
            }
          }

          return
        }
      }

      // Fallback to regular resume
      const requestBody = {
        rootDir,
        outputFile,
        outputFolder,
        numWorkers,
        verbose,
        filterConfig: filterEnabled ? { ...filterConfig, enabled: true } : null,
        chunkSize,
        pauseBetweenChunks,
        pauseDuration,
        resumeFromState: true,
      }

      const response = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      if (data.success) {
        addMessage("system", "Processing resumed successfully")
      } else {
        throw new Error(data.error || "Failed to resume processing")
      }
    } catch (error: any) {
      addMessage("error", `Resume error: ${error.message}`)
      setActiveTab("logs")
    } finally {
      setIsRunning(false)
    }
  }

  const pauseProcessing = async () => {
    try {
      const response = await fetch("/api/parse/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pause",
          jobId,
          sessionId: jobId,
          currentChunk,
          processedFiles: stats.processedFiles,
        }),
      })

      if (response.ok) {
        const result = await response.json()
        addMessage("system", "Pause request sent - processing will stop gracefully and save state")
        console.log("[UI] Pause response:", result)
      } else {
        throw new Error("Failed to send pause request")
      }
    } catch (error) {
      addMessage("error", "Failed to pause processing")
      console.error("Pause error:", error)
    }
  }

  const stopProcessing = async () => {
    try {
      const response = await fetch("/api/parse/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          jobId,
          sessionId: jobId,
          currentChunk,
          processedFiles: stats.processedFiles,
        }),
      })

      if (response.ok) {
        const result = await response.json()
        addMessage("system", "Stop request sent - processing will terminate and save state for resume")
        console.log("[UI] Stop response:", result)
      } else {
        throw new Error("Failed to send stop request")
      }
    } catch (error) {
      addMessage("error", "Failed to stop processing")
      console.error("Stop error:", error)
    }
  }

  const stopWatching = async () => {
    try {
      const response = await fetch("/api/watch/stop", {
        method: "POST",
      })
      const result = await response.json()
      addMessage("system", `🛑 Watcher stopped`)
      setWatchMode(false)
      setWatcherStatus(null)
    } catch (error: any) {
      addMessage("error", `❌ Error stopping watcher: ${error.message}`)
    }
  }

  // Watcher functions
  const startWatching = async () => {
    if (!watchDirectory.trim()) {
      alert("Please enter a directory to watch")
      return
    }

    try {
      setWatchMode(true)
      const response = await fetch("/api/watch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir: watchDirectory,
          filterConfig: useFiltersForWatch
            ? {
                ...filterConfig,
                enabled: filterEnabled,
              }
            : { enabled: false },
          outputFile: watchOutputFile,
          outputFolder: watchOutputFolder, // Add this line
          numWorkers: 1,
          verbose: true,
        }),
      })

      const result = await response.json()
      if (result.success) {
        addMessage("system", `✅ Watcher started successfully`)
        addMessage("system", `👀 Monitoring: ${watchDirectory}`)
        addMessage("system", `📄 Output: ${watchOutputFile}`)
        addMessage("system", `🔗 Looking for XML-Image pairs...`)
        // Poll for status updates
        const statusInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch("/api/watch/status")
            const status = await statusResponse.json()
            setWatcherStatus(status)
            if (!status.isWatching) {
              clearInterval(statusInterval)
              setWatchMode(false)
            }
          } catch (err) {
            console.error("Status check failed:", err)
          }
        }, 2000)
      } else {
        addMessage("error", `❌ Failed to start watcher: ${result.error}`)
        setWatchMode(false)
      }
    } catch (error: any) {
      addMessage("error", `❌ Error starting watcher: ${error.message}`)
      setWatchMode(false)
    }
  }

  const deleteSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/history/${sessionId}`, { method: "DELETE" })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        await loadHistory()
        addMessage("system", "Session deleted successfully")
      } else {
        addMessage("error", `Failed to delete session: ${data.error}`)
      }
    } catch (error) {
      console.error("Failed to delete session:", error)
      addMessage("error", `Failed to delete session: ${error.message}`)
    }
  }

  const clearHistory = async () => {
    try {
      const response = await fetch("/api/history", { method: "DELETE" })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        await loadHistory()
        addMessage("system", "History cleared successfully")
      } else {
        addMessage("error", `Failed to clear history: ${data.error}`)
      }
    } catch (error) {
      console.error("Failed to clear history:", error)
      addMessage("error", `Failed to clear history: ${error.message}`)
    }
  }

  const resumeFromSession = async (sessionId: string) => {
    try {
      const response = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        // Load session config
        const session = data.session || history.find((s) => s.id === sessionId)
        if (session) {
          setRootDir(session.config.rootDir)
          setOutputFile(session.config.outputFile)
          setNumWorkers(session.config.numWorkers)
          setProcessingMode(session.config.processingMode as any)
          if (session.config.filterConfig) {
            setFilterConfig(session.config.filterConfig)
            setFilterEnabled(true)
          }
          addMessage("system", `Prepared to resume session: ${sessionId}`)
        }
      } else {
        addMessage("error", `Failed to prepare resume: ${data.error}`)
      }
    } catch (error) {
      console.error("Failed to prepare resume:", error)
      addMessage("error", `Failed to prepare resume: ${error.message}`)
    }
  }

  const formatDuration = (start: string, end?: string) => {
    const startTime = new Date(start)
    const endTime = end ? new Date(end) : new Date()
    const duration = endTime.getTime() - startTime.getTime()
    const minutes = Math.floor(duration / 60000)
    const seconds = Math.floor((duration % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-600"
      case "running":
        return "text-blue-600"
      case "paused":
        return "text-yellow-600"
      case "failed":
        return "text-red-600"
      case "interrupted":
        return "text-orange-600"
      default:
        return "text-gray-600"
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <Toaster />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Sakal XML Parser</h1>
        <div className="flex items-center space-x-2">
          <Badge variant={isRunning ? "default" : "secondary"}>{isRunning ? "Processing" : "Ready"}</Badge>
          {isPaused && <Badge variant="outline">Paused</Badge>}
          {canResume && (
            <Badge variant="outline" className="text-orange-600">
              Can Resume
            </Badge>
          )}
          {watchMode && <Badge variant="outline">Watching</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Configuration Panel */}
        <div className="lg:col-span-3">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="filters">Filters</TabsTrigger>
              <TabsTrigger value="chunked">Chunked</TabsTrigger>
              <TabsTrigger value="watch">Watch</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="logs" className={isRunning ? "bg-blue-100 text-blue-700" : ""}>
                Logs {isRunning && <span className="ml-1 animate-pulse">●</span>}
              </TabsTrigger>
              <TabsTrigger value="results" className={processingResults ? "bg-green-100 text-green-700" : ""}>
                Results {processingResults && <span className="ml-1">✓</span>}
              </TabsTrigger>
            </TabsList>

            {/* Basic Configuration */}
            <TabsContent value="basic" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Basic Configuration</CardTitle>
                  <CardDescription>Configure the basic parsing settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rootDir">Root Directory</Label>
                      <Input
                        id="rootDir"
                        value={rootDir}
                        onChange={(e) => setRootDir(e.target.value)}
                        placeholder="/path/to/xml/files"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="outputFile">Output File</Label>
                      <Input
                        id="outputFile"
                        value={outputFile}
                        onChange={(e) => setOutputFile(e.target.value)}
                        placeholder="output.csv"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="outputFolder">Output Folder (optional)</Label>
                      <Input
                        id="outputFolder"
                        value={outputFolder}
                        onChange={(e) => setOutputFolder(e.target.value)}
                        placeholder="/path/to/save/csv/files (leave empty for current directory)"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="numWorkers">Workers: {numWorkers}</Label>
                      <Slider
                        id="numWorkers"
                        min={1}
                        max={16}
                        step={1}
                        value={[numWorkers]}
                        onValueChange={(value) => setNumWorkers(value[0])}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="processingMode">Processing Mode</Label>
                      <Select
                        value={processingMode}
                        onValueChange={(value) => setProcessingMode(value as "regular" | "stream" | "chunked")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="regular">Regular</SelectItem>
                          <SelectItem value="stream">Stream</SelectItem>
                          <SelectItem value="chunked">Chunked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch id="verbose" checked={verbose} onCheckedChange={setVerbose} />
                    <Label htmlFor="verbose">Verbose logging</Label>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Filters Configuration */}
            <TabsContent value="filters" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>File Filters</CardTitle>
                  <CardDescription>Configure which files to process</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Switch id="filterEnabled" checked={filterEnabled} onCheckedChange={setFilterEnabled} />
                    <Label htmlFor="filterEnabled">Enable filtering</Label>
                    {filterEnabled && (
                      <Badge variant="outline" className="ml-2">
                        Filters Active
                      </Badge>
                    )}
                  </div>

                  {filterEnabled && (
                    <>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>File Types</Label>
                          <div className="space-x-2">
                            <Button size="sm" variant="outline" onClick={selectAllCommonTypes}>
                              Select All Common
                            </Button>
                            <Button size="sm" variant="outline" onClick={clearAllTypes}>
                              Clear All
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                          {["jpg", "jpeg", "png", "tiff", "bmp", "gif", "webp", "raw", "cr2", "nef"].map((type) => (
                            <div key={type} className="flex items-center space-x-2">
                              <Checkbox
                                id={type}
                                checked={filterConfig.fileTypes.includes(type)}
                                onCheckedChange={(checked) => handleFileTypeChange(type, checked as boolean)}
                              />
                              <Label htmlFor={type} className="text-sm">
                                {type.toUpperCase()}
                              </Label>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="customExtensions">Custom Extensions</Label>
                          <Input
                            id="customExtensions"
                            value={filterConfig.customExtensions}
                            onChange={(e) => setFilterConfig((prev) => ({ ...prev, customExtensions: e.target.value }))}
                            placeholder="heic,dng,arw (comma-separated)"
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label>Image Dimensions</Label>

                        {/* Dimension Presets */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Quick Presets</Label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {[
                              { label: "200×200", width: 200, height: 200 },
                              { label: "500×500", width: 500, height: 500 },
                              { label: "1024×1024", width: 1024, height: 1024 },
                              { label: "1280×1280", width: 1280, height: 1280 },
                              { label: "1920×1080", width: 1920, height: 1080 },
                              { label: "2048×2048", width: 2048, height: 2048 },
                              { label: "4K (3840×2160)", width: 3840, height: 2160 },
                              { label: "Clear", width: null, height: null },
                            ].map((preset) => (
                              <Button
                                key={preset.label}
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setFilterConfig((prev) => ({
                                    ...prev,
                                    minWidth: preset.width,
                                    minHeight: preset.height,
                                  }))
                                }}
                                className="text-xs"
                              >
                                {preset.label}
                              </Button>
                            ))}
                          </div>
                        </div>

                        {/* Manual Input */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="minWidth">Min Width (px)</Label>
                            <Input
                              id="minWidth"
                              type="number"
                              value={filterConfig.minWidth || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  minWidth: e.target.value ? Number.parseInt(e.target.value) : undefined,
                                }))
                              }
                              placeholder="e.g. 1024"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="minHeight">Min Height (px)</Label>
                            <Input
                              id="minHeight"
                              type="number"
                              value={filterConfig.minHeight || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  minHeight: e.target.value ? Number.parseInt(e.target.value) : undefined,
                                }))
                              }
                              placeholder="e.g. 1024"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="maxWidth">Max Width (px)</Label>
                            <Input
                              id="maxWidth"
                              type="number"
                              value={filterConfig.maxWidth || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  maxWidth: e.target.value ? Number.parseInt(e.target.value) : undefined,
                                }))
                              }
                              placeholder="e.g. 4096"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="maxHeight">Max Height (px)</Label>
                            <Input
                              id="maxHeight"
                              type="number"
                              value={filterConfig.maxHeight || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  maxHeight: e.target.value ? Number.parseInt(e.target.value) : undefined,
                                }))
                              }
                              placeholder="e.g. 4096"
                            />
                          </div>
                        </div>

                        {/* Current Selection Display */}
                        {(filterConfig.minWidth || filterConfig.minHeight) && (
                          <div className="p-3 bg-muted rounded-lg">
                            <div className="text-sm font-medium">Current Filter:</div>
                            <div className="text-sm text-muted-foreground">
                              Min: {filterConfig.minWidth || 0} × {filterConfig.minHeight || 0} pixels
                              {(filterConfig.maxWidth || filterConfig.maxHeight) && (
                                <span>
                                  {" "}
                                  | Max: {filterConfig.maxWidth || "∞"} × {filterConfig.maxHeight || "∞"} pixels
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <Label className="text-base font-semibold">Metadata Filters</Label>

                        {/* Credit Line Filter */}
                        <div className="space-y-2">
                          <Label htmlFor="creditLineOperator">Credit Line</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              value={filterConfig.creditLine?.operator || ""}
                              onValueChange={(value) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  creditLine: {
                                    ...prev.creditLine,
                                    operator: value,
                                    value: prev.creditLine?.value || "",
                                  },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select operator" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="like">Contains</SelectItem>
                                <SelectItem value="notLike">Does not contain</SelectItem>
                                <SelectItem value="equals">Equals</SelectItem>
                                <SelectItem value="notEquals">Not equals</SelectItem>
                                <SelectItem value="startsWith">Starts with</SelectItem>
                                <SelectItem value="endsWith">Ends with</SelectItem>
                                <SelectItem value="notBlank">Not blank</SelectItem>
                                <SelectItem value="isBlank">Is blank</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              value={filterConfig.creditLine?.value || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  creditLine: {
                                    ...prev.creditLine,
                                    operator: prev.creditLine?.operator || "like",
                                    value: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Filter value"
                              disabled={!filterConfig.creditLine?.operator}
                            />
                          </div>
                        </div>

                        {/* Copyright Filter */}
                        <div className="space-y-2">
                          <Label htmlFor="copyrightOperator">Copyright</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              value={filterConfig.copyright?.operator || ""}
                              onValueChange={(value) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  copyright: {
                                    ...prev.copyright,
                                    operator: value,
                                    value: prev.copyright?.value || "",
                                  },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select operator" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="like">Contains</SelectItem>
                                <SelectItem value="notLike">Does not contain</SelectItem>
                                <SelectItem value="equals">Equals</SelectItem>
                                <SelectItem value="notEquals">Not equals</SelectItem>
                                <SelectItem value="startsWith">Starts with</SelectItem>
                                <SelectItem value="endsWith">Ends with</SelectItem>
                                <SelectItem value="notBlank">Not blank</SelectItem>
                                <SelectItem value="isBlank">Is blank</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              value={filterConfig.copyright?.value || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  copyright: {
                                    ...prev.copyright,
                                    operator: prev.copyright?.operator || "like",
                                    value: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Filter value"
                              disabled={!filterConfig.copyright?.operator}
                            />
                          </div>
                        </div>

                        {/* Usage Type Filter */}
                        <div className="space-y-2">
                          <Label htmlFor="usageTypeOperator">Usage Type</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              value={filterConfig.usageType?.operator || ""}
                              onValueChange={(value) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  usageType: { ...prev.usageType, operator: value, value: prev.usageType?.value || "" },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select operator" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="like">Contains</SelectItem>
                                <SelectItem value="notLike">Does not contain</SelectItem>
                                <SelectItem value="equals">Equals</SelectItem>
                                <SelectItem value="notEquals">Not equals</SelectItem>
                                <SelectItem value="startsWith">Starts with</SelectItem>
                                <SelectItem value="endsWith">Ends with</SelectItem>
                                <SelectItem value="notBlank">Not blank</SelectItem>
                                <SelectItem value="isBlank">Is blank</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              value={filterConfig.usageType?.value || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  usageType: {
                                    ...prev.usageType,
                                    operator: prev.usageType?.operator || "like",
                                    value: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Filter value"
                              disabled={!filterConfig.usageType?.operator}
                            />
                          </div>
                        </div>

                        {/* Rights Holder Filter */}
                        <div className="space-y-2">
                          <Label htmlFor="rightsHolderOperator">Rights Holder</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              value={filterConfig.rightsHolder?.operator || ""}
                              onValueChange={(value) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  rightsHolder: {
                                    ...prev.rightsHolder,
                                    operator: value,
                                    value: prev.rightsHolder?.value || "",
                                  },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select operator" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="like">Contains</SelectItem>
                                <SelectItem value="notLike">Does not contain</SelectItem>
                                <SelectItem value="equals">Equals</SelectItem>
                                <SelectItem value="notEquals">Not equals</SelectItem>
                                <SelectItem value="startsWith">Starts with</SelectItem>
                                <SelectItem value="endsWith">Ends with</SelectItem>
                                <SelectItem value="notBlank">Not blank</SelectItem>
                                <SelectItem value="isBlank">Is blank</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              value={filterConfig.rightsHolder?.value || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  rightsHolder: {
                                    ...prev.rightsHolder,
                                    operator: prev.rightsHolder?.operator || "like",
                                    value: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Filter value"
                              disabled={!filterConfig.rightsHolder?.operator}
                            />
                          </div>
                        </div>

                        {/* Location Filter */}
                        <div className="space-y-2">
                          <Label htmlFor="locationOperator">Location</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              value={filterConfig.location?.operator || ""}
                              onValueChange={(value) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  location: { ...prev.location, operator: value, value: prev.location?.value || "" },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select operator" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="like">Contains</SelectItem>
                                <SelectItem value="notLike">Does not contain</SelectItem>
                                <SelectItem value="equals">Equals</SelectItem>
                                <SelectItem value="notEquals">Not equals</SelectItem>
                                <SelectItem value="startsWith">Starts with</SelectItem>
                                <SelectItem value="endsWith">Ends with</SelectItem>
                                <SelectItem value="notBlank">Not blank</SelectItem>
                                <SelectItem value="isBlank">Is blank</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              value={filterConfig.location?.value || ""}
                              onChange={(e) =>
                                setFilterConfig((prev) => ({
                                  ...prev,
                                  location: {
                                    ...prev.location,
                                    operator: prev.location?.operator || "like",
                                    value: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Filter value"
                              disabled={!filterConfig.location?.operator}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <Label className="text-base font-semibold">File Size Filters</Label>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="minFileSize">Min File Size</Label>
                            <div className="flex space-x-2">
                              <Input
                                id="minFileSize"
                                type="number"
                                step="0.1"
                                value={filterConfig.minFileSizeValue || ""}
                                onChange={(e) => {
                                  const value = e.target.value ? Number.parseFloat(e.target.value) : undefined
                                  const unit = filterConfig.minFileSizeUnit || "MB"
                                  setFilterConfig((prev) => ({
                                    ...prev,
                                    minFileSizeValue: value,
                                    minFileSize: value
                                      ? unit === "MB"
                                        ? value * 1024 * 1024
                                        : value * 1024
                                      : undefined,
                                  }))
                                }}
                                placeholder="0.0"
                              />
                              <Select
                                value={filterConfig.minFileSizeUnit || "MB"}
                                onValueChange={(unit) => {
                                  const value = filterConfig.minFileSizeValue
                                  setFilterConfig((prev) => ({
                                    ...prev,
                                    minFileSizeUnit: unit,
                                    minFileSize: value
                                      ? unit === "MB"
                                        ? value * 1024 * 1024
                                        : value * 1024
                                      : undefined,
                                  }))
                                }}
                              >
                                <SelectTrigger className="w-20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="KB">KB</SelectItem>
                                  <SelectItem value="MB">MB</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="maxFileSize">Max File Size</Label>
                            <div className="flex space-x-2">
                              <Input
                                id="maxFileSize"
                                type="number"
                                step="0.1"
                                value={filterConfig.maxFileSizeValue || ""}
                                onChange={(e) => {
                                  const value = e.target.value ? Number.parseFloat(e.target.value) : undefined
                                  const unit = filterConfig.maxFileSizeUnit || "MB"
                                  setFilterConfig((prev) => ({
                                    ...prev,
                                    maxFileSizeValue: value,
                                    maxFileSize: value
                                      ? unit === "MB"
                                        ? value * 1024 * 1024
                                        : value * 1024
                                      : undefined,
                                  }))
                                }}
                                placeholder="100.0"
                              />
                              <Select
                                value={filterConfig.maxFileSizeUnit || "MB"}
                                onValueChange={(unit) => {
                                  const value = filterConfig.maxFileSizeValue
                                  setFilterConfig((prev) => ({
                                    ...prev,
                                    maxFileSizeUnit: unit,
                                    maxFileSize: value
                                      ? unit === "MB"
                                        ? value * 1024 * 1024
                                        : value * 1024
                                      : undefined,
                                  }))
                                }}
                              >
                                <SelectTrigger className="w-20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="KB">KB</SelectItem>
                                  <SelectItem value="MB">MB</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <Label className="text-base font-semibold">Image Moving</Label>

                        <div className="flex items-center space-x-2">
                          <Switch
                            id="moveImages"
                            checked={filterConfig.moveImages}
                            onCheckedChange={(checked) =>
                              setFilterConfig((prev) => ({
                                ...prev,
                                moveImages: checked,
                              }))
                            }
                          />
                          <Label htmlFor="moveImages">Move filtered images to destination</Label>
                          {filterConfig.moveImages && (
                            <Badge variant="outline" className="ml-2">
                              Move Enabled
                            </Badge>
                          )}
                        </div>

                        {filterConfig.moveImages && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="moveDestinationPath">Destination Path</Label>
                              <Input
                                id="moveDestinationPath"
                                value={filterConfig.moveDestinationPath || ""}
                                onChange={(e) =>
                                  setFilterConfig((prev) => ({
                                    ...prev,
                                    moveDestinationPath: e.target.value,
                                  }))
                                }
                                placeholder="/path/to/filtered/images"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="moveFolderStructure">Folder Structure</Label>
                              <Select
                                value={filterConfig.moveFolderStructureOption || "replicate"}
                                onValueChange={(value) =>
                                  setFilterConfig((prev) => ({
                                    ...prev,
                                    moveFolderStructureOption: value as "replicate" | "flat",
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="replicate">Replicate source structure</SelectItem>
                                  <SelectItem value="flat">Single folder (flat)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Chunked Processing */}
            <TabsContent value="chunked" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Chunked Processing</CardTitle>
                  <CardDescription>Process large directories in manageable chunks</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {processingMode === "chunked" ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="chunkSize">Chunk Size: {chunkSize} files</Label>
                        <Slider
                          id="chunkSize"
                          min={10}
                          max={500}
                          step={10}
                          value={[chunkSize]}
                          onValueChange={(value) => setChunkSize(value[0])}
                        />
                        <p className="text-sm text-muted-foreground">
                          Smaller chunks use less memory but may be slower overall
                        </p>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="pauseBetweenChunks"
                          checked={pauseBetweenChunks}
                          onCheckedChange={setPauseBetweenChunks}
                        />
                        <Label htmlFor="pauseBetweenChunks">Pause between chunks</Label>
                      </div>

                      {pauseBetweenChunks && (
                        <div className="space-y-2">
                          <Label htmlFor="pauseDuration">Pause Duration: {pauseDuration}s</Label>
                          <Slider
                            id="pauseDuration"
                            min={1}
                            max={60}
                            step={1}
                            value={[pauseDuration]}
                            onValueChange={(value) => setPauseDuration(value[0])}
                          />
                        </div>
                      )}

                      {totalChunks > 0 && (
                        <div className="space-y-2">
                          <Label>Chunk Progress</Label>
                          <div className="flex items-center justify-between text-sm">
                            <span>
                              Chunk {currentChunk} of {totalChunks}
                            </span>
                            <span>{Math.round((currentChunk / totalChunks) * 100)}%</span>
                          </div>
                          <Progress value={(currentChunk / totalChunks) * 100} />
                        </div>
                      )}
                    </>
                  ) : (
                    <Alert>
                      <AlertDescription>
                        Chunked processing is only available when "Chunked" mode is selected in Basic Configuration.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Watch Mode */}
            <TabsContent value="watch" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>File Watcher</CardTitle>
                  <CardDescription>
                    Monitor directories for new XML-Image pairs and process them automatically
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="watchDirectory">Directory to Watch</Label>
                      <Input
                        id="watchDirectory"
                        value={watchDirectory}
                        onChange={(e) => setWatchDirectory(e.target.value)}
                        placeholder="/Users/amangupta/Desktop/test-images"
                      />
                      <p className="text-xs text-gray-500">
                        💡 <strong>Tip:</strong> Create directory first:{" "}
                        <code>mkdir -p /Users/amangupta/Desktop/test-images</code>
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="watchOutputFile">Output CSV File</Label>
                      <Input
                        id="watchOutputFile"
                        value={watchOutputFile}
                        onChange={(e) => setWatchOutputFile(e.target.value)}
                        placeholder="watched_images.csv"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="watchOutputFolder">Output Folder (optional)</Label>
                      <Input
                        id="watchOutputFolder"
                        value={watchOutputFolder}
                        onChange={(e) => setWatchOutputFolder(e.target.value)}
                        placeholder="/path/to/save/csv/files (leave empty for current directory)"
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="useFiltersForWatch"
                      checked={useFiltersForWatch}
                      onCheckedChange={setUseFiltersForWatch}
                    />
                    <Label htmlFor="useFiltersForWatch">Apply current filters to watched files</Label>
                  </div>

                  <div className="flex space-x-2">
                    <Button onClick={startWatching} disabled={watchMode || !watchDirectory.trim()} className="flex-1">
                      {watchMode ? "Watching..." : "Start Watching"}
                    </Button>
                    <Button
                      onClick={stopWatching}
                      disabled={!watchMode}
                      variant="outline"
                      className="flex-1 bg-transparent"
                    >
                      Stop Watching
                    </Button>
                  </div>

                  {watcherStatus && (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <h4 className="font-medium mb-2">Watcher Status</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Status:</span>
                          <div className={`font-medium ${watchMode ? "text-green-600" : "text-gray-600"}`}>
                            {watchMode ? "🟢 Active" : "🔴 Stopped"}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">XML Files:</span>
                          <div className="font-medium">{watcherStatus.stats?.xmlFilesDetected || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Image Files:</span>
                          <div className="font-medium">{watcherStatus.stats?.imageFilesDetected || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Pairs Processed:</span>
                          <div className="font-medium text-green-600">{watcherStatus.stats?.pairsProcessed || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Pending Pairs:</span>
                          <div className="font-medium text-yellow-600">{watcherStatus.pendingPairs || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Complete Pairs:</span>
                          <div className="font-medium text-blue-600">{watcherStatus.completePairs || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Files Moved:</span>
                          <div className="font-medium text-purple-600">{watcherStatus.stats?.filesMoved || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Errors:</span>
                          <div className="font-medium text-red-600">{watcherStatus.stats?.filesErrored || 0}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <Alert>
                    <AlertDescription>
                      <strong>How it works:</strong> The watcher monitors the specified directory for new XML and image
                      files. When both files with matching base names are detected (e.g., "image.xml" and "image.jpg"),
                      they are automatically processed as a pair and results are appended to the CSV file. If filters
                      are enabled, only pairs that pass the filters will be processed and moved.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </TabsContent>

            {/* History */}
            <TabsContent value="history" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Processing History</CardTitle>
                  <CardDescription>View and manage previous processing sessions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex space-x-2">
                      <Button onClick={loadHistory} variant="outline" size="sm">
                        Refresh
                      </Button>
                      <Button onClick={clearHistory} variant="destructive" size="sm">
                        Clear All
                      </Button>
                    </div>
                    {canResume && (
                      <Badge variant="outline" className="text-orange-600">
                        Resume Available
                      </Badge>
                    )}
                  </div>

                  <ScrollArea className="h-96">
                    <div className="space-y-3">
                      {!Array.isArray(history) || history.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">No processing history found</div>
                      ) : (
                        history.map((session) => (
                          <Card key={session.id} className="p-4">
                            <div className="flex justify-between items-start">
                              <div className="space-y-2 flex-1">
                                <div className="flex items-center space-x-2">
                                  <Badge variant="outline" className={getStatusColor(session.status)}>
                                    {session.status.toUpperCase()}
                                  </Badge>
                                  <span className="text-sm text-muted-foreground">
                                    {new Date(session.startTime).toLocaleString()}
                                  </span>
                                </div>

                                <div className="text-sm">
                                  <div>
                                    <strong>Directory:</strong> {session.config.rootDir}
                                  </div>
                                  <div>
                                    <strong>Output:</strong> {session.config.outputFile}
                                  </div>
                                  <div>
                                    <strong>Mode:</strong> {session.config.processingMode}
                                  </div>
                                  <div>
                                    <strong>Duration:</strong> {formatDuration(session.startTime, session.endTime)}
                                  </div>
                                </div>

                                <div className="grid grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <div className="font-medium">Progress</div>
                                    <div>
                                      {session.progress.processedFiles}/{session.progress.totalFiles}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="font-medium">Success</div>
                                    <div className="text-green-600">{session.progress.successCount}</div>
                                  </div>
                                  <div>
                                    <div className="font-medium">Errors</div>
                                    <div className="text-red-600">{session.progress.errorCount}</div>
                                  </div>
                                </div>

                                {session.progress.totalFiles > 0 && (
                                  <Progress
                                    value={(session.progress.processedFiles / session.progress.totalFiles) * 100}
                                    className="h-2"
                                  />
                                )}
                              </div>

                              <div className="flex flex-col space-y-2 ml-4">
                                {(session.status === "interrupted" || session.status === "paused") && (
                                  <Button size="sm" onClick={() => resumeFromSession(session.id)} className="text-xs">
                                    Resume
                                  </Button>
                                )}
                                {session.results?.outputPath && (
                                  <Button size="sm" variant="outline" asChild className="text-xs bg-transparent">
                                    <a href={`/api/download?file=${encodeURIComponent(session.results.outputPath)}`}>
                                      Download
                                    </a>
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => deleteSession(session.id)}
                                  className="text-xs"
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </Card>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Logs */}
            <TabsContent value="logs" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Processing Logs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <div className="space-y-1">
                        {messages.map((message, index) => (
                          <div key={index} className="text-sm">
                            <span className="text-muted-foreground">{message.timestamp}</span>
                            <span className="ml-2 font-medium">[{message.type.toUpperCase()}]</span>
                            <span className="ml-2">{formatLogMessage(message.message)}</span>
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Error Logs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <div className="space-y-1">
                        {errorMessages.map((message, index) => (
                          <div key={index} className="text-sm text-red-600">
                            <span className="text-muted-foreground">{message.timestamp}</span>
                            <span className="ml-2 font-medium">[ERROR]</span>
                            <span className="ml-2">{formatLogMessage(message.message)}</span>
                          </div>
                        ))}
                        <div ref={errorLogsEndRef} />
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Results */}
            <TabsContent value="results" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Processing Results</CardTitle>
                  <CardDescription>View progress and download results</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {processingResults ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Overall Progress</Label>
                          <span className="text-sm font-medium">{progress}%</span>
                        </div>
                        <Progress value={progress} />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{processingResults.stats.totalFiles}</div>
                          <div className="text-sm text-muted-foreground">Total Files</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{processingResults.stats.processedFiles}</div>
                          <div className="text-sm text-muted-foreground">Processed</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">
                            {processingResults.stats.successfulFiles}
                          </div>
                          <div className="text-sm text-muted-foreground">Success</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-red-600">{processingResults.stats.errorFiles}</div>
                          <div className="text-sm text-muted-foreground">Errors</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{processingResults.stats.recordsWritten}</div>
                          <div className="text-sm text-muted-foreground">Records Written</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{processingResults.stats.filteredFiles}</div>
                          <div className="text-sm text-muted-foreground">Filtered</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{processingResults.stats.movedFiles}</div>
                          <div className="text-sm text-muted-foreground">Moved</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{processingResults.processingTime}</div>
                          <div className="text-sm text-muted-foreground">Duration</div>
                        </div>
                      </div>

                      {processingResults.errors && processingResults.errors.length > 0 && (
                        <div className="space-y-2">
                          <Label>Recent Errors</Label>
                          <ScrollArea className="h-32 border rounded p-2">
                            {processingResults.errors.map((error, index) => (
                              <div key={index} className="text-sm text-red-600 mb-1">
                                {error}
                              </div>
                            ))}
                          </ScrollArea>
                        </div>
                      )}

                      {downloadURL && (
                        <div className="space-y-2">
                          <Label>Download Results</Label>
                          <Button asChild className="w-full">
                            <a href={downloadURL} download>
                              Download CSV File
                            </a>
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <Alert>
                      <AlertDescription>
                        No results available yet. Start processing to see results here.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Quick Stats Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm">Status:</span>
                <Badge variant={isRunning ? "default" : "secondary"}>{isRunning ? "Running" : "Idle"}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Mode:</span>
                <span className="text-sm font-medium">{processingMode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Workers:</span>
                <span className="text-sm font-medium">{numWorkers}</span>
              </div>
              {filterEnabled && (
                <div className="flex justify-between">
                  <span className="text-sm">Filters:</span>
                  <Badge variant="outline">Enabled</Badge>
                </div>
              )}
              {processingMode === "chunked" && (
                <div className="flex justify-between">
                  <span className="text-sm">Chunk Size:</span>
                  <span className="text-sm font-medium">{chunkSize}</span>
                </div>
              )}
              {canResume && (
                <div className="flex justify-between">
                  <span className="text-sm">Resume:</span>
                  <Badge variant="outline" className="text-orange-600">
                    Available
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!isRunning && !canResume && (
                <Button onClick={startProcessing} disabled={!rootDir} className="w-full">
                  Start Processing
                </Button>
              )}

              {canResume && !isRunning && (
                <>
                  <Button onClick={resumeProcessing} className="w-full">
                    Resume Processing
                  </Button>
                  <Button
                    onClick={startProcessing}
                    disabled={!rootDir}
                    variant="outline"
                    className="w-full bg-transparent"
                  >
                    Start New Processing
                  </Button>
                </>
              )}

              {isRunning && (
                <>
                  <Button onClick={pauseProcessing} variant="outline" className="w-full bg-transparent">
                    Pause & Save State
                  </Button>
                  <Button onClick={stopProcessing} variant="destructive" className="w-full">
                    Stop & Save State
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {filterEnabled && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Filter Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm">
                  <span className="font-medium">File Types:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {filterConfig.fileTypes?.map((type) => (
                      <Badge key={type} variant="secondary" className="text-xs">
                        {type}
                      </Badge>
                    ))}
                  </div>
                </div>
                {(filterConfig.minWidth || filterConfig.maxWidth) && (
                  <div className="text-sm">
                    <span className="font-medium">Dimensions:</span>
                    <span className="ml-1">
                      {filterConfig.minWidth || 0} - {filterConfig.maxWidth || "∞"}px
                    </span>
                  </div>
                )}
                {(filterConfig.minFileSize || filterConfig.maxFileSize) && (
                  <div className="text-sm">
                    <span className="font-medium">File Size:</span>
                    <span className="ml-1">
                      {filterConfig.minFileSizeValue
                        ? `${filterConfig.minFileSizeValue}${filterConfig.minFileSizeUnit}`
                        : "0"}{" "}
                      -{" "}
                      {filterConfig.maxFileSizeValue
                        ? `${filterConfig.maxFileSizeValue}${filterConfig.maxFileSizeUnit}`
                        : "∞"}
                    </span>
                  </div>
                )}
                {filterConfig.moveImages && (
                  <div className="text-sm">
                    <span className="font-medium">Move Images:</span>
                    <Badge variant="outline" className="ml-1">
                      Enabled
                    </Badge>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {[
                    filterConfig.creditLine?.operator && "Credit Line",
                    filterConfig.copyright?.operator && "Copyright",
                    filterConfig.usageType?.operator && "Usage Type",
                    filterConfig.rightsHolder?.operator && "Rights Holder",
                    filterConfig.location?.operator && "Location",
                  ]
                    .filter(Boolean)
                    .join(", ") || "No metadata filters"}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Resume Dialog */}
      {showResumeDialog && resumeSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-96">
            <CardHeader>
              <CardTitle>Resume Processing?</CardTitle>
              <CardDescription>
                An interrupted processing session was found. Would you like to resume from where you left off?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-2">
                <div>
                  <strong>Directory:</strong> {resumeSession.config.rootDir}
                </div>
                <div>
                  <strong>Progress:</strong> {resumeSession.progress.processedFiles}/{resumeSession.progress.totalFiles}{" "}
                  files
                </div>
                <div>
                  <strong>Started:</strong> {new Date(resumeSession.startTime).toLocaleString()}
                </div>
              </div>
              <Progress value={(resumeSession.progress.processedFiles / resumeSession.progress.totalFiles) * 100} />
            </CardContent>
            <CardContent className="flex space-x-2">
              <Button
                onClick={() => {
                  resumeFromSession(resumeSession.id)
                  setShowResumeDialog(false)
                }}
                className="flex-1"
              >
                Resume
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await fetch("/api/resume", { method: "DELETE" })
                  setShowResumeDialog(false)
                  setCanResume(false)
                }}
                className="flex-1"
              >
                Start Fresh
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
