import fs from "fs/promises"
import path from "path"
import os from "os"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"
import { promises as fsPromise } from "fs"

export interface RemoteFile {
  name: string
  url: string
  size?: number
  lastModified?: string
}

export interface RemoteDirectory {
  name: string
  url: string
  files: RemoteFile[]
  subdirectories: RemoteDirectory[]
}

export async function isRemotePath(filePath: string): Promise<boolean> {
  return filePath && (filePath.startsWith("http://") || filePath.startsWith("https://"))
}

// Helper function to check if a URL is within the allowed base path
function isWithinBasePath(baseUrl: string, targetUrl: string): boolean {
  try {
    const base = new URL(baseUrl)
    const target = new URL(targetUrl)

    // Must be same origin (protocol + host + port)
    if (base.origin !== target.origin) {
      return false
    }

    // Target path must start with base path
    const basePath = base.pathname.endsWith("/") ? base.pathname : base.pathname + "/"
    const targetPath = target.pathname.endsWith("/") ? target.pathname : target.pathname + "/"

    return targetPath.startsWith(basePath)
  } catch (error) {
    console.error("Error checking path bounds:", error)
    return false
  }
}

export async function fetchDirectoryListing(
  url: string,
  baseUrl: string,
): Promise<{ files: RemoteFile[]; directories: string[] }> {
  try {
    console.log(`Fetching directory listing from: ${url}`)

    // Ensure we're not going outside the base path
    if (!isWithinBasePath(baseUrl, url)) {
      console.log(`Skipping ${url} - outside base path ${baseUrl}`)
      return { files: [], directories: [] }
    }

    const response = await fetch(url)

    if (!response.ok) {
      console.log(`Failed to fetch directory listing: ${response.status} ${response.statusText}`)
      return { files: [], directories: [] }
    }

    const html = await response.text()
    console.log(`HTML response length: ${html.length}`)

    // Enhanced patterns to catch more directory listing formats
    const filePatterns = [
      // Standard Apache/Nginx patterns for XML files
      /<a\s+(?:[^>]*?\s+)?href="([^"]*\.xml)"[^>]*>([^<]*)<\/a>/gi,
      /<a\s+href="([^"]*\.xml)"[^>]*>([^<]*)<\/a>/gi,
      /<A\s+HREF="([^"]*\.xml)"[^>]*>([^<]*)<\/A>/gi,
      // More flexible pattern
      /href=["']([^"']*\.xml)["']/gi,
      // Pattern without quotes
      /href=([^\s>]*\.xml)/gi,
    ]

    // Enhanced directory patterns - look for any folder-like links
    const directoryPatterns = [
      // Standard directory patterns (ending with /)
      /<a\s+(?:[^>]*?\s+)?href="([^"#?]*\/)"[^>]*>([^<]*)<\/a>/gi,
      /<a\s+href="([^"#?]*\/)"[^>]*>([^<]*)<\/a>/gi,
      /<A\s+HREF="([^"#?]*\/)"[^>]*>([^<]*)<\/A>/gi,
      // Directory patterns without trailing slash but with directory indicators
      /<a\s+(?:[^>]*?\s+)?href="([^"#?./][^"#?]*)"[^>]*>\s*([^<]*)\s*<\/a>/gi,
    ]

    const files: RemoteFile[] = []
    const directories: string[] = []

    // Extract XML files
    for (const pattern of filePatterns) {
      let match
      while ((match = pattern.exec(html)) !== null) {
        const fileName = match[1]

        // Skip parent directory links and current directory
        if (fileName === "../" || fileName === "./" || fileName === ".." || fileName.startsWith("../")) {
          continue
        }

        // Skip if already found
        if (files.some((f) => f.name === path.basename(fileName))) continue

        // Handle relative URLs and ensure they're within base path
        const fileUrl = new URL(fileName, url).toString()

        if (!isWithinBasePath(baseUrl, fileUrl)) {
          console.log(`Skipping file ${fileName} - outside base path`)
          continue
        }

        files.push({
          name: path.basename(fileName),
          url: fileUrl,
          directory: url,
        })
      }
    }

    // Extract directories
    for (const pattern of directoryPatterns) {
      let match
      while ((match = pattern.exec(html)) !== null) {
        let dirName = match[1]
        const linkText = match[2] || ""

        // Skip parent directory links, current directory, and any path starting with ../
        if (
          dirName === "../" ||
          dirName === "./" ||
          dirName === ".." ||
          dirName.startsWith("../") ||
          linkText.includes("Parent Directory") ||
          linkText.includes("..") ||
          dirName.includes("?") ||
          dirName.includes("#")
        ) {
          continue
        }

        // Normalize directory name
        if (!dirName.endsWith("/")) {
          dirName += "/"
        }

        // Skip if already found
        if (directories.includes(dirName)) continue

        // Check if the directory URL would be within base path
        const dirUrl = new URL(dirName, url).toString()
        if (!isWithinBasePath(baseUrl, dirUrl)) {
          console.log(`Skipping directory ${dirName} - outside base path`)
          continue
        }

        directories.push(dirName)
      }
    }

    console.log(`Found ${files.length} XML files and ${directories.length} directories in bounds`)
    if (files.length > 0) {
      console.log(`XML files found: ${files.map((f) => f.name).join(", ")}`)
    }
    if (directories.length > 0) {
      console.log(`Directories found: ${directories.join(", ")}`)
    }

    return { files, directories }
  } catch (error) {
    console.error(`Error fetching directory listing from ${url}:`, error)
    return { files: [], directories: [] }
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
  const tempDir = path.join(os.tmpdir(), `xml-parser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
  await fs.mkdir(tempDir, { recursive: true })
  return tempDir
}

export async function cleanupTempDirectory(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch (error) {
    console.error("Error cleaning up temp directory:", error)
  }
}

// Scan a specific folder completely (deep scan)
export async function scanFolderCompletely(
  folderUrl: string,
  baseUrl: string,
  maxDepth = 10,
  currentDepth = 0,
  onProgress?: (message: string) => void,
): Promise<RemoteFile[]> {
  const allXmlFiles: RemoteFile[] = []

  if (currentDepth >= maxDepth) {
    onProgress?.(`Maximum depth ${maxDepth} reached for ${folderUrl}`)
    return allXmlFiles
  }

  // Ensure we're not going outside the base path
  if (!isWithinBasePath(baseUrl, folderUrl)) {
    onProgress?.(`Skipping ${folderUrl} - outside base path ${baseUrl}`)
    return allXmlFiles
  }

  try {
    // Ensure URL ends with a slash
    if (!folderUrl.endsWith("/")) {
      folderUrl += "/"
    }

    onProgress?.(`Deep scanning folder: ${folderUrl} (depth: ${currentDepth})`)

    // Get directory listing
    const { files, directories } = await fetchDirectoryListing(folderUrl, baseUrl)

    // Add all XML files from current directory
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".xml")) {
        allXmlFiles.push(file)
        onProgress?.(`Found XML file: ${file.name} in ${folderUrl}`)
      }
    }

    // Recursively scan all subdirectories
    for (const dir of directories) {
      try {
        const subDirUrl = new URL(dir, folderUrl).toString()

        if (!isWithinBasePath(baseUrl, subDirUrl)) {
          onProgress?.(`Skipping subdirectory ${dir} - outside base path`)
          continue
        }

        onProgress?.(`Scanning subdirectory: ${dir}`)

        const subDirFiles = await scanFolderCompletely(subDirUrl, baseUrl, maxDepth, currentDepth + 1, onProgress)

        allXmlFiles.push(...subDirFiles)

        if (subDirFiles.length > 0) {
          onProgress?.(`Found ${subDirFiles.length} XML files in subdirectory: ${dir}`)
        }
      } catch (error) {
        onProgress?.(`Error scanning subdirectory ${dir}: ${error instanceof Error ? error.message : "Unknown error"}`)
        continue
      }
    }

    return allXmlFiles
  } catch (error) {
    onProgress?.(`Error scanning folder ${folderUrl}: ${error instanceof Error ? error.message : "Unknown error"}`)
    return allXmlFiles
  }
}

// Scan top-level folders one by one (shallow scan of each top-level folder)
export async function scanTopLevelFolders(
  baseUrl: string,
  onProgress?: (message: string) => void,
): Promise<RemoteFile[]> {
  const allXmlFiles: RemoteFile[] = []

  try {
    onProgress?.(`Scanning top-level folders in: ${baseUrl}`)

    // Get top-level directory listing
    const { files, directories } = await fetchDirectoryListing(baseUrl, baseUrl)

    // Add XML files from root directory
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".xml")) {
        allXmlFiles.push(file)
        onProgress?.(`Found XML file in root: ${file.name}`)
      }
    }

    // Scan each top-level folder completely
    for (const dir of directories) {
      try {
        const topLevelFolderUrl = new URL(dir, baseUrl).toString()
        onProgress?.(`Scanning top-level folder: ${dir}`)

        const folderFiles = await scanFolderCompletely(topLevelFolderUrl, baseUrl, 10, 0, onProgress)

        if (folderFiles.length > 0) {
          allXmlFiles.push(...folderFiles)
          onProgress?.(`Found ${folderFiles.length} XML files in folder: ${dir}`)
        } else {
          onProgress?.(`No XML files found in folder: ${dir}, moving to next folder`)
        }
      } catch (error) {
        onProgress?.(
          `Error scanning top-level folder ${dir}: ${error instanceof Error ? error.message : "Unknown error"}`,
        )
        continue
      }
    }

    return allXmlFiles
  } catch (error) {
    onProgress?.(
      `Error scanning top-level folders in ${baseUrl}: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
    throw error
  }
}

