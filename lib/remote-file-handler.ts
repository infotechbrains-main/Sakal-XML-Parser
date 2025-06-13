import fs from "fs/promises"
import path from "path"
import os from "os"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"

export interface RemoteFile {
  name: string
  url: string
  localPath?: string
  size?: number
}

export async function isRemotePath(path: string): Promise<boolean> {
  return path.startsWith("http://") || path.startsWith("https://")
}

export async function fetchDirectoryListing(url: string): Promise<RemoteFile[]> {
  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to fetch directory listing: ${response.status} ${response.statusText}`)
    }

    const html = await response.text()

    // Extract links from HTML - this is a simple implementation and might need adjustment
    // based on the actual HTML structure of your server's directory listing
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*\.xml)"[^>]*>(.*?)<\/a>/gi
    const files: RemoteFile[] = []
    let match

    while ((match = linkRegex.exec(html)) !== null) {
      const fileName = match[1]
      // Skip parent directory links
      if (fileName === "../" || fileName === "./") continue

      // Handle relative URLs
      const fileUrl = new URL(fileName, url).toString()

      files.push({
        name: path.basename(fileName),
        url: fileUrl,
      })
    }

    return files
  } catch (error) {
    console.error(`Error fetching directory listing from ${url}:`, error)
    throw error
  }
}

export async function downloadFile(fileUrl: string, tempDir: string): Promise<string> {
  const fileName = path.basename(fileUrl)
  const localPath = path.join(tempDir, fileName)

  try {
    const response = await fetch(fileUrl)

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error("Response body is null")
    }

    const fileStream = createWriteStream(localPath)
    await pipeline(response.body as any, fileStream)

    return localPath
  } catch (error) {
    console.error(`Error downloading file ${fileUrl}:`, error)
    throw error
  }
}

export async function createTempDirectory(): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `xml-parser-${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })
  return tempDir
}

export async function cleanupTempDirectory(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch (error) {
    console.error(`Error cleaning up temp directory ${tempDir}:`, error)
  }
}

export async function scanRemoteDirectory(baseUrl: string): Promise<RemoteFile[]> {
  const xmlFiles: RemoteFile[] = []
  const tempDir = await createTempDirectory()

  try {
    // Ensure URL ends with a slash
    if (!baseUrl.endsWith("/")) {
      baseUrl += "/"
    }

    // Get initial directory listing
    const files = await fetchDirectoryListing(baseUrl)

    // Process XML files
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".xml")) {
        xmlFiles.push(file)
      }
    }

    // Recursively scan subdirectories (if needed)
    // This is a simplified version - you might need to enhance this
    // to properly detect and traverse subdirectories

    return xmlFiles
  } catch (error) {
    console.error(`Error scanning remote directory ${baseUrl}:`, error)
    throw error
  }
}
