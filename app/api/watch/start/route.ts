import { type NextRequest, NextResponse } from "next/server"
import { startWatcher } from "@/lib/watcher-manager"
import fs from "fs"
import path from "path"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { rootDir, filterConfig, outputFile, numWorkers, verbose } = body

    console.log("Watch start request:", { rootDir, filterConfig, outputFile, numWorkers, verbose })

    if (!rootDir) {
      return NextResponse.json({ error: "Root directory is required" }, { status: 400 })
    }

    // Validate that the directory exists
    if (!fs.existsSync(rootDir)) {
      return NextResponse.json(
        {
          error: "Directory does not exist",
          path: rootDir,
        },
        { status: 400 },
      )
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputFile || "image_metadata.csv")
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Start the watcher with proper error handling
    const result = await startWatcher({
      rootDir,
      filterConfig: filterConfig || {},
      outputFile: outputFile || "image_metadata.csv",
      numWorkers: numWorkers || 1,
      verbose: verbose || false,
    })

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Watcher started successfully",
        watchingPath: rootDir,
        outputFile: outputFile || "image_metadata.csv",
        watcherId: result.watcherId,
      })
    } else {
      return NextResponse.json(
        {
          error: "Failed to start watcher",
          message: result.error,
        },
        { status: 500 },
      )
    }
  } catch (error: any) {
    console.error("Watch start error:", error)
    return NextResponse.json(
      {
        error: "Failed to start watcher",
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}
