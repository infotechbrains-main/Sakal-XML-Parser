import { NextResponse } from "next/server"
import { TemplateManager } from "@/lib/template-manager"

const templateManager = new TemplateManager()

export async function GET() {
  try {
    const templates = await templateManager.getAllTemplates()
    return NextResponse.json({ success: true, templates })
  } catch (error) {
    console.error("Error fetching templates:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, description, config } = body

    if (!name || !config) {
      return NextResponse.json(
        { success: false, error: "Template name and config are required" },
        { status: 400 }
      )
    }

    const template = await templateManager.saveTemplate({
      name,
      description,
      config,
    })

    if (!template) {
      return NextResponse.json(
        { success: false, error: "Failed to save template" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error("Error saving template:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const templateId = searchParams.get("id")

    if (!templateId) {
      return NextResponse.json(
        { success: false, error: "Template ID is required" },
        { status: 400 }
      )
    }

    const success = await templateManager.deleteTemplate(templateId)

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Template not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting template:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
