import type { NextRequest } from "next/server"
import path from "path"
import fs from "fs/promises"

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    rootDir,
    outputFile = "image_metadata.csv",
    outputFolder = "", // Add this line
    numWorkers = 4,
    verbose = false,
    filterConfig = null,
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

  // Update the rest of the function to use fullOutputPath instead of outputFile
  const outputPath = path.resolve(fullOutputPath)

  // TODO: Implement the image parsing logic here, using rootDir, outputPath, numWorkers, verbose, and filterConfig
  // This is just a placeholder for the actual image parsing process
  console.log("rootDir:", rootDir)
  console.log("outputPath:", outputPath)
  console.log("numWorkers:", numWorkers)
  console.log("verbose:", verbose)
  console.log("filterConfig:", filterConfig)

  return new Response(JSON.stringify({ message: "Image parsing initiated", outputPath: outputPath }), {
    headers: { "Content-Type": "application/json" },
  })
}
