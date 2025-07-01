import { NextResponse } from "next/server"
import { getWatcherStatus } from "@/lib/watcher-manager"

export async function GET() {
  try {
    const status = await getWatcherStatus()
    return NextResponse.json(status)
  } catch (error: any) {
    console.error("Watch status error:", error)
    return NextResponse.json(
      {
        error: "Failed to get watcher status",
        message: error.message,
      },
      { status: 500 },
    )
  }
}
