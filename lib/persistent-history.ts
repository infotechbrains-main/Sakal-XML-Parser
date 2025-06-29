import fs from "fs/promises"
import path from "path"

export interface ProcessingSession {
  id: string
  startTime: string
  endTime?: string
  status: "running" | "paused" | "completed" | "failed" | "interrupted"
  config: {
    rootDir: string
    outputFile: string
    numWorkers: number
    processingMode: string
    filterConfig?: any
    chunkSize?: number
  }
  progress: {
    totalFiles: number
    processedFiles: number
    successCount: number
    errorCount: number
    filteredCount: number
    movedCount: number
    currentFileIndex: number
    processedFilesList: string[]
    remainingFiles: string[]
  }
  results?: {
    outputPath: string
    stats: any
    errors: string[]
  }
  resumeData?: {
    lastProcessedFile: string
    partialResults: any[]
    chunkIndex?: number
  }
}

export class PersistentHistory {
  private static readonly DATA_DIR = path.join(process.cwd(), "data")
  private static readonly HISTORY_FILE = path.join(this.DATA_DIR, "processing_history.json")
  private static readonly CURRENT_SESSION_FILE = path.join(this.DATA_DIR, "current_session.json")

  // Ensure data directory exists
  private static async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.DATA_DIR, { recursive: true })
    } catch (error) {
      console.error("Failed to create data directory:", error)
    }
  }

  // Safe file read with fallback
  private static async safeReadFile(filePath: string, fallback: any = null): Promise<any> {
    try {
      const data = await fs.readFile(filePath, "utf-8")
      return JSON.parse(data)
    } catch (error) {
      console.log(`File not found or corrupted: ${path.basename(filePath)}, using fallback`)
      return fallback
    }
  }

  // Safe file write with backup
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
      console.error(`Failed to write file ${path.basename(filePath)}:`, error)
      return false
    }
  }

  // Load processing history
  static async loadHistory(): Promise<ProcessingSession[]> {
    const history = await this.safeReadFile(this.HISTORY_FILE, [])
    return Array.isArray(history) ? history : []
  }

  // Save processing history
  static async saveHistory(sessions: ProcessingSession[]): Promise<boolean> {
    return await this.safeWriteFile(this.HISTORY_FILE, sessions)
  }

  // Add new session to history
  static async addSession(session: ProcessingSession): Promise<boolean> {
    try {
      const history = await this.loadHistory()
      history.unshift(session) // Add to beginning

      // Keep only last 100 sessions
      if (history.length > 100) {
        history.splice(100)
      }

      return await this.saveHistory(history)
    } catch (error) {
      console.error("Failed to add session:", error)
      return false
    }
  }

  // Update existing session
  static async updateSession(sessionId: string, updates: Partial<ProcessingSession>): Promise<boolean> {
    try {
      const history = await this.loadHistory()
      const sessionIndex = history.findIndex((s) => s.id === sessionId)

      if (sessionIndex !== -1) {
        history[sessionIndex] = { ...history[sessionIndex], ...updates }
        return await this.saveHistory(history)
      }
      return false
    } catch (error) {
      console.error("Failed to update session:", error)
      return false
    }
  }

  // Get current session
  static async getCurrentSession(): Promise<ProcessingSession | null> {
    return await this.safeReadFile(this.CURRENT_SESSION_FILE, null)
  }

  // Save current session
  static async saveCurrentSession(session: ProcessingSession): Promise<boolean> {
    return await this.safeWriteFile(this.CURRENT_SESSION_FILE, session)
  }

  // Clear current session
  static async clearCurrentSession(): Promise<boolean> {
    try {
      await fs.unlink(this.CURRENT_SESSION_FILE)
      return true
    } catch {
      return true // File doesn't exist, that's fine
    }
  }

  // Delete session from history
  static async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const history = await this.loadHistory()
      const filteredHistory = history.filter((s) => s.id !== sessionId)
      return await this.saveHistory(filteredHistory)
    } catch (error) {
      console.error("Failed to delete session:", error)
      return false
    }
  }

  // Clear all history
  static async clearHistory(): Promise<boolean> {
    return await this.saveHistory([])
  }

  // Generate unique session ID
  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Get storage info
  static async getStorageInfo(): Promise<{
    historyExists: boolean
    currentSessionExists: boolean
    historySize: number
    dataDir: string
  }> {
    try {
      await this.ensureDataDir()

      const historyExists = await fs
        .access(this.HISTORY_FILE)
        .then(() => true)
        .catch(() => false)
      const currentSessionExists = await fs
        .access(this.CURRENT_SESSION_FILE)
        .then(() => true)
        .catch(() => false)

      let historySize = 0
      if (historyExists) {
        const history = await this.loadHistory()
        historySize = history.length
      }

      return {
        historyExists,
        currentSessionExists,
        historySize,
        dataDir: this.DATA_DIR,
      }
    } catch (error) {
      return {
        historyExists: false,
        currentSessionExists: false,
        historySize: 0,
        dataDir: this.DATA_DIR,
      }
    }
  }
}
