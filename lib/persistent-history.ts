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
  }
  results?: {
    outputPath: string
    downloadUrl?: string
  }
  errors?: string[]
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

  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.access(this.dataDir)
    } catch {
      await fs.mkdir(this.dataDir, { recursive: true })
    }
  }

  private async safeReadFile(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, "utf-8")
      return JSON.parse(content)
    } catch (error) {
      console.log(`File not found or corrupted: ${filePath}, returning default`)
      return null
    }
  }

  private async safeWriteFile(filePath: string, data: any): Promise<void> {
    try {
      await this.ensureDataDirectory()

      // Create backup if file exists
      try {
        await fs.access(filePath)
        const backupPath = `${filePath}.backup`
        await fs.copyFile(filePath, backupPath)
      } catch {
        // File doesn't exist, no backup needed
      }

      await fs.writeFile(filePath, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error(`Error writing file ${filePath}:`, error)
      throw error
    }
  }

  async getAllSessions(): Promise<ProcessingSession[]> {
    try {
      const data = await this.safeReadFile(this.historyFile)
      return data?.sessions || []
    } catch (error) {
      console.error("Error reading history:", error)
      return []
    }
  }

  async createSession(config: any): Promise<ProcessingSession> {
    const session: ProcessingSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startTime: new Date().toISOString(),
      status: "running",
      config,
      progress: {
        totalFiles: 0,
        processedFiles: 0,
        successCount: 0,
        errorCount: 0,
        processedFilesList: [],
      },
    }

    try {
      // Save as current session
      await this.safeWriteFile(this.currentSessionFile, session)

      // Add to history
      const sessions = await this.getAllSessions()
      sessions.unshift(session)

      // Keep only last 100 sessions
      const limitedSessions = sessions.slice(0, 100)
      await this.safeWriteFile(this.historyFile, { sessions: limitedSessions })

      return session
    } catch (error) {
      console.error("Error creating session:", error)
      throw error
    }
  }

  async updateSession(sessionId: string, updates: Partial<ProcessingSession>): Promise<void> {
    try {
      // Update current session if it matches
      const currentSession = await this.safeReadFile(this.currentSessionFile)
      if (currentSession?.id === sessionId) {
        const updatedSession = { ...currentSession, ...updates }
        await this.safeWriteFile(this.currentSessionFile, updatedSession)
      }

      // Update in history
      const sessions = await this.getAllSessions()
      const sessionIndex = sessions.findIndex((s) => s.id === sessionId)

      if (sessionIndex !== -1) {
        sessions[sessionIndex] = { ...sessions[sessionIndex], ...updates }
        await this.safeWriteFile(this.historyFile, { sessions })
      }
    } catch (error) {
      console.error("Error updating session:", error)
    }
  }

  async completeSession(sessionId: string, results: any): Promise<void> {
    const updates: Partial<ProcessingSession> = {
      status: "completed",
      endTime: new Date().toISOString(),
      results,
    }

    await this.updateSession(sessionId, updates)
    await this.clearCurrentSession()
  }

  async failSession(sessionId: string, error: string): Promise<void> {
    const updates: Partial<ProcessingSession> = {
      status: "failed",
      endTime: new Date().toISOString(),
      errors: [error],
    }

    await this.updateSession(sessionId, updates)
    await this.clearCurrentSession()
  }

  async getCurrentSession(): Promise<ProcessingSession | null> {
    return await this.safeReadFile(this.currentSessionFile)
  }

  async clearCurrentSession(): Promise<void> {
    try {
      await fs.unlink(this.currentSessionFile)
    } catch {
      // File doesn't exist, that's fine
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const sessions = await this.getAllSessions()
      const filteredSessions = sessions.filter((s) => s.id !== sessionId)
      await this.safeWriteFile(this.historyFile, { sessions: filteredSessions })
    } catch (error) {
      console.error("Error deleting session:", error)
      throw error
    }
  }

  async clearAllHistory(): Promise<void> {
    try {
      await this.safeWriteFile(this.historyFile, { sessions: [] })
      await this.clearCurrentSession()
    } catch (error) {
      console.error("Error clearing history:", error)
      throw error
    }
  }

  async getStorageInfo(): Promise<any> {
    try {
      const sessions = await this.getAllSessions()
      const currentSession = await this.getCurrentSession()

      return {
        totalSessions: sessions.length,
        hasCurrentSession: !!currentSession,
        dataDirectory: this.dataDir,
        lastUpdated: sessions[0]?.startTime || null,
      }
    } catch (error) {
      return {
        totalSessions: 0,
        hasCurrentSession: false,
        dataDirectory: this.dataDir,
        lastUpdated: null,
        error: error.message,
      }
    }
  }
}
