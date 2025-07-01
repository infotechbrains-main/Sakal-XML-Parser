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
          success: false,
          error: result.error,
        },
        { status: 400 },
      )
    }
  } catch (error: any) {
    console.error("Error stopping watcher:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to stop watcher",
        message: error.message,
      },
      { status: 500 },
    )
  }
}
