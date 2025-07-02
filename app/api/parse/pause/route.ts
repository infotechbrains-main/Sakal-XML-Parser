import { type NextRequest, NextResponse } from "next/server"

// Global pause state
let pauseState = {
  isPaused: false,
  shouldStop: false,
  pauseRequested: false,
  stopRequested: false,
  lastUpdated: new Date().toISOString(),
}

export function getPauseState() {
  return { ...pauseState }
}

export function resetPauseState() {
  pauseState = {
    isPaused: false,
    shouldStop: false,
    pauseRequested: false,
    stopRequested: false,
    lastUpdated: new Date().toISOString(),
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, jobId } = body

    console.log(`[Pause API] Received action: ${action}${jobId ? ` for job: ${jobId}` : ""}`)

    switch (action) {
      case "pause":
        pauseState.isPaused = true
        pauseState.pauseRequested = true
        pauseState.lastUpdated = new Date().toISOString()
        console.log("[Pause API] Processing paused")
        return NextResponse.json({
          success: true,
          message: "Processing paused",
          state: pauseState,
        })

      case "resume":
        pauseState.isPaused = false
        pauseState.pauseRequested = false
        pauseState.lastUpdated = new Date().toISOString()
        console.log("[Pause API] Processing resumed")
        return NextResponse.json({
          success: true,
          message: "Processing resumed",
          state: pauseState,
        })

      case "stop":
        pauseState.shouldStop = true
        pauseState.stopRequested = true
        pauseState.isPaused = false
        pauseState.lastUpdated = new Date().toISOString()
        console.log("[Pause API] Processing stopped")
        return NextResponse.json({
          success: true,
          message: "Processing stopped",
          state: pauseState,
        })

      default:
        return NextResponse.json(
          {
            success: false,
            error: `Unknown action: ${action}`,
          },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error("[Pause API] Error:", error)
    return NextResponse.json(
      {
        success: false,
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
