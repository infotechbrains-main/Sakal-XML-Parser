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

const HISTORY_FILE = path.join(process.cwd(), "processing_history.json")
const CURRENT_SESSION_FILE = path.join(process.cwd(), "current_session.json")

export class ProcessingHistory {
  static async loadHistory(): Promise<ProcessingSession[]> {
    try {
      const data = await fs.readFile(HISTORY_FILE, "utf-8")
      const parsed = JSON.parse(data)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      // File doesn't exist or is corrupted, return empty array
      console.log("History file not found or corrupted, starting fresh")
      return []
    }
  }

  static async saveHistory(sessions: ProcessingSession[]): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(HISTORY_FILE)
      await fs.mkdir(dir, { recursive: true }).catch(() => {})

      await fs.writeFile(HISTORY_FILE, JSON.stringify(sessions, null, 2))
    } catch (error) {
      console.error("Error saving history:", error)
      throw error
    }
  }

  static async addSession(session: ProcessingSession): Promise<void> {
    const history = await this.loadHistory()
    history.unshift(session) // Add to beginning

    // Keep only last 50 sessions
    if (history.length > 50) {
      history.splice(50)
    }

    await this.saveHistory(history)
  }

  static async updateSession(sessionId: string, updates: Partial<ProcessingSession>): Promise<void> {
    const history = await this.loadHistory()
    const sessionIndex = history.findIndex((s) => s.id === sessionId)

    if (sessionIndex !== -1) {
      history[sessionIndex] = { ...history[sessionIndex], ...updates }
      await this.saveHistory(history)
    }
  }

  static async getCurrentSession(): Promise<ProcessingSession | null> {
    try {
      const data = await fs.readFile(CURRENT_SESSION_FILE, "utf-8")
      return JSON.parse(data)
    } catch (error) {
      // File doesn't exist, that's fine
      return null
    }
  }

  static async saveCurrentSession(session: ProcessingSession): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(CURRENT_SESSION_FILE)
      await fs.mkdir(dir, { recursive: true }).catch(() => {})

      await fs.writeFile(CURRENT_SESSION_FILE, JSON.stringify(session, null, 2))
    } catch (error) {
      console.error("Error saving current session:", error)
      throw error
    }
  }

  static async clearCurrentSession(): Promise<void> {
    try {
      await fs.unlink(CURRENT_SESSION_FILE)
    } catch (error) {
      // File doesn't exist, that's fine
    }
  }

  static async deleteSession(sessionId: string): Promise<void> {
    try {
      const history = await this.loadHistory()
      const filteredHistory = history.filter((s) => s.id !== sessionId)
      await this.saveHistory(filteredHistory)
    } catch (error) {
      console.error("Error deleting session:", error)
      throw error
    }
  }

  static async clearHistory(): Promise<void> {
    try {
      await this.saveHistory([])
    } catch (error) {
      console.error("Error clearing history:", error)
      throw error
    }
  }

  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}
