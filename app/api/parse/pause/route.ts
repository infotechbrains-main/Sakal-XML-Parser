import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

interface PauseState {
  isPaused: boolean
  pauseRequested: boolean
  shouldStop: boolean
  stopRequested: boolean
}

let pauseState: PauseState = {
  isPaused: false,
  pauseRequested: false,
  shouldStop: false,
  stopRequested: false,
}

// Export the functions that are used by other routes
export function getPauseState(): PauseState {
  return { ...pauseState }
}

export function resetPauseState() {
  pauseState = {
    isPaused: false,
    pauseRequested: false,
    shouldStop: false,
    stopRequested: false,
  }
  console.log("[Pause API] State reset")
}

export function setPauseState(newState: Partial<PauseState>): void {
  pauseState = {
    ...pauseState,
    ...newState,
  }
  console.log("[Pause API] State updated:", pauseState)
}

interface ProcessingConfig {
  rootDir: string
  outputFile: string
  outputFolder: string
  processingMode: string
  numWorkers: number
  verbose: boolean
  filterConfig: any
  chunkSize?: number
  pauseBetweenChunks?: boolean
  pauseDuration?: number
}

async function saveProcessingConfig(config: ProcessingConfig) {
  try {
    const configPath = path.join(process.cwd(), "last_processing_config.json")
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    console.log("[Pause API] Saved processing configuration")
  } catch (error) {
    console.error("[Pause API] Error saving processing config:", error)
  }
}

async function loadProcessingConfig(): Promise<ProcessingConfig | null> {
  try {
    const configPath = path.join(process.cwd(), "last_processing_config.json")
    const content = await fs.readFile(configPath, "utf-8")
    return JSON.parse(content)
  } catch (error) {
    console.log("[Pause API] No saved processing config found")
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, config } = body

    if (action === "pause") {
      setPauseState({
        isPaused: true,
        pauseRequested: true,
      })

      if (config) {
        await saveProcessingConfig(config)
      }

      console.log("[Pause API] Pause requested")
      return NextResponse.json({ success: true, message: "Pause requested" })
    }

    if (action === "stop") {
      setPauseState({
        shouldStop: true,
        stopRequested: true,
      })

      if (config) {
        await saveProcessingConfig(config)
      }

      console.log("[Pause API] Stop requested")
      return NextResponse.json({ success: true, message: "Stop requested" })
    }

    if (action === "reset") {
      resetPauseState()
      console.log("[Pause API] Pause state reset")
      return NextResponse.json({ success: true, message: "Pause state reset" })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[Pause API] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET() {
  try {
    const config = await loadProcessingConfig()
    return NextResponse.json({
      success: true,
      state: pauseState,
      savedConfig: config,
    })
  } catch (error) {
    console.error("[Pause API] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
