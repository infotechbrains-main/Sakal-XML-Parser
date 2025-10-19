import { NextResponse } from "next/server"
import { PersistentHistory } from "@/lib/persistent-history"

const history = new PersistentHistory()

export async function GET() {
  try {
    const sessions = await history.getAllSessions()
    const storageInfo = await history.getStorageInfo()

    return NextResponse.json({
      success: true,
      history: sessions,
      storage: storageInfo,
    })
  } catch (error: unknown) {
    console.error("History GET error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({
      success: false,
      error: message,
      history: [],
    })
  }
}

export async function DELETE() {
  return NextResponse.json(
    {
      success: false,
      message: "Clearing history is disabled to preserve processing records.",
    },
    { status: 405 },
  )
}
