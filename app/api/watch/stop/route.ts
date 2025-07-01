import { NextResponse } from "next/server"
import { stopWatcher } from "@/lib/watcher-manager"

export async function POST() {
  try {
    const result = await stopWatcher()

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Watcher stopped successfully",
      })
    } else {
      return NextResponse.json(
        {
          error: "Failed to stop watcher",
          message: result.error,
        },
        { status: 500 },
      )
    }
  } catch (error: any) {
    console.error("Watch stop error:", error)
    return NextResponse.json(
      {
        error: "Failed to stop watcher",
        message: error.message,
      },
      { status: 500 },
    )
  }
}
