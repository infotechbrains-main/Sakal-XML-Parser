import { NextResponse } from "next/server"
import { getWatcherStatus } from "@/lib/watcher-manager"

export async function GET() {
  try {
    const status = await getWatcherStatus()
    return NextResponse.json({
      success: true,
      ...status,
    })
  } catch (error: any) {
    console.error("Error getting watcher status:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get watcher status",
        message: error.message,
      },
      { status: 500 },
    )
  }
}
