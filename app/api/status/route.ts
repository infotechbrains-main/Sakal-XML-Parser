import type { NextRequest } from "next/server"

export async function GET(req: NextRequest) {
  return Response.json({
    status: "ready",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  })
}
