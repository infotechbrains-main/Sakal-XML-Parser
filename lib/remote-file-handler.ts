import fs from "fs/promises"
import path from "path"
import os from "os"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"

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

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; XML-Parser/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })

    if (!response.ok) {
      console.log(`Failed to fetch directory listing: ${response.status} ${response.statusText}`)
      return { files: [], directories: [] }
    }

    const html = await response.text()
    console.log(`HTML response length: ${html.length}`)

    // Debug: Log first 500 characters to see the format
    console.log(`HTML preview: ${html.substring(0, 500)}`)

    const files: RemoteFile[] = []
    const directories: string[] = []

    // Enhanced patterns for different server types
    const linkPatterns = [
      // Apache/Nginx standard format
      /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi,
      // IIS format
      /<A\s+HREF=["']([^"']+)["'][^>]*>([^<]+)<\/A>/gi,
      // Simple href without quotes
      /<a\s+href=([^\s>]+)[^>]*>([^<]+)<\/a>/gi,
      // More flexible pattern
      /href\s*=\s*["']([^"']+)["'][^>]*>([^<]*)</gi,
    ]

    let foundLinks = false

    for (const pattern of linkPatterns) {
      pattern.lastIndex = 0 // Reset regex
      let match

      while ((match = pattern.exec(html)) !== null) {
        const href = match[1]?.trim()
        const linkText = match[2]?.trim()

        if (!href || !linkText) continue

        // Skip parent directory and self references
        if (
          href === "../" ||
          href === "./" ||
          href === "." ||
          href === ".." ||
          linkText === "Parent Directory" ||
          linkText === ".." ||
          linkText === "." ||
          href.startsWith("?") ||
          href.startsWith("#")
        ) {
          continue
        }

        // Skip common non-content files
        if (linkText.match(/^(index\.|default\.|robots\.txt|favicon\.ico|\.htaccess)/i)) {
          continue
        }

        foundLinks = true

        // Determine if it's a directory or file
        const isDirectory =
          href.endsWith("/") || (!href.includes(".") && !linkText.includes(".")) || linkText.endsWith("/")

        if (isDirectory) {
          // It's a directory
          const dirName = href.endsWith("/") ? href : href + "/"

          // Skip if already found
          if (directories.includes(dirName)) continue

          // Check if the directory URL would be within base path
          const dirUrl = new URL(dirName, url).toString()
          if (!isWithinBasePath(baseUrl, dirUrl)) {
            console.log(`Skipping directory ${dirName} - outside base path`)
            continue
          }

          directories.push(dirName)
        } else if (href.toLowerCase().endsWith(".xml")) {
          // It's an XML file
          const fileName = path.basename(href)

          // Skip if already found
          if (files.some((f) => f.name === fileName)) continue

          // Handle relative URLs and ensure they're within base path
          const fileUrl = new URL(href, url).toString()

          if (!isWithinBasePath(baseUrl, fileUrl)) {
            console.log(`Skipping file ${fileName} - outside base path`)
            continue
          }

          files.push({
            name: fileName,
            url: fileUrl,
          })
        }
      }

      // If we found links with this pattern, use them
      if (foundLinks) {
        break
      }
    }

    // If no links found with standard patterns, try alternative parsing
    if (!foundLinks) {
      console.log("No links found with standard patterns, trying alternative parsing...")

      // Try to find directory names in the HTML content
      const cityPatterns = [
        // Look for common Indian city names or directory-like patterns
        /(?:^|\s|>)([A-Z][a-zA-Z]+)(?:\/|\s|<|$)/gm,
        // Look for year patterns (2010-2030)
        /(?:^|\s|>)(20[1-3][0-9])(?:\/|\s|<|$)/gm,
        // Look for month patterns (01-12)
        /(?:^|\s|>)(0[1-9]|1[0-2])(?:\/|\s|<|$)/gm,
      ]

      for (const pattern of cityPatterns) {
        pattern.lastIndex = 0
        let match
        while ((match = pattern.exec(html)) !== null) {
          const dirName = match[1] + "/"
          if (!directories.includes(dirName)) {
            const dirUrl = new URL(dirName, url).toString()
            if (isWithinBasePath(baseUrl, dirUrl)) {
              directories.push(dirName)
            }
          }
        }
      }
    }

    console.log(`Found ${files.length} XML files and ${directories.length} directories in bounds`)
    if (files.length > 0) {
      console.log(`XML files found: ${files.map((f) => f.name).join(", ")}`)
    }
    if (directories.length > 0) {
      console.log(
        `Directories found: ${directories.slice(0, 10).join(", ")}${directories.length > 10 ? ` and ${directories.length - 10} more...` : ""}`,
      )
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

// Enhanced remote directory scanner with better city/year detection
export async function scanRemoteDirectory(
  baseUrl: string,
  onProgress?: (message: string) => void,
  maxDepth = 4,
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
        onProgress(`Scanning: ${url} (depth: ${depth})`)
      }

      const { files, directories } = await fetchDirectoryListing(url, baseUrl)

      // Add XML files from current directory
      for (const file of files) {
        if (file.name.toLowerCase().endsWith(".xml")) {
          xmlFiles.push(file)
          if (onProgress) {
            onProgress(`Found XML: ${file.name}`)
          }
        }
      }

      // If we found XML files, we're likely in a 'processed' directory
      if (files.length > 0) {
        if (onProgress) {
          onProgress(`Found ${files.length} XML files in ${url}`)
        }
        return // Don't scan deeper if we found XML files
      }

      // Scan subdirectories with priority
      if (depth < maxDepth) {
        // Prioritize 'processed' directories
        const processedDirs = directories.filter((dir) => dir.toLowerCase().includes("processed"))

        // Then year directories (2010-2030)
        const yearDirs = directories.filter((dir) => /^20[1-3][0-9]\/$/.test(dir))

        // Then month directories (01-12)
        const monthDirs = directories.filter((dir) => /^(0[1-9]|1[0-2])\/$/.test(dir))

        // Then city directories (capitalized names)
        const cityDirs = directories.filter(
          (dir) =>
            /^[A-Z][a-zA-Z]+\/$/.test(dir) &&
            !dir.toLowerCase().includes("processed") &&
            !dir.toLowerCase().includes("media"),
        )

        // Scan in priority order
        const prioritizedDirs = [...processedDirs, ...yearDirs, ...monthDirs, ...cityDirs]

        for (const dir of prioritizedDirs) {
          const subUrl = new URL(dir, url).toString()
          await scanDirectory(subUrl, depth + 1)

          // If we've found a good number of files, we can stop scanning more cities
          if (xmlFiles.length > 1000 && depth === 0) {
            if (onProgress) {
              onProgress(`Found ${xmlFiles.length} files, limiting scan to prevent timeout`)
            }
            break
          }
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
    await fs.writeFile(localPath, Buffer.from(buffer))
  } catch (error) {
    throw new Error(
      `Failed to download remote file ${url}: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}
