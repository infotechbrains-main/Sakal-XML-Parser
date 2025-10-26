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
    filteredCount?: number
    movedCount?: number
    currentFileIndex?: number
    processedFilesList?: string[]
    remainingFiles?: string[]
    noXmlImagesRecorded?: number
    noXmlImagesFilteredOut?: number
    moveFailures?: number
  }
  results?: {
    outputPath: string
    failureOutputPath?: string
    failureCount?: number
    failurePreview?: Array<{
      imageHref: string
      imagePath: string
      xmlPath: string
      failureReason: string
      failureDetails?: string
      filterStatus?: string
    }>
    stats?: {
      totalFiles: number
      processedFiles: number
      successfulFiles: number
      errorFiles: number
      recordsWritten: number
      filteredFiles: number
      movedFiles: number
      moveFailures?: number
      noXmlImagesConsidered?: number
      noXmlImagesRecorded?: number
      noXmlImagesFilteredOut?: number
      noXmlImagesMoved?: number
      noXmlDestinationPath?: string
    }
    errors?: string[]
  }
  resumeData?: {
    lastProcessedFile: string
    partialResults: any[]
  }
}

export class ProcessingHistory {
  private static historyFile = path.join(process.cwd(), "data", "processing_history.json")
  private static currentSessionFile = path.join(process.cwd(), "data", "current_session.json")
  private static dataDir = path.join(process.cwd(), "data")

  private static async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
    } catch (error) {
      console.error("Failed to create data directory:", error)
    }
  }

  private static async safeReadFile(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, "utf-8")
      return JSON.parse(content)
    } catch (error) {
      return null
    }
  }

  private static async safeWriteFile(filePath: string, data: any): Promise<boolean> {
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

  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  static async getAllSessions(): Promise<ProcessingSession[]> {
    const data = await this.safeReadFile(this.historyFile)
    return data?.sessions || []
  }

  static async addSession(session: ProcessingSession): Promise<boolean> {
    const sessions = await this.getAllSessions()
    sessions.unshift(session) // Add to beginning

    // Keep only last 100 sessions
    const trimmedSessions = sessions.slice(0, 100)

    return await this.safeWriteFile(this.historyFile, { sessions: trimmedSessions })
  }

  static async updateSession(sessionId: string, updates: Partial<ProcessingSession>): Promise<boolean> {
    const sessions = await this.getAllSessions()
    const sessionIndex = sessions.findIndex((s) => s.id === sessionId)

    if (sessionIndex === -1) return false

    sessions[sessionIndex] = { ...sessions[sessionIndex], ...updates }
    return await this.safeWriteFile(this.historyFile, { sessions })
  }

  static async deleteSession(sessionId: string): Promise<boolean> {
    const sessions = await this.getAllSessions()
    const filteredSessions = sessions.filter((s) => s.id !== sessionId)
    return await this.safeWriteFile(this.historyFile, { sessions: filteredSessions })
  }

  static async clearHistory(): Promise<boolean> {
    return await this.safeWriteFile(this.historyFile, { sessions: [] })
  }

  static async getCurrentSession(): Promise<ProcessingSession | null> {
    return await this.safeReadFile(this.currentSessionFile)
  }

  static async saveCurrentSession(session: ProcessingSession | null): Promise<boolean> {
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

  static async clearCurrentSession(): Promise<boolean> {
    try {
      await fs.unlink(this.currentSessionFile)
      return true
    } catch {
      return true // File doesn't exist, that's fine
    }
  }

  static async getStorageInfo() {
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
