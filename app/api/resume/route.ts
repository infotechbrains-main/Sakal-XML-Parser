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
    } catch (error) {
      return NextResponse.json({
        hasState: false,
        message: "No previous processing state found",
      })
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to check processing state",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function DELETE() {
  try {
    const statePath = path.join(process.cwd(), "processing_state.json")

    try {
      await fs.unlink(statePath)
      return NextResponse.json({
        message: "Processing state cleared successfully",
      })
    } catch (error) {
      return NextResponse.json({
        message: "No processing state to clear",
      })
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to clear processing state",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
