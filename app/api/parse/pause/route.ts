import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

interface PauseState {
  isPaused: boolean
  shouldStop: boolean
  sessionId?: string
  currentChunk?: number
  processedFiles?: number
  timestamp: string
}

interface ProcessingConfig {
  rootDir: string
  outputFile: string
  outputFolder: string
  processingMode: string
  numWorkers: number
  verbose: boolean
  filterConfig: any
  chunkSize?: number
  pauseBetweenChunks?: boolean
  pauseDuration?: number
}

let pauseState: PauseState = {
  isPaused: false,
  shouldStop: false,
  timestamp: new Date().toISOString(),
}

let savedConfig: ProcessingConfig | null = null

const PAUSE_STATE_FILE = path.join(process.cwd(), "pause_state.json")
const CONFIG_STATE_FILE = path.join(process.cwd(), "last_processing_config.json")

// Load pause state from file
async function loadPauseState(): Promise<PauseState | null> {
  try {
    const data = await fs.readFile(PAUSE_STATE_FILE, "utf8")
    const state = JSON.parse(data)
    console.log("[Pause API] Loaded pause state from file")
    return state
  } catch (error) {
    console.log("[Pause API] No saved pause state found")
    return null
  }
}

// Save pause state to file
async function savePauseState(state: PauseState): Promise<void> {
  try {
    await fs.writeFile(PAUSE_STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    console.log("[Pause API] Saved pause state to file")
  } catch (error) {
    console.error("[Pause API] Error saving pause state:", error)
  }
}

// Load processing config from file
async function loadProcessingConfig(): Promise<ProcessingConfig | null> {
  try {
    const data = await fs.readFile(CONFIG_STATE_FILE, "utf8")
    const config = JSON.parse(data)
    console.log("[Pause API] Loaded processing config from file")
    return config
  } catch (error) {
    console.log("[Pause API] No saved processing config found")
    return null
  }
}

// Save processing config to file
async function saveProcessingConfig(config: ProcessingConfig): Promise<void> {
  try {
    await fs.writeFile(CONFIG_STATE_FILE, JSON.stringify(config, null, 2), "utf8")
    console.log("[Pause API] Saved processing config to file")
  } catch (error) {
    console.error("[Pause API] Error saving processing config:", error)
  }
}

// Clear pause state file
async function clearPauseState(): Promise<void> {
  try {
    await fs.unlink(PAUSE_STATE_FILE)
    console.log("[Pause API] Cleared pause state file")
  } catch (error) {
    // File doesn't exist, which is fine
  }
}

export function getPauseState(): PauseState {
  return pauseState
}

export function setPauseState(newState: Partial<PauseState>): void {
  pauseState = {
    ...pauseState,
    ...newState,
    timestamp: new Date().toISOString(),
  }
  savePauseState(pauseState)
}

export function resetPauseState(): void {
  pauseState = {
    isPaused: false,
    shouldStop: false,
    timestamp: new Date().toISOString(),
  }
  clearPauseState()
  console.log("[Pause API] State reset")
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, config, jobId, sessionId, currentChunk, processedFiles } = body

    console.log(`[Pause API] Received ${action} request`)

    switch (action) {
      case "pause":
        setPauseState({
          isPaused: true,
          shouldStop: false,
          sessionId: sessionId || jobId,
          currentChunk,
          processedFiles,
        })

        // Save config if provided
        if (config) {
          savedConfig = config
          await saveProcessingConfig(config)
        }

        return NextResponse.json({
          success: true,
          message: "Pause request received",
          state: pauseState,
        })

      case "stop":
        setPauseState({
          isPaused: false,
          shouldStop: true,
          sessionId: sessionId || jobId,
          currentChunk,
          processedFiles,
        })

        // Save config if provided
        if (config) {
          savedConfig = config
          await saveProcessingConfig(config)
        }

        return NextResponse.json({
          success: true,
          message: "Stop request received",
          state: pauseState,
        })

      case "reset":
        resetPauseState()
        return NextResponse.json({
          success: true,
          message: "State reset",
          state: pauseState,
        })

      default:
        return NextResponse.json(
          {
            success: false,
            message: "Invalid action",
          },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error("[Pause API] Error:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  try {
    // Load state from file if it exists
    const fileState = await loadPauseState()
    if (fileState) {
      pauseState = fileState
    }

    // Load saved config
    const fileConfig = await loadProcessingConfig()
    if (fileConfig) {
      savedConfig = fileConfig
    }

    return NextResponse.json({
      success: true,
      state: pauseState,
      savedConfig: savedConfig,
    })
  } catch (error) {
    console.error("[Pause API] Error:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500 },
    )
  }
}
