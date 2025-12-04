"use client"

import { useState, useRef, useEffect, useMemo, useDeferredValue } from "react"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Toaster, toast } from "sonner"
import type { ConfigTemplate } from "@/lib/template-manager"

interface Message {
  type: string
  message: any
  timestamp?: string
}

interface ProcessingResultStats {
  totalFiles: number
  processedFiles: number
  successfulFiles: number
  errorFiles: number
  recordsWritten: number
  filteredFiles: number
  movedFiles: number
  moveFailures?: number
  totalMediaFiles?: number
  mediaFilesMatched?: number
  localMediaFilesMatched?: number
  remoteMediaFilesMatched?: number
  mediaFilesUnmatched?: number
  xmlFilesWithMedia?: number
  xmlFilesMissingMedia?: number
  xmlProcessedWithoutMedia?: number
  mediaCountsByExtension?: Record<string, number>
  noXmlImagesConsidered?: number
  noXmlImagesRecorded?: number
  noXmlImagesFilteredOut?: number
  noXmlImagesMoved?: number
  noXmlDestinationPath?: string
}

interface ProcessingStats {
  totalFiles: number
  processedFiles: number
  successCount: number
  errorCount: number
  filteredCount: number
  movedCount: number
  moveFailures: number
  totalMediaFiles: number
  mediaFilesMatched: number
  localMediaFilesMatched: number
  remoteMediaFilesMatched: number
  mediaFilesUnmatched: number
  xmlFilesWithMedia: number
  xmlFilesMissingMedia: number
  xmlProcessedWithoutMedia: number
  currentFile?: string
  estimatedTimeRemaining?: string
  noXmlImagesConsidered: number
  noXmlImagesRecorded: number
  noXmlImagesFilteredOut: number
  noXmlImagesMoved: number
  noXmlDestinationPath?: string
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
    mediaFilesTotal?: number
    mediaFilesMatched?: number
    mediaFilesUnmatched?: number
    xmlFilesWithMedia?: number
    xmlFilesMissingMedia?: number
    processedFilesList?: string[]
    noXmlImagesRecorded?: number
    noXmlImagesFilteredOut?: number
    moveFailures?: number
  }
  results?: {
    outputPath: string
    failureOutputPath?: string
    failureCount?: number
    failurePreview?: FailurePreviewEntry[]
    stats?: ProcessingResultStats
  }
}

interface ProcessingResults {
  stats: ProcessingResultStats
  outputFile: string
  errors: string[]
  processingTime?: string
  startTime?: string
  endTime?: string
  scanWarnings?: string[]
  failureOutputFile?: string
  failureCount?: number
  failurePreview?: FailurePreviewEntry[]
}

interface FailurePreviewEntry {
  imageHref: string
  imagePath: string
  xmlPath: string
  failureReason: string
  failureDetails?: string
  filterStatus?: string
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const DEFAULT_PROCESSING_STATS: ProcessingStats = {
  totalFiles: 0,
  processedFiles: 0,
  successCount: 0,
  errorCount: 0,
  filteredCount: 0,
  movedCount: 0,
  moveFailures: 0,
  totalMediaFiles: 0,
  mediaFilesMatched: 0,
  localMediaFilesMatched: 0,
  remoteMediaFilesMatched: 0,
  mediaFilesUnmatched: 0,
  xmlFilesWithMedia: 0,
  xmlFilesMissingMedia: 0,
  xmlProcessedWithoutMedia: 0,
  noXmlImagesConsidered: 0,
  noXmlImagesRecorded: 0,
  noXmlImagesFilteredOut: 0,
  noXmlImagesMoved: 0,
}

const MAX_LOG_ENTRIES = 500
const MAX_ERROR_LOG_ENTRIES = 200

const formatMetricValue = (value: number | string | undefined | null) => {
  if (value === undefined || value === null || value === "") {
    return "—"
  }
  return typeof value === "number" ? value.toLocaleString() : value
}

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return "—"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
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
  const [stats, setStats] = useState<ProcessingStats>({ ...DEFAULT_PROCESSING_STATS })

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
  const [logsAutoFollow, setLogsAutoFollow] = useState(true)

  // Template management
  const [templates, setTemplates] = useState<ConfigTemplate[]>([])
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [templateDescription, setTemplateDescription] = useState("")
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  const logsEndRef = useRef<HTMLDivElement>(null)
  const errorLogsEndRef = useRef<HTMLDivElement>(null)
  const ws = useRef<WebSocket | null>(null)
  const deferredMessages = useDeferredValue(messages)
  const deferredErrorMessages = useDeferredValue(errorMessages)

  const quickProcessingMetrics = useMemo(
    () => [
      { label: "Total Files", value: stats.totalFiles },
      { label: "Processed", value: stats.processedFiles },
      { label: "Success", value: stats.successCount, accentClass: "text-green-600" },
      { label: "Errors", value: stats.errorCount, accentClass: "text-red-600" },
      { label: "Filtered", value: stats.filteredCount },
      { label: "Moved", value: stats.movedCount },
      { label: "Move Failures", value: stats.moveFailures, accentClass: "text-red-600" },
    ],
    [stats],
  )

  const mediaQuickMetrics = useMemo(() => {
    const matchRate =
      stats.totalMediaFiles > 0
        ? `${((stats.mediaFilesMatched / stats.totalMediaFiles) * 100).toFixed(1)}%`
        : "—"

    return [
      { label: "Total Media", value: stats.totalMediaFiles },
      { label: "Matched", value: stats.mediaFilesMatched, accentClass: "text-green-600" },
      { label: "Local Matches", value: stats.localMediaFilesMatched },
      { label: "Remote Matches", value: stats.remoteMediaFilesMatched },
      { label: "Unmatched", value: stats.mediaFilesUnmatched, accentClass: "text-red-600" },
      { label: "Match Rate", value: matchRate },
    ]
  }, [stats])

