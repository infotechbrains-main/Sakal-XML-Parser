import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

interface PauseState {
  isPaused: boolean
  shouldStop: boolean
  timestamp: string
}

const PAUSE_STATE_FILE = path.join(process.cwd(), "pause_state.json")

let pauseState: PauseState = {
  isPaused: false,
  shouldStop: false,
  timestamp: new Date().toISOString(),
}

// Load pause state from file on startup
async function loadPauseState(): Promise<void> {
  try {
    const data = await fs.readFile(PAUSE_STATE_FILE, "utf8")
    const savedState = JSON.parse(data)
    pauseState = { ...pauseState, ...savedState }
    console.log("[Pause API] Loaded pause state:", pauseState)
  } catch (error) {
    // File doesn't exist or is invalid, use default state
    console.log("[Pause API] No saved pause state found, using default")
  }
}

// Save pause state to file
async function savePauseState(): Promise<void> {
  try {
    await fs.writeFile(PAUSE_STATE_FILE, JSON.stringify(pauseState, null, 2), "utf8")
    console.log("[Pause API] Saved pause state:", pauseState)
  } catch (error) {
    console.error("[Pause API] Error saving pause state:", error)
  }
}

// Initialize pause state on module load
loadPauseState()

export function getPauseState(): PauseState {
  return { ...pauseState }
}

export function resetPauseState(): void {
  pauseState = {
    isPaused: false,
    shouldStop: false,
    timestamp: new Date().toISOString(),
  }
  savePauseState()
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    console.log(`[Pause API] Received action: ${action}`)

    switch (action) {
      case "pause":
        pauseState.isPaused = true
        pauseState.shouldStop = false
        pauseState.timestamp = new Date().toISOString()
        await savePauseState()
        console.log("[Pause API] Processing paused")
        return NextResponse.json({
          success: true,
          message: "Processing paused",
          state: pauseState,
        })

      case "resume":
        pauseState.isPaused = false
        pauseState.shouldStop = false
        pauseState.timestamp = new Date().toISOString()
        await savePauseState()
        console.log("[Pause API] Processing resumed")
        return NextResponse.json({
          success: true,
          message: "Processing resumed",
          state: pauseState,
        })

      case "stop":
        pauseState.isPaused = false
        pauseState.shouldStop = true
        pauseState.timestamp = new Date().toISOString()
        await savePauseState()
        console.log("[Pause API] Processing stopped")
        return NextResponse.json({
          success: true,
          message: "Processing stopped",
          state: pauseState,
        })

      case "reset":
        resetPauseState()
        console.log("[Pause API] Processing state reset")
        return NextResponse.json({
          success: true,
          message: "Processing state reset",
          state: pauseState,
        })

      case "status":
        return NextResponse.json({
          success: true,
          state: pauseState,
        })

      default:
        return NextResponse.json(
          {
            success: false,
            message: "Invalid action. Use 'pause', 'resume', 'stop', 'reset', or 'status'",
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
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    state: pauseState,
  })
}
