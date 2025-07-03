import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

interface PauseState {
  isPaused: boolean
  pauseRequested: boolean
  shouldStop: boolean
  stopRequested: boolean
  timestamp: number
}

interface ProcessingConfig {
  rootDir?: string
  outputFile?: string
  outputFolder?: string
  numWorkers?: number
  verbose?: boolean
  filterConfig?: any
  processingMode?: string
  isRemote?: boolean
  chunkSize?: number
  pauseDuration?: number
}

// In-memory state
let pauseState: PauseState = {
  isPaused: false,
  pauseRequested: false,
  shouldStop: false,
  stopRequested: false,
  timestamp: Date.now(),
}

let processingConfig: ProcessingConfig | null = null

// File paths for persistence
const PAUSE_STATE_FILE = path.join(process.cwd(), "temp", "pause-state.json")
const PROCESSING_CONFIG_FILE = path.join(process.cwd(), "temp", "processing-config.json")

// Ensure temp directory exists
async function ensureTempDir() {
  const tempDir = path.dirname(PAUSE_STATE_FILE)
  try {
    await fs.mkdir(tempDir, { recursive: true })
  } catch (error) {
    // Directory might already exist
  }
}

// Load pause state from file
async function loadPauseState(): Promise<PauseState> {
  try {
    await ensureTempDir()
    const data = await fs.readFile(PAUSE_STATE_FILE, "utf8")
    const loaded = JSON.parse(data) as PauseState
    console.log("[Pause API] Loaded pause state from file:", loaded)
    return loaded
  } catch (error) {
    console.log("[Pause API] No saved pause state found, using default")
    return {
      isPaused: false,
      pauseRequested: false,
      shouldStop: false,
      stopRequested: false,
      timestamp: Date.now(),
    }
  }
}

// Save pause state to file
async function savePauseState(state: PauseState): Promise<void> {
  try {
    await ensureTempDir()
    await fs.writeFile(PAUSE_STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    console.log("[Pause API] Saved pause state to file")
  } catch (error) {
    console.error("[Pause API] Error saving pause state:", error)
  }
}

// Load processing config from file
async function loadProcessingConfig(): Promise<ProcessingConfig | null> {
  try {
    await ensureTempDir()
    const data = await fs.readFile(PROCESSING_CONFIG_FILE, "utf8")
    const loaded = JSON.parse(data) as ProcessingConfig
    console.log("[Pause API] Loaded processing config from file")
    return loaded
  } catch (error) {
    console.log("[Pause API] No saved processing config found")
    return null
  }
}

// Save processing config to file
async function saveProcessingConfig(config: ProcessingConfig): Promise<void> {
  try {
    await ensureTempDir()
    await fs.writeFile(PROCESSING_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8")
    console.log("[Pause API] Saved processing config to file")
  } catch (error) {
    console.error("[Pause API] Error saving processing config:", error)
  }
}

// Initialize state from file on startup
async function initializeState() {
  pauseState = await loadPauseState()
  processingConfig = await loadProcessingConfig()
}

// Initialize on module load
initializeState().catch(console.error)

export async function GET(request: NextRequest) {
  try {
    // Refresh state from file
    pauseState = await loadPauseState()
    processingConfig = await loadProcessingConfig()

    return NextResponse.json({
      success: true,
      pauseState,
      processingConfig,
    })
  } catch (error) {
    console.error("[Pause API] Error getting pause state:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get pause state",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, config } = body

    console.log(`[Pause API] Received action: ${action}`)

    switch (action) {
      case "pause":
        pauseState.pauseRequested = true
        pauseState.isPaused = true
        pauseState.timestamp = Date.now()
        await savePauseState(pauseState)
        console.log("[Pause API] Pause requested")
        break

      case "resume":
        pauseState.pauseRequested = false
        pauseState.isPaused = false
        pauseState.timestamp = Date.now()
        await savePauseState(pauseState)
        console.log("[Pause API] Resume requested")
        break

      case "stop":
        pauseState.stopRequested = true
        pauseState.shouldStop = true
        pauseState.timestamp = Date.now()
        await savePauseState(pauseState)
        console.log("[Pause API] Stop requested")
        break

      case "reset":
        pauseState = {
          isPaused: false,
          pauseRequested: false,
          shouldStop: false,
          stopRequested: false,
          timestamp: Date.now(),
        }
        await savePauseState(pauseState)
        console.log("[Pause API] State reset")
        break

      case "saveConfig":
        if (config) {
          processingConfig = config
          await saveProcessingConfig(config)
          console.log("[Pause API] Processing config saved")
        }
        break

      default:
        return NextResponse.json(
          {
            success: false,
            error: "Invalid action",
          },
          { status: 400 },
        )
    }

    return NextResponse.json({
      success: true,
      pauseState,
      processingConfig,
    })
  } catch (error) {
    console.error("[Pause API] Error handling pause request:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to handle pause request",
      },
      { status: 500 },
    )
  }
}

// Export functions for use by other modules
export function getPauseState(): PauseState {
  return { ...pauseState }
}

export function setPauseState(newState: Partial<PauseState>): void {
  pauseState = { ...pauseState, ...newState, timestamp: Date.now() }
  savePauseState(pauseState).catch(console.error)
}

export function resetPauseState(): void {
  pauseState = {
    isPaused: false,
    pauseRequested: false,
    shouldStop: false,
    stopRequested: false,
    timestamp: Date.now(),
  }
  savePauseState(pauseState).catch(console.error)
}

export function getProcessingConfig(): ProcessingConfig | null {
  return processingConfig
}

export function setProcessingConfig(config: ProcessingConfig): void {
  processingConfig = config
  saveProcessingConfig(config).catch(console.error)
}
