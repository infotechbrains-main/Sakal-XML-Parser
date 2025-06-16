import { NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

export async function GET() {
  try {
    const statePath = path.join(process.cwd(), "processing_state.json")

    try {
      const stateContent = await fs.readFile(statePath, "utf-8")
      const state = JSON.parse(stateContent)

      return NextResponse.json({
        hasState: true,
        state,
        message: "Previous processing state found",
      })
    } catch (fileError) {
      // File doesn't exist or can't be read - this is normal
      return NextResponse.json({
        hasState: false,
        message: "No previous processing state found",
      })
    }
  } catch (error) {
    console.error("Error in processing-state GET:", error)
    return NextResponse.json(
      {
        hasState: false,
        error: "Failed to check processing state",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 200 }, // Return 200 instead of 500 to avoid fetch errors
    )
  }
}

export async function DELETE() {
  try {
    const statePath = path.join(process.cwd(), "processing_state.json")

    try {
      await fs.unlink(statePath)
      return NextResponse.json({
        success: true,
        message: "Processing state cleared successfully",
      })
    } catch (fileError) {
      // File doesn't exist - this is fine
      return NextResponse.json({
        success: true,
        message: "No processing state to clear",
      })
    }
  } catch (error) {
    console.error("Error in processing-state DELETE:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to clear processing state",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 200 }, // Return 200 instead of 500 to avoid fetch errors
    )
  }
}
