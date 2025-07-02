import { type NextRequest, NextResponse } from "next/server"

// Global pause state that all processing routes can access
let globalPauseState = {
  isPaused: false,
  shouldStop: false,
  pauseRequested: false,
  stopRequested: false,
}

export function getPauseState() {
  return globalPauseState
}

export function setPauseState(newState: Partial<typeof globalPauseState>) {
  globalPauseState = { ...globalPauseState, ...newState }
}

export function resetPauseState() {
  globalPauseState = {
    isPaused: false,
    shouldStop: false,
    pauseRequested: false,
    stopRequested: false,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, jobId } = body

    console.log(`[Pause API] Received ${action} request for job: ${jobId || "unknown"}`)

    if (action === "pause") {
      globalPauseState.isPaused = true
      globalPauseState.pauseRequested = true
      console.log("[Pause API] Pause state set to true")

      return NextResponse.json({
        success: true,
        message: "Pause request processed",
        state: globalPauseState,
      })
    } else if (action === "stop") {
      globalPauseState.shouldStop = true
      globalPauseState.stopRequested = true
      globalPauseState.isPaused = false // Clear pause when stopping
      console.log("[Pause API] Stop state set to true")

      return NextResponse.json({
        success: true,
        message: "Stop request processed",
        state: globalPauseState,
      })
    } else if (action === "resume") {
      globalPauseState.isPaused = false
      globalPauseState.pauseRequested = false
      console.log("[Pause API] Pause state cleared (resumed)")

      return NextResponse.json({
        success: true,
        message: "Resume request processed",
        state: globalPauseState,
      })
    } else {
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
