import { type NextRequest, NextResponse } from "next/server"
import { PersistentHistory } from "@/lib/persistent-history"

const history = new PersistentHistory()

export async function GET() {
  try {
    const currentSession = await history.getCurrentSession()
    const canResume = currentSession && (currentSession.status === "interrupted" || currentSession.status === "paused")

    return NextResponse.json({
      success: true,
      canResume,
      session: canResume ? currentSession : null,
    })
  } catch (error) {
    console.error("Resume GET error:", error)
    return NextResponse.json({
      success: false,
      canResume: false,
      session: null,
      error: error.message,
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = body

    if (sessionId) {
      // Resume specific session
      const sessions = await history.getAllSessions()
      const session = sessions.find((s) => s.id === sessionId)

      if (!session) {
        return NextResponse.json({
          success: false,
          error: "Session not found",
        })
      }

      // Mark as current session for resume
      await history.updateSession(sessionId, { status: "running" })

      return NextResponse.json({
        success: true,
        session,
        message: "Session prepared for resume",
      })
    } else {
      // Resume current session
      const currentSession = await history.getCurrentSession()

      if (!currentSession) {
        return NextResponse.json({
          success: false,
          error: "No session to resume",
        })
      }

      await history.updateSession(currentSession.id, { status: "running" })

      return NextResponse.json({
        success: true,
        session: currentSession,
        message: "Session resumed",
      })
    }
  } catch (error) {
    console.error("Resume POST error:", error)
    return NextResponse.json({
      success: false,
      error: error.message,
    })
  }
}

export async function DELETE() {
  try {
    await history.clearCurrentSession()
    return NextResponse.json({
      success: true,
      message: "Current session cleared",
    })
  } catch (error) {
    console.error("Resume DELETE error:", error)
    return NextResponse.json({
      success: false,
      error: error.message,
    })
  }
}
