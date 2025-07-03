import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

interface PauseState {
  isPaused: boolean
  pauseRequested: boolean
  shouldStop: boolean
  stopRequested: boolean
  timestamp: string
}

interface ProcessingConfig {
  rootDir: string
  outputFile: string
  outputFolder: string
  filterConfig: any
  verbose: boolean
  numWorkers: number
  pauseDuration: number
  chunkSize?: number
  processingMode: string
}

const PAUSE_STATE_FILE = path.join(process.cwd(), "pause_state.json")
const PROCESSING_CONFIG_FILE = path.join(process.cwd(), "processing_config.json")

let currentPauseState: PauseState = {
  isPaused: false,
  pauseRequested: false,
  shouldStop: false,
  stopRequested: false,
  timestamp: new Date().toISOString(),
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

// Save processing config to file
async function saveProcessingConfig(config: ProcessingConfig): Promise<void> {
  try {
    await fs.writeFile(PROCESSING_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8")
    console.log("[Pause API] Saved processing config to file")
  } catch (error) {
    console.error("[Pause API] Error saving processing config:", error)
  }
}

// Load processing config from file
async function loadProcessingConfig(): Promise<ProcessingConfig | null> {
  try {
    const data = await fs.readFile(PROCESSING_CONFIG_FILE, "utf8")
    const config = JSON.parse(data)
    console.log("[Pause API] Loaded processing config from file")
    return config
  } catch (error) {
    console.log("[Pause API] No saved processing config found")
    return null
  }
}

// Clear processing config file
async function clearProcessingConfig(): Promise<void> {
  try {
    await fs.unlink(PROCESSING_CONFIG_FILE)
    console.log("[Pause API] Cleared processing config file")
  } catch (error) {
    // File doesn't exist, which is fine
  }
}

export function getPauseState(): PauseState {
  return { ...currentPauseState }
}

export function setPauseState(state: Partial<PauseState>): void {
  currentPauseState = {
    ...currentPauseState,
    ...state,
    timestamp: new Date().toISOString(),
  }
  savePauseState(currentPauseState)
}

export function resetPauseState(): void {
  currentPauseState = {
    isPaused: false,
    pauseRequested: false,
    shouldStop: false,
    stopRequested: false,
    timestamp: new Date().toISOString(),
  }
  savePauseState(currentPauseState)
  console.log("[Pause API] State reset")
}

export async function GET(request: NextRequest) {
  try {
    // Load state from file if it exists
    const savedState = await loadPauseState()
    if (savedState) {
      currentPauseState = savedState
    }

    const config = await loadProcessingConfig()

    return NextResponse.json({
      pauseState: currentPauseState,
      processingConfig: config,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Pause API] Error getting pause state:", error)
    return NextResponse.json({ error: "Failed to get pause state" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, config } = body

    switch (action) {
      case "pause":
        setPauseState({
          isPaused: true,
          pauseRequested: true,
        })
        console.log("[Pause API] Pause requested")
        break

      case "resume":
        setPauseState({
          isPaused: false,
          pauseRequested: false,
        })
        console.log("[Pause API] Resume requested")
        break

      case "stop":
        setPauseState({
          shouldStop: true,
          stopRequested: true,
        })
        console.log("[Pause API] Stop requested")
        break

      case "reset":
        resetPauseState()
        await clearProcessingConfig()
        console.log("[Pause API] State and config reset")
        break

      case "saveConfig":
        if (config) {
          await saveProcessingConfig(config)
          console.log("[Pause API] Processing config saved")
        }
        break

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      pauseState: currentPauseState,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Pause API] Error updating pause state:", error)
    return NextResponse.json({ error: "Failed to update pause state" }, { status: 500 })
  }
}
