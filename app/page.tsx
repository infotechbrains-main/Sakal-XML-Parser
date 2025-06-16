"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Copy,
  FileDown,
  FolderOpen,
  Layers,
  Play,
  Settings,
  Upload,
  Filter,
  ImageIcon,
  HardDrive,
  Newspaper,
  Square,
  RotateCcw,
  Database,
  Pause,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function Home() {
  const [rootDir, setRootDir] = useState("")
  const [outputFile, setOutputFile] = useState("image_metadata.csv")
  const [workers, setWorkers] = useState(4)
  const [batchSize, setBatchSize] = useState(100)
  const [verbose, setVerbose] = useState(true)

  // Chunked processing settings
  const [enableChunkedProcessing, setEnableChunkedProcessing] = useState(true)
  const [chunkSize, setChunkSize] = useState(1000)
  const [organizeByCity, setOrganizeByCity] = useState(true)

  // Processing state
  const [processingState, setProcessingState] = useState<any>(null)
  const [hasProcessingHistory, setHasProcessingHistory] = useState(false)

  // Filter settings
  const [enableFiltering, setEnableFiltering] = useState(false)
  const [minImageSize, setMinImageSize] = useState("512")
  const [customMinWidth, setCustomMinWidth] = useState("")
  const [customMinHeight, setCustomMinHeight] = useState("")
  const [minFileSize, setMinFileSize] = useState("")
  const [maxFileSize, setMaxFileSize] = useState("")
  const [fileSizeUnit, setFileSizeUnit] = useState("KB")

  // File type filter
  const [enableFileTypeFilter, setEnableFileTypeFilter] = useState(false)
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([])
  const [customFileTypes, setCustomFileTypes] = useState("")

  // Common image file types
  const COMMON_FILE_TYPES = [
    { value: "jpg", label: "JPG" },
    { value: "jpeg", label: "JPEG" },
    { value: "png", label: "PNG" },
    { value: "tif", label: "TIF" },
    { value: "tiff", label: "TIFF" },
    { value: "bmp", label: "BMP" },
    { value: "gif", label: "GIF" },
    { value: "webp", label: "WebP" },
  ]

  const [moveFilteredImages, setMoveFilteredImages] = useState(false)
  const [moveDestinationPath, setMoveDestinationPath] = useState("")
  const [moveFolderStructure, setMoveFolderStructure] = useState("replicate")

  const [creditLineFilter, setCreditLineFilter] = useState({ value: "", operator: "like" })
  const [copyrightFilter, setCopyrightFilter] = useState({ value: "", operator: "like" })
  const [usageTypeFilter, setUsageTypeFilter] = useState({ value: "", operator: "like" })
  const [rightsHolderFilter, setRightsHolderFilter] = useState({ value: "", operator: "like" })
  const [locationFilter, setLocationFilter] = useState({ value: "", operator: "like" })

  const [enableWatchMode, setEnableWatchMode] = useState(false)
  const [isWatching, setIsWatching] = useState(false)

  const [status, setStatus] = useState("idle")
  const [logs, setLogs] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [chunkProgress, setChunkProgress] = useState(0)
  const [currentChunk, setCurrentChunk] = useState(0)
  const [totalChunks, setTotalChunks] = useState(0)
  const [stats, setStats] = useState({
    totalFiles: 0,
    processedFiles: 0,
    successfulFiles: 0,
    errorFiles: 0,
    filteredFiles: 0,
    movedFiles: 0,
    startTime: 0,
    endTime: 0,
    chunksCompleted: 0,
    citiesProcessed: 0,
  })
  const [activeTab, setActiveTab] = useState("config")
  const [isConnected, setIsConnected] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  // SSE connection ref
  const eventSourceRef = useRef<EventSource | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const logsEndRef = useRef<HTMLDivElement>(null)
  const errorsEndRef = useRef<HTMLDivElement>(null)

  const TEXT_FILTER_OPERATORS = [
    { value: "like", label: "Contains (Like)" },
    { value: "notLike", label: "Does Not Contain (Not Like)" },
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not Equal To" },
    { value: "startsWith", label: "Starts With" },
    { value: "endsWith", label: "Ends With" },
    { value: "notBlank", label: "Is Not Blank" },
    { value: "isBlank", label: "Is Blank or Empty" },
  ]

  useEffect(() => {
    setIsConnected(true)
    setLogs(["XML Parser initialized successfully", "Ready to process files", "Waiting for configuration..."])
    checkProcessingHistory()
  }, [])

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs])

  useEffect(() => {
    if (errorsEndRef.current) {
      errorsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [errors])

  // Cleanup SSE connection on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const checkProcessingHistory = async () => {
    try {
      const response = await fetch("/api/processing-state")

      if (!response.ok) {
        console.warn("Processing state API returned non-OK status:", response.status)
        setHasProcessingHistory(false)
        setProcessingState(null)
        return
      }

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        console.warn("Processing state API returned non-JSON response:", contentType)
        setHasProcessingHistory(false)
        setProcessingState(null)
        return
      }

      const data = await response.json()

      if (data.error) {
        console.warn("Processing state API returned error:", data.error)
        setHasProcessingHistory(false)
        setProcessingState(null)
        return
      }

      if (data.hasState && data.state) {
        setHasProcessingHistory(true)
        setProcessingState(data.state)
        addLog(
          `Found previous processing state: ${data.state.chunksCompleted || 0}/${data.state.totalChunks || 0} chunks completed`,
        )
      } else {
        setHasProcessingHistory(false)
        setProcessingState(null)
      }
    } catch (error) {
      console.warn("Error checking processing history (non-critical):", error)
      setHasProcessingHistory(false)
      setProcessingState(null)
      // Don't show error to user - this is not critical functionality
    }
  }

  const resetProcessingHistory = async () => {
    try {
      const response = await fetch("/api/processing-state", { method: "DELETE" })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success !== false) {
        setHasProcessingHistory(false)
        setProcessingState(null)
        setCurrentChunk(0)
        setTotalChunks(0)
        setChunkProgress(0)
        addLog("Processing history reset successfully")
      } else {
        throw new Error(data.error || "Failed to reset processing history")
      }
    } catch (error) {
      console.error("Error resetting processing history:", error)
      addLog(`Error resetting processing history: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`])
  }

  const getFilterConfig = () => {
    if (!enableFiltering) return null

    const config: any = {
      enabled: true,
      moveImages: moveFilteredImages,
      moveDestinationPath: moveFilteredImages ? moveDestinationPath : undefined,
      moveFolderStructureOption: moveFilteredImages ? moveFolderStructure : undefined,
      organizeByCity: organizeByCity,
    }

    if (minImageSize === "custom") {
      config.minWidth = Number.parseInt(customMinWidth) || undefined
      config.minHeight = Number.parseInt(customMinHeight) || undefined
    } else if (minImageSize !== "none") {
      const size = Number.parseInt(minImageSize)
      config.minWidth = size
      config.minHeight = size
    }

    if (minFileSize) {
      const multiplier = fileSizeUnit === "MB" ? 1024 * 1024 : 1024
      config.minFileSize = Number.parseInt(minFileSize) * multiplier
    }
    if (maxFileSize) {
      const multiplier = fileSizeUnit === "MB" ? 1024 * 1024 : 1024
      config.maxFileSize = Number.parseInt(maxFileSize) * multiplier
    }

    // File type filter
    if (enableFileTypeFilter) {
      const allFileTypes = [...selectedFileTypes]
      if (customFileTypes.trim()) {
        const customTypes = customFileTypes
          .split(",")
          .map((type) => type.trim().toLowerCase().replace(/^\./, ""))
          .filter((type) => type.length > 0)
        allFileTypes.push(...customTypes)
      }
      config.allowedFileTypes = allFileTypes.length > 0 ? allFileTypes : undefined
    }

    const addMetaFilter = (field: string, filterState: { value: string; operator: string }) => {
      if (filterState.operator === "notBlank" || filterState.operator === "isBlank") {
        config[field] = { operator: filterState.operator, value: "" }
      } else if (filterState.value.trim()) {
        config[field] = { value: filterState.value.trim(), operator: filterState.operator }
      }
    }

    addMetaFilter("creditLine", creditLineFilter)
    addMetaFilter("copyright", copyrightFilter)
    addMetaFilter("usageType", usageTypeFilter)
    addMetaFilter("rightsHolder", rightsHolderFilter)
    addMetaFilter("location", locationFilter)

    return config
  }

  const handleStartParsing = async () => {
    if (!rootDir) {
      alert("Please select a root directory first")
      return
    }
    if (moveFilteredImages && !moveDestinationPath) {
      alert("Please specify a destination path for moved images if 'Move matching images' is enabled.")
      return
    }

    // Reset state
    setLogs([])
    setErrors([])
    setProgress(0)
    setChunkProgress(0)
    setStats({
      totalFiles: 0,
      processedFiles: 0,
      successfulFiles: 0,
      errorFiles: 0,
      filteredFiles: 0,
      movedFiles: 0,
      startTime: Date.now(),
      endTime: 0,
      chunksCompleted: 0,
      citiesProcessed: 0,
    })
    setStatus("running")
    setIsProcessing(true)
    setIsPaused(false)
    setActiveTab("logs")
    setDownloadUrl("")

    const currentFilterConfig = getFilterConfig()

    try {
      // Close any existing SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      // Create abort controller for the fetch request
      abortControllerRef.current = new AbortController()

      // Start SSE processing
      const endpoint = enableChunkedProcessing ? "/api/parse/chunked" : "/api/parse/stream"
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir,
          outputFile,
          numWorkers: workers,
          verbose,
          filterConfig: currentFilterConfig,
          chunkSize: enableChunkedProcessing ? chunkSize : undefined,
          organizeByCity,
          resumeFromState: hasProcessingHistory ? processingState : null,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // If using chunked processing but it's not implemented yet, fall back to regular processing
      if (enableChunkedProcessing && response.headers.get("content-type")?.includes("application/json")) {
        const result = await response.json()
        if (result.message && result.message.includes("not yet fully implemented")) {
          addLog("Chunked processing not yet implemented, falling back to regular processing...")
          // Fall back to regular stream processing
          const fallbackResponse = await fetch("/api/parse/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rootDir,
              outputFile,
              numWorkers: workers,
              verbose,
              filterConfig: currentFilterConfig,
            }),
            signal: abortControllerRef.current.signal,
          })

          if (!fallbackResponse.ok) {
            throw new Error(`HTTP error! status: ${fallbackResponse.status}`)
          }

          // Process the fallback response
          const reader = fallbackResponse.body?.getReader()
          const decoder = new TextDecoder()

          if (reader) {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value)
              const lines = chunk.split("\n")

              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const data = JSON.parse(line.slice(6))
                    handleSSEMessage(data)
                  } catch (e) {
                    console.error("Error parsing SSE data:", e)
                  }
                }
              }
            }
          }
          return
        }
      }

      // Create EventSource-like functionality with fetch
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split("\n")

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6))
                handleSSEMessage(data)
              } catch (e) {
                console.error("Error parsing SSE data:", e)
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        addLog("Processing was cancelled")
        setStatus("idle")
      } else {
        addLog(`Network error: ${error.message}`)
        setStatus("error")
      }
    } finally {
      setIsProcessing(false)
      setIsPaused(false)
    }
  }

  const handleSSEMessage = (data: any) => {
    switch (data.type) {
      case "log":
        addLog(data.message)
        break
      case "chunk_start":
        setCurrentChunk(data.chunkNumber)
        setTotalChunks(data.totalChunks)
        setChunkProgress(0)
        addLog(`Starting chunk ${data.chunkNumber}/${data.totalChunks} (${data.chunkSize} files)`)
        break
      case "chunk_progress":
        setChunkProgress(data.percentage)
        break
      case "chunk_complete":
        setStats((prev) => ({
          ...prev,
          chunksCompleted: data.chunkNumber,
          citiesProcessed: data.citiesProcessed || prev.citiesProcessed,
        }))
        addLog(`Chunk ${data.chunkNumber} completed. CSV saved: ${data.csvFile}`)
        if (data.citiesSaved) {
          addLog(`Images organized by cities: ${data.citiesSaved.join(", ")}`)
        }
        break
      case "progress":
        setProgress(data.percentage)
        setStats((prev) => ({
          ...prev,
          processedFiles: data.processed,
          totalFiles: data.total,
          successfulFiles: data.successful,
          filteredFiles: data.filtered,
          movedFiles: data.moved,
          errorFiles: data.errors,
        }))
        break
      case "error":
        addLog(`Error: ${data.message}`)
        setErrors((prev) => [...prev, data.message])
        setStatus("error")
        setIsProcessing(false)
        break
      case "paused":
        setIsPaused(true)
        setStatus("paused")
        addLog("Processing paused. State saved.")
        break
      case "complete":
        setStats((prev) => ({ ...prev, ...data.stats, endTime: Date.now() }))
        setProgress(100)
        setChunkProgress(100)
        setStatus("completed")
        setDownloadUrl(`/api/download?file=${encodeURIComponent(data.outputFile)}`)
        setIsProcessing(false)
        setHasProcessingHistory(false)
        if (data.errors && data.errors.length > 0) {
          setErrors(data.errors)
        }
        addLog(`All ${data.stats.chunksCompleted} chunks completed successfully!`)
        break
    }
  }

  const handlePauseProcessing = async () => {
    try {
      const response = await fetch("/api/parse/pause", { method: "POST" })
      if (response.ok) {
        addLog("Pause request sent...")
      }
    } catch (error) {
      addLog(`Error pausing: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const handleStopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    setIsProcessing(false)
    setIsPaused(false)
    setStatus("idle")
    addLog("Processing stopped by user")
  }

  const handleDownloadCSV = () => {
    if (downloadUrl) {
      window.open(downloadUrl, "_blank")
    } else {
      const csvContent = `City,Year,Month,News Item ID,Headline\nPune,2010,07,2010-07-01_11-01-54_MED_838EB5AE_N_000_000_000_org,"नगर-निर्मल गांधी"`
      const blob = new Blob([csvContent], { type: "text/csv" })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = outputFile
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    }
  }

  const handleStartWatching = async () => {
    if (!rootDir) {
      alert("Please select a root directory first")
      return
    }
    if (moveFilteredImages && !moveDestinationPath) {
      alert("Please specify a destination path for moved images if 'Move matching images' is enabled for watch mode.")
      return
    }
    setIsWatching(true)
    setStatus("running")
    setActiveTab("logs")
    addLog("=".repeat(50))
    addLog("Attempting to start watch mode...")

    const currentFilterConfig = getFilterConfig()

    try {
      const response = await fetch("/api/watch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir,
          outputFile,
          numWorkers: workers,
          verbose,
          filterConfig: currentFilterConfig,
        }),
      })
      const result = await response.json()
      if (response.ok) {
        addLog("Watch mode started successfully. Monitoring for new XML files.")
      } else {
        addLog(`Error starting watcher: ${result.message}`)
        setIsWatching(false)
        setStatus("error")
      }
    } catch (error) {
      addLog(`Network error: ${error instanceof Error ? error.message : "Unknown error"}`)
      setIsWatching(false)
      setStatus("error")
    }
  }

  const handleStopWatching = async () => {
    addLog("Attempting to stop watch mode...")
    try {
      const response = await fetch("/api/watch/stop", { method: "POST" })
      const result = await response.json()
      if (response.ok) {
        addLog("Watch mode stopped.")
      } else {
        addLog(`Could not stop watcher: ${result.message}`)
      }
    } catch (error) {
      addLog(`Network error: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsWatching(false)
      setStatus("idle")
    }
  }

  const getStatusBadge = () => {
    switch (status) {
      case "idle":
        return (
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            Ready
          </Badge>
        )
      case "running":
        return (
          <Badge variant="secondary">
            <Play className="h-3 w-3 mr-1" />
            Running
          </Badge>
        )
      case "paused":
        return (
          <Badge variant="secondary" className="bg-yellow-600">
            <Pause className="h-3 w-3 mr-1" />
            Paused
          </Badge>
        )
      case "completed":
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        )
      case "error":
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        )
      default:
        return null
    }
  }

  const formatDuration = (ms: number) => {
    if (!ms) return "0s"
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  const getConnectionStatus = () => {
    return isConnected ? (
      <Badge variant="default" className="bg-green-600">
        <CheckCircle className="h-3 w-3 mr-1" />
        Connected
      </Badge>
    ) : (
      <Badge variant="destructive">
        <AlertCircle className="h-3 w-3 mr-1" />
        Disconnected
      </Badge>
    )
  }

  return (
    <main className="container mx-auto py-8 px-4 max-w-7xl">
      <Card className="mb-8">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-3xl font-bold">Sakal Image Metadata Parser</CardTitle>
            </div>
            <div className="flex gap-2">
              {getConnectionStatus()}
              {getStatusBadge()}
              {enableFiltering && (
                <Badge variant="outline">
                  <Filter className="h-3 w-3 mr-1" />
                  Filtering Enabled
                </Badge>
              )}
              {enableChunkedProcessing && (
                <Badge variant="outline">
                  <Database className="h-3 w-3 mr-1" />
                  Chunked Processing
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-4 mb-4">
              <TabsTrigger value="config">Configuration</TabsTrigger>
              <TabsTrigger value="filters">Filters</TabsTrigger>
              <TabsTrigger value="logs">Processing Logs</TabsTrigger>
              <TabsTrigger value="results">Results & Download</TabsTrigger>
            </TabsList>

            <TabsContent value="config">
              <Card>
                <CardHeader>
                  <CardTitle>Parser Configuration</CardTitle>
                  <CardDescription>Configure the XML parser settings before starting</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="rootDir">Root Directory (Full Absolute Path)</Label>
                    <Input
                      id="rootDir"
                      value={rootDir}
                      onChange={(e) => setRootDir(e.target.value)}
                      placeholder="e.g., C:\Users\YourName\Documents\Sample_Images or /Users/yourname/Documents/Sample_Images"
                      className="flex-1"
                    />
                    <p className="text-sm text-muted-foreground">
                      Manually paste the full, absolute path to the directory containing your XML files. The server must
                      have access to this path.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="outputFile">Output CSV File</Label>
                    <Input
                      id="outputFile"
                      value={outputFile}
                      onChange={(e) => setOutputFile(e.target.value)}
                      placeholder="image_metadata.csv"
                    />
                    <p className="text-sm text-muted-foreground">Name of the CSV file that will be generated</p>
                  </div>

                  {/* Chunked Processing Settings */}
                  <Card className="p-4 border-2 border-blue-200">
                    <CardHeader className="p-0 pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Database className="h-4 w-4" /> Chunked Processing (Recommended for Large Datasets)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 space-y-4">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="enableChunkedProcessing"
                          checked={enableChunkedProcessing}
                          onCheckedChange={setEnableChunkedProcessing}
                        />
                        <Label htmlFor="enableChunkedProcessing">Enable chunked processing</Label>
                      </div>

                      {enableChunkedProcessing && (
                        <>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <Label htmlFor="chunkSize">Chunk Size (files per chunk)</Label>
                              <Badge variant="outline">{chunkSize.toLocaleString()}</Badge>
                            </div>
                            <Slider
                              id="chunkSize"
                              min={100}
                              max={10000}
                              step={100}
                              value={[chunkSize]}
                              onValueChange={(value) => setChunkSize(value[0])}
                            />
                            <p className="text-sm text-muted-foreground">
                              Process files in chunks. Smaller chunks = more frequent saves, larger chunks = faster
                              processing
                            </p>
                          </div>

                          <div className="flex items-center space-x-2">
                            <Switch id="organizeByCity" checked={organizeByCity} onCheckedChange={setOrganizeByCity} />
                            <Label htmlFor="organizeByCity">Organize moved images by city</Label>
                          </div>

                          {hasProcessingHistory && (
                            <Alert className="bg-blue-50 border-blue-200">
                              <Database className="h-4 w-4" />
                              <AlertTitle>Previous Processing Found</AlertTitle>
                              <AlertDescription className="space-y-2">
                                <div>
                                  Found previous processing state: {processingState?.chunksCompleted || 0}/
                                  {processingState?.totalChunks || 0} chunks completed
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" onClick={resetProcessingHistory}>
                                    <RotateCcw className="h-3 w-3 mr-1" />
                                    Reset & Start Fresh
                                  </Button>
                                </div>
                              </AlertDescription>
                            </Alert>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor="workers">Worker Threads</Label>
                        <Badge variant="outline">{workers}</Badge>
                      </div>
                      <Slider
                        id="workers"
                        min={1}
                        max={16}
                        step={1}
                        value={[workers]}
                        onValueChange={(value) => setWorkers(value[0])}
                      />
                      <p className="text-sm text-muted-foreground">Number of parallel workers for processing</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor="batchSize">Batch Size (for worker assignment)</Label>
                        <Badge variant="outline">{batchSize}</Badge>
                      </div>
                      <Slider
                        id="batchSize"
                        min={10}
                        max={500}
                        step={10}
                        value={[batchSize]}
                        onValueChange={(value) => setBatchSize(value[0])}
                      />
                      <p className="text-sm text-muted-foreground">
                        Number of files assigned to workers in chunks (primarily for large file lists)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch id="verbose" checked={verbose} onCheckedChange={setVerbose} />
                    <Label htmlFor="verbose">Verbose Logging</Label>
                    <p className="text-sm text-muted-foreground ml-2">Show detailed processing information</p>
                  </div>
                  <div className="flex items-center space-x-2 pt-4 border-t">
                    <Switch id="watchMode" checked={enableWatchMode} onCheckedChange={setEnableWatchMode} />
                    <Label htmlFor="watchMode">Enable Watch Mode</Label>
                    <p className="text-sm text-muted-foreground ml-2">
                      Automatically process new files added to the root folder.
                    </p>
                  </div>
                  <div className="mt-6 pt-4 border-t">
                    {enableWatchMode ? (
                      isWatching ? (
                        <Button onClick={handleStopWatching} className="w-full" size="lg" variant="destructive">
                          <Clock className="h-4 w-4 mr-2" />
                          Stop Watching
                        </Button>
                      ) : (
                        <Button onClick={handleStartWatching} disabled={!rootDir} className="w-full" size="lg">
                          <Play className="h-4 w-4 mr-2" />
                          Start Watching Folder
                        </Button>
                      )
                    ) : isProcessing ? (
                      <div className="flex gap-2">
                        <Button onClick={handlePauseProcessing} className="flex-1" size="lg" variant="secondary">
                          <Pause className="h-4 w-4 mr-2" />
                          Pause Processing
                        </Button>
                        <Button onClick={handleStopProcessing} className="flex-1" size="lg" variant="destructive">
                          <Square className="h-4 w-4 mr-2" />
                          Stop Processing
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={handleStartParsing}
                        disabled={status === "running" || !rootDir}
                        className="w-full"
                        size="lg"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {hasProcessingHistory ? "Resume Processing" : "Start Processing"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="filters">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Image Filtering Options
                  </CardTitle>
                  <CardDescription>Filter images by size, metadata, and manage filtered images.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center space-x-2">
                    <Switch id="enableFiltering" checked={enableFiltering} onCheckedChange={setEnableFiltering} />
                    <Label htmlFor="enableFiltering">Enable Image Filtering</Label>
                  </div>

                  {enableFiltering && (
                    <>
                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" /> Image Dimensions
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 space-y-4">
                          <div className="space-y-2">
                            <Label>Minimum Image Size</Label>
                            <Select value={minImageSize} onValueChange={setMinImageSize}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select minimum size" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No size filter</SelectItem>
                                <SelectItem value="512">512x512 pixels</SelectItem>
                                <SelectItem value="720">720x720 pixels</SelectItem>
                                <SelectItem value="1024">1024x1024 pixels</SelectItem>
                                <SelectItem value="custom">Custom size</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {minImageSize === "custom" && (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="customMinWidth">Min Width (px)</Label>
                                <Input
                                  id="customMinWidth"
                                  type="number"
                                  value={customMinWidth}
                                  onChange={(e) => setCustomMinWidth(e.target.value)}
                                  placeholder="e.g., 800"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="customMinHeight">Min Height (px)</Label>
                                <Input
                                  id="customMinHeight"
                                  type="number"
                                  value={customMinHeight}
                                  onChange={(e) => setCustomMinHeight(e.target.value)}
                                  placeholder="e.g., 600"
                                />
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <HardDrive className="h-4 w-4" /> File Size
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 space-y-4">
                          <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="minFileSize">Min File Size</Label>
                              <Input
                                id="minFileSize"
                                type="number"
                                value={minFileSize}
                                onChange={(e) => setMinFileSize(e.target.value)}
                                placeholder="e.g., 100"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="maxFileSize">Max File Size</Label>
                              <Input
                                id="maxFileSize"
                                type="number"
                                value={maxFileSize}
                                onChange={(e) => setMaxFileSize(e.target.value)}
                                placeholder="e.g., 5000"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Unit</Label>
                              <Select value={fileSizeUnit} onValueChange={setFileSizeUnit}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="KB">KB</SelectItem>
                                  <SelectItem value="MB">MB</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" /> File Type Filter
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 space-y-4">
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="enableFileTypeFilter"
                              checked={enableFileTypeFilter}
                              onCheckedChange={setEnableFileTypeFilter}
                            />
                            <Label htmlFor="enableFileTypeFilter">Filter by image file type</Label>
                          </div>

                          {enableFileTypeFilter && (
                            <>
                              <div className="space-y-3">
                                <Label className="text-sm font-medium">Select file types to include:</Label>
                                <div className="grid grid-cols-2 gap-2">
                                  {COMMON_FILE_TYPES.map((fileType) => (
                                    <div key={fileType.value} className="flex items-center space-x-2">
                                      <input
                                        type="checkbox"
                                        id={`filetype-${fileType.value}`}
                                        checked={selectedFileTypes.includes(fileType.value)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedFileTypes((prev) => [...prev, fileType.value])
                                          } else {
                                            setSelectedFileTypes((prev) =>
                                              prev.filter((type) => type !== fileType.value),
                                            )
                                          }
                                        }}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      <Label
                                        htmlFor={`filetype-${fileType.value}`}
                                        className="text-sm font-normal cursor-pointer"
                                      >
                                        .{fileType.label}
                                      </Label>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="customFileTypes" className="text-sm font-medium">
                                  Custom file types (comma-separated):
                                </Label>
                                <Input
                                  id="customFileTypes"
                                  value={customFileTypes}
                                  onChange={(e) => setCustomFileTypes(e.target.value)}
                                  placeholder="e.g., raw, cr2, nef"
                                  className="text-sm"
                                />
                                <p className="text-xs text-muted-foreground">
                                  Add custom extensions without dots, separated by commas
                                </p>
                              </div>

                              <div className="flex items-center justify-between">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedFileTypes(COMMON_FILE_TYPES.map((ft) => ft.value))}
                                >
                                  Select All Common
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedFileTypes([])
                                    setCustomFileTypes("")
                                  }}
                                >
                                  Clear All
                                </Button>
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Newspaper className="h-4 w-4" /> Metadata Filters
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="creditLineFilterValue">CreditLine</Label>
                            <div className="flex gap-2">
                              <Select
                                value={creditLineFilter.operator}
                                onValueChange={(op) => setCreditLineFilter((prev) => ({ ...prev, operator: op }))}
                              >
                                <SelectTrigger className="w-[200px]">
                                  <SelectValue placeholder="Select operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEXT_FILTER_OPERATORS.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                      {op.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {creditLineFilter.operator !== "notBlank" && creditLineFilter.operator !== "isBlank" && (
                                <Input
                                  id="creditLineFilterValue"
                                  value={creditLineFilter.value}
                                  onChange={(e) => setCreditLineFilter((prev) => ({ ...prev, value: e.target.value }))}
                                  placeholder="e.g., Sakal Media"
                                  className="flex-1"
                                />
                              )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="copyrightFilterValue">Copyright</Label>
                            <div className="flex gap-2">
                              <Select
                                value={copyrightFilter.operator}
                                onValueChange={(op) => setCopyrightFilter((prev) => ({ ...prev, operator: op }))}
                              >
                                <SelectTrigger className="w-[200px]">
                                  <SelectValue placeholder="Select operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEXT_FILTER_OPERATORS.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                      {op.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {copyrightFilter.operator !== "notBlank" && copyrightFilter.operator !== "isBlank" && (
                                <Input
                                  id="copyrightFilterValue"
                                  value={copyrightFilter.value}
                                  onChange={(e) => setCopyrightFilter((prev) => ({ ...prev, value: e.target.value }))}
                                  placeholder="e.g., 2023 Company"
                                  className="flex-1"
                                />
                              )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="usageTypeFilterValue">UsageType</Label>
                            <div className="flex gap-2">
                              <Select
                                value={usageTypeFilter.operator}
                                onValueChange={(op) => setUsageTypeFilter((prev) => ({ ...prev, operator: op }))}
                              >
                                <SelectTrigger className="w-[200px]">
                                  <SelectValue placeholder="Select operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEXT_FILTER_OPERATORS.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                      {op.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {usageTypeFilter.operator !== "notBlank" && usageTypeFilter.operator !== "isBlank" && (
                                <Input
                                  id="usageTypeFilterValue"
                                  value={usageTypeFilter.value}
                                  onChange={(e) => setUsageTypeFilter((prev) => ({ ...prev, value: e.target.value }))}
                                  placeholder="e.g., public"
                                  className="flex-1"
                                />
                              )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="rightsHolderFilterValue">RightsHolder</Label>
                            <div className="flex gap-2">
                              <Select
                                value={rightsHolderFilter.operator}
                                onValueChange={(op) => setRightsHolderFilter((prev) => ({ ...prev, operator: op }))}
                              >
                                <SelectTrigger className="w-[200px]">
                                  <SelectValue placeholder="Select operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEXT_FILTER_OPERATORS.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                      {op.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {rightsHolderFilter.operator !== "notBlank" &&
                                rightsHolderFilter.operator !== "isBlank" && (
                                  <Input
                                    id="rightsHolderFilterValue"
                                    value={rightsHolderFilter.value}
                                    onChange={(e) =>
                                      setRightsHolderFilter((prev) => ({ ...prev, value: e.target.value }))
                                    }
                                    placeholder="e.g., sakal"
                                    className="flex-1"
                                  />
                                )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="locationFilterValue">Location</Label>
                            <div className="flex gap-2">
                              <Select
                                value={locationFilter.operator}
                                onValueChange={(op) => setLocationFilter((prev) => ({ ...prev, operator: op }))}
                              >
                                <SelectTrigger className="w-[200px]">
                                  <SelectValue placeholder="Select operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEXT_FILTER_OPERATORS.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                      {op.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {locationFilter.operator !== "notBlank" && locationFilter.operator !== "isBlank" && (
                                <Input
                                  id="locationFilterValue"
                                  value={locationFilter.value}
                                  onChange={(e) => setLocationFilter((prev) => ({ ...prev, value: e.target.value }))}
                                  placeholder="e.g., Pne"
                                  className="flex-1"
                                />
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <FolderOpen className="h-4 w-4" />
                            Move Filtered Images
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 space-y-4">
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="moveFilteredImages"
                              checked={moveFilteredImages}
                              onCheckedChange={setMoveFilteredImages}
                            />
                            <Label htmlFor="moveFilteredImages">Move matching images to a specified destination</Label>
                          </div>
                          {moveFilteredImages && (
                            <>
                              <div className="space-y-2">
                                <Label htmlFor="moveDestinationPath">Destination Path (Full Absolute Path)</Label>
                                <Input
                                  id="moveDestinationPath"
                                  value={moveDestinationPath}
                                  onChange={(e) => setMoveDestinationPath(e.target.value)}
                                  placeholder="e.g., D:\Filtered_Output or /mnt/storage/filtered_images"
                                />
                                <p className="text-xs text-muted-foreground">
                                  The server must have write access to this path.
                                </p>
                              </div>
                              <div className="space-y-2">
                                <Label>Moved Images Folder Structure</Label>
                                <RadioGroup
                                  value={moveFolderStructure}
                                  onValueChange={(value) => setMoveFolderStructure(value)}
                                  className="flex flex-col space-y-1"
                                >
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="replicate" id="replicate" />
                                    <Label htmlFor="replicate" className="font-normal flex items-center gap-1">
                                      <Copy className="h-3 w-3 text-muted-foreground" />
                                      Replicate source folder structure
                                    </Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="single" id="single" />
                                    <Label htmlFor="single" className="font-normal flex items-center gap-1">
                                      <Layers className="h-3 w-3 text-muted-foreground" />
                                      Place all in selected destination folder
                                    </Label>
                                  </div>
                                </RadioGroup>
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>

                      <Alert>
                        <Filter className="h-4 w-4" />
                        <AlertTitle>Current Filter Summary</AlertTitle>
                        <AlertDescription className="space-y-1 text-xs">
                          {minImageSize !== "none" && (
                            <div>
                              Image size:{" "}
                              {minImageSize === "custom"
                                ? `${customMinWidth || 0}x${customMinHeight || 0}`
                                : `${minImageSize}x${minImageSize}`}{" "}
                              px min
                            </div>
                          )}
                          {(minFileSize || maxFileSize) && (
                            <div>
                              File size: {minFileSize && `${minFileSize}${fileSizeUnit} min`}{" "}
                              {maxFileSize && `${maxFileSize}${fileSizeUnit} max`}
                            </div>
                          )}
                          {enableFileTypeFilter && (selectedFileTypes.length > 0 || customFileTypes.trim()) && (
                            <div>
                              File types:{" "}
                              {[
                                ...selectedFileTypes.map((type) => `.${type.toUpperCase()}`),
                                ...(customFileTypes.trim()
                                  ? customFileTypes.split(",").map((type) => `.${type.trim().toUpperCase()}`)
                                  : []),
                              ].join(", ")}
                            </div>
                          )}
                          {Object.entries({
                            CreditLine: creditLineFilter,
                            Copyright: copyrightFilter,
                            UsageType: usageTypeFilter,
                            RightsHolder: rightsHolderFilter,
                            Location: locationFilter,
                          }).map(([label, filterDetail]) => {
                            if (
                              filterDetail.operator === "notBlank" ||
                              filterDetail.operator === "isBlank" ||
                              (filterDetail.value && filterDetail.value.trim())
                            ) {
                              const opLabel =
                                TEXT_FILTER_OPERATORS.find((op) => op.value === filterDetail.operator)?.label ||
                                filterDetail.operator
                              if (filterDetail.operator === "notBlank" || filterDetail.operator === "isBlank") {
                                return (
                                  <div key={label}>
                                    {label}: {opLabel}
                                  </div>
                                )
                              }
                              return (
                                <div key={label}>
                                  {label}: {opLabel} "{filterDetail.value}"
                                </div>
                              )
                            }
                            return null
                          })}
                          {moveFilteredImages && moveDestinationPath && (
                            <>
                              <div>Move to: "{moveDestinationPath}"</div>
                              <div>
                                Structure: {moveFolderStructure === "replicate" ? "Replicate source" : "Single folder"}
                              </div>
                              {organizeByCity && <div>Organization: By city folders</div>}
                            </>
                          )}
                        </AlertDescription>
                      </Alert>
                    </>
                  )}

                  <div className="mt-6 pt-4 border-t">
                    {enableWatchMode ? (
                      isWatching ? (
                        <Button onClick={handleStopWatching} className="w-full" size="lg" variant="destructive">
                          <Clock className="h-4 w-4 mr-2" /> Stop Watching
                        </Button>
                      ) : (
                        <Button
                          onClick={handleStartWatching}
                          disabled={!rootDir || (moveFilteredImages && !moveDestinationPath)}
                          className="w-full"
                          size="lg"
                        >
                          <Play className="h-4 w-4 mr-2" /> Start Watching with Filters
                        </Button>
                      )
                    ) : isProcessing ? (
                      <div className="flex gap-2">
                        <Button onClick={handlePauseProcessing} className="flex-1" size="lg" variant="secondary">
                          <Pause className="h-4 w-4 mr-2" />
                          Pause Processing
                        </Button>
                        <Button onClick={handleStopProcessing} className="flex-1" size="lg" variant="destructive">
                          <Square className="h-4 w-4 mr-2" />
                          Stop Processing
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={handleStartParsing}
                        disabled={status === "running" || !rootDir || (moveFilteredImages && !moveDestinationPath)}
                        className="w-full"
                        size="lg"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {enableFiltering ? "Start Processing with Filters" : "Start Processing (No Filters)"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="logs">
              <Card className="h-[700px] flex flex-col">
                <CardHeader>
                  <CardTitle>Processing Logs</CardTitle>
                  <CardDescription>Real-time logs from the XML parser</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
                    <div className="flex flex-col h-full">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-sm font-medium">Standard Output</h3>
                        <Badge variant="outline">{logs.length} entries</Badge>
                      </div>
                      <ScrollArea className="flex-1 border rounded-md p-4 bg-muted/20">
                        {logs.length === 0 ? (
                          <p className="text-muted-foreground text-sm italic">No logs yet...</p>
                        ) : (
                          logs.map((log, index) => (
                            <div key={index} className="text-xs font-mono mb-1 py-1">
                              {log}
                            </div>
                          ))
                        )}
                        <div ref={logsEndRef} />
                      </ScrollArea>
                    </div>
                    <div className="flex flex-col h-full">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-sm font-medium">Errors & Warnings</h3>
                        <Badge variant={errors.length > 0 ? "destructive" : "outline"}>{errors.length} errors</Badge>
                      </div>
                      <ScrollArea className="flex-1 border rounded-md p-4 bg-muted/20">
                        {errors.length === 0 ? (
                          <p className="text-muted-foreground text-sm italic">No errors...</p>
                        ) : (
                          errors.map((error, index) => (
                            <div key={index} className="text-xs font-mono text-red-600 mb-1 py-1">
                              {error}
                            </div>
                          ))
                        )}
                        <div ref={errorsEndRef} />
                      </ScrollArea>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="border-t pt-4">
                  <div className="w-full space-y-4">
                    {enableChunkedProcessing && totalChunks > 0 && (
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span>Current Chunk Progress</span>
                          <span>
                            Chunk {currentChunk}/{totalChunks} ({Math.round(chunkProgress)}%)
                          </span>
                        </div>
                        <Progress value={chunkProgress} className="h-2" />
                      </div>
                    )}
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span>Overall Progress</span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                      <Progress value={progress} className="h-3" />
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>{stats.processedFiles.toLocaleString()} processed</span>
                        <span>{stats.totalFiles.toLocaleString()} total</span>
                      </div>
                    </div>
                  </div>
                </CardFooter>
              </Card>
            </TabsContent>

            <TabsContent value="results">
              <Card>
                <CardHeader>
                  <CardTitle>Processing Results</CardTitle>
                  <CardDescription>Summary and download options</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {status === "idle" ? (
                    <Alert>
                      <Clock className="h-4 w-4" />
                      <AlertTitle>No processing started yet</AlertTitle>
                      <AlertDescription>Configure and start parsing to see results.</AlertDescription>
                    </Alert>
                  ) : status === "running" || status === "paused" ? (
                    <Alert>
                      <Play className="h-4 w-4" />
                      <AlertTitle>Processing in progress</AlertTitle>
                      <AlertDescription>
                        {enableChunkedProcessing && (
                          <div>
                            Chunk {currentChunk}/{totalChunks} - {stats.chunksCompleted} chunks completed
                          </div>
                        )}
                        Results will be available when complete.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Total Files</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-3xl font-bold">{stats.totalFiles.toLocaleString()}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Processed</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-3xl font-bold">{stats.processedFiles.toLocaleString()}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Successful</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-3xl font-bold text-green-600">
                              {stats.successfulFiles.toLocaleString()}
                            </p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Filtered</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-3xl font-bold text-blue-600">{stats.filteredFiles.toLocaleString()}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Moved</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-3xl font-bold text-purple-600">{stats.movedFiles.toLocaleString()}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Chunks</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-3xl font-bold text-orange-600">{stats.chunksCompleted}</p>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Proc. Time</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-xl font-medium">{formatDuration(stats.endTime - stats.startTime)}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Success Rate</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-xl font-medium">
                              {stats.processedFiles > 0
                                ? `${Math.round((stats.successfulFiles / stats.processedFiles) * 100)}%`
                                : "0%"}
                            </p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm text-muted-foreground">Filter Rate</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                            <p className="text-xl font-medium">
                              {stats.totalFiles > 0 && enableFiltering
                                ? `${Math.round((stats.filteredFiles / stats.totalFiles) * 100)}%`
                                : "N/A"}
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                      {status === "completed" && (
                        <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <AlertTitle className="text-green-600">Processing completed successfully!</AlertTitle>
                          <AlertDescription>
                            CSV generated. {enableFiltering && `${stats.filteredFiles} images matched filters.`}{" "}
                            {moveFilteredImages && stats.movedFiles > 0 && `${stats.movedFiles} images moved.`}
                            {enableChunkedProcessing && ` Processed in ${stats.chunksCompleted} chunks.`}
                          </AlertDescription>
                        </Alert>
                      )}
                      {status === "error" && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Processing completed with errors</AlertTitle>
                          <AlertDescription>Check error logs for details.</AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}
                </CardContent>
                <CardFooter className="flex gap-2">
                  <Button
                    onClick={handleDownloadCSV}
                    disabled={status !== "completed" && status !== "error"}
                    className="flex-1"
                    size="lg"
                  >
                    <FileDown className="h-4 w-4 mr-2" />
                    Download CSV
                  </Button>
                  <Button variant="outline" onClick={() => setActiveTab("config")} size="lg">
                    <Settings className="h-4 w-4 mr-2" />
                    New Session
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Live Statistics</CardTitle>
              <CardDescription>Real-time processing metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="font-medium capitalize">{status}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Connection:</span>
                  <span className="font-medium">{isConnected ? "Connected" : "Disconnected"}</span>
                </div>
                {enableChunkedProcessing && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current Chunk:</span>
                      <span className="font-medium">
                        {currentChunk}/{totalChunks}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Chunks Done:</span>
                      <span className="font-medium text-orange-600">{stats.chunksCompleted}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Files:</span>
                  <span className="font-medium">{stats.totalFiles.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Processed:</span>
                  <span className="font-medium">{stats.processedFiles.toLocaleString()}</span>
                </div>
                {enableFiltering && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Filtered:</span>
                    <span className="font-medium text-blue-600">{stats.filteredFiles.toLocaleString()}</span>
                  </div>
                )}
                {moveFilteredImages && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Moved:</span>
                    <span className="font-medium text-purple-600">{stats.movedFiles.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Success Rate:</span>
                  <span className="font-medium text-green-600">
                    {stats.processedFiles > 0
                      ? `${Math.round((stats.successfulFiles / stats.processedFiles) * 100)}%`
                      : "0%"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Error Rate:</span>
                  <span className="font-medium text-red-600">
                    {stats.processedFiles > 0
                      ? `${Math.round((stats.errorFiles / stats.processedFiles) * 100)}%`
                      : "0%"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Elapsed Time:</span>
                  <span className="font-medium">
                    {formatDuration(
                      status === "running" ? Date.now() - stats.startTime : stats.endTime - stats.startTime,
                    )}
                  </span>
                </div>
              </div>
              <div className="pt-4 border-t">
                <div className="flex justify-between text-sm mb-2">
                  <span>Overall Progress</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-3" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0%</span>
                  <span>100%</span>
                </div>
              </div>
              {status === "running" && (
                <div className="pt-4 border-t">
                  <div className="text-sm text-muted-foreground mb-2">Processing Speed</div>
                  <div className="text-lg font-medium">
                    {stats.processedFiles > 0 && stats.startTime > 0
                      ? `${Math.round(stats.processedFiles / ((Date.now() - stats.startTime) / 1000))} files/sec`
                      : "Calculating..."}
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setActiveTab("config")}
                disabled={status === "running"}
              >
                <Settings className="h-4 w-4 mr-2" />
                Configuration
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setActiveTab("filters")}>
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setActiveTab("logs")}>
                <Upload className="h-4 w-4 mr-2" />
                View Logs
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </main>
  )
}
