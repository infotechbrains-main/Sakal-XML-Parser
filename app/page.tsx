"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Download,
  Play,
  Pause,
  RotateCcw,
  FileText,
  Filter,
  Settings,
  Clock,
  AlertCircle,
  Eye,
  EyeOff,
  PlayCircle,
  StopCircle,
  Activity,
} from "lucide-react"

interface ProcessingJob {
  id: string
  status: "running" | "paused" | "completed" | "error"
  progress: number
  totalFiles: number
  processedFiles: number
  filteredFiles: number
  movedFiles: number
  startTime: string
  endTime?: string
  rootDir: string
  outputFile: string
  filterConfig: any
}

interface HistoryEntry {
  sessionId: string
  timestamp: string
  rootDir: string
  outputFile: string
  totalFiles: number
  processedFiles: number
  filteredFiles: number
  movedFiles: number
  status: "completed" | "error" | "paused"
  duration: number
  filterConfig: any
}

interface WatcherStatus {
  isWatching: boolean
  watcherId: string | null
  config: any
  stats: {
    filesProcessed: number
    filesSuccessful: number
    filesMoved: number
    filesErrored: number
    xmlFilesDetected: number
    imageFilesDetected: number
    pairsProcessed: number
    startTime: string
  }
  uptime: number
  pendingPairs: number
  completePairs: number
}

