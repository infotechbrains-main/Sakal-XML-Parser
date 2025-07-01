import { type NextRequest, NextResponse } from "next/server"
import { getWatcherStatus } from "@/lib/watcher-manager"

export async function GET(request: NextRequest) {
  try {
    const status = await getWatcherStatus()
    return NextResponse.json(status)
  } catch (error: any) {
    console.error("Error getting watcher status:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
