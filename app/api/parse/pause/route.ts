import { type NextRequest, NextResponse } from "next/server"

interface PauseState {
  isPaused: boolean
  shouldStop: boolean
  pauseRequested: boolean
  stopRequested: boolean
  sessionId?: string
  currentChunk?: number
  processedFiles?: number
  timestamp?: string
}

let globalPauseState: PauseState = {
  isPaused: false,
  shouldStop: false,
  pauseRequested: false,
  stopRequested: false,
}

export function getPauseState(): PauseState {
  return { ...globalPauseState }
}

export function setPauseState(newState: Partial<PauseState>): void {
  globalPauseState = {
    ...globalPauseState,
    ...newState,
    timestamp: new Date().toISOString(),
  }
  console.log("[Pause API] State updated:", globalPauseState)
}

export function resetPauseState(): void {
  globalPauseState = {
    isPaused: false,
    shouldStop: false,
    pauseRequested: false,
    stopRequested: false,
  }
  console.log("[Pause API] State reset")
}

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      state: globalPauseState,
    })
  } catch (error) {
    console.error("[Pause API] GET error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, sessionId, currentChunk, processedFiles } = body

    console.log(`[Pause API] Received ${action} request for session ${sessionId}`)

    if (action === "pause") {
      setPauseState({
        isPaused: true,
        pauseRequested: true,
        shouldStop: false,
        stopRequested: false,
        sessionId,
        currentChunk,
        processedFiles,
      })

      return NextResponse.json({
        success: true,
        message: "Pause request received",
        state: globalPauseState,
      })
    } else if (action === "stop") {
      setPauseState({
        isPaused: false,
        pauseRequested: false,
        shouldStop: true,
        stopRequested: true,
        sessionId,
        currentChunk,
        processedFiles,
      })

      return NextResponse.json({
        success: true,
        message: "Stop request received",
        state: globalPauseState,
      })
    } else if (action === "resume") {
      setPauseState({
        isPaused: false,
        pauseRequested: false,
        shouldStop: false,
        stopRequested: false,
      })

      return NextResponse.json({
        success: true,
        message: "Resume request received",
        state: globalPauseState,
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid action. Use 'pause', 'stop', or 'resume'",
        },
        { status: 400 },
      )
    }
  } catch (error) {
    console.error("[Pause API] POST error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