export default function Home() {
  // State management
  const [rootDir, setRootDir] = useState("")
  const [outputFile, setOutputFile] = useState("image_metadata.csv")
  const [numWorkers, setNumWorkers] = useState(4)
  const [verbose, setVerbose] = useState(false)
  const [currentJob, setCurrentJob] = useState<ProcessingJob | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Watcher state
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null)
  const [watcherRootDir, setWatcherRootDir] = useState("")
  const [watcherOutputFile, setWatcherOutputFile] = useState("watched_images.csv")
  const [watcherVerbose, setWatcherVerbose] = useState(true)

  // Filter configuration
  const [filterConfig, setFilterConfig] = useState({
    enabled: false,
    fileTypes: ["jpg", "jpeg", "png", "tiff", "bmp"],
    customExtensions: "",
    allowedFileTypes: ["jpg", "jpeg", "png", "tiff", "bmp"],
    minWidth: 0,
    minHeight: 0,
    minFileSize: 0,
    maxFileSize: 0,
    creditLine: { operator: "", value: "" },
    copyright: { operator: "", value: "" },
    usageType: { operator: "", value: "" },
    rightsHolder: { operator: "", value: "" },
    location: { operator: "", value: "" },
    moveImages: false,
    moveDestinationPath: "",
    moveFolderStructureOption: "replicate",
  })

  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  // Load processing history
  useEffect(() => {
    loadHistory()
  }, [])

  // Poll for job status and watcher status
  useEffect(() => {
    const interval = setInterval(() => {
      if (isProcessing && currentJob) {
        checkJobStatus(currentJob.id)
      }
      if (watcherStatus?.isWatching) {
        checkWatcherStatus()
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [isProcessing, currentJob, watcherStatus?.isWatching])

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`])
  }

  const loadHistory = async () => {
    try {
      const response = await fetch("/api/history")
      if (response.ok) {
        const data = await response.json()
        // Ensure data.history is an array
        if (Array.isArray(data.history)) {
          setHistory(data.history)
        } else {
          console.warn("History data is not an array:", data)
          setHistory([])
        }
      } else {
        console.error("Failed to load history")
        setHistory([])
      }
    } catch (error) {
      console.error("Error loading history:", error)
      setHistory([])
    }
  }

  const startProcessing = async () => {
    if (!rootDir.trim()) {
      addLog("❌ Please select a root directory")
      return
    }

    try {
      setIsProcessing(true)
      addLog("🚀 Starting XML processing...")

      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir: rootDir.trim(),
          outputFile: outputFile.trim() || "image_metadata.csv",
          numWorkers,
          verbose,
          filterConfig,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setCurrentJob({
          id: data.jobId,
          status: "running",
          progress: 0,
          totalFiles: data.totalFiles || 0,
          processedFiles: 0,
          filteredFiles: 0,
          movedFiles: 0,
          startTime: new Date().toISOString(),
          rootDir,
          outputFile: outputFile.trim() || "image_metadata.csv",
          filterConfig,
        })
        addLog(`✅ Processing started with job ID: ${data.jobId}`)
        addLog(`📁 Found ${data.totalFiles} XML files to process`)
      } else {
        addLog(`❌ Failed to start processing: ${data.error}`)
        setIsProcessing(false)
      }
    } catch (error) {
      addLog(`❌ Error starting processing: ${error}`)
      setIsProcessing(false)
    }
  }

  const pauseProcessing = async () => {
    if (!currentJob) return

    try {
      const response = await fetch("/api/parse/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: currentJob.id }),
      })

      const data = await response.json()
      if (data.success) {
        setIsPaused(true)
        addLog("⏸️ Processing paused")
      } else {
        addLog(`❌ Failed to pause: ${data.error}`)
      }
    } catch (error) {
      addLog(`❌ Error pausing: ${error}`)
    }
  }

  const resumeProcessing = async () => {
    try {
      const response = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: currentJob?.id,
          filterConfig,
        }),
      })

      const data = await response.json()
      if (data.success) {
        setIsPaused(false)
        addLog("▶️ Processing resumed")
      } else {
        addLog(`❌ Failed to resume: ${data.error}`)
      }
    } catch (error) {
      addLog(`❌ Error resuming: ${error}`)
    }
  }

  const checkJobStatus = async (jobId: string) => {
    try {
      const response = await fetch(`/api/progress/${jobId}`)
      const data = await response.json()

      if (data.success && data.progress) {
        setCurrentJob((prev) =>
          prev
            ? {
                ...prev,
                progress: data.progress.percentage,
                processedFiles: data.progress.processedFiles,
                filteredFiles: data.progress.filteredFiles,
                movedFiles: data.progress.movedFiles,
                status: data.progress.status,
              }
            : null,
        )

        if (data.progress.status === "completed") {
          setIsProcessing(false)
          setIsPaused(false)
          addLog("✅ Processing completed successfully!")
          loadHistory()
        } else if (data.progress.status === "error") {
          setIsProcessing(false)
          setIsPaused(false)
          addLog("❌ Processing failed with errors")
          loadHistory()
        }
      }
    } catch (error) {
      console.error("Error checking job status:", error)
    }
  }

  const downloadResults = async () => {
    if (!currentJob) return

    try {
      const response = await fetch(`/api/download?file=${encodeURIComponent(currentJob.outputFile)}`)
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = currentJob.outputFile
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        addLog("📥 Results downloaded successfully")
      } else {
        addLog("❌ Failed to download results")
      }
    } catch (error) {
      addLog(`❌ Error downloading results: ${error}`)
    }
  }

  // Watcher functions
  const startWatcher = async () => {
    if (!watcherRootDir.trim()) {
      addLog("❌ Please select a directory to watch")
      return
    }

    try {
      addLog("🔍 Starting file watcher...")

      const response = await fetch("/api/watch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir: watcherRootDir.trim(),
          outputFile: watcherOutputFile.trim() || "watched_images.csv",
          numWorkers: 1,
          verbose: watcherVerbose,
          filterConfig,
        }),
      })

      const data = await response.json()

      if (data.success) {
        addLog(`✅ File watcher started successfully`)
        addLog(`👀 Watching: ${data.watchingPath}`)
        addLog(`📄 Output: ${data.outputFile}`)
        addLog(`🔗 Looking for XML-Image pairs...`)
        checkWatcherStatus()
      } else {
        addLog(`❌ Failed to start watcher: ${data.error}`)
      }
    } catch (error) {
      addLog(`❌ Error starting watcher: ${error}`)
    }
  }

  const stopWatcher = async () => {
    try {
      const response = await fetch("/api/watch/stop", {
        method: "POST",
      })

      const data = await response.json()

      if (data.success) {
        setWatcherStatus(null)
        addLog("🛑 File watcher stopped")
      } else {
        addLog(`❌ Failed to stop watcher: ${data.error}`)
      }
    } catch (error) {
      addLog(`❌ Error stopping watcher: ${error}`)
    }
  }

  const checkWatcherStatus = async () => {
    try {
      const response = await fetch("/api/watch/status")
      const data = await response.json()

      if (data.success) {
        setWatcherStatus(data.status)
      }
    } catch (error) {
      console.error("Error checking watcher status:", error)
    }
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }

  const resetJob = () => {
    setCurrentJob(null)
    setIsProcessing(false)
    setIsPaused(false)
    addLog("🔄 Job reset")
  }

  const clearLogs = () => {
    setLogs([])
  }

  const handleFilterChange = (key: string, value: any) => {
    setFilterConfig((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleTextFilterChange = (filterName: string, field: string, value: string) => {
    setFilterConfig((prev) => ({
      ...prev,
      [filterName]: {
        ...prev[filterName as keyof typeof prev],
        [field]: value,
      },
    }))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-gray-900">XML to CSV Converter</h1>
          <p className="text-gray-600">Process XML files and extract image metadata with advanced filtering</p>
        </div>

        <Tabs defaultValue="batch" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="batch" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Batch Processing
            </TabsTrigger>
            <TabsTrigger value="watcher" className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              File Watcher
            </TabsTrigger>
            <TabsTrigger value="filters" className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filters & Settings
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              History & Logs
            </TabsTrigger>
          </TabsList>

          {/* Batch Processing Tab */}
          <TabsContent value="batch" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Input Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Configuration
                  </CardTitle>
                  <CardDescription>Configure your XML processing settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="rootDir">Root Directory</Label>
                    <Input
                      id="rootDir"
                      placeholder="/path/to/xml/files"
                      value={rootDir}
                      onChange={(e) => setRootDir(e.target.value)}
                      disabled={isProcessing}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="outputFile">Output CSV File</Label>
                    <Input
                      id="outputFile"
                      placeholder="image_metadata.csv"
                      value={outputFile}
                      onChange={(e) => setOutputFile(e.target.value)}
                      disabled={isProcessing}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="numWorkers">Number of Workers: {numWorkers}</Label>
                    <Slider
                      id="numWorkers"
                      min={1}
                      max={8}
                      step={1}
                      value={[numWorkers]}
                      onValueChange={(value) => setNumWorkers(value[0])}
                      disabled={isProcessing}
                      className="w-full"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch id="verbose" checked={verbose} onCheckedChange={setVerbose} disabled={isProcessing} />
                    <Label htmlFor="verbose">Verbose Logging</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch id="showAdvanced" checked={showAdvanced} onCheckedChange={setShowAdvanced} />
                    <Label htmlFor="showAdvanced">Show Advanced Options</Label>
                  </div>

                  {showAdvanced && (
                    <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium">Advanced Settings</h4>
                      <div className="space-y-2">
                        <Label>Processing Mode</Label>
                        <Select defaultValue="standard">
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="chunked">Chunked Processing</SelectItem>
                            <SelectItem value="stream">Stream Processing</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Processing Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    Processing Status
                  </CardTitle>
                  <CardDescription>Monitor your current processing job</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentJob ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Progress</span>
                          <span>{Math.round(currentJob.progress)}%</span>
                        </div>
                        <Progress value={currentJob.progress} className="w-full" />
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span>Total Files:</span>
                            <Badge variant="outline">{currentJob.totalFiles}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Processed:</span>
                            <Badge variant="default">{currentJob.processedFiles}</Badge>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span>Filtered:</span>
                            <Badge variant="secondary">{currentJob.filteredFiles}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Moved:</span>
                            <Badge variant="destructive">{currentJob.movedFiles}</Badge>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            currentJob.status === "running"
                              ? "bg-green-500 animate-pulse"
                              : currentJob.status === "paused"
                                ? "bg-yellow-500"
                                : currentJob.status === "completed"
                                  ? "bg-blue-500"
                                  : "bg-red-500"
                          }`}
                        />
                        <span className="text-sm font-medium capitalize">{currentJob.status}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No active processing job</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Control Buttons */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-3">
                  {!isProcessing ? (
                    <Button onClick={startProcessing} className="flex items-center gap-2">
                      <Play className="w-4 h-4" />
                      Start Processing
                    </Button>
                  ) : (
                    <>
                      {!isPaused ? (
                        <Button
                          onClick={pauseProcessing}
                          variant="outline"
                          className="flex items-center gap-2 bg-transparent"
                        >
                          <Pause className="w-4 h-4" />
                          Pause
                        </Button>
                      ) : (
                        <Button onClick={resumeProcessing} className="flex items-center gap-2">
                          <Play className="w-4 h-4" />
                          Resume
                        </Button>
                      )}
                    </>
                  )}

                  <Button
                    onClick={resetJob}
                    variant="outline"
                    disabled={isProcessing && !isPaused}
                    className="flex items-center gap-2 bg-transparent"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset
                  </Button>

                  <Button
                    onClick={downloadResults}
                    variant="outline"
                    disabled={!currentJob || currentJob.status !== "completed"}
                    className="flex items-center gap-2 bg-transparent"
                  >
                    <Download className="w-4 h-4" />
                    Download Results
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* File Watcher Tab */}
          <TabsContent value="watcher" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Watcher Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="w-5 h-5" />
                    File Watcher Configuration
                  </CardTitle>
                  <CardDescription>
                    Monitor a directory for new XML-Image pairs and process them automatically
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="watcherRootDir">Directory to Watch</Label>
                    <Input
                      id="watcherRootDir"
                      placeholder="/path/to/watch/directory"
                      value={watcherRootDir}
                      onChange={(e) => setWatcherRootDir(e.target.value)}
                      disabled={watcherStatus?.isWatching}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="watcherOutputFile">Output CSV File</Label>
                    <Input
                      id="watcherOutputFile"
                      placeholder="watched_images.csv"
                      value={watcherOutputFile}
                      onChange={(e) => setWatcherOutputFile(e.target.value)}
                      disabled={watcherStatus?.isWatching}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="watcherVerbose"
                      checked={watcherVerbose}
                      onCheckedChange={setWatcherVerbose}
                      disabled={watcherStatus?.isWatching}
                    />
                    <Label htmlFor="watcherVerbose">Verbose Logging</Label>
                  </div>

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      The watcher looks for XML-Image pairs with matching base names. Both files must be present before
                      processing begins.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              {/* Watcher Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    Watcher Status
                  </CardTitle>
                  <CardDescription>Monitor file watcher activity and statistics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {watcherStatus?.isWatching ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-sm font-medium">Watching Active</span>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Uptime:</span>
                          <Badge variant="outline">{formatDuration(watcherStatus.uptime)}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>XML Files Detected:</span>
                          <Badge variant="default">{watcherStatus.stats.xmlFilesDetected}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Image Files Detected:</span>
                          <Badge variant="default">{watcherStatus.stats.imageFilesDetected}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Pairs Processed:</span>
                          <Badge variant="secondary">{watcherStatus.stats.pairsProcessed}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Pending Pairs:</span>
                          <Badge variant="outline">{watcherStatus.pendingPairs}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Files Moved:</span>
                          <Badge variant="destructive">{watcherStatus.stats.filesMoved}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Errors:</span>
                          <Badge variant="destructive">{watcherStatus.stats.filesErrored}</Badge>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <EyeOff className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>File watcher is not active</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Watcher Control Buttons */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-3">
                  {!watcherStatus?.isWatching ? (
                    <Button onClick={startWatcher} className="flex items-center gap-2">
                      <PlayCircle className="w-4 h-4" />
                      Start Watcher
                    </Button>
                  ) : (
                    <Button onClick={stopWatcher} variant="destructive" className="flex items-center gap-2">
                      <StopCircle className="w-4 h-4" />
                      Stop Watcher
                    </Button>
                  )}

                  <Button
                    onClick={checkWatcherStatus}
                    variant="outline"
                    className="flex items-center gap-2 bg-transparent"
                  >
                    <Activity className="w-4 h-4" />
                    Refresh Status
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Filters & Settings Tab */}
          <TabsContent value="filters" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="w-5 h-5" />
                  Filter Configuration
                </CardTitle>
                <CardDescription>Configure filters to process only specific images</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="filtersEnabled"
                    checked={filterConfig.enabled}
                    onCheckedChange={(checked) => handleFilterChange("enabled", checked)}
                  />
                  <Label htmlFor="filtersEnabled">Enable Filters</Label>
                </div>

                {filterConfig.enabled && (
                  <div className="space-y-6 p-4 bg-gray-50 rounded-lg">
                    {/* File Type Filters */}
                    <div className="space-y-3">
                      <Label className="text-base font-medium">File Type Filters</Label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {["jpg", "jpeg", "png", "tiff", "bmp", "gif", "webp"].map((type) => (
                          <div key={type} className="flex items-center space-x-2">
                            <Checkbox
                              id={type}
                              checked={filterConfig.allowedFileTypes.includes(type)}
                              onCheckedChange={(checked) => {
                                const newTypes = checked
                                  ? [...filterConfig.allowedFileTypes, type]
                                  : filterConfig.allowedFileTypes.filter((t) => t !== type)
                                handleFilterChange("allowedFileTypes", newTypes)
                              }}
                            />
                            <Label htmlFor={type} className="text-sm">
                              .{type}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Dimension Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="minWidth">Minimum Width: {filterConfig.minWidth}px</Label>
                        <Slider
                          id="minWidth"
                          min={0}
                          max={5000}
                          step={50}
                          value={[filterConfig.minWidth]}
                          onValueChange={(value) => handleFilterChange("minWidth", value[0])}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="minHeight">Minimum Height: {filterConfig.minHeight}px</Label>
                        <Slider
                          id="minHeight"
                          min={0}
                          max={5000}
                          step={50}
                          value={[filterConfig.minHeight]}
                          onValueChange={(value) => handleFilterChange("minHeight", value[0])}
                        />
                      </div>
                    </div>

                    {/* File Size Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="minFileSize">
                          Min File Size: {Math.round(filterConfig.minFileSize / 1024)}KB
                        </Label>
                        <Slider
                          id="minFileSize"
                          min={0}
                          max={10485760}
                          step={51200}
                          value={[filterConfig.minFileSize]}
                          onValueChange={(value) => handleFilterChange("minFileSize", value[0])}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxFileSize">
                          Max File Size:{" "}
                          {filterConfig.maxFileSize === 0
                            ? "No limit"
                            : Math.round(filterConfig.maxFileSize / 1024) + "KB"}
                        </Label>
                        <Slider
                          id="maxFileSize"
                          min={0}
                          max={104857600}
                          step={1048576}
                          value={[filterConfig.maxFileSize]}
                          onValueChange={(value) => handleFilterChange("maxFileSize", value[0])}
                        />
                      </div>
                    </div>

                    {/* Text Filters */}
                    <div className="space-y-4">
                      <Label className="text-base font-medium">Text Filters</Label>
                      {[
                        { key: "creditLine", label: "Credit Line" },
                        { key: "copyright", label: "Copyright" },
                        { key: "usageType", label: "Usage Type" },
                        { key: "rightsHolder", label: "Rights Holder" },
                        { key: "location", label: "Location" },
                      ].map(({ key, label }) => (
                        <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                          <div className="space-y-1">
                            <Label className="text-sm">{label}</Label>
                            <Select
                              value={filterConfig[key as keyof typeof filterConfig]?.operator || "none"}
                              onValueChange={(value) => handleTextFilterChange(key, "operator", value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select operator" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No filter</SelectItem>
                                <SelectItem value="like">Contains</SelectItem>
                                <SelectItem value="notLike">Does not contain</SelectItem>
                                <SelectItem value="equals">Equals</SelectItem>
                                <SelectItem value="notEquals">Does not equal</SelectItem>
                                <SelectItem value="startsWith">Starts with</SelectItem>
                                <SelectItem value="endsWith">Ends with</SelectItem>
                                <SelectItem value="notBlank">Is not blank</SelectItem>
                                <SelectItem value="isBlank">Is blank</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="md:col-span-2">
                            <Input
                              placeholder="Filter value"
                              value={filterConfig[key as keyof typeof filterConfig]?.value || ""}
                              onChange={(e) => handleTextFilterChange(key, "value", e.target.value)}
                              disabled={filterConfig[key as keyof typeof filterConfig]?.operator === "none"}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Image Moving Options */}
                    <div className="space-y-4 p-4 bg-white rounded-lg border">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="moveImages"
                          checked={filterConfig.moveImages}
                          onCheckedChange={(checked) => handleFilterChange("moveImages", checked)}
                        />
                        <Label htmlFor="moveImages" className="font-medium">
                          Move Filtered Images
                        </Label>
                      </div>

                      {filterConfig.moveImages && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="moveDestination">Destination Directory</Label>
                            <Input
                              id="moveDestination"
                              placeholder="/path/to/destination"
                              value={filterConfig.moveDestinationPath}
                              onChange={(e) => handleFilterChange("moveDestinationPath", e.target.value)}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Folder Structure</Label>
                            <RadioGroup
                              value={filterConfig.moveFolderStructureOption}
                              onValueChange={(value) => handleFilterChange("moveFolderStructureOption", value)}
                            >
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="flat" id="flat" />
                                <Label htmlFor="flat">Flat (all images in one folder)</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="replicate" id="replicate" />
                                <Label htmlFor="replicate">Replicate original structure</Label>
                              </div>
                            </RadioGroup>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* History & Logs Tab */}
          <TabsContent value="history" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Processing History */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Processing History
                  </CardTitle>
                  <CardDescription>View your recent processing sessions</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64">
                    {!Array.isArray(history) || history.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No processing history available</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {history.map((entry, index) => (
                          <div key={index} className="p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <Badge
                                variant={
                                  entry.status === "completed"
                                    ? "default"
                                    : entry.status === "error"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {entry.status}
                              </Badge>
                              <span className="text-xs text-gray-500">
                                {new Date(entry.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sm space-y-1">
                              <div className="flex justify-between">
                                <span>Files:</span>
                                <span>
                                  {entry.processedFiles}/{entry.totalFiles}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Duration:</span>
                                <span>{formatDuration(entry.duration)}</span>
                              </div>
                              <div className="text-xs text-gray-600 truncate">{entry.rootDir}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Live Logs */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Live Logs
                  </CardTitle>
                  <CardDescription>Real-time processing logs and status updates</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Badge variant="outline">{logs.length} entries</Badge>
                      <Button onClick={clearLogs} variant="outline" size="sm">
                        Clear Logs
                      </Button>
                    </div>
                    <ScrollArea className="h-64 w-full border rounded-md p-3 bg-gray-50 font-mono text-xs">
                      {logs.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p>No logs available</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {logs.map((log, index) => (
                            <div key={index} className="text-gray-700">
                              {log}
                            </div>
                          ))}
                          <div ref={logsEndRef} />
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
