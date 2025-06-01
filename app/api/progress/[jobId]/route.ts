import type { NextRequest } from "next/server"

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const { jobId } = params

  // Simulate progress tracking
  // In a real implementation, you would check actual job progress
  const mockProgress = {
    jobId,
    status: "running",
    progress: Math.floor(Math.random() * 100),
    processedFiles: Math.floor(Math.random() * 1000),
    totalFiles: 1000,
    errors: Math.floor(Math.random() * 10),
    startTime: Date.now() - 60000,
    estimatedCompletion: Date.now() + 30000,
  }

  return Response.json(mockProgress)
}
