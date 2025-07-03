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

    // Enhanced patterns for IIS directory listing (which is what your server uses)
    const linkPatterns = [
      // IIS format: <A HREF="/photoapp/Akola/">Akola</A>
      /<A\s+HREF=["']([^"']+)["'][^>]*>([^<]+)<\/A>/gi,
      // Apache/Nginx standard format
      /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi,
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
          href === "/" ||
          linkText === "Parent Directory" ||
          linkText === ".." ||
          linkText === "." ||
          linkText === "[To Parent Directory]" ||
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

        // For IIS format, href is the full path like "/photoapp/Akola/"
        // We need to convert this to relative path for URL construction
        let relativePath = href

        // If href is an absolute path starting with the base path, make it relative
        const basePath = new URL(baseUrl).pathname
        if (href.startsWith(basePath)) {
          relativePath = href.substring(basePath.length)
          // Remove leading slash if present
          if (relativePath.startsWith("/")) {
            relativePath = relativePath.substring(1)
          }
        } else if (href.startsWith("/")) {
          // If it's an absolute path but doesn't start with base path, skip it
          continue
        }

        // Determine if it's a directory or file
        const isDirectory =
          href.endsWith("/") || linkText.endsWith("/") || html.includes(`&lt;dir&gt; <A HREF="${href}">`)

        if (isDirectory) {
          // It's a directory - use relative path
          const dirName = relativePath.endsWith("/") ? relativePath : relativePath + "/"

          // Skip if already found
          if (directories.includes(dirName)) continue

          // Construct the full URL to verify it's valid
          try {
            const dirUrl = new URL(dirName, url).toString()

            // Basic sanity check - make sure it's within our domain
            if (isWithinBasePath(baseUrl, dirUrl)) {
              directories.push(dirName)
              console.log(`Added directory: ${dirName} -> ${dirUrl}`)
            } else {
              console.log(`Skipping directory ${dirName} - outside base path`)
            }
          } catch (urlError) {
            console.log(`Skipping directory ${dirName} - invalid URL construction`)
            continue
          }
        } else if (href.toLowerCase().endsWith(".xml")) {
          // It's an XML file
          const fileName = path.basename(href)

          // Skip if already found
          if (files.some((f) => f.name === fileName)) continue

          try {
            // Handle relative URLs and ensure they're within base path
            const fileUrl = new URL(relativePath, url).toString()

            if (isWithinBasePath(baseUrl, fileUrl)) {
              files.push({
                name: fileName,
                url: fileUrl,
              })
              console.log(`Added XML file: ${fileName} -> ${fileUrl}`)
            } else {
              console.log(`Skipping file ${fileName} - outside base path`)
            }
          } catch (urlError) {
            console.log(`Skipping file ${fileName} - invalid URL construction`)
            continue
          }
        }
      }

      // If we found links with this pattern, use them
      if (foundLinks) {
        break
      }
    }

    // If no links found with standard patterns, try alternative parsing for IIS
    if (!foundLinks) {
      console.log("No links found with standard patterns, trying IIS-specific parsing...")

      // Look for IIS directory listing pattern: <dir> <A HREF="/path/">name</A>
      const iisPattern = /&lt;dir&gt;\s*<A\s+HREF=["']([^"']+)["'][^>]*>([^<]+)<\/A>/gi
      let match
      while ((match = iisPattern.exec(html)) !== null) {
        const href = match[1]?.trim()
        const linkText = match[2]?.trim()

        if (!href || !linkText) continue

        // Skip parent directory references
        if (linkText === ".." || href === "../" || linkText === "[To Parent Directory]") {
          continue
        }

        // Convert full path to relative path
        let relativePath = href
        const basePath = new URL(baseUrl).pathname
        if (href.startsWith(basePath)) {
          relativePath = href.substring(basePath.length)
          if (relativePath.startsWith("/")) {
            relativePath = relativePath.substring(1)
          }
        }

        const dirName = relativePath.endsWith("/") ? relativePath : relativePath + "/"

        if (!directories.includes(dirName)) {
          try {
            const dirUrl = new URL(dirName, url).toString()
            if (isWithinBasePath(baseUrl, dirUrl)) {
              directories.push(dirName)
              foundLinks = true
              console.log(`Added directory (IIS): ${dirName} -> ${dirUrl}`)
            }
          } catch (urlError) {
            console.log(`Skipping directory (IIS) ${dirName} - invalid URL construction`)
            continue
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

    // If we found XML files, we're likely in a 'processed' directory, so don't go deeper
    if (files.length > 0) {
      onProgress?.(`Found ${files.length} XML files in ${folderUrl}, stopping deeper scan`)
      return allXmlFiles
    }

    // Recursively scan all subdirectories with priority
    const processedDirs = directories.filter((dir) => dir.toLowerCase().includes("processed"))
    const yearDirs = directories.filter((dir) => /^20[1-3][0-9]\/$/.test(dir))
    const monthDirs = directories.filter((dir) => /^(0[1-9]|1[0-2])\/$/.test(dir))
    const cityDirs = directories.filter(
      (dir) =>
        /^[A-Z][a-zA-Z]+\/$/.test(dir) &&
        !dir.toLowerCase().includes("processed") &&
        !dir.toLowerCase().includes("media") &&
        !dir.toLowerCase().includes("select"),
    )
    const otherDirs = directories.filter(
      (dir) =>
        !processedDirs.includes(dir) && !yearDirs.includes(dir) && !monthDirs.includes(dir) && !cityDirs.includes(dir),
    )

    // Scan in priority order
    const prioritizedDirs = [...processedDirs, ...yearDirs, ...monthDirs, ...cityDirs, ...otherDirs]

    for (const dir of prioritizedDirs) {
      try {
        const subDirUrl = new URL(dir, folderUrl).toString()

        onProgress?.(`Scanning subdirectory: ${dir} -> ${subDirUrl}`)

        const subDirFiles = await scanFolderCompletely(subDirUrl, baseUrl, maxDepth, currentDepth + 1, onProgress)

        allXmlFiles.push(...subDirFiles)

        if (subDirFiles.length > 0) {
          onProgress?.(`Found ${subDirFiles.length} XML files in subdirectory: ${dir}`)
        }

        // If we're at the root level and found a good number of files, limit to prevent timeout
        if (currentDepth === 0 && allXmlFiles.length > 5000) {
          onProgress?.(`Found ${allXmlFiles.length} files, limiting scan to prevent timeout`)
          break
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
        onProgress?.(`Scanning top-level folder: ${dir} -> ${topLevelFolderUrl}`)

        const folderFiles = await scanFolderCompletely(topLevelFolderUrl, baseUrl, 5, 0, onProgress)

        if (folderFiles.length > 0) {
          allXmlFiles.push(...folderFiles)
          onProgress?.(`Found ${folderFiles.length} XML files in folder: ${dir}`)
        } else {
          onProgress?.(`No XML files found in folder: ${dir}, moving to next folder`)
        }

        // Limit to prevent timeout
        if (allXmlFiles.length > 10000) {
          onProgress?.(`Found ${allXmlFiles.length} files, stopping scan to prevent timeout`)
          break
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
  maxDepth = 5,
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
          onProgress(`Found ${files.length} XML files in ${url}, stopping deeper scan`)
        }
        return // Don't scan deeper if we found XML files
      }

      // Scan subdirectories with priority if we haven't reached max depth
      if (depth < maxDepth && directories.length > 0) {
        // Prioritize 'processed' directories
        const processedDirs = directories.filter((dir) => dir.toLowerCase().includes("processed"))

        // Then year directories (2010-2030)
        const yearDirs = directories.filter((dir) => /^20[1-3][0-9]\/$/.test(dir))

        // Then month directories (01-12)
        const monthDirs = directories.filter((dir) => /^(0[1-9]|1[0-2])\/$/.test(dir))

        // Then city directories (capitalized names, excluding system directories)
        const cityDirs = directories.filter(
          (dir) =>
            /^[A-Z][a-zA-Z]+\/$/.test(dir) &&
            !dir.toLowerCase().includes("processed") &&
            !dir.toLowerCase().includes("media") &&
            !dir.toLowerCase().includes("select") &&
            !dir.toLowerCase().includes("default"),
        )

        // Other directories
        const otherDirs = directories.filter(
          (dir) =>
            !processedDirs.includes(dir) &&
            !yearDirs.includes(dir) &&
            !monthDirs.includes(dir) &&
            !cityDirs.includes(dir),
        )

        // Scan in priority order
        const prioritizedDirs = [...processedDirs, ...yearDirs, ...monthDirs, ...cityDirs, ...otherDirs]

        if (onProgress) {
          onProgress(
            `Found ${directories.length} directories to scan: ${prioritizedDirs.slice(0, 5).join(", ")}${prioritizedDirs.length > 5 ? "..." : ""}`,
          )
        }

        for (const dir of prioritizedDirs) {
          const subUrl = new URL(dir, url).toString()
          await scanDirectory(subUrl, depth + 1)

          // If we're at the root level and found a good number of files, we can stop scanning more cities
          if (depth === 0 && xmlFiles.length > 5000) {
            if (onProgress) {
              onProgress(`Found ${xmlFiles.length} files, limiting scan to prevent timeout`)
            }
            break
          }

          // Limit cities scanned at root level to prevent timeout
          if (depth === 0 && cityDirs.includes(dir)) {
            const scannedCities = prioritizedDirs
              .slice(0, prioritizedDirs.indexOf(dir) + 1)
              .filter((d) => cityDirs.includes(d))
            if (scannedCities.length >= 3 && xmlFiles.length > 1000) {
              if (onProgress) {
                onProgress(
                  `Scanned ${scannedCities.length} cities, found ${xmlFiles.length} files, stopping to prevent timeout`,
                )
              }
              break
            }
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
