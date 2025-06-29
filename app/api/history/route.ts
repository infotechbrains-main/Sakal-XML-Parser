import { NextResponse } from "next/server"
import { PersistentHistory } from "@/lib/persistent-history"

export async function GET() {
  try {
    const history = await PersistentHistory.loadHistory()
    const storageInfo = await PersistentHistory.getStorageInfo()

    return NextResponse.json({
      success: true,
      history,
      storageInfo,
      message: `Loaded ${history.length} sessions from persistent storage`,
    })
  } catch (error) {
    console.error("Error in history GET:", error)
    return NextResponse.json({
      success: true,
      history: [],
      storageInfo: null,
      message: "Failed to load history, using fallback",
    })
  }
}

export async function DELETE() {
  try {
    const success = await PersistentHistory.clearHistory()

    return NextResponse.json({
      success,
      message: success ? "History cleared successfully" : "Failed to clear history",
    })
  } catch (error) {
    console.error("Error in history DELETE:", error)
    return NextResponse.json({
      success: false,
      message: "Error clearing history",
    })
  }
}