// Scan remote directory
export async function scanRemoteDirectory(
  baseUrl: string,
  onProgress?: (message: string) => void,
  maxDepth = 3,
): Promise<RemoteFile[]> {
  const xmlFiles: RemoteFile[] = []
  const visitedUrls = new Set<string>()

  async function scanDirectory(url: string, depth = 0): Promise<void> {
    if (depth > maxDepth || visitedUrls.has(url)) {
      return
    }

    visitedUrls.add(url)

    try {
      if (onProgress) {
        onProgress(`Scanning: ${url}`)
      }

      console.log(`Fetching directory listing from: ${url}`)
      const response = await fetch(url)

      if (!response.ok) {
        console.log(`Failed to fetch ${url}: ${response.status}`)
        return
      }

      const html = await response.text()
      console.log(`HTML response length: ${html.length}`)

      // Parse HTML to find links
      const links = parseDirectoryListing(html, url)

      const xmlFilesInDir = links.filter((link) => link.name.toLowerCase().endsWith(".xml"))

      const subdirectories = links.filter(
        (link) => link.name.endsWith("/") && !link.name.startsWith("..") && link.name !== "/",
      )

      console.log(`Found ${xmlFilesInDir.length} XML files and ${subdirectories.length} directories in bounds`)

      // Add XML files
      for (const xmlFile of xmlFilesInDir) {
        xmlFiles.push({
          name: xmlFile.name,
          url: xmlFile.url,
          size: xmlFile.size,
        })
      }

      if (xmlFilesInDir.length > 0) {
        console.log(`XML files found: ${xmlFilesInDir.map((f) => f.name).join(", ")}`)
      }

      // Only scan subdirectories if we haven't found XML files in current directory
      // This prevents infinite recursion through media folders
      if (xmlFilesInDir.length === 0 && depth < maxDepth) {
        if (subdirectories.length > 0) {
          console.log(`Directories found: ${subdirectories.map((d) => d.name).join(", ")}`)
        }

        // Prioritize 'processed' directories over 'media' directories
        const processedDirs = subdirectories.filter((dir) => dir.name.toLowerCase().includes("processed"))
        const otherDirs = subdirectories.filter(
          (dir) => !dir.name.toLowerCase().includes("processed") && !dir.name.toLowerCase().includes("media"),
        )

        // Scan processed directories first
        for (const dir of processedDirs) {
          await scanDirectory(dir.url, depth + 1)
        }

        // Then scan other directories (but skip media if we found XML files)
        for (const dir of otherDirs) {
          await scanDirectory(dir.url, depth + 1)
        }
      }
    } catch (error) {
      console.error(`Error scanning ${url}:`, error)
      if (onProgress) {
        onProgress(`Error scanning ${url}: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }
  }

  await scanDirectory(baseUrl)

  if (onProgress) {
    onProgress(`Scan complete. Found ${xmlFiles.length} XML files.`)
  }

  return xmlFiles
}

function parseDirectoryListing(html: string, baseUrl: string): RemoteFile[] {
  const files: RemoteFile[] = []

  // Common patterns for directory listings
  const patterns = [
    // Apache directory listing
    /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
    // Nginx directory listing
    /<a href="([^"]+)">([^<]+)<\/a>/gi,
    // IIS directory listing
    /<A HREF="([^"]+)">([^<]+)<\/A>/gi,
  ]

  for (const pattern of patterns) {
    let match
    pattern.lastIndex = 0 // Reset regex

    while ((match = pattern.exec(html)) !== null) {
      const href = match[1]
      const name = match[2].trim()

      // Skip parent directory links and self references
      if (href === "../" || href === "./" || name === "Parent Directory" || name === "..") {
        continue
      }

      // Skip common non-content files
      if (name.match(/^(index\.|default\.|robots\.txt|favicon\.ico)/i)) {
        continue
      }

      // Create full URL
      let fullUrl: string
      if (href.startsWith("http://") || href.startsWith("https://")) {
        fullUrl = href
      } else {
        const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
        const cleanHref = href.startsWith("/") ? href.substring(1) : href
        fullUrl = cleanBaseUrl + cleanHref
      }

      // Decode URL-encoded names
      const decodedName = decodeURIComponent(name)

      files.push({
        name: decodedName,
        url: fullUrl,
      })
    }

    // If we found files with this pattern, use them
    if (files.length > 0) {
      break
    }
  }

  return files
}

export async function fetchRemoteFile(url: string): Promise<string> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return await response.text()
  } catch (error) {
    throw new Error(`Failed to fetch remote file ${url}: ${error instanceof Error ? error.message : "Unknown error"}`)
  }
}

export async function downloadRemoteFile(url: string, localPath: string): Promise<void> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    await fsPromise.writeFile(localPath, Buffer.from(buffer))
  } catch (error) {
    throw new Error(
      `Failed to download remote file ${url}: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}
