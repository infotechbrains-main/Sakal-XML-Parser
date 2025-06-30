import { type NextRequest, NextResponse } from "next/server"
import { PersistentHistory } from "@/lib/persistent-history"

const history = new PersistentHistory()

export async function DELETE(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const sessionId = params.sessionId
    const success = await history.deleteSession(sessionId)

    return NextResponse.json({
      success,
      message: success ? "Session deleted successfully" : "Session not found",
    })
  } catch (error) {
    console.error("Session DELETE error:", error)
    return NextResponse.json({
      success: false,
      error: error.message,
    })
  }
}

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const sessionId = params.sessionId
    const sessions = await history.getAllSessions()
    const session = sessions.find((s) => s.id === sessionId)

    if (!session) {
      return NextResponse.json({
        success: false,
        error: "Session not found",
      })
    }

    return NextResponse.json({
      success: true,
      session,
    })
  } catch (error) {
    console.error("Session GET error:", error)
    return NextResponse.json({
      success: false,
      error: error.message,
    })
  }
}
