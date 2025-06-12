import { type NextRequest, NextResponse } from "next/server"
import { stopWatcher } from "@/lib/watcher-manager"

export async function POST(request: NextRequest) {
  try {
    const stopped = stopWatcher((message) => console.log(message))
    if (stopped) {
      return NextResponse.json({ success: true, message: "Watcher stopped successfully." })
    } else {
      return NextResponse.json({ success: false, message: "No active watcher to stop." })
    }
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to stop watcher", message: error.message }, { status: 500 })
  }
}
