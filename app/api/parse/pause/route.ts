import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

interface PauseState {
  isPaused: boolean
  shouldStop: boolean
  timestamp: string
}

interface ProcessingConfig {
  rootDir: string
  outputFile: string
  outputFolder: string
  chunkSize: number
  pauseDuration: number
  numWorkers: number
  verbose: boolean
  filterConfig: any
  processingMode: string
}

let pauseState: PauseState = {
  isPaused: false,
  shouldStop: false,
  timestamp: new Date().toISOString(),
}

const PAUSE_STATE_FILE = path.join(process.cwd(), "pause_state.json")
const PROCESSING_CONFIG_FILE = path.join(process.cwd(), "processing_config.json")

// Save pause state to file
async function savePauseState(): Promise<void> {
  try {
    await fs.writeFile(PAUSE_STATE_FILE, JSON.stringify(pauseState, null, 2), "utf8")
    console.log("[Pause API] Saved pause state to file")
  } catch (error) {
    console.error("[Pause API] Error saving pause state:", error)
  }
}

// Load pause state from file
async function loadPauseState(): Promise<void> {
  try {
    const data = await fs.readFile(PAUSE_STATE_FILE, "utf8")
    pauseState = JSON.parse(data)
    console.log("[Pause API] Loaded pause state from file")
  } catch (error) {
    console.log("[Pause API] No saved pause state found, using defaults")
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

// Initialize pause state from file on module load
loadPauseState()

export async function GET() {
  try {
    // Load current state from file
    await loadPauseState()

    const config = await loadProcessingConfig()

    return NextResponse.json({
      ...pauseState,
      hasConfig: !!config,
      config: config,
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

    console.log(`[Pause API] Received action: ${action}`)

    switch (action) {
      case "pause":
        pauseState.isPaused = true
        pauseState.shouldStop = false
        pauseState.timestamp = new Date().toISOString()
        await savePauseState()

        if (config) {
          await saveProcessingConfig(config)
        }

        console.log("[Pause API] Processing paused")
        break

      case "stop":
        pauseState.isPaused = false
        pauseState.shouldStop = true
        pauseState.timestamp = new Date().toISOString()
        await savePauseState()

        if (config) {
          await saveProcessingConfig(config)
        }

        console.log("[Pause API] Processing stopped")
        break

      case "resume":
        pauseState.isPaused = false
        pauseState.shouldStop = false
        pauseState.timestamp = new Date().toISOString()
        await savePauseState()
        console.log("[Pause API] Processing resumed")
        break

      case "reset":
        pauseState.isPaused = false
        pauseState.shouldStop = false
        pauseState.timestamp = new Date().toISOString()
        await savePauseState()
        await clearProcessingConfig()
        console.log("[Pause API] State reset")
        break

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      state: pauseState,
    })
  } catch (error) {
    console.error("[Pause API] Error updating pause state:", error)
    return NextResponse.json({ error: "Failed to update pause state" }, { status: 500 })
  }
}

// Export functions for use by other modules
export function getPauseState(): PauseState {
  return { ...pauseState }
}

export function setPauseState(newState: Partial<PauseState>): void {
  pauseState = { ...pauseState, ...newState }
  savePauseState()
}

export function resetPauseState(): void {
  pauseState = {
    isPaused: false,
    shouldStop: false,
    timestamp: new Date().toISOString(),
  }
  savePauseState()
}
