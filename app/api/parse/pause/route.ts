import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

// Global pause state
let globalPauseState = {
  shouldPause: false,
  pauseRequested: false,
  currentJobId: null as string | null,
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { action = "pause", jobId } = body

    if (action === "pause") {
      globalPauseState.shouldPause = true
      globalPauseState.pauseRequested = true
      globalPauseState.currentJobId = jobId || null

      // Save pause state to file for persistence
      try {
        const pauseStatePath = path.join(process.cwd(), "pause_state.json")
        await fs.writeFile(pauseStatePath, JSON.stringify(globalPauseState, null, 2))
      } catch (error) {
        console.error("Error saving pause state:", error)
      }

      return NextResponse.json({
        success: true,
        message: "Pause request received and processing will stop gracefully",
        status: "pausing",
      })
    } else if (action === "stop") {
      globalPauseState.shouldPause = true
      globalPauseState.pauseRequested = true
      globalPauseState.currentJobId = jobId || null

      return NextResponse.json({
        success: true,
        message: "Stop request received and processing will terminate",
        status: "stopping",
      })
    }

    return NextResponse.json(
      {
        success: false,
        error: "Invalid action",
      },
      { status: 400 },
    )
  } catch (error) {
    console.error("Error in pause/stop processing:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to pause/stop processing",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    pauseState: globalPauseState,
  })
}

// Export the pause state for other modules to check
export function getPauseState() {
  return globalPauseState
}

export function resetPauseState() {
  globalPauseState = {
    shouldPause: false,
    pauseRequested: false,
    currentJobId: null,
  }
}
