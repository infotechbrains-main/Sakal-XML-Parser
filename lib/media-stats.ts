import fs from "fs/promises"
import type { Dirent } from "fs"
import path from "path"

export const MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".webp",
  ".heic",
  ".heif",
  ".raw",
  ".cr2",
  ".nef",
  ".arw",
])

export interface DirectoryScanResult {
  xmlFiles: string[]
  mediaFiles: string[]
  mediaCountsByExtension: Record<string, number>
  errors: string[]
}

export async function scanLocalDirectoryForAssets(rootDir: string): Promise<DirectoryScanResult> {
  const xmlFiles: string[] = []
  const mediaFiles: string[] = []
  const mediaCountsByExtension: Record<string, number> = {}
  const errors: string[] = []

  const normalizedRoot = path.resolve(rootDir)

  async function traverse(dir: string) {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      errors.push(`Failed to read directory ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          // Avoid following symlinked directories to prevent cycles
          if (entry.isSymbolicLink()) {
            return
          }
          await traverse(fullPath)
          return
        }

        if (!entry.isFile() && !entry.isSymbolicLink()) {
          return
        }

        const extension = path.extname(entry.name).toLowerCase()
        if (extension === ".xml") {
          xmlFiles.push(fullPath)
          return
        }

        if (MEDIA_EXTENSIONS.has(extension)) {
          mediaFiles.push(fullPath)
          mediaCountsByExtension[extension] = (mediaCountsByExtension[extension] || 0) + 1
        }
      }),
    )
  }

  await traverse(normalizedRoot)

  return {
    xmlFiles,
    mediaFiles,
    mediaCountsByExtension,
    errors,
  }
}
