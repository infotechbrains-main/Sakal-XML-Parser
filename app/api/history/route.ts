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
  } catch (error) {
    console.error("History GET error:", error)
    return NextResponse.json({
      success: false,
      error: error.message,
      history: [],
    })
  }
}

export async function DELETE() {
  try {
    const success = await history.clearHistory()

    return NextResponse.json({
      success,
      message: success ? "History cleared successfully" : "Failed to clear history",
    })
  } catch (error) {
    console.error("History DELETE error:", error)
    return NextResponse.json({
      success: false,
      error: error.message,
    })
  }
}
