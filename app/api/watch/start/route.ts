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
      return NextResponse.json({ success: false, error: "Root directory is required" }, { status: 400 })
    }

    // Validate that the directory exists
    try {
      const stats = fs.statSync(rootDir)
      if (!stats.isDirectory()) {
        return NextResponse.json(
          {
            success: false,
            error: "Path exists but is not a directory",
            path: rootDir,
          },
          { status: 400 },
        )
      }
    } catch (err: any) {
      console.error("Directory validation error:", err)
      return NextResponse.json(
        {
          success: false,
          error: "Directory does not exist or is not accessible",
          path: rootDir,
          details: err.message,
        },
        { status: 400 },
      )
    }

    // Ensure output directory exists
    const outputFilePath = outputFile || "watched_images.csv"
    const outputDir = path.dirname(path.resolve(outputFilePath))

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
    } catch (err: any) {
      console.error("Output directory creation error:", err)
      return NextResponse.json(
        {
          success: false,
          error: "Failed to create output directory",
          details: err.message,
        },
        { status: 500 },
      )
    }

    // Start the watcher with proper error handling
    const result = await startWatcher({
      rootDir,
      filterConfig: filterConfig || {},
      outputFile: outputFilePath,
      numWorkers: numWorkers || 1,
      verbose: verbose || false,
    })

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Watcher started successfully",
        watchingPath: rootDir,
        outputFile: outputFilePath,
        watcherId: result.watcherId,
      })
    } else {
      return NextResponse.json(
        {
          success: false,
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
        success: false,
        error: "Failed to start watcher",
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}
