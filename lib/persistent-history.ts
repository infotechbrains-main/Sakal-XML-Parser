import fs from "fs/promises"
import path from "path"

export interface ProcessingSession {
  id: string
  startTime: string
  endTime?: string
  status: "running" | "completed" | "failed" | "paused" | "interrupted"
  config: {
    rootDir: string
    outputFile: string
    numWorkers: number
    verbose: boolean
    filterConfig: any
    processingMode: string
  }
  progress: {
    totalFiles: number
    processedFiles: number
    successCount: number
    errorCount: number
    processedFilesList?: string[]
    mediaFilesTotal?: number
    mediaFilesMatched?: number
    mediaFilesUnmatched?: number
    xmlFilesWithMedia?: number
    xmlFilesMissingMedia?: number
    noXmlImagesRecorded?: number
    noXmlImagesFilteredOut?: number
  }
  results?: {
    outputPath: string
    stats?: {
      totalFiles: number
      processedFiles: number
      successfulFiles: number
      errorFiles: number
      recordsWritten: number
      filteredFiles: number
      movedFiles: number
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
  }
}

export class PersistentHistory {
  private historyFile: string
  private currentSessionFile: string
  private dataDir: string

  constructor() {
    this.dataDir = path.join(process.cwd(), "data")
    this.historyFile = path.join(this.dataDir, "processing_history.json")
    this.currentSessionFile = path.join(this.dataDir, "current_session.json")
  }

  private async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
    } catch (error) {
      console.error("Failed to create data directory:", error)
    }
  }

  private async safeReadFile(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, "utf-8")
      return JSON.parse(content)
    } catch (error) {
      return null
    }
  }

  private async safeWriteFile(filePath: string, data: any): Promise<boolean> {
    try {
      await this.ensureDataDir()

      // Create backup if file exists
      try {
        await fs.access(filePath)
        const backupPath = `${filePath}.backup`
        await fs.copyFile(filePath, backupPath)
      } catch {
        // File doesn't exist, no backup needed
      }

      await fs.writeFile(filePath, JSON.stringify(data, null, 2))
      return true
    } catch (error) {
      console.error(`Failed to write file ${filePath}:`, error)
      return false
    }
  }

  async getAllSessions(): Promise<ProcessingSession[]> {
    const data = await this.safeReadFile(this.historyFile)
    return data?.sessions || []
  }

  async addSession(session: ProcessingSession): Promise<boolean> {
    const sessions = await this.getAllSessions()
    sessions.unshift(session) // Add to beginning

    // Keep only last 100 sessions
    const trimmedSessions = sessions.slice(0, 100)

    return await this.safeWriteFile(this.historyFile, { sessions: trimmedSessions })
  }

  async updateSession(sessionId: string, updates: Partial<ProcessingSession>): Promise<boolean> {
    const sessions = await this.getAllSessions()
    const sessionIndex = sessions.findIndex((s) => s.id === sessionId)

    if (sessionIndex === -1) return false

    sessions[sessionIndex] = { ...sessions[sessionIndex], ...updates }
    return await this.safeWriteFile(this.historyFile, { sessions })
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const sessions = await this.getAllSessions()
    const filteredSessions = sessions.filter((s) => s.id !== sessionId)
    return await this.safeWriteFile(this.historyFile, { sessions: filteredSessions })
  }

  async clearHistory(): Promise<boolean> {
    return await this.safeWriteFile(this.historyFile, { sessions: [] })
  }

  async getCurrentSession(): Promise<ProcessingSession | null> {
    return await this.safeReadFile(this.currentSessionFile)
  }

  async setCurrentSession(session: ProcessingSession | null): Promise<boolean> {
    if (session === null) {
      try {
        await fs.unlink(this.currentSessionFile)
        return true
      } catch {
        return true // File doesn't exist, that's fine
      }
    }
    return await this.safeWriteFile(this.currentSessionFile, session)
  }

  async getStorageInfo() {
    const sessions = await this.getAllSessions()
    const currentSession = await this.getCurrentSession()

    return {
      totalSessions: sessions.length,
      hasCurrentSession: currentSession !== null,
      dataDirectory: this.dataDir,
      historyFile: this.historyFile,
      currentSessionFile: this.currentSessionFile,
    }
  }
}
