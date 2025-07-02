import { type NextRequest, NextResponse } from "next/server"

// Global pause state
let globalPauseState = {
  isPaused: false,
  shouldStop: false,
  pauseRequested: false,
  stopRequested: false,
}

export function getPauseState() {
  return globalPauseState
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
    const { action } = body

    switch (action) {
      case "pause":
        globalPauseState.isPaused = true
        globalPauseState.pauseRequested = true
        return NextResponse.json({
          success: true,
          message: "Pause requested",
          state: globalPauseState,
        })

      case "resume":
        globalPauseState.isPaused = false
        globalPauseState.pauseRequested = false
        return NextResponse.json({
          success: true,
          message: "Resume requested",
          state: globalPauseState,
        })

      case "stop":
        globalPauseState.shouldStop = true
        globalPauseState.stopRequested = true
        globalPauseState.isPaused = false
        return NextResponse.json({
          success: true,
          message: "Stop requested",
          state: globalPauseState,
        })

      default:
        return NextResponse.json(
          {
            success: false,
            error: "Invalid action",
          },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error("Pause route error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
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
