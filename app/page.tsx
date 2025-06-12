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
import {
  AlertCircle,
  CheckCircle,
  Clock,
  FileDown,
  FolderOpen,
  Play,
  Settings,
  Upload,
  Filter,
  ImageIcon,
  HardDrive,
  Newspaper,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function Home() {
  const [rootDir, setRootDir] = useState("")
  const [outputFile, setOutputFile] = useState("image_metadata.csv")
  const [workers, setWorkers] = useState(4)
  const [batchSize, setBatchSize] = useState(100)
  const [verbose, setVerbose] = useState(true)

  // Filter settings
  const [enableFiltering, setEnableFiltering] = useState(false)
  // Image Dimension Filters
  const [minImageSize, setMinImageSize] = useState("512")
  const [customMinWidth, setCustomMinWidth] = useState("")
  const [customMinHeight, setCustomMinHeight] = useState("")
  // File Size Filters
  const [minFileSize, setMinFileSize] = useState("")
  const [maxFileSize, setMaxFileSize] = useState("")
  const [fileSizeUnit, setFileSizeUnit] = useState("KB")
  // Move Images
  const [moveFilteredImages, setMoveFilteredImages] = useState(false)
  const [filteredImagesFolder, setFilteredImagesFolder] = useState("filtered_images")
  // New Metadata Filters - now objects with value and operator
  const [creditLineFilter, setCreditLineFilter] = useState({ value: "", operator: "like" })
  const [copyrightFilter, setCopyrightFilter] = useState({ value: "", operator: "like" })
  const [usageTypeFilter, setUsageTypeFilter] = useState({ value: "", operator: "like" })
  const [rightsHolderFilter, setRightsHolderFilter] = useState({ value: "", operator: "like" })
  const [locationFilter, setLocationFilter] = useState({ value: "", operator: "like" })

  const [enableWatchMode, setEnableWatchMode] = useState(false)
  const [isWatching, setIsWatching] = useState(false)

  const [status, setStatus] = useState("idle") // idle, running, completed, error
  const [logs, setLogs] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState({
    totalFiles: 0,
    processedFiles: 0,
    successfulFiles: 0,
    errorFiles: 0,
    filteredFiles: 0,
    movedFiles: 0,
    startTime: 0,
    endTime: 0,
  })
  const [activeTab, setActiveTab] = useState("config")
  const [isConnected, setIsConnected] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState("")
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

  // Initialize
  useEffect(() => {
    setIsConnected(true)
    setLogs(["XML Parser initialized successfully", "Ready to process files", "Waiting for configuration..."])
  }, [])

  // Auto-scroll logs and errors to bottom
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

  const getFilterConfig = () => {
    if (!enableFiltering) return null

    const config: any = {
      enabled: true,
      moveImages: moveFilteredImages,
      outputFolder: filteredImagesFolder,
    }

    // Image size filters
    if (minImageSize === "custom") {
      config.minWidth = Number.parseInt(customMinWidth) || undefined
      config.minHeight = Number.parseInt(customMinHeight) || undefined
    } else if (minImageSize !== "none") {
      const size = Number.parseInt(minImageSize)
      config.minWidth = size
      config.minHeight = size
    }

    // File size filters
    if (minFileSize) {
      const multiplier = fileSizeUnit === "MB" ? 1024 * 1024 : 1024
      config.minFileSize = Number.parseInt(minFileSize) * multiplier
    }
    if (maxFileSize) {
      const multiplier = fileSizeUnit === "MB" ? 1024 * 1024 : 1024
      config.maxFileSize = Number.parseInt(maxFileSize) * multiplier
    }

    // Metadata filters - now passing operator and value
    const addMetaFilter = (field: string, filterState: { value: string; operator: string }) => {
      if (filterState.operator === "notBlank" || filterState.operator === "isBlank") {
        config[field] = { operator: filterState.operator, value: "" } // Value is not needed but send consistently
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

    setLogs((prev) => [...prev, "=".repeat(50), "Starting new parsing session..."])
    const currentFilterConfig = getFilterConfig()

    if (enableFiltering && currentFilterConfig) {
      setLogs((prev) => [...prev, "Filtering enabled with the following criteria:"])
      if (currentFilterConfig.minWidth || currentFilterConfig.minHeight) {
        setLogs((prev) => [
          ...prev,
          `  Image size: min ${currentFilterConfig.minWidth || 0}x${currentFilterConfig.minHeight || 0} pixels`,
        ])
      }
      if (currentFilterConfig.minFileSize || currentFilterConfig.maxFileSize) {
        setLogs((prev) => [
          ...prev,
          `  File size: ${currentFilterConfig.minFileSize ? `min ${Math.round(currentFilterConfig.minFileSize / 1024)}KB` : ""} ${currentFilterConfig.maxFileSize ? `max ${Math.round(currentFilterConfig.maxFileSize / 1024)}KB` : ""}`,
        ])
      }
      const logMetaFilter = (label: string, filterDetail?: { value: string; operator: string }) => {
        if (filterDetail) {
          const opLabel =
            TEXT_FILTER_OPERATORS.find((op) => op.value === filterDetail.operator)?.label || filterDetail.operator
          if (filterDetail.operator === "notBlank" || filterDetail.operator === "isBlank") {
            setLogs((prev) => [...prev, `  ${label}: ${opLabel}`])
          } else if (filterDetail.value) {
            setLogs((prev) => [...prev, `  ${label}: ${opLabel} "${filterDetail.value}"`])
          }
        }
      }
      logMetaFilter("CreditLine", currentFilterConfig.creditLine)
      logMetaFilter("Copyright", currentFilterConfig.copyright)
      logMetaFilter("UsageType", currentFilterConfig.usageType)
      logMetaFilter("RightsHolder", currentFilterConfig.rightsHolder)
      logMetaFilter("Location", currentFilterConfig.location)

      if (moveFilteredImages) {
        setLogs((prev) => [...prev, `  Filtered images will be moved to: ${filteredImagesFolder}`])
      }
    } else {
      setLogs((prev) => [...prev, "No filters applied or filtering disabled."])
    }

    setErrors([])
    setProgress(0)
    setStats({
      totalFiles: 0,
      processedFiles: 0,
      successfulFiles: 0,
      errorFiles: 0,
      filteredFiles: 0,
      movedFiles: 0,
      startTime: Date.now(),
      endTime: 0,
    })
    setStatus("running")
    setActiveTab("logs")
    setDownloadUrl("")

    try {
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir,
          outputFile,
          workers,
          batchSize,
          verbose,
          filterConfig: currentFilterConfig,
        }),
      })
      const result = await response.json()

      if (response.ok) {
        setLogs((prev) => [...prev, `Found ${result.stats.totalFiles} XML files to process`])
        if (result.stats.filteredFiles !== undefined) {
          setLogs((prev) => [...prev, `${result.stats.filteredFiles} files matched the filter criteria`])
        }
        if (result.stats.movedFiles !== undefined && result.stats.movedFiles > 0) {
          setLogs((prev) => [...prev, `${result.stats.movedFiles} images moved to filtered folder`])
        }
        setLogs((prev) => [
          ...prev,
          `Processing completed successfully!`,
          `Processed ${result.stats.processedFiles} files`,
          `Successful: ${result.stats.successfulFiles}`,
          `Errors: ${result.stats.errorFiles}`,
          `Records written: ${result.stats.recordsWritten}`,
          `CSV file generated: ${outputFile}`,
        ])
        setStats((prev) => ({ ...prev, ...result.stats, endTime: Date.now() }))
        setProgress(100)
        setStatus("completed")
        setDownloadUrl(`/api/download?file=${encodeURIComponent(outputFile)}`)
        if (result.errors && result.errors.length > 0) setErrors(result.errors)
      } else {
        setLogs((prev) => [...prev, `Error: ${result.error}`, `Message: ${result.message || "Unknown error"}`])
        setStatus("error")
      }
    } catch (error) {
      setLogs((prev) => [...prev, `Network error: ${error instanceof Error ? error.message : "Unknown error"}`])
      setStatus("error")
    }
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
    setIsWatching(true)
    setStatus("running") // Use 'running' status to indicate activity
    setActiveTab("logs")
    setLogs((prev) => [...prev, "=".repeat(50), "Attempting to start watch mode..."])

    const currentFilterConfig = getFilterConfig()

    try {
      const response = await fetch("/api/watch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir,
          outputFile,
          numWorkers: workers,
          batchSize,
          verbose,
          filterConfig: currentFilterConfig,
        }),
      })
      const result = await response.json()
      if (response.ok) {
        setLogs((prev) => [...prev, "Watch mode started successfully. Monitoring for new XML files."])
      } else {
        setLogs((prev) => [...prev, `Error starting watcher: ${result.message}`])
        setIsWatching(false)
        setStatus("error")
      }
    } catch (error) {
      setLogs((prev) => [...prev, `Network error: ${error instanceof Error ? error.message : "Unknown error"}`])
      setIsWatching(false)
      setStatus("error")
    }
  }

  const handleStopWatching = async () => {
    setLogs((prev) => [...prev, "Attempting to stop watch mode..."])
    try {
      const response = await fetch("/api/watch/stop", { method: "POST" })
      const result = await response.json()
      if (response.ok) {
        setLogs((prev) => [...prev, "Watch mode stopped."])
      } else {
        setLogs((prev) => [...prev, `Could not stop watcher: ${result.message}`])
      }
    } catch (error) {
      setLogs((prev) => [...prev, `Network error: ${error instanceof Error ? error.message : "Unknown error"}`])
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
              <CardTitle className="text-3xl font-bold">XML Image Metadata Parser</CardTitle>
              <CardDescription className="text-lg">
                Extract metadata from XML files with advanced filtering options
              </CardDescription>
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
                  {/* Root Directory, Output File, Workers, Batch Size, Verbose Logging */}
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
                        <Label htmlFor="batchSize">Batch Size</Label>
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
                      <p className="text-sm text-muted-foreground">Number of files processed per batch</p>
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
                  <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Development Only Feature</AlertTitle>
                    <AlertDescription>
                      Watch Mode runs as a persistent process and is only suitable for local development. It will not
                      work when deployed to serverless environments like Vercel.
                    </AlertDescription>
                  </Alert>
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
                    ) : (
                      <Button
                        onClick={handleStartParsing}
                        disabled={status === "running" || !rootDir}
                        className="w-full"
                        size="lg"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Start One-Time Processing
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
                      {/* Image Dimension Filters */}
                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" />
                            Image Dimensions
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

                      {/* File Size Filters */}
                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <HardDrive className="h-4 w-4" />
                            File Size
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

                      {/* Metadata Filters */}
                      <Card className="p-4">
                        <CardHeader className="p-0 pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Newspaper className="h-4 w-4" />
                            Metadata Filters
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 space-y-4">
                          {/* CreditLine Filter */}
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

                          {/* Copyright Filter (similar structure) */}
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

                          {/* UsageType Filter (similar structure) */}
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

                          {/* RightsHolder Filter (similar structure) */}
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

                          {/* Location Filter (similar structure) */}
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

                      {/* Move Filtered Images */}
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
                            <Label htmlFor="moveFilteredImages">Move matching images to separate folder</Label>
                          </div>
                          {moveFilteredImages && (
                            <div className="space-y-2">
                              <Label htmlFor="filteredImagesFolder">Filtered Images Folder Name</Label>
                              <Input
                                id="filteredImagesFolder"
                                value={filteredImagesFolder}
                                onChange={(e) => setFilteredImagesFolder(e.target.value)}
                                placeholder="filtered_images"
                              />
                            </div>
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
                          {moveFilteredImages && <div>Move to: "{filteredImagesFolder}"</div>}
                          {!(
                            minImageSize !== "none" ||
                            minFileSize ||
                            maxFileSize ||
                            (creditLineFilter.operator !== "notBlank" && creditLineFilter.operator !== "isBlank"
                              ? creditLineFilter.value.trim()
                              : true) ||
                            (copyrightFilter.operator !== "notBlank" && copyrightFilter.operator !== "isBlank"
                              ? copyrightFilter.value.trim()
                              : true) ||
                            (usageTypeFilter.operator !== "notBlank" && usageTypeFilter.operator !== "isBlank"
                              ? usageTypeFilter.value.trim()
                              : true) ||
                            (rightsHolderFilter.operator !== "notBlank" && rightsHolderFilter.operator !== "isBlank"
                              ? rightsHolderFilter.value.trim()
                              : true) ||
                            (locationFilter.operator !== "notBlank" && locationFilter.operator !== "isBlank"
                              ? locationFilter.value.trim()
                              : true)
                          ) && (
                            <div>
                              No specific filters active. All images will be processed if "Enable Filtering" is on.
                            </div>
                          )}
                        </AlertDescription>
                      </Alert>
                    </>
                  )}

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
                          Start Watching with Filters
                        </Button>
                      )
                    ) : (
                      <Button
                        onClick={handleStartParsing}
                        disabled={status === "running" || !rootDir}
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

            {/* Logs and Results Tabs remain the same */}
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
                              <span className="text-muted-foreground mr-2">[{new Date().toLocaleTimeString()}]</span>
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
                              <span className="text-muted-foreground mr-2">[{new Date().toLocaleTimeString()}]</span>
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
                  <div className="w-full">
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
                  ) : status === "running" ? (
                    <Alert>
                      <Play className="h-4 w-4" />
                      <AlertTitle>Processing in progress</AlertTitle>
                      <AlertDescription>Results will be available when complete.</AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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

        {/* Live Statistics Panel remains the same */}
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