  const xmlQuickMetrics = useMemo(
    () => [
      { label: "XML With Media", value: stats.xmlFilesWithMedia },
      { label: "XML Missing Media", value: stats.xmlFilesMissingMedia, accentClass: "text-yellow-600" },
      { label: "XML Without Media", value: stats.xmlProcessedWithoutMedia, accentClass: "text-red-600" },
    ],
    [stats],
  )

  const processingResultMetrics = useMemo(() => {
    if (!processingResults) {
      return []
    }

    const { stats: resultStats, processingTime } = processingResults

    return [
      { label: "Total Files", value: resultStats.totalFiles },
      { label: "Processed", value: resultStats.processedFiles },
      { label: "Success", value: resultStats.successfulFiles, accentClass: "text-green-600" },
      { label: "Errors", value: resultStats.errorFiles, accentClass: "text-red-600" },
      { label: "Records Written", value: resultStats.recordsWritten },
      { label: "Filtered", value: resultStats.filteredFiles },
      { label: "Moved", value: resultStats.movedFiles },
      {
        label: "Move Failures",
        value: resultStats.moveFailures ?? processingResults.failureCount ?? 0,
        accentClass: "text-red-600",
      },
      { label: "Duration", value: processingTime ?? "—" },
    ]
  }, [processingResults])

  const processingResultMediaMetrics = useMemo(() => {
    if (!processingResults) {
      return []
    }

    const { stats: resultStats } = processingResults
    const totalMedia = resultStats.totalMediaFiles ?? 0
    const matchedMedia = resultStats.mediaFilesMatched ?? 0
    const matchRate = totalMedia > 0 ? `${((matchedMedia / totalMedia) * 100).toFixed(1)}%` : "—"

    return [
      { label: "Total Media", value: resultStats.totalMediaFiles },
      { label: "Matched", value: resultStats.mediaFilesMatched, accentClass: "text-green-600" },
      { label: "Local Matches", value: resultStats.localMediaFilesMatched },
      { label: "Remote Matches", value: resultStats.remoteMediaFilesMatched },
      { label: "Unmatched", value: resultStats.mediaFilesUnmatched, accentClass: "text-red-600" },
      { label: "Match Rate", value: matchRate },
      { label: "XML With Media", value: resultStats.xmlFilesWithMedia },
      { label: "XML Missing Media", value: resultStats.xmlFilesMissingMedia, accentClass: "text-yellow-600" },
      { label: "XML Without Media", value: resultStats.xmlProcessedWithoutMedia, accentClass: "text-red-600" },
    ]
  }, [processingResults])

  const processingResultNoXmlMetrics = useMemo(() => {
    if (!processingResults) {
      return []
    }

    const { stats: resultStats } = processingResults

    const metrics = [
      { label: "No-XML Considered", value: resultStats.noXmlImagesConsidered },
      { label: "No-XML Recorded", value: resultStats.noXmlImagesRecorded, accentClass: "text-green-600" },
      { label: "No-XML Filtered", value: resultStats.noXmlImagesFilteredOut, accentClass: "text-yellow-600" },
      { label: "No-XML Moved", value: resultStats.noXmlImagesMoved },
    ]

    return metrics
  }, [processingResults])

  const mediaExtensionEntries = useMemo(() => {
    if (!processingResults?.stats.mediaCountsByExtension) {
      return [] as Array<[string, number]>
    }

    return Object.entries(processingResults.stats.mediaCountsByExtension).sort(([, a], [, b]) => Number(b) - Number(a))
  }, [processingResults])

  const failurePreviewEntries = useMemo(() => {
    if (!processingResults?.failurePreview || processingResults.failurePreview.length === 0) {
      return [] as FailurePreviewEntry[]
    }

    return processingResults.failurePreview.slice(0, 25)
  }, [processingResults])

  const failureOutputFile = processingResults?.failureOutputFile ?? null
  const failureCount =
    processingResults?.failureCount ??
    processingResults?.stats.moveFailures ??
    (processingResults?.failurePreview ? processingResults.failurePreview.length : 0)

  const failureDownloadURL = useMemo(() => {
    if (!failureOutputFile) {
      return null
    }

    return `/api/download?file=${encodeURIComponent(failureOutputFile)}`
  }, [failureOutputFile])

  const scanWarnings = processingResults?.scanWarnings ?? []
  const resultStartTime = processingResults?.startTime ?? processingStartTime
  const resultEndTime = processingResults?.endTime ?? processingEndTime

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

