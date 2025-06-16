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

export async function scanRemoteDirectory(
  baseUrl: string,
  onProgress?: (message: string) => void,
): Promise<RemoteFile[]> {
  onProgress?.(`Starting scan of: ${baseUrl}`)

  try {
    // Determine if this is a specific folder or root level scan
    const url = new URL(baseUrl)
    const pathParts = url.pathname.split("/").filter((part) => part.length > 0)

    // If the path ends with a specific folder name (not just the app root)
    // Example: /photoapp/charitra vs /photoapp/ or /photoapp
    const isSpecificFolder = pathParts.length > 1 && !baseUrl.endsWith("/photoapp/") && !baseUrl.endsWith("/photoapp")

    if (isSpecificFolder) {
      onProgress?.(`Detected specific folder scan: ${baseUrl}`)
      return await scanFolderCompletely(baseUrl, baseUrl, 10, 0, onProgress)
    } else {
      onProgress?.(`Detected root level scan: ${baseUrl}`)
      return await scanTopLevelFolders(baseUrl, onProgress)
    }
  } catch (error) {
    onProgress?.(
      `Error determining scan type for ${baseUrl}: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
    // Fallback to complete folder scan
    return await scanFolderCompletely(baseUrl, baseUrl, 10, 0, onProgress)
  }
}

// Alternative method to try direct file access if directory listing fails
export async function tryDirectFileAccess(baseUrl: string, commonXmlNames: string[] = []): Promise<RemoteFile[]> {
  const files: RemoteFile[] = []

  // Common XML file patterns to try
  const defaultPatterns = ["data.xml", "metadata.xml", "index.xml", "config.xml"]

  const patternsToTry = [...commonXmlNames, ...defaultPatterns]

  for (const pattern of patternsToTry) {
    try {
      const fileUrl = new URL(pattern, baseUrl).toString()

      // Ensure the direct file access is within base path
      if (!isWithinBasePath(baseUrl, fileUrl)) {
        continue
      }

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
