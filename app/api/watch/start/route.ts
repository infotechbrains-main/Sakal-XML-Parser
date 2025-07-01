import type { NextRequest } from "next/server"
import { startWatcher } from "@/lib/file-watcher"
import path from "path"
import fs from "fs/promises"

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    rootDir,
    filterConfig,
    outputFile = "watched_images.csv",
    outputFolder = "", // Add this line
    numWorkers = 1,
    verbose = false,
  } = body

  if (!rootDir) {
    return new Response("Root directory is required", { status: 400 })
  }

  // Create full output path
  const fullOutputPath = outputFolder ? path.join(outputFolder, outputFile) : outputFile

  // Ensure output directory exists
  if (outputFolder) {
    try {
      await fs.mkdir(outputFolder, { recursive: true })
    } catch (error) {
      console.error("Error creating output directory:", error)
      return new Response(`Failed to create output directory: ${outputFolder}`, { status: 400 })
    }
  }

  try {
    const result = await startWatcher({
      rootDir,
      filterConfig,
      outputFile: fullOutputPath, // Use fullOutputPath here
      numWorkers,
      verbose,
    })

    if (result.success) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "File watcher started successfully",
          watcherId: result.watcherId,
          watchingPath: rootDir,
          outputFile: fullOutputPath, // Return fullOutputPath
        }),
        { headers: { "Content-Type": "application/json" } },
      )
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: result.error,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}