  useEffect(() => {
    if (!logsAutoFollow) return
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [deferredMessages, logsAutoFollow])

  useEffect(() => {
    if (!logsAutoFollow) return
    if (errorLogsEndRef.current) {
      errorLogsEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [deferredErrorMessages, logsAutoFollow])

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
      addMessage("error", `Failed to load history: ${getErrorMessage(error)}`)
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

  // Add this function after checkResumeStatus
  const loadSavedConfig = async () => {
    try {
      const response = await fetch("/api/parse/pause")
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.savedConfig) {
          const config = data.savedConfig

          // Load all saved settings
          setRootDir(config.rootDir || "")
          setOutputFile(config.outputFile || "image_metadata.csv")
          setOutputFolder(config.outputFolder || "")
          setProcessingMode(config.processingMode || "stream")
          setNumWorkers(config.numWorkers || 4)
          setVerbose(config.verbose || false)

          // Load chunked settings
          if (config.chunkSize) setChunkSize(config.chunkSize)
          if (config.pauseBetweenChunks !== undefined) setPauseBetweenChunks(config.pauseBetweenChunks)
          if (config.pauseDuration) setPauseDuration(config.pauseDuration)

          // Load filter settings
          if (config.filterConfig) {
            setFilterConfig(config.filterConfig)
            setFilterEnabled(config.filterConfig.enabled || false)
          }

          addMessage("system", "Loaded saved processing configuration")
          return true
        }
      }
    } catch (error) {
      console.error("Failed to load saved config:", error)
    }
    return false
  }

  // Add this function to reset all settings to defaults
  const resetToDefaults = () => {
    setRootDir("")
    setOutputFile("image_metadata.csv")
    setOutputFolder("")
    setProcessingMode("stream")
    setNumWorkers(4)
    setVerbose(false)
    setChunkSize(100)
    setPauseBetweenChunks(false)
    setPauseDuration(5)
    setFilterEnabled(false)
    setFilterConfig({
      enabled: false,
      fileTypes: ["jpg", "jpeg", "png", "tiff", "bmp"],
      customExtensions: "",
      allowedFileTypes: ["jpg", "jpeg", "png", "tiff", "bmp"],
      moveImages: false,
      moveFolderStructureOption: "replicate",
    })
    addMessage("system", "Reset all settings to defaults")
  }

  const addMessage = (type: string, message: any) => {
    const newMessage: Message = {
      type,
      message,
      timestamp: new Date().toLocaleTimeString(),
    }

    console.log(`[UI] Adding message: ${type} - ${JSON.stringify(message)}`)

    if (type === "error") {
      setErrorMessages((prev) => {
        const next = [...prev, newMessage]
        return next.length > MAX_ERROR_LOG_ENTRIES ? next.slice(-MAX_ERROR_LOG_ENTRIES) : next
      })
    } else {
      setMessages((prev) => {
        const next = [...prev, newMessage]
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next
      })
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
        setStats((prev) => {
          const statsPayload = data.message.stats ?? {}

          return {
            ...prev,
            totalFiles: statsPayload.totalFiles ?? data.message.total ?? prev.totalFiles,
            processedFiles: statsPayload.processedFiles ?? data.message.processed ?? prev.processedFiles,
            successCount: statsPayload.successCount ?? data.message.successful ?? prev.successCount,
            errorCount: statsPayload.errorCount ?? data.message.errors ?? prev.errorCount,
            filteredCount:
              statsPayload.filteredCount ??
              statsPayload.filteredFiles ??
              data.message.filtered ??
              prev.filteredCount,
            movedCount:
              statsPayload.movedCount ??
              statsPayload.movedFiles ??
              data.message.moved ??
              prev.movedCount,
            moveFailures:
              statsPayload.moveFailures ??
              data.message.moveFailures ??
              prev.moveFailures,
            totalMediaFiles:
              statsPayload.totalMediaFiles ??
              statsPayload.mediaFilesTotal ??
              data.message.mediaFilesTotal ??
              prev.totalMediaFiles,
            mediaFilesMatched:
              statsPayload.mediaFilesMatched ?? data.message.mediaFilesMatched ?? prev.mediaFilesMatched,
            localMediaFilesMatched:
              statsPayload.localMediaFilesMatched ??
              data.message.localMediaFilesMatched ??
              prev.localMediaFilesMatched,
            remoteMediaFilesMatched:
              statsPayload.remoteMediaFilesMatched ??
              data.message.remoteMediaFilesMatched ??
              prev.remoteMediaFilesMatched,
            mediaFilesUnmatched:
              statsPayload.mediaFilesUnmatched ?? data.message.mediaFilesUnmatched ?? prev.mediaFilesUnmatched,
            xmlFilesWithMedia:
              statsPayload.xmlFilesWithMedia ?? data.message.xmlFilesWithMedia ?? prev.xmlFilesWithMedia,
            xmlFilesMissingMedia:
              statsPayload.xmlFilesMissingMedia ?? data.message.xmlFilesMissingMedia ?? prev.xmlFilesMissingMedia,
            xmlProcessedWithoutMedia:
              statsPayload.xmlProcessedWithoutMedia ??
              data.message.xmlProcessedWithoutMedia ??
              prev.xmlProcessedWithoutMedia,
            currentFile: data.message.currentFile ?? statsPayload.currentFile ?? prev.currentFile,
            estimatedTimeRemaining:
              data.message.estimatedTimeRemaining ??
              statsPayload.estimatedTimeRemaining ??
              prev.estimatedTimeRemaining,
            noXmlImagesConsidered:
              statsPayload.noXmlImagesConsidered ??
              data.message.noXmlImagesConsidered ??
              prev.noXmlImagesConsidered,
            noXmlImagesRecorded:
              statsPayload.noXmlImagesRecorded ??
              data.message.noXmlImagesRecorded ??
              prev.noXmlImagesRecorded,
            noXmlImagesFilteredOut:
              statsPayload.noXmlImagesFilteredOut ??
              data.message.noXmlImagesFilteredOut ??
              prev.noXmlImagesFilteredOut,
            noXmlImagesMoved:
              statsPayload.noXmlImagesMoved ??
              data.message.noXmlImagesMoved ??
              prev.noXmlImagesMoved,
            noXmlDestinationPath:
              statsPayload.noXmlDestinationPath ??
              data.message.noXmlDestinationPath ??
              prev.noXmlDestinationPath,
          }
        })
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
          startTime: processingStartTime ?? undefined,
          endTime: new Date().toISOString(),
          scanWarnings: data.message.scanWarnings,
          failureOutputFile: data.message.failureOutputFile,
          failureCount:
            data.message.failureCount ??
            data.message.stats?.moveFailures ??
            data.message.stats?.failureCount,
          failurePreview: data.message.failurePreview,
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

  // Template management functions
  const loadTemplates = async () => {
    try {
      const response = await fetch("/api/templates")
      if (response.ok) {
        const data = await response.json()
        if (data.success && Array.isArray(data.templates)) {
          setTemplates(data.templates)
        }
      }
    } catch (error) {
      console.error("Failed to load templates:", error)
      toast.error("Failed to load templates")
    }
  }

  const saveAsTemplate = async () => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name")
      return
    }

    const templateConfig = {
      rootDir,
      outputFile,
      outputFolder,
      numWorkers,
      verbose,
      processingMode,
      chunkSize,
      pauseBetweenChunks,
      pauseDuration,
      filterEnabled,
      filterConfig,
      watchMode,
      watchInterval,
      watchDirectory,
      watchOutputFile,
      watchOutputFolder,
    }

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName,
          description: templateDescription,
          config: templateConfig,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          toast.success("Template saved successfully!")
          setShowSaveTemplateDialog(false)
          setTemplateName("")
          setTemplateDescription("")
          await loadTemplates()
        }
      } else {
        toast.error("Failed to save template")
      }
    } catch (error) {
      console.error("Error saving template:", error)
      toast.error("Error saving template")
    }
  }

  const applyTemplate = async (templateId: string) => {
    try {
      const response = await fetch(`/api/templates/${templateId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.template) {
          const config = data.template.config

          // Apply all configuration
          setRootDir(config.rootDir || "")
          setOutputFile(config.outputFile || "image_metadata.csv")
          setOutputFolder(config.outputFolder || "")
          setNumWorkers(config.numWorkers || 4)
          setVerbose(config.verbose || false)
          setProcessingMode(config.processingMode || "stream")
          
          // Chunked settings
          if (config.chunkSize) setChunkSize(config.chunkSize)
          if (config.pauseBetweenChunks !== undefined) setPauseBetweenChunks(config.pauseBetweenChunks)
          if (config.pauseDuration) setPauseDuration(config.pauseDuration)

          // Filter settings
          setFilterEnabled(config.filterEnabled || false)
          if (config.filterConfig) {
            setFilterConfig(config.filterConfig)
          }

          // Watch mode settings
          if (config.watchMode !== undefined) setWatchMode(config.watchMode)
          if (config.watchInterval) setWatchInterval(config.watchInterval)
          if (config.watchDirectory) setWatchDirectory(config.watchDirectory)
          if (config.watchOutputFile) setWatchOutputFile(config.watchOutputFile)
          if (config.watchOutputFolder) setWatchOutputFolder(config.watchOutputFolder)

          setSelectedTemplate(templateId)
          toast.success(`Template "${data.template.name}" applied successfully!`)
        }
      }
    } catch (error) {
      console.error("Error applying template:", error)
      toast.error("Error applying template")
    }
  }

  const deleteTemplate = async (templateId: string) => {
    if (!confirm("Are you sure you want to delete this template?")) {
      return
    }

    try {
      const response = await fetch(`/api/templates/${templateId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast.success("Template deleted successfully!")
        await loadTemplates()
        if (selectedTemplate === templateId) {
          setSelectedTemplate(null)
        }
      } else {
        toast.error("Failed to delete template")
      }
    } catch (error) {
      console.error("Error deleting template:", error)
      toast.error("Error deleting template")
    }
  }

  // Load templates on mount
  useEffect(() => {
    loadTemplates()
  }, [])

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

  const clearMetadataFilters = () => {
    setFilterConfig((prev) => ({
      ...prev,
      creditLine: undefined,
      copyright: undefined,
      usageType: undefined,
      rightsHolder: undefined,
      location: undefined,
    }))
    toast.success("Metadata filters cleared")
  }

  // Update the startProcessing function to reset settings when starting new
  const startProcessing = async () => {
    // Only reset to defaults if this is a completely new start (not a resume)
    if (!canResume) {
      // Don't reset if user has manually configured settings
      // This preserves user's current configuration for new processing
    }

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
    setStats({ ...DEFAULT_PROCESSING_STATS })

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
          startTime: processingStartTime ?? undefined,
          endTime: new Date().toISOString(),
          scanWarnings: data.scanWarnings,
          failureOutputFile: data.failureOutputFile,
          failureCount: data.failureCount ?? data.stats?.moveFailures,
          failurePreview: data.failurePreview,
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

          let completeLines: string[]
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
      addMessage("error", `Error: ${getErrorMessage(error)}`)
      setActiveTab("logs") // Show logs on error
    } finally {
      setIsRunning(false)
    }
  }

  // Update the pauseProcessing function
  const pauseProcessing = async () => {
    try {
      // Prepare current config to save
      const currentConfig = {
        rootDir,
        outputFile,
        outputFolder,
        processingMode,
        numWorkers,
        verbose,
        filterConfig: filterEnabled ? { ...filterConfig, enabled: true } : null,
        chunkSize,
        pauseBetweenChunks,
        pauseDuration,
      }

      const response = await fetch("/api/parse/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pause",
          config: currentConfig,
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

  // Update the stopProcessing function
  const stopProcessing = async () => {
    try {
      // Prepare current config to save
      const currentConfig = {
        rootDir,
        outputFile,
        outputFolder,
        processingMode,
        numWorkers,
        verbose,
        filterConfig: filterEnabled ? { ...filterConfig, enabled: true } : null,
        chunkSize,
        pauseBetweenChunks,
        pauseDuration,
      }

      const response = await fetch("/api/parse/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          config: currentConfig,
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

  // Update the resumeProcessing function
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

            let completeLines: string[]
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

      // Check pause state and try to load saved config
      const pauseResponse = await fetch("/api/parse/pause")
      if (pauseResponse.ok) {
        const pauseData = await pauseResponse.json()
        if (pauseData.success && pauseData.state && (pauseData.state.isPaused || pauseData.state.shouldStop)) {
          // Load saved configuration
          if (pauseData.savedConfig) {
            const config = pauseData.savedConfig

            // Load all saved settings
            setRootDir(config.rootDir || "")
            setOutputFile(config.outputFile || "image_metadata.csv")
            setOutputFolder(config.outputFolder || "")
            setProcessingMode(config.processingMode || "stream")
            setNumWorkers(config.numWorkers || 4)
            setVerbose(config.verbose || false)

            // Load chunked settings
            if (config.chunkSize) setChunkSize(config.chunkSize)
            if (config.pauseBetweenChunks !== undefined) setPauseBetweenChunks(config.pauseBetweenChunks)
            if (config.pauseDuration) setPauseDuration(config.pauseDuration)

            // Load filter settings
            if (config.filterConfig) {
              setFilterConfig(config.filterConfig)
              setFilterEnabled(config.filterConfig.enabled || false)
            }

            addMessage("system", "Loaded saved configuration for resume")
          }

          // Reset pause state and restart processing with loaded config
          await fetch("/api/parse/pause", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reset" }),
          })

          addMessage("system", "Resuming from paused state with saved configuration")

          // Small delay to ensure state is updated
          setTimeout(() => {
            startProcessing()
          }, 500)
          return
        }
      }

      // Try regular resume API as fallback
      const response = await fetch("/api/resume")
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.canResume && data.session) {
          // Load session config and restart
          const session = data.session
          setRootDir(session.config.rootDir)
          setOutputFile(session.config.outputFile)
          setNumWorkers(session.config.numWorkers)
          setProcessingMode(session.config.processingMode as any)
          if (session.config.filterConfig) {
            setFilterConfig(session.config.filterConfig)
            setFilterEnabled(true)
          }

          addMessage("system", "Resuming from saved session")
          setTimeout(() => {
            startProcessing()
          }, 500)
          return
        }
      }

      // If no resume state found, just restart with current config
      addMessage("system", "No specific resume state found, restarting with current configuration")
      setTimeout(() => {
        startProcessing()
      }, 500)
    } catch (error: any) {
      addMessage("error", `Resume error: ${getErrorMessage(error)}`)
      setActiveTab("logs")
    } finally {
      setIsRunning(false)
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
      addMessage("error", `❌ Error stopping watcher: ${getErrorMessage(error)}`)
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
      addMessage("error", `❌ Error starting watcher: ${getErrorMessage(error)}`)
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
      addMessage("error", `Failed to delete session: ${getErrorMessage(error)}`)
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
      addMessage("error", `Failed to prepare resume: ${getErrorMessage(error)}`)
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

              {/* Template Management Section */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Configuration Templates</CardTitle>
                      <CardDescription>Save and reuse your configurations</CardDescription>
                    </div>
                    <Button onClick={() => setShowSaveTemplateDialog(true)} variant="outline" size="sm">
                      💾 Save Current as Template
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {templates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No templates saved yet.</p>
                      <p className="text-sm mt-2">
                        Click &ldquo;Save Current as Template&rdquo; to create your first template.
                      </p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[300px]">
                      <div className="space-y-3">
                        {templates.map((template) => (
                          <Card
                            key={template.id}
                            className={`cursor-pointer transition-all ${
                              selectedTemplate === template.id
                                ? "border-blue-500 bg-blue-50"
                                : "hover:border-gray-400"
                            }`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between">
                                <div className="flex-1" onClick={() => applyTemplate(template.id)}>
                                  <div className="flex items-center space-x-2 mb-2">
                                    <h3 className="font-semibold text-lg">{template.name}</h3>
                                    {selectedTemplate === template.id && (
                                      <Badge variant="default" className="text-xs">
                                        Active
                                      </Badge>
                                    )}
                                  </div>
                                  {template.description && (
                                    <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                                  )}
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <Badge variant="secondary">
                                      📁 {template.config.rootDir || "No root dir"}
                                    </Badge>
                                    <Badge variant="secondary">
                                      📄 {template.config.outputFile || "output.csv"}
                                    </Badge>
                                    <Badge variant="secondary">
                                      ⚙️ {template.config.processingMode || "stream"}
                                    </Badge>
                                    <Badge variant="secondary">
                                      👷 {template.config.numWorkers || 4} workers
                                    </Badge>
                                    {template.config.filterEnabled && (
                                      <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                                        🔍 Filters ON
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-2">
                                    Created: {new Date(template.createdAt).toLocaleDateString()}
                                  </div>
                                </div>
                                <div className="flex space-x-2 ml-4">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      applyTemplate(template.id)
                                    }}
                                    className="h-8 w-8 p-0"
                                  >
                                    ▶️
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      deleteTemplate(template.id)
                                    }}
                                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    🗑️
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
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
                                    minWidth: preset.width ?? undefined,
                                    minHeight: preset.height ?? undefined,
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
                        <div className="flex items-center justify-between">
                          <Label className="text-base font-semibold">Metadata Filters</Label>
                          <Button size="sm" variant="outline" onClick={clearMetadataFilters}>
                            Clear All Metadata
                          </Button>
                        </div>

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
                              disabled={!filterConfig.copyright?.operator || filterConfig.copyright?.operator === "isBlank" || filterConfig.copyright?.operator === "notBlank"}
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
                        Chunked processing is only available when &ldquo;Chunked&rdquo; mode is selected in Basic
                        Configuration.
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
                        files. When both files with matching base names are detected (e.g., &ldquo;image.xml&rdquo; and
                        &ldquo;image.jpg&rdquo;), they are automatically processed as a pair and results are appended to the CSV
                        file. If filters are enabled, only pairs that pass the filters will be processed and moved.
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
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex space-x-2">
                      <Button onClick={loadHistory} variant="outline" size="sm">
                        Refresh
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">Persistent History</Badge>
                      <span className="hidden sm:inline">Sessions are kept for auditing and resume support.</span>
                      {canResume && (
                        <Badge variant="outline" className="text-orange-600">
                          Resume Available
                        </Badge>
                      )}
                    </div>
                  </div>

                  <ScrollArea className="h-96">
                    <div className="space-y-3">
                      {!Array.isArray(history) || history.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">No processing history found</div>
                      ) : (
                        history.map((session) => {
                          const summaryStats = session.results?.stats
                          const mediaTotal = summaryStats?.totalMediaFiles ?? session.progress.mediaFilesTotal
                          const mediaMatched = summaryStats?.mediaFilesMatched ?? session.progress.mediaFilesMatched
                          const mediaUnmatched = summaryStats?.mediaFilesUnmatched ?? session.progress.mediaFilesUnmatched
                          const xmlWithMedia = summaryStats?.xmlFilesWithMedia ?? session.progress.xmlFilesWithMedia
                          const xmlMissingMedia = summaryStats?.xmlFilesMissingMedia ?? session.progress.xmlFilesMissingMedia
                          const xmlWithoutMedia = summaryStats?.xmlProcessedWithoutMedia
                          const filteredFiles = summaryStats?.filteredFiles
                          const movedFiles = summaryStats?.movedFiles
                          const moveFailures =
                            summaryStats?.moveFailures ??
                            session.results?.failureCount ??
                            session.progress.moveFailures
                          const noXmlConsidered = summaryStats?.noXmlImagesConsidered
                          const noXmlRecorded = summaryStats?.noXmlImagesRecorded
                          const noXmlFiltered = summaryStats?.noXmlImagesFilteredOut
                          const noXmlMoved = summaryStats?.noXmlImagesMoved
                          const noXmlDestination = summaryStats?.noXmlDestinationPath
                          const failureOutputPath = session.results?.failureOutputPath
                          const mediaMatchRate =
                            mediaTotal !== undefined && mediaTotal !== null && mediaTotal > 0 && mediaMatched !== undefined
                              ? `${((Number(mediaMatched) / Number(mediaTotal)) * 100).toFixed(1)}%`
                              : undefined

                          return (
                            <Card key={session.id} className="p-4">
                              <div className="flex justify-between items-start">
                                <div className="space-y-2 flex-1">
                                  <div className="flex items-center space-x-2">
                                    <Badge variant="outline" className={getStatusColor(session.status)}>
                                      {session.status.toUpperCase()}
                                    </Badge>
                                    <span className="text-sm text-muted-foreground">
                                      {formatTimestamp(session.startTime)}
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

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
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
                                    {filteredFiles !== undefined && (
                                      <div>
                                        <div className="font-medium">Filtered</div>
                                        <div>{formatMetricValue(filteredFiles)}</div>
                                      </div>
                                    )}
                                    {movedFiles !== undefined && (
                                      <div>
                                        <div className="font-medium">Moved</div>
                                        <div>{formatMetricValue(movedFiles)}</div>
                                      </div>
                                    )}
                                    {moveFailures !== undefined && (
                                      <div>
                                        <div className="font-medium">Move Failures</div>
                                        <div className="text-red-600">{formatMetricValue(moveFailures)}</div>
                                      </div>
                                    )}
                                  </div>

                                  {session.progress.totalFiles > 0 && (
                                    <Progress
                                      value={(session.progress.processedFiles / session.progress.totalFiles) * 100}
                                      className="h-2"
                                    />
                                  )}

                                  {(mediaTotal !== undefined || mediaMatched !== undefined || mediaUnmatched !== undefined) && (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                      {mediaTotal !== undefined && (
                                        <div>
                                          <div className="font-medium">Media Total</div>
                                          <div>{formatMetricValue(mediaTotal)}</div>
                                        </div>
                                      )}
                                      {mediaMatched !== undefined && (
                                        <div>
                                          <div className="font-medium">Media Matched</div>
                                          <div className="text-green-600">{formatMetricValue(mediaMatched)}</div>
                                        </div>
                                      )}
                                      {mediaUnmatched !== undefined && (
                                        <div>
                                          <div className="font-medium">Media Unmatched</div>
                                          <div className="text-red-600">{formatMetricValue(mediaUnmatched)}</div>
                                        </div>
                                      )}
                                      {mediaMatchRate && (
                                        <div>
                                          <div className="font-medium">Match Rate</div>
                                          <div className="text-blue-600">{mediaMatchRate}</div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {(xmlWithMedia !== undefined || xmlMissingMedia !== undefined || xmlWithoutMedia !== undefined) && (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                      {xmlWithMedia !== undefined && (
                                        <div>
                                          <div className="font-medium">XML With Media</div>
                                          <div>{formatMetricValue(xmlWithMedia)}</div>
                                        </div>
                                      )}
                                      {xmlMissingMedia !== undefined && (
                                        <div>
                                          <div className="font-medium">XML Missing Media</div>
                                          <div className="text-yellow-600">{formatMetricValue(xmlMissingMedia)}</div>
                                        </div>
                                      )}
                                      {xmlWithoutMedia !== undefined && (
                                        <div>
                                          <div className="font-medium">XML Without Media</div>
                                          <div className="text-red-600">{formatMetricValue(xmlWithoutMedia)}</div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {(noXmlConsidered !== undefined ||
                                    noXmlRecorded !== undefined ||
                                    noXmlFiltered !== undefined ||
                                    noXmlMoved !== undefined) && (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                      {noXmlConsidered !== undefined && (
                                        <div>
                                          <div className="font-medium">No-XML Considered</div>
                                          <div>{formatMetricValue(noXmlConsidered)}</div>
                                        </div>
                                      )}
                                      {noXmlRecorded !== undefined && (
                                        <div>
                                          <div className="font-medium">No-XML Recorded</div>
                                          <div className="text-green-600">{formatMetricValue(noXmlRecorded)}</div>
                                        </div>
                                      )}
                                      {noXmlFiltered !== undefined && (
                                        <div>
                                          <div className="font-medium">No-XML Filtered</div>
                                          <div className="text-yellow-600">{formatMetricValue(noXmlFiltered)}</div>
                                        </div>
                                      )}
                                      {noXmlMoved !== undefined && (
                                        <div>
                                          <div className="font-medium">No-XML Moved</div>
                                          <div>{formatMetricValue(noXmlMoved)}</div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {noXmlDestination && (
                                    <div className="text-xs text-muted-foreground break-all">
                                      <span className="font-medium text-foreground">No-XML Destination:</span> {noXmlDestination}
                                    </div>
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
                                  {failureOutputPath && (
                                    <Button size="sm" variant="outline" asChild className="text-xs bg-transparent">
                                      <a href={`/api/download?file=${encodeURIComponent(failureOutputPath)}`}>
                                        Failure CSV
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
                          )
                        })
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
                  <CardHeader className="flex items-center justify-between">
                    <CardTitle>Processing Logs</CardTitle>
                    <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                      <Label htmlFor="followLogs" className="text-xs">Follow logs</Label>
                      <Switch id="followLogs" checked={logsAutoFollow} onCheckedChange={setLogsAutoFollow} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <div className="space-y-1">
                        {deferredMessages.map((message, index) => (
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
                        {deferredErrorMessages.map((message, index) => (
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

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            File Processing
                          </Label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {processingResultMetrics.map((metric) => (
                              <div key={metric.label} className="text-center">
                                <div className={`text-2xl font-bold ${metric.accentClass ?? ""}`.trim()}>
                                  {formatMetricValue(metric.value)}
                                </div>
                                <div className="text-xs text-muted-foreground">{metric.label}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            Media Coverage
                          </Label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {processingResultMediaMetrics.map((metric) => (
                              <div key={metric.label} className="text-center">
                                <div className={`text-2xl font-bold ${metric.accentClass ?? ""}`.trim()}>
                                  {formatMetricValue(metric.value)}
                                </div>
                                <div className="text-xs text-muted-foreground">{metric.label}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {processingResultNoXmlMetrics.length > 0 && (
                          <div className="space-y-2">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                              No-XML Pipeline
                            </Label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              {processingResultNoXmlMetrics.map((metric) => (
                                <div key={metric.label} className="text-center">
                                  <div className={`text-2xl font-bold ${metric.accentClass ?? ""}`.trim()}>
                                    {formatMetricValue(metric.value)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">{metric.label}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Started</Label>
                          <div className="font-medium text-foreground">{formatTimestamp(resultStartTime)}</div>
                        </div>
                        <div>
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Completed</Label>
                          <div className="font-medium text-foreground">{formatTimestamp(resultEndTime)}</div>
                        </div>
                      </div>

                      {processingResults.stats.noXmlDestinationPath && (
                        <div className="grid grid-cols-1 gap-2 text-sm">
                          <div>
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                              No-XML Destination
                            </Label>
                            <div className="font-medium text-foreground break-all">
                              {processingResults.stats.noXmlDestinationPath}
                            </div>
                          </div>
                        </div>
                      )}

                      {mediaExtensionEntries.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            Media by Extension
                          </Label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                            {mediaExtensionEntries.map(([extension, count]) => (
                              <div
                                key={extension}
                                className="flex items-center justify-between rounded-md border px-2 py-1"
                              >
                                <span className="uppercase text-muted-foreground">{extension}</span>
                                <span className="font-semibold text-foreground">{formatMetricValue(count)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(failureCount > 0 || failureOutputFile || failurePreviewEntries.length > 0) && (
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            Move Failures
                          </Label>
                          <div className="rounded-md border p-3 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                              <span>Total</span>
                              <span className="font-semibold text-red-600">{formatMetricValue(failureCount)}</span>
                            </div>
                            {failureOutputFile && (
                              <div className="space-y-2">
                                <div className="text-xs text-muted-foreground break-all">
                                  {failureOutputFile}
                                </div>
                                {failureDownloadURL && (
                                  <Button asChild variant="outline" size="sm" className="w-full md:w-auto">
                                    <a href={failureDownloadURL} download>
                                      Download Failure CSV
                                    </a>
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>

                          {failurePreviewEntries.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground">
                                Showing {failurePreviewEntries.length} recent failures.
                              </div>
                              <ScrollArea className="max-h-60 border rounded">
                                <div className="divide-y text-xs">
                                  {failurePreviewEntries.map((entry, index) => (
                                    <div key={`${entry.imagePath || entry.imageHref || "unknown"}-${index}`} className="p-2 space-y-1">
                                      <div className="font-medium text-red-600">{entry.failureReason}</div>
                                      {entry.failureDetails && (
                                        <div className="text-muted-foreground">{entry.failureDetails}</div>
                                      )}
                                      <div className="grid gap-1 text-muted-foreground">
                                        {entry.imagePath && (
                                          <div className="break-all">
                                            <span className="font-semibold text-foreground">Image:</span> {entry.imagePath}
                                          </div>
                                        )}
                                        {entry.imageHref && (
                                          <div className="break-all">
                                            <span className="font-semibold text-foreground">Href:</span> {entry.imageHref}
                                          </div>
                                        )}
                                        {entry.xmlPath && (
                                          <div className="break-all">
                                            <span className="font-semibold text-foreground">XML:</span> {entry.xmlPath}
                                          </div>
                                        )}
                                        {entry.filterStatus && (
                                          <div>
                                            <span className="font-semibold text-foreground">Filter:</span> {entry.filterStatus}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </ScrollArea>
                            </div>
                          )}
                        </div>
                      )}

                      {scanWarnings.length > 0 && (
                        <Alert variant="destructive">
                          <AlertDescription>
                            <div className="space-y-1">
                              <div className="font-medium">Directory scan warnings</div>
                              <ul className="list-disc list-inside space-y-1 text-sm">
                                {scanWarnings.map((warning, index) => (
                                  <li key={index}>{warning}</li>
                                ))}
                              </ul>
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}

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
              <CardTitle className="text-lg">Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!isRunning && !canResume && (
                <>
                  <Button onClick={startProcessing} disabled={!rootDir} className="w-full">
                    Start Processing
                  </Button>
                  <div className="flex space-x-2">
                    <Button onClick={loadSavedConfig} variant="outline" size="sm" className="flex-1 bg-transparent">
                      Load Saved
                    </Button>
                    <Button onClick={resetToDefaults} variant="outline" size="sm" className="flex-1 bg-transparent">
                      Reset All
                    </Button>
                  </div>
                </>
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
                  <div className="flex space-x-2">
                    <Button onClick={loadSavedConfig} variant="outline" size="sm" className="flex-1 bg-transparent">
                      Load Saved
                    </Button>
                    <Button onClick={resetToDefaults} variant="outline" size="sm" className="flex-1 bg-transparent">
                      Reset All
                    </Button>
                  </div>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <div className="flex justify-between">
                <span className="text-sm">Progress:</span>
                <span className="text-sm font-medium">{progress}%</span>
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

              <div className="border-t border-dashed pt-3 space-y-3">
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Files</Label>
                  <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                    {quickProcessingMetrics.map((metric) => (
                      <div key={metric.label} className="flex flex-col">
                        <span className={`text-base font-semibold ${metric.accentClass ?? ""}`.trim()}>
                          {formatMetricValue(metric.value)}
                        </span>
                        <span className="text-xs text-muted-foreground">{metric.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {(stats.currentFile || stats.estimatedTimeRemaining) && (
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    {stats.currentFile && (
                      <div>
                        <span className="font-medium text-foreground">Current:</span> {stats.currentFile}
                      </div>
                    )}
                    {stats.estimatedTimeRemaining && (
                      <div>
                        <span className="font-medium text-foreground">ETA:</span> {stats.estimatedTimeRemaining}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Media Overview</CardTitle>
              <CardDescription>How assets line up with the discovered XML</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Media Files</Label>
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  {mediaQuickMetrics.map((metric) => (
                    <div key={metric.label} className="flex flex-col">
                      <span className={`text-base font-semibold ${metric.accentClass ?? ""}`.trim()}>
                        {formatMetricValue(metric.value)}
                      </span>
                      <span className="text-xs text-muted-foreground">{metric.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">XML Status</Label>
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  {xmlQuickMetrics.map((metric) => (
                    <div key={metric.label} className="flex flex-col">
                      <span className={`text-base font-semibold ${metric.accentClass ?? ""}`.trim()}>
                        {formatMetricValue(metric.value)}
                      </span>
                      <span className="text-xs text-muted-foreground">{metric.label}</span>
                    </div>
                  ))}
                </div>
              </div>
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

      {/* Save Template Dialog */}
      <Dialog open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Configuration as Template</DialogTitle>
            <DialogDescription>
              Save your current configuration settings to reuse later. All settings including filters, chunked mode, and watch settings will be saved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="templateName">Template Name *</Label>
              <Input
                id="templateName"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Production Config, Test Setup, etc."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="templateDescription">Description (optional)</Label>
              <Input
                id="templateDescription"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                placeholder="Brief description of this template"
              />
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium">This template will save:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Root directory and output settings</li>
                <li>Processing mode and worker configuration</li>
                <li>All filter settings (file types, dimensions, metadata)</li>
                <li>Chunked processing settings</li>
                <li>Watch mode configuration</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowSaveTemplateDialog(false)
              setTemplateName("")
              setTemplateDescription("")
            }}>
              Cancel
            </Button>
            <Button onClick={saveAsTemplate}>
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
