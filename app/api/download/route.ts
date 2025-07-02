import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filePath = searchParams.get("file")

    if (!filePath) {
      return NextResponse.json({ error: "File path is required" }, { status: 400 })
    }

    console.log(`[Download API] Requested file: ${filePath}`)

    // Check if file exists
    try {
      await fs.access(filePath)
    } catch (error) {
      console.error(`[Download API] File not found: ${filePath}`)
      console.error("Error details:", error)
      return NextResponse.json(
        {
          error: "File not found",
          path: filePath,
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 404 },
      )
    }

    // Read file
    const fileBuffer = await fs.readFile(filePath)
    const fileName = path.basename(filePath)

    console.log(`[Download API] Successfully serving file: ${fileName} (${fileBuffer.length} bytes)`)

    // Return file with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": fileBuffer.length.toString(),
      },
    })
  } catch (error) {
    console.error("[Download API] Error:", error)
    return NextResponse.json(
      {
        error: "Failed to download file",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
