import { type NextRequest, NextResponse } from "next/server"

// Global pause state
let globalPauseState = {
  isPaused: false,
  shouldStop: false,
  timestamp: Date.now(),
}

export function getPauseState() {
  return { ...globalPauseState }
}

export function resetPauseState() {
  globalPauseState = {
    isPaused: false,
    shouldStop: false,
    timestamp: Date.now(),
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    switch (action) {
      case "pause":
        globalPauseState.isPaused = true
        globalPauseState.timestamp = Date.now()
        return NextResponse.json({
          success: true,
          message: "Processing paused",
          state: globalPauseState,
        })

      case "resume":
        globalPauseState.isPaused = false
        globalPauseState.timestamp = Date.now()
        return NextResponse.json({
          success: true,
          message: "Processing resumed",
          state: globalPauseState,
        })

      case "stop":
        globalPauseState.shouldStop = true
        globalPauseState.isPaused = false
        globalPauseState.timestamp = Date.now()
        return NextResponse.json({
          success: true,
          message: "Processing stopped",
          state: globalPauseState,
        })

      case "status":
        return NextResponse.json({
          success: true,
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
