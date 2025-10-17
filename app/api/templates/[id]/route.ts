import { NextResponse } from "next/server"
import { TemplateManager } from "@/lib/template-manager"

const templateManager = new TemplateManager()

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const template = await templateManager.getTemplate(params.id)

    if (!template) {
      return NextResponse.json(
        { success: false, error: "Template not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error("Error fetching template:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json()
    const { name, description, config } = body

    const success = await templateManager.updateTemplate(params.id, {
      name,
      description,
      config,
    })

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Template not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating template:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const success = await templateManager.deleteTemplate(params.id)

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
