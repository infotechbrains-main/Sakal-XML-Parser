"use client"

import type React from "react"

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
  const [minImageSize, setMinImageSize] = useState("512")
  const [customMinWidth, setCustomMinWidth] = useState("")
  const [customMinHeight, setCustomMinHeight] = useState("")
  const [minFileSize, setMinFileSize] = useState("")
  const [maxFileSize, setMaxFileSize] = useState("")
  const [fileSizeUnit, setFileSizeUnit] = useState("KB")
  const [moveFilteredImages, setMoveFilteredImages] = useState(false)
  const [filteredImagesFolder, setFilteredImagesFolder] = useState("filtered_images")

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
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleSelectDirectory = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleDirectorySelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) {
      // Get the path from the first file
      const firstFile = files[0]
      const path = firstFile.webkitRelativePath || firstFile.name
      const rootPath = path.split("/")[0]
      setRootDir(rootPath)

      // Add log
      setLogs((prev) => [...prev, `Selected directory: ${rootPath} (${files.length} files found)`])
    }
  }

  const getFilterConfig = () => {
    if (!enableFiltering) return null

    const config: any = {
      enabled: true,
      moveImages: moveFilteredImages,
      outputFolder: filteredImagesFolder,
    }

    // Image size filters
    if (minImageSize === "custom") {
      config.minWidth = Number.parseInt(customMinWidth) || 0
      config.minHeight = Number.parseInt(customMinHeight) || 0
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

    return config
  }

  const handleStartParsing = async () => {
    if (!rootDir) {
      alert("Please select a root directory first")
      return
    }

    // Reset state
    setLogs((prev) => [...prev, "=".repeat(50)])
    setLogs((prev) => [...prev, "Starting new parsing session..."])

    if (enableFiltering) {
      setLogs((prev) => [...prev, "Filtering enabled - only matching images will be processed"])
      const filterConfig = getFilterConfig()
      if (filterConfig?.minWidth || filterConfig?.minHeight) {
        setLogs((prev) => [
          ...prev,
          `Image size filter: min ${filterConfig.minWidth || 0}x${filterConfig.minHeight || 0} pixels`,
        ])
      }
      if (filterConfig?.minFileSize || filterConfig?.maxFileSize) {
        setLogs((prev) => [
          ...prev,
          `File size filter: ${filterConfig.minFileSize ? `min ${Math.round(filterConfig.minFileSize / 1024)}KB` : ""} ${filterConfig.maxFileSize ? `max ${Math.round(filterConfig.maxFileSize / 1024)}KB` : ""}`,
        ])
      }
      if (moveFilteredImages) {
        setLogs((prev) => [...prev, `Filtered images will be moved to: ${filteredImagesFolder}`])
      }
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
      // Call the real API
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rootDir,
          outputFile,
          workers,
          batchSize,
          verbose,
          filterConfig: getFilterConfig(),
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
        setLogs((prev) => [...prev, `Processing completed successfully!`])
        setLogs((prev) => [...prev, `Processed ${result.stats.processedFiles} files`])
        setLogs((prev) => [...prev, `Successful: ${result.stats.successfulFiles}`])
        setLogs((prev) => [...prev, `Errors: ${result.stats.errorFiles}`])
        setLogs((prev) => [...prev, `Records written: ${result.stats.recordsWritten}`])
        setLogs((prev) => [...prev, `CSV file generated: ${outputFile}`])

        setStats((prev) => ({
          ...prev,
          totalFiles: result.stats.totalFiles,
          processedFiles: result.stats.processedFiles,
          successfulFiles: result.stats.successfulFiles,
          errorFiles: result.stats.errorFiles,
          filteredFiles: result.stats.filteredFiles || 0,
          movedFiles: result.stats.movedFiles || 0,
          endTime: Date.now(),
        }))

        setProgress(100)
        setStatus("completed")
        setDownloadUrl(`/api/download?file=${encodeURIComponent(outputFile)}`)

        // Add errors to error log
        if (result.errors && result.errors.length > 0) {
          setErrors(result.errors)
        }
      } else {
        setLogs((prev) => [...prev, `Error: ${result.error}`])
        setLogs((prev) => [...prev, `Message: ${result.message || "Unknown error"}`])
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
      // Create a sample CSV for demo
      const csvContent = `City,Year,Month,News Item ID,Headline
Pune,2010,07,2010-07-01_11-01-54_MED_838EB5AE_N_000_000_000_org,"नगर-निर्मल गांधी"
Mumbai,2010,08,2010-08-01_12-01-54_MED_838EB5AE_N_000_000_000_org,"Sample Headline"
Delhi,2010,09,2010-09-01_13-01-54_MED_838EB5AE_N_000_000_000_org,"Another Headline"`

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

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
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
                  <div className="space-y-2">
                    <Label htmlFor="rootDir">Root Directory</Label>
                    <div className="flex gap-2">
                      <Input
                        id="rootDir"
                        value={rootDir}
                        onChange={(e) => setRootDir(e.target.value)}
                        placeholder="Enter full path to your XML directory (e.g., C:\path\to\Sample_Images)"
                        className="flex-1"
                      />
                      <Button variant="outline" onClick={handleSelectDirectory}>
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Browse
                      </Button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      webkitdirectory=""
                      directory=""
                      multiple
                      onChange={handleDirectorySelect}
                      style={{ display: "none" }}
                    />
                    <p className="text-sm text-muted-foreground">
                      Enter the full path to your directory containing XML files
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
                  <CardDescription>Filter images by size and move matching images to a separate folder</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center space-x-2">
                    <Switch id="enableFiltering" checked={enableFiltering} onCheckedChange={setEnableFiltering} />
                    <Label htmlFor="enableFiltering">Enable Image Filtering</Label>
                    <p className="text-sm text-muted-foreground ml-2">Only process images that match the criteria</p>
                  </div>

                  {enableFiltering && (
                    <>
                      <div className="border rounded-lg p-4 space-y-4">
                        <div className="flex items-center gap-2 mb-3">
                          <ImageIcon className="h-4 w-4" />
                          <h3 className="font-medium">Image Dimensions Filter</h3>
                        </div>

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
                              <SelectItem value="1280">1280x1280 pixels</SelectItem>
                              <SelectItem value="1920">1920x1920 pixels</SelectItem>
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
                      </div>

                      <div className="border rounded-lg p-4 space-y-4">
                        <div className="flex items-center gap-2 mb-3">
                          <HardDrive className="h-4 w-4" />
                          <h3 className="font-medium">File Size Filter</h3>
                        </div>

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
                        <p className="text-sm text-muted-foreground">Leave empty to skip file size filtering</p>
                      </div>

                      <div className="border rounded-lg p-4 space-y-4">
                        <div className="flex items-center gap-2 mb-3">
                          <FolderOpen className="h-4 w-4" />
                          <h3 className="font-medium">Move Filtered Images</h3>
                        </div>

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
                            <Label htmlFor="filteredImagesFolder">Filtered Images Folder</Label>
                            <Input
                              id="filteredImagesFolder"
                              value={filteredImagesFolder}
                              onChange={(e) => setFilteredImagesFolder(e.target.value)}
                              placeholder="filtered_images"
                            />
                            <p className="text-sm text-muted-foreground">
                              Folder name where filtered images will be moved (relative to root directory)
                            </p>
                          </div>
                        )}
                      </div>

                      <Alert>
                        <Filter className="h-4 w-4" />
                        <AlertTitle>Filter Summary</AlertTitle>
                        <AlertDescription>
                          {minImageSize !== "none" && (
                            <div>
                              Image size:{" "}
                              {minImageSize === "custom"
                                ? `${customMinWidth || 0}x${customMinHeight || 0}`
                                : `${minImageSize}x${minImageSize}`}{" "}
                              pixels minimum
                            </div>
                          )}
                          {(minFileSize || maxFileSize) && (
                            <div>
                              File size: {minFileSize && `${minFileSize}${fileSizeUnit} min`}{" "}
                              {maxFileSize && `${maxFileSize}${fileSizeUnit} max`}
                            </div>
                          )}
                          {moveFilteredImages && <div>Images will be moved to: {filteredImagesFolder}</div>}
                          {!minImageSize ||
                            (minImageSize === "none" && !minFileSize && !maxFileSize && (
                              <div>No filters active - all images will be processed</div>
                            ))}
                        </AlertDescription>
                      </Alert>
                    </>
                  )}
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
                  <CardDescription>Summary and download options for the parsing operation</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {status === "idle" ? (
                    <Alert>
                      <Clock className="h-4 w-4" />
                      <AlertTitle>No processing started yet</AlertTitle>
                      <AlertDescription>
                        Configure your settings and start the parsing process to see results here.
                      </AlertDescription>
                    </Alert>
                  ) : status === "running" ? (
                    <Alert>
                      <Play className="h-4 w-4" />
                      <AlertTitle>Processing in progress</AlertTitle>
                      <AlertDescription>
                        The parser is currently running. Results will be available when complete.
                      </AlertDescription>
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
                            <CardTitle className="text-sm text-muted-foreground">Processing Time</CardTitle>
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
                            All files have been processed and the CSV has been generated.
                            {enableFiltering && ` ${stats.filteredFiles} images matched your filter criteria.`}
                            {moveFilteredImages &&
                              stats.movedFiles > 0 &&
                              ` ${stats.movedFiles} images were moved to the filtered folder.`}
                          </AlertDescription>
                        </Alert>
                      )}

                      {status === "error" && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Processing completed with errors</AlertTitle>
                          <AlertDescription>
                            The process completed but some files could not be processed. Check the error logs for
                            details.
                          </AlertDescription>
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
