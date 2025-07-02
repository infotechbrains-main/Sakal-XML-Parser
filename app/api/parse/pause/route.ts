import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

interface PauseState {
  isPaused: boolean
  shouldStop: boolean
  pauseRequested: boolean
  stopRequested: boolean
  lastUpdated: string
  sessionId?: string
  currentChunk?: number
  processedFiles?: number
}

// Global pause state that all processing routes can access
let globalPauseState: PauseState = {
  isPaused: false,
  shouldStop: false,
  pauseRequested: false,
  stopRequested: false,
  lastUpdated: new Date().toISOString(),
}

const PAUSE_STATE_FILE = path.join(process.cwd(), "pause_state.json")

// Load pause state from file on startup
async function loadPauseState(): Promise<void> {
  try {
    const data = await fs.readFile(PAUSE_STATE_FILE, "utf-8")
    const savedState = JSON.parse(data)
    globalPauseState = { ...globalPauseState, ...savedState }
    console.log("[Pause API] Loaded pause state from file:", globalPauseState)
  } catch (error) {
    // File doesn't exist or can't be read - use default state
    console.log("[Pause API] No saved pause state found, using default")
  }
}

// Save pause state to file
async function savePauseState(): Promise<void> {
  try {
    await fs.writeFile(PAUSE_STATE_FILE, JSON.stringify(globalPauseState, null, 2))
    console.log("[Pause API] Saved pause state to file")
  } catch (error) {
    console.error("[Pause API] Failed to save pause state:", error)
  }
}

// Initialize pause state on module load
loadPauseState()

export function getPauseState(): PauseState {
  return { ...globalPauseState }
}

export function setPauseState(newState: Partial<PauseState>): void {
  globalPauseState = {
    ...globalPauseState,
    ...newState,
    lastUpdated: new Date().toISOString(),
  }
  // Save to file asynchronously
  savePauseState().catch(console.error)
}

export function resetPauseState(): void {
  globalPauseState = {
    isPaused: false,
    shouldStop: false,
    pauseRequested: false,
    stopRequested: false,
    lastUpdated: new Date().toISOString(),
  }
  // Save to file asynchronously
  savePauseState().catch(console.error)
  console.log("[Pause API] Reset pause state")
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, jobId, sessionId, currentChunk, processedFiles } = body

    console.log(`[Pause API] Received ${action} request for session: ${sessionId || jobId || "unknown"}`)

    switch (action) {
      case "pause":
        setPauseState({
          isPaused: true,
          pauseRequested: true,
          sessionId,
          currentChunk,
          processedFiles,
        })
        console.log("[Pause API] Pause state set to true")
        return NextResponse.json({
          success: true,
          message: "Pause request processed",
          state: globalPauseState,
        })

      case "stop":
        setPauseState({
          shouldStop: true,
          stopRequested: true,
          isPaused: false,
          sessionId,
          currentChunk,
          processedFiles,
        })
        console.log("[Pause API] Stop state set to true")
        return NextResponse.json({
          success: true,
          message: "Stop request processed",
          state: globalPauseState,
        })

      case "resume":
        setPauseState({
          isPaused: false,
          pauseRequested: false,
        })
        console.log("[Pause API] Pause state cleared (resumed)")
        return NextResponse.json({
          success: true,
          message: "Resume request processed",
          state: globalPauseState,
        })

      default:
        return NextResponse.json(
          {
            success: false,
            message: "Invalid action. Use 'pause', 'stop', or 'resume'",
          },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error("[Pause API] Error:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Failed to process pause/stop request",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    state: globalPauseState,
  })
}

export async function DELETE() {
  try {
    await fs.unlink(PAUSE_STATE_FILE)
    resetPauseState()
    return NextResponse.json({
      success: true,
      message: "Pause state cleared",
    })
  } catch (error) {
    // File doesn't exist - that's fine
    resetPauseState()
    return NextResponse.json({
      success: true,
      message: "Pause state cleared",
    })
  }
}
