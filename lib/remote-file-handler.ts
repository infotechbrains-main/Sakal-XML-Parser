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
  directory?: string
}

export interface RemoteDirectory {
  name: string
  url: string
  files: RemoteFile[]
  subdirectories: RemoteDirectory[]
}

export async function isRemotePath(path: string): Promise<boolean> {
  return path.startsWith("http://") || path.startsWith("https://")
}

export async function fetchDirectoryListing(url: string): Promise<{ files: RemoteFile[]; directories: string[] }> {
  try {
    console.log(`Fetching directory listing from: ${url}`)
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to fetch directory listing: ${response.status} ${response.statusText}`)
    }

    const html = await response.text()
    console.log(`HTML response length: ${html.length}`)

    // Multiple regex patterns to handle different server directory listing formats
    const patterns = [
      // Apache style: <a href="filename.xml">filename.xml</a>
      /<a\s+(?:[^>]*?\s+)?href="([^"]*\.xml)"[^>]*>([^<]*)<\/a>/gi,
      // Nginx style: <a href="filename.xml">filename.xml</a>
      /<a\s+href="([^"]*\.xml)"[^>]*>([^<]*)<\/a>/gi,
      // IIS style: <A HREF="filename.xml">filename.xml</A>
      /<A\s+HREF="([^"]*\.xml)"[^>]*>([^<]*)<\/A>/gi,
      // Generic pattern for any link ending with .xml
      /href="([^"]*\.xml)"/gi,
    ]

    // Directory patterns
    const directoryPatterns = [
      // Apache/Nginx directory links (ending with /)
      /<a\s+(?:[^>]*?\s+)?href="([^"]*\/)"[^>]*>([^<]*)<\/a>/gi,
      /<a\s+href="([^"]*\/)"[^>]*>([^<]*)<\/a>/gi,
      /<A\s+HREF="([^"]*\/)"[^>]*>([^<]*)<\/A>/gi,
      // Generic directory pattern
      /href="([^"]*\/)"/gi,
    ]

    const files: RemoteFile[] = []
    const directories: string[] = []

    // Try each pattern for XML files
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(html)) !== null) {
        const fileName = match[1]

        // Skip parent directory links and current directory
        if (fileName === "../" || fileName === "./" || fileName === "..") continue

        // Skip if already found
        if (files.some((f) => f.name === path.basename(fileName))) continue

        // Handle relative URLs
        const fileUrl = new URL(fileName, url).toString()

        files.push({
          name: path.basename(fileName),
          url: fileUrl,
          directory: url,
        })
      }
    }

    // Try each pattern for directories
    for (const pattern of directoryPatterns) {
      let match
      while ((match = pattern.exec(html)) !== null) {
        const dirName = match[1]

        // Skip parent directory links and current directory
        if (dirName === "../" || dirName === "./" || dirName === "..") continue

        // Skip if already found
        if (directories.includes(dirName)) continue

        directories.push(dirName)
      }
    }

    console.log(`Found ${files.length} XML files and ${directories.length} directories`)

    return { files, directories }
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

export async function scanRemoteDirectoryRecursive(
  baseUrl: string,
  maxDepth = 5,
  currentDepth = 0,
  onProgress?: (message: string) => void,
): Promise<RemoteFile[]> {
  const allXmlFiles: RemoteFile[] = []

  if (currentDepth >= maxDepth) {
    onProgress?.(`Maximum depth ${maxDepth} reached for ${baseUrl}`)
    return allXmlFiles
  }

  try {
    // Ensure URL ends with a slash
    if (!baseUrl.endsWith("/")) {
      baseUrl += "/"
    }

    onProgress?.(`Scanning directory: ${baseUrl} (depth: ${currentDepth})`)

    // Get directory listing
    const { files, directories } = await fetchDirectoryListing(baseUrl)

    // Add XML files from current directory
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".xml")) {
        allXmlFiles.push(file)
        onProgress?.(`Found XML file: ${file.name} in ${baseUrl}`)
      }
    }

    onProgress?.(`Found ${files.length} XML files in current directory`)

    // If no XML files found in current directory, scan subdirectories
    if (files.length === 0 && directories.length > 0) {
      onProgress?.(`No XML files in current directory, scanning ${directories.length} subdirectories...`)

      for (const dir of directories) {
        try {
          const subDirUrl = new URL(dir, baseUrl).toString()
          onProgress?.(`Scanning subdirectory: ${dir}`)

          const subDirFiles = await scanRemoteDirectoryRecursive(subDirUrl, maxDepth, currentDepth + 1, onProgress)

          allXmlFiles.push(...subDirFiles)

          if (subDirFiles.length > 0) {
            onProgress?.(`Found ${subDirFiles.length} XML files in subdirectory: ${dir}`)
          }
        } catch (error) {
          onProgress?.(
            `Error scanning subdirectory ${dir}: ${error instanceof Error ? error.message : "Unknown error"}`,
          )
          continue // Skip this directory and continue with others
        }
      }
    } else if (files.length > 0) {
      onProgress?.(`Found XML files in current directory, skipping subdirectory scan`)
    }

    return allXmlFiles
  } catch (error) {
    onProgress?.(
      `Error scanning remote directory ${baseUrl}: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
    throw error
  }
}

export async function scanRemoteDirectory(
  baseUrl: string,
  onProgress?: (message: string) => void,
): Promise<RemoteFile[]> {
  return await scanRemoteDirectoryRecursive(baseUrl, 5, 0, onProgress)
}

// Alternative method to try direct file access if directory listing fails
export async function tryDirectFileAccess(baseUrl: string, commonXmlNames: string[] = []): Promise<RemoteFile[]> {
  const files: RemoteFile[] = []

  // Common XML file patterns to try
  const defaultPatterns = ["*.xml", "data.xml", "metadata.xml", "index.xml", "config.xml"]

  const patternsToTry = [...commonXmlNames, ...defaultPatterns]

  for (const pattern of patternsToTry) {
    try {
      const fileUrl = new URL(pattern, baseUrl).toString()
      const response = await fetch(fileUrl, { method: "HEAD" })

      if (response.ok) {
        files.push({
          name: pattern,
          url: fileUrl,
          directory: baseUrl,
        })
      }
    } catch (error) {
      // Ignore errors for direct file access attempts
      continue
    }
  }

  return files
}
