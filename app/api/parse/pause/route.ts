import { NextResponse } from "next/server"

// Global pause state
let pauseState = {
  shouldPause: false,
  shouldStop: false,
  isPaused: false,
}

export function getPauseState() {
  return pauseState
}

export function resetPauseState() {
  pauseState = {
    shouldPause: false,
    shouldStop: false,
    isPaused: false,
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action } = body

    switch (action) {
      case "pause":
        pauseState.shouldPause = true
        pauseState.isPaused = true
        return NextResponse.json({ success: true, message: "Pause requested" })

      case "stop":
        pauseState.shouldStop = true
        pauseState.shouldPause = false
        pauseState.isPaused = false
        return NextResponse.json({ success: true, message: "Stop requested" })

      case "resume":
        pauseState.shouldPause = false
        pauseState.isPaused = false
        return NextResponse.json({ success: true, message: "Resume requested" })

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Pause API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
