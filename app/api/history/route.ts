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
      storage: null,
    })
  }
}

export async function DELETE() {
  try {
    await history.clearAllHistory()
    return NextResponse.json({
      success: true,
      message: "History cleared successfully",
    })
  } catch (error) {
    console.error("History DELETE error:", error)
    return NextResponse.json({
      success: false,
      error: error.message,
    })
  }
}
