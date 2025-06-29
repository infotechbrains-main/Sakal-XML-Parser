import { type NextRequest, NextResponse } from "next/server"
import { PersistentHistory } from "@/lib/persistent-history"

export async function GET() {
  try {
    const currentSession = await PersistentHistory.getCurrentSession()
    const canResume =
      currentSession &&
      (currentSession.status === "interrupted" ||
        currentSession.status === "paused" ||
        currentSession.status === "running")

    return NextResponse.json({
      success: true,
      canResume: !!canResume,
      session: canResume ? currentSession : null,
      message: canResume ? "Resume session available" : "No session to resume",
    })
  } catch (error) {
    console.error("Error checking resume status:", error)
    return NextResponse.json({
      success: true,
      canResume: false,
      session: null,
      message: "Error checking resume status",
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { sessionId } = body

    if (sessionId) {
      // Resume specific session from history
      const history = await PersistentHistory.loadHistory()
      const session = history.find((s) => s.id === sessionId)

      if (!session) {
        return NextResponse.json(
          {
            success: false,
            error: "Session not found in history",
          },
          { status: 404 },
        )
      }

      // Set as current session for resume
      const resumeSession = {
        ...session,
        status: "running" as const,
      }

      const success = await PersistentHistory.saveCurrentSession(resumeSession)

      if (success) {
        await PersistentHistory.updateSession(sessionId, { status: "running" })
      }

      return NextResponse.json({
        success,
        message: success ? "Session prepared for resume" : "Failed to prepare session",
        session: resumeSession,
      })
    } else {
      // Resume current session
      const currentSession = await PersistentHistory.getCurrentSession()

      if (!currentSession) {
        return NextResponse.json(
          {
            success: false,
            error: "No current session to resume",
          },
          { status: 400 },
        )
      }

      // Update status to running
      const resumeSession = {
        ...currentSession,
        status: "running" as const,
      }

      const success = await PersistentHistory.saveCurrentSession(resumeSession)

      if (success) {
        await PersistentHistory.updateSession(currentSession.id, { status: "running" })
      }

      return NextResponse.json({
        success,
        message: success ? "Processing resumed" : "Failed to resume processing",
        session: resumeSession,
      })
    }
  } catch (error) {
    console.error("Error resuming processing:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to resume processing",
      },
      { status: 500 },
    )
  }
}

export async function DELETE() {
  try {
    const success = await PersistentHistory.clearCurrentSession()

    return NextResponse.json({
      success,
      message: success ? "Current session cleared" : "Failed to clear current session",
    })
  } catch (error) {
    console.error("Error clearing current session:", error)
    return NextResponse.json({
      success: false,
      message: "Error clearing current session",
    })
  }
}
