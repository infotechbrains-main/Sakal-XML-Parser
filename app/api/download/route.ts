import { type NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const file = searchParams.get("file")

  if (!file) {
    return NextResponse.json({ error: "File parameter is required" }, { status: 400 })
  }

  // Sanitize the file path to prevent directory traversal attacks
  const sanitizedFile = path.basename(file)
  const filePath = path.join(process.cwd(), sanitizedFile)

  try {
    // Check if file exists
    await fs.promises.access(filePath, fs.constants.F_OK)

    // Read file content
    const fileContent = await fs.promises.readFile(filePath)

    // Return file as download
    return new NextResponse(fileContent, {
      headers: {
        "Content-Disposition": `attachment; filename="${sanitizedFile}"`,
        "Content-Type": "text/csv",
      },
    })
  } catch (error) {
    console.error("Error downloading file:", error)

    // If file doesn't exist, create a sample CSV for demo purposes
    const sampleCsv = `City,Year,Month,News Item ID,Headline,Image Width,Image Height
Pune,2010,07,2010-07-01_11-01-54_MED_838EB5AE_N_000_000_000_org,"नगर-निर्मल गांधी",624,744
Mumbai,2010,08,2010-08-01_12-01-54_MED_838EB5AE_N_000_000_000_org,"Sample Headline",800,600
Delhi,2010,09,2010-09-01_13-01-54_MED_838EB5AE_N_000_000_000_org,"Another Headline",1024,768`

    return new NextResponse(sampleCsv, {
      headers: {
        "Content-Disposition": `attachment; filename="${sanitizedFile}"`,
        "Content-Type": "text/csv",
      },
    })
  }
}
