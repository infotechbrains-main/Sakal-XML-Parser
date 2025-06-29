import { type NextRequest, NextResponse } from "next/server"
import { PersistentHistory } from "@/lib/persistent-history"

export async function DELETE(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const success = await PersistentHistory.deleteSession(params.sessionId)

    return NextResponse.json({
      success,
      message: success ? "Session deleted successfully" : "Failed to delete session",
    })
  } catch (error) {
    console.error("Error deleting session:", error)
    return NextResponse.json({
      success: false,
      message: "Error deleting session",
    })
  }
}

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const history = await PersistentHistory.loadHistory()
    const session = history.find((s) => s.id === params.sessionId)

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          error: "Session not found",
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      session,
    })
  } catch (error) {
    console.error("Error loading session:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load session",
      },
      { status: 500 },
    )
  }
}
