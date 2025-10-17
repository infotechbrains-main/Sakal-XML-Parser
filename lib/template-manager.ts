import fs from "fs/promises"
import path from "path"

export interface ConfigTemplate {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  config: {
    // Basic Configuration
    rootDir: string
    outputFile: string
    outputFolder: string
    numWorkers: number
    verbose: boolean
    processingMode: "regular" | "stream" | "chunked"
    
    // Chunked Mode Settings
    chunkSize?: number
    pauseBetweenChunks?: boolean
    pauseDuration?: number
    
    // Filter Configuration
    filterEnabled: boolean
    filterConfig: {
      enabled: boolean
      fileTypes: string[]
      customExtensions: string
      allowedFileTypes: string[]
      minWidth?: number
      maxWidth?: number
      minHeight?: number
      maxHeight?: number
      minFileSize?: number
      maxFileSize?: number
      minFileSizeValue?: number
      maxFileSizeValue?: number
      minFileSizeUnit?: string
      maxFileSizeUnit?: string
      
      // Metadata filters
      creditLine?: {
        operator: string
        value: string
      }
      copyright?: {
        operator: string
        value: string
      }
      usageType?: {
        operator: string
        value: string
      }
      rightsHolder?: {
        operator: string
        value: string
      }
      location?: {
        operator: string
        value: string
      }
      
      // Image moving
      moveImages: boolean
      moveDestinationPath?: string
      moveFolderStructureOption?: "replicate" | "flat"
    }
    
    // Watch Mode Settings
    watchMode?: boolean
    watchInterval?: number
    watchDirectory?: string
    watchOutputFile?: string
    watchOutputFolder?: string
  }
}

export class TemplateManager {
  private templatesFile: string
  private dataDir: string

  constructor() {
    this.dataDir = path.join(process.cwd(), "data")
    this.templatesFile = path.join(this.dataDir, "config_templates.json")
  }

  private async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
    } catch (error) {
      console.error("Failed to create data directory:", error)
    }
  }

  private async safeReadFile(): Promise<ConfigTemplate[]> {
    try {
      await this.ensureDataDir()
      const content = await fs.readFile(this.templatesFile, "utf-8")
      return JSON.parse(content)
    } catch (error) {
      return []
    }
  }

  private async safeWriteFile(templates: ConfigTemplate[]): Promise<boolean> {
    try {
      await this.ensureDataDir()
      
      // Create backup if file exists
      try {
        await fs.access(this.templatesFile)
        const backupPath = `${this.templatesFile}.backup`
        await fs.copyFile(this.templatesFile, backupPath)
      } catch {
        // File doesn't exist, no backup needed
      }

      await fs.writeFile(this.templatesFile, JSON.stringify(templates, null, 2))
      return true
    } catch (error) {
      console.error(`Failed to write templates file:`, error)
      return false
    }
  }

  async getAllTemplates(): Promise<ConfigTemplate[]> {
    return await this.safeReadFile()
  }

  async getTemplate(id: string): Promise<ConfigTemplate | null> {
    const templates = await this.getAllTemplates()
    return templates.find((t) => t.id === id) || null
  }

  async saveTemplate(template: Omit<ConfigTemplate, "id" | "createdAt" | "updatedAt">): Promise<ConfigTemplate | null> {
    const templates = await this.getAllTemplates()
    
    const newTemplate: ConfigTemplate = {
      ...template,
      id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    
    templates.unshift(newTemplate)
    
    const success = await this.safeWriteFile(templates)
    return success ? newTemplate : null
  }

  async updateTemplate(id: string, updates: Partial<Omit<ConfigTemplate, "id" | "createdAt">>): Promise<boolean> {
    const templates = await this.getAllTemplates()
    const templateIndex = templates.findIndex((t) => t.id === id)
    
    if (templateIndex === -1) return false
    
    templates[templateIndex] = {
      ...templates[templateIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    
    return await this.safeWriteFile(templates)
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const templates = await this.getAllTemplates()
    const filteredTemplates = templates.filter((t) => t.id !== id)
    
    if (filteredTemplates.length === templates.length) {
      return false // Template not found
    }
    
    return await this.safeWriteFile(filteredTemplates)
  }

  async clearAllTemplates(): Promise<boolean> {
    return await this.safeWriteFile([])
  }
}
