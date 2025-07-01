import { type NextRequest, NextResponse } from "next/server"
import { startWatcher } from "@/lib/watcher-manager"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { rootDir, filterConfig, outputFile, numWorkers = 1, verbose = false } = body

    if (!rootDir) {
      return NextResponse.json({ success: false, error: "Root directory is required" }, { status: 400 })
    }

    const result = await startWatcher({
      rootDir,
      filterConfig,
      outputFile: outputFile || "watched_images.csv",
      numWorkers,
      verbose,
    })

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `Watcher started for directory: ${rootDir}`,
        watcherId: result.watcherId,
      })
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }
  } catch (error: any) {
    console.error("Error starting watcher:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
