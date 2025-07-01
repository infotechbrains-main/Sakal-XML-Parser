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

export default function Home() {
  // Basic configuration
  const [rootDir, setRootDir] = useState("")
  const [outputFile, setOutputFile] = useState("image_metadata.csv")
  const [numWorkers, setNumWorkers] = useState(4)
  const [verbose, setVerbose] = useState(false)
  const [processingMode, setProcessingMode] = useState<"regular" | "stream" | "chunked">("stream")

  // Processing state
  const [messages, setMessages] = useState<Message[]>([])
  const [errorMessages, setErrorMessages] = useState<Message[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
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
  const [organizeByCity, setOrganizeByCity] = useState(false)
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
  const [useFiltersForWatch, setUseFiltersForWatch] = useState(true)
  const [watcherStatus, setWatcherStatus] = useState<any>(null)

  // Results
  const [downloadURL, setDownloadURL] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  // History - Initialize as empty array
  const [history, setHistory] = useState<ProcessingSession[]>([])
  const [canResume, setCanResume] = useState(false)
  const [resumeSession, setResumeSession] = useState<ProcessingSession | null>(null)
  const [showResumeDialog, setShowResumeDialog] = useState(false)

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

      if (data.success && Array.isArray(data.history)) {
        setHistory(data.history)
      } else {
        console.error("Invalid history data:", data)
        setHistory([])
        if (data.error) {
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
        setCanResume(data.canResume)
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

    if (type === "error") {
      setErrorMessages((prev) => [...prev, newMessage])
    } else {
      setMessages((prev) => [...prev, newMessage])
    }
  }

  const handleStreamMessage = (data: any) => {
    switch (data.type) {
      case "log":
        addMessage("log", data.message)
        break
      case "error":
        addMessage("error", data.message)
        break
      case "progress":
        setProgress(data.percentage || 0)
        if (data.stats) {
          setStats(data.stats)
        }
        break
      case "chunk_start":
        setCurrentChunk(data.chunkNumber)
        setTotalChunks(data.totalChunks)
        addMessage("chunk", `Starting chunk ${data.chunkNumber}/${data.totalChunks}`)
        break
      case "chunk_complete":
        addMessage("chunk", `Completed chunk ${data.chunkNumber}/${data.totalChunks}`)
        break
      case "download":
        setDownloadURL(data.url)
        addMessage("success", "Processing complete! Download ready.")
        break
      case "job_created":
        setJobId(data.jobId)
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
    setStats({
      totalFiles: 0,
      processedFiles: 0,
      successCount: 0,
      errorCount: 0,
    })

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
        numWorkers,
        verbose,
        filterConfig: finalFilterConfig,
        chunkSize: processingMode === "chunked" ? chunkSize : undefined,
        pauseBetweenChunks: processingMode === "chunked" ? pauseBetweenChunks : undefined,
        pauseDuration: processingMode === "chunked" ? pauseDuration : undefined,
        organizeByCity: processingMode === "chunked" ? organizeByCity : undefined,
      }

      console.log("Full request body:", requestBody)

      let endpoint = "/api/parse"
      if (processingMode === "stream" || processingMode === "chunked") {
        endpoint = "/api/parse/stream"
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
    } finally {
      setIsRunning(false)
    }
  }

  const pauseProcessing = async () => {
    try {
      await fetch("/api/parse/pause", { method: "POST" })
      setIsPaused(true)
      addMessage("system", "Processing paused")
    } catch (error) {
      addMessage("error", "Failed to pause processing")
    }
  }

  const resumeProcessing = async () => {
    try {
      await fetch("/api/resume", { method: "POST" })
      setIsPaused(false)
      addMessage("system", "Processing resumed")
    } catch (error) {
      addMessage("error", "Failed to resume processing")
    }
  }

  const stopProcessing = async () => {
    try {
      await fetch("/api/parse/pause", { method: "POST" })
      setIsRunning(false)
      setIsPaused(false)
      addMessage("system", "Processing stopped")
    } catch (error) {
      addMessage("error", "Failed to stop processing")
    }
  }

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
          numWorkers: 1,
          verbose: true,
        }),
      })

      const result = await response.json()
      if (result.success) {
        addMessage("system", `✅ Watcher started: ${result.message}`)
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

  const stopWatching = async () => {
    try {
      const response = await fetch("/api/watch/stop", {
        method: "POST",
      })
      const result = await response.json()
      addMessage("system", `🛑 Watcher stopped: ${result.message}`)
      setWatchMode(false)
      setWatcherStatus(null)
    } catch (error: any) {
      addMessage("error", `❌ Error stopping watcher: ${error.message}`)
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
        <h1 className="text-3xl font-bold">XML to CSV Converter</h1>
        <div className="flex items-center space-x-2">
          <Badge variant={isRunning ? "default" : "secondary"}>{isRunning ? "Processing" : "Ready"}</Badge>
          {isPaused && <Badge variant="outline">Paused</Badge>}
          {watchMode && <Badge variant="outline">Watching</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Configuration Panel */}
        <div className="lg:col-span-3">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="filters">Filters</TabsTrigger>
              <TabsTrigger value="chunked">Chunked</TabsTrigger>
              <TabsTrigger value="watch">Watch</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
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
                                <SelectItem value="notBlank">Is blank</SelectItem>
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

                      <div className="flex items-center space-x-2">
                        <Switch id="organizeByCity" checked={organizeByCity} onCheckedChange={setOrganizeByCity} />
                        <Label htmlFor="organizeByCity">Organize results by city</Label>
                      </div>

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
                  <CardDescription>Monitor directories for new files and process them automatically</CardDescription>
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
                          <span className="text-muted-foreground">Processed:</span>
                          <div className="font-medium">{watcherStatus.stats?.filesProcessed || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Successful:</span>
                          <div className="font-medium text-green-600">{watcherStatus.stats?.filesSuccessful || 0}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Moved:</span>
                          <div className="font-medium text-blue-600">{watcherStatus.stats?.filesMoved || 0}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <Alert>
                    <AlertDescription>
                      <strong>How it works:</strong> The watcher monitors the specified directory for new image files.
                      When files are added, they are automatically processed and results are appended to the CSV file.
                      If filters are enabled, only images that pass the filters will be processed and moved.
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
                            <span className="ml-2 font-medium">[{message.type}]</span>
                            <span className="ml-2">{JSON.stringify(message.message)}</span>
                          </div>
                        ))}
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
                            <span className="ml-2">{JSON.stringify(message.message)}</span>
                          </div>
                        ))}
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
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Overall Progress</Label>
                      <span className="text-sm font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} />
                  </div>

                  {stats.totalFiles > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{stats.totalFiles}</div>
                        <div className="text-sm text-muted-foreground">Total Files</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold">{stats.processedFiles}</div>
                        <div className="text-sm text-muted-foreground">Processed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{stats.successCount}</div>
                        <div className="text-sm text-muted-foreground">Success</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{stats.errorCount}</div>
                        <div className="text-sm text-muted-foreground">Errors</div>
                      </div>
                    </div>
                  )}

                  {stats.currentFile && (
                    <div className="space-y-1">
                      <Label>Currently Processing</Label>
                      <p className="text-sm text-muted-foreground truncate">{stats.currentFile}</p>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button onClick={startProcessing} disabled={isRunning || !rootDir} className="w-full">
                {isRunning ? "Processing..." : "Start Processing"}
              </Button>

              {isRunning && (
                <>
                  <Button
                    onClick={isPaused ? resumeProcessing : pauseProcessing}
                    variant="outline"
                    className="w-full bg-transparent"
                  >
                    {isPaused ? "Resume" : "Pause"}
                  </Button>
                  <Button onClick={stopProcessing} variant="destructive" className="w-full">
                    Stop
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
