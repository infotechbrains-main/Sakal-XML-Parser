import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

// File paths for state persistence
const PAUSE_STATE_FILE = path.join(process.cwd(), "pause_state.json")
const PROCESSING_CONFIG_FILE = path.join(process.cwd(), "processing_config.json")

// Global pause state
let isPaused = false
let pauseState: any = null
let processingConfig: any = null

// Load pause state from file
async function loadPauseState() {
  try {
    const data = await fs.readFile(PAUSE_STATE_FILE, "utf-8")
    const state = JSON.parse(data)
    isPaused = state.isPaused || false
    pauseState = state.pauseState || null
    console.log("[Pause API] Loaded pause state from file:", { isPaused, pauseState })
    return state
  } catch (error) {
    console.log("[Pause API] No existing pause state file found")
    return { isPaused: false, pauseState: null }
  }
}

// Save pause state to file
async function savePauseState() {
  try {
    const state = { isPaused, pauseState }
    await fs.writeFile(PAUSE_STATE_FILE, JSON.stringify(state, null, 2))
    console.log("[Pause API] Saved pause state to file")
  } catch (error) {
    console.error("[Pause API] Error saving pause state:", error)
  }
}

// Load processing config from file
async function loadProcessingConfig() {
  try {
    const data = await fs.readFile(PROCESSING_CONFIG_FILE, "utf-8")
    processingConfig = JSON.parse(data)
    console.log("[Pause API] Loaded processing config from file")
    return processingConfig
  } catch (error) {
    console.log("[Pause API] No existing processing config file found")
    return null
  }
}

// Save processing config to file
async function saveProcessingConfig(config: any) {
  try {
    processingConfig = config
    await fs.writeFile(PROCESSING_CONFIG_FILE, JSON.stringify(config, null, 2))
    console.log("[Pause API] Saved processing config to file")
  } catch (error) {
    console.error("[Pause API] Error saving processing config:", error)
  }
}

// Get current pause state
export function getPauseState() {
  return { isPaused, pauseState }
}

// Set pause state
export function setPauseState(paused: boolean, state?: any) {
  isPaused = paused
  if (state !== undefined) {
    pauseState = state
  }
  savePauseState()
}

// Reset pause state
export function resetPauseState() {
  isPaused = false
  pauseState = null
  console.log("[Pause API] State reset")
  savePauseState()
}

// Get processing config
export function getProcessingConfig() {
  return processingConfig
}

// Set processing config
export function setProcessingConfig(config: any) {
  saveProcessingConfig(config)
}

export async function GET() {
  try {
    // Load state from file on each request
    await loadPauseState()
    await loadProcessingConfig()

    if (!pauseState && !processingConfig) {
      console.log("[Pause API] No saved processing config found")
      return NextResponse.json({
        success: true,
        isPaused: false,
        message: "No saved processing state found",
      })
    }

    console.log("[Pause API] Retrieved pause state:", { isPaused, pauseState, processingConfig })

    return NextResponse.json({
      success: true,
      isPaused,
      pauseState,
      processingConfig,
      message: isPaused ? "Processing is paused" : "Processing is not paused",
    })
  } catch (error) {
    console.error("[Pause API] Error getting pause state:", error)
    return NextResponse.json({ success: false, error: "Failed to get pause state" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, state, config } = body

    // Load current state from file
    await loadPauseState()

    if (action === "pause") {
      setPauseState(true, state)
      if (config) {
        setProcessingConfig(config)
      }
      console.log("[Pause API] Processing paused")
      return NextResponse.json({ success: true, message: "Processing paused" })
    } else if (action === "resume") {
      setPauseState(false)
      console.log("[Pause API] Processing resumed")
      return NextResponse.json({ success: true, message: "Processing resumed" })
    } else if (action === "reset") {
      resetPauseState()
      // Also clear processing config
      try {
        await fs.unlink(PROCESSING_CONFIG_FILE)
        processingConfig = null
        console.log("[Pause API] Processing config cleared")
      } catch (error) {
        // File might not exist, ignore error
      }
      return NextResponse.json({ success: true, message: "State reset" })
    } else {
      return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("[Pause API] Error handling pause request:", error)
    return NextResponse.json({ success: false, error: "Failed to handle pause request" }, { status: 500 })
  }
}
