import { type NextRequest, NextResponse } from "next/server"
import { stopWatcher } from "@/lib/watcher-manager"

export async function POST(request: NextRequest) {
  try {
    const result = await stopWatcher()

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Watcher stopped successfully",
      })
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }
  } catch (error: any) {
    console.error("Error stopping watcher:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
