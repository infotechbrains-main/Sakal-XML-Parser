import { type NextRequest, NextResponse } from "next/server"
import { startWatcher } from "@/lib/watcher-manager"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      rootDir,
      filterConfig,
      outputFile = "watched_images.csv",
      outputFolder = "",
      numWorkers = 1,
      verbose = false,
    } = body

    if (!rootDir) {
      return NextResponse.json({ success: false, error: "Root directory is required" }, { status: 400 })
    }

    // Create full output path
    const fullOutputPath = outputFolder ? `${outputFolder}/${outputFile}` : outputFile

    const result = await startWatcher({
      rootDir,
      filterConfig,
      outputFile: fullOutputPath,
      numWorkers,
      verbose,
    })

    if (result.success) {
      return NextResponse.json({
        success: true,
        watcherId: result.watcherId,
        watchingPath: rootDir,
        outputFile: fullOutputPath,
        message: "File watcher started successfully",
      })
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }
  } catch (error) {
    console.error("Error starting watcher:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
