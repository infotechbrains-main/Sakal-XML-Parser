import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Forward the request to the chunked processing endpoint with resume flag
    const chunkedRequest = {
      ...body,
      resumeFromState: true,
    }

    // Create a new request to the chunked endpoint
    const chunkedResponse = await fetch(`${request.nextUrl.origin}/api/parse/chunked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunkedRequest),
    })

    // Return the stream response from chunked processing
    return new Response(chunkedResponse.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    console.error("[Resume API] Error:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Failed to resume processing",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
