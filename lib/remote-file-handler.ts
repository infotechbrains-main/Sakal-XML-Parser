import fs from "fs/promises"
import path from "path"
import os from "os"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"

import { MEDIA_EXTENSIONS } from "./media-stats"

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

interface DirectoryListingOptions {
  allowedExtensions?: string[]
}

export interface RemoteDirectoryScanOptions {
  maxDepth?: number
  includeMedia?: boolean
  mediaExtensions?: string[]
  maxXmlFiles?: number
  maxCityDirectories?: number
}

export interface RemoteDirectoryScanResult {
  xmlFiles: RemoteFile[]
  mediaFiles: RemoteFile[]
  mediaCountsByExtension: Record<string, number>
  warnings: string[]
}

export async function isRemotePath(filePath: string): Promise<boolean> {
  return Boolean(filePath && (filePath.startsWith("http://") || filePath.startsWith("https://")))
}

// Helper function to normalize URLs for comparison
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    // Ensure path ends with slash for directories
    if (!urlObj.pathname.endsWith("/")) {
      urlObj.pathname += "/"
    }
    return urlObj.toString()
  } catch (error) {
    return url.endsWith("/") ? url : url + "/"
  }
}

// Helper function to check if a URL is within the allowed base path
function isWithinBasePath(baseUrl: string, targetUrl: string): boolean {
  try {
    const normalizedBase = normalizeUrl(baseUrl)
    const normalizedTarget = normalizeUrl(targetUrl)

    const base = new URL(normalizedBase)
    const target = new URL(normalizedTarget)

    // Must be same origin (protocol + host + port)
    if (base.origin !== target.origin) {
      return false
    }

    // Target path must start with base path
    return target.pathname.startsWith(base.pathname)
  } catch (error) {
    console.error("Error checking path bounds:", error)
    return false
  }
}

export async function fetchDirectoryListing(
  url: string,
  baseUrl: string,
  options: DirectoryListingOptions = {},
): Promise<{ files: RemoteFile[]; directories: string[] }> {
  try {
    // Normalize the URL to ensure it ends with /
    const normalizedUrl = normalizeUrl(url)
    console.log(`Fetching directory listing from: ${normalizedUrl}`)

    const response = await fetch(normalizedUrl, {
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

    const normalizedExtensions = (options.allowedExtensions || [".xml"]).map((ext) => ext.toLowerCase())
    const allowedExtensions = new Set(normalizedExtensions)
    const allowAllExtensions = options.allowedExtensions == null || options.allowedExtensions.length === 0

    // Enhanced patterns for IIS directory listing
    const linkPatterns = [
      // IIS format: <A HREF="/photoapp/Akola/">Akola</A>
      /<A\s+HREF=["']([^"']+)["'][^>]*>([^<]+)<\/A>/gi,
      // Apache/Nginx standard format
      /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi,
      // Simple href without quotes
      /<a\s+href=([^\s>]+)[^>]*>([^<]+)<\/a>/gi,
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

        // Determine if it's a directory or file based on the HTML content
        const isDirectory = href.endsWith("/") || html.includes(`&lt;dir&gt; <A HREF="${href}">`)

        if (isDirectory) {
          // For directories, use the link text as the directory name
          const dirName = linkText.endsWith("/") ? linkText : linkText + "/"

          // Skip if already found
          if (directories.includes(dirName)) continue

          // Construct the full URL using the original href
          let fullDirUrl: string
          if (href.startsWith("http://") || href.startsWith("https://")) {
            // Absolute URL
            fullDirUrl = href
          } else if (href.startsWith("/")) {
            // Root-relative URL
            const baseUrlObj = new URL(normalizedUrl)
            fullDirUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`
          } else {
            // Relative URL
            fullDirUrl = new URL(href, normalizedUrl).toString()
          }

          // Ensure the directory URL ends with /
          if (!fullDirUrl.endsWith("/")) {
            fullDirUrl += "/"
          }

          // Check if it's within base path
          if (isWithinBasePath(baseUrl, fullDirUrl)) {
            directories.push(dirName)
            console.log(`Added directory: ${dirName} -> ${fullDirUrl}`)
          } else {
            console.log(`Skipping directory ${dirName} - outside base path (${fullDirUrl} not within ${baseUrl})`)
          }
        } else {
          const fileName = path.basename(href)
          const sanitizedFileName = fileName.split(/[?#]/)[0] || fileName
          const extension = path.extname(sanitizedFileName).toLowerCase()

          if (!allowAllExtensions && extension && !allowedExtensions.has(extension)) {
            continue
          }

          // Skip if already found
          if (files.some((f) => f.name === sanitizedFileName)) continue

          // Construct the full URL
          let fullFileUrl: string
          if (href.startsWith("http://") || href.startsWith("https://")) {
            fullFileUrl = href
          } else if (href.startsWith("/")) {
            const baseUrlObj = new URL(normalizedUrl)
            fullFileUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`
          } else {
            fullFileUrl = new URL(href, normalizedUrl).toString()
          }

          if (isWithinBasePath(baseUrl, fullFileUrl)) {
            files.push({
              name: sanitizedFileName,
              url: fullFileUrl,
            })
            console.log(`Added file (${extension || "no-ext"}): ${sanitizedFileName} -> ${fullFileUrl}`)
          } else {
            console.log(`Skipping file ${fileName} - outside base path`)
          }
        }
      }

      // If we found links with this pattern, use them
      if (foundLinks) {
        break
      }
    }

    console.log(`Found ${files.length} matching file(s) and ${directories.length} directories in bounds`)
    if (files.length > 0) {
      console.log(`Files found: ${files.map((f) => f.name).join(", ")}`)
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
    const normalizedFolderUrl = normalizeUrl(folderUrl)
    onProgress?.(`Deep scanning folder: ${normalizedFolderUrl} (depth: ${currentDepth})`)

    // Get directory listing
    const { files, directories } = await fetchDirectoryListing(normalizedFolderUrl, baseUrl)

    // Add all XML files from current directory
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".xml")) {
        allXmlFiles.push(file)
        onProgress?.(`Found XML file: ${file.name} in ${normalizedFolderUrl}`)
      }
    }

    // If we found XML files, we're likely in a 'processed' directory, so don't go deeper
    if (files.length > 0) {
      onProgress?.(`Found ${files.length} XML files in ${normalizedFolderUrl}, stopping deeper scan`)
      return allXmlFiles
    }

    // Recursively scan all subdirectories with priority
    const processedDirs = directories.filter((dir) => dir.toLowerCase().includes("processed"))
    const yearDirs = directories.filter((dir) => /^(?:19|20)\d{2}\/$/.test(dir))
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
        // Construct subdirectory URL by appending directory name to current URL
        const subDirUrl = normalizedFolderUrl + dir

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
        const normalizedBaseUrl = normalizeUrl(baseUrl)
        const topLevelFolderUrl = normalizedBaseUrl + dir
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

// Enhanced remote directory scanner with better city/year detection and media support
export async function scanRemoteDirectory(
  baseUrl: string,
  onProgress?: (message: string) => void,
  options: RemoteDirectoryScanOptions = {},
): Promise<RemoteDirectoryScanResult> {
  const maxDepth = options.maxDepth ?? 5
  const includeMedia = options.includeMedia ?? true
  const maxXmlFiles = options.maxXmlFiles ?? Number.POSITIVE_INFINITY
  const maxCityDirectories = options.maxCityDirectories ?? Number.POSITIVE_INFINITY

  const mediaExtensionsFromOptions = options.mediaExtensions ?? Array.from(MEDIA_EXTENSIONS)
  const normalizedMediaExtensions = Array.from(
    new Set(
      mediaExtensionsFromOptions
        .map((ext) => ext.trim().toLowerCase())
        .filter(Boolean)
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)),
    ),
  )

  const allowedExtensions = includeMedia ? [".xml", ...normalizedMediaExtensions] : [".xml"]

  const xmlFiles: RemoteFile[] = []
  const mediaFiles: RemoteFile[] = []
  const mediaCountsByExtension: Record<string, number> = {}
  const warnings: string[] = []
  const visitedUrls = new Set<string>()
  let rootCityScanCount = 0

  async function scanDirectory(url: string, depth = 0): Promise<void> {
    const normalizedUrl = normalizeUrl(url)

    if (depth > maxDepth) {
      warnings.push(`Max depth ${maxDepth} reached at ${normalizedUrl}`)
      return
    }

    if (visitedUrls.has(normalizedUrl)) {
      return
    }

    visitedUrls.add(normalizedUrl)

    try {
      onProgress?.(`Scanning: ${normalizedUrl} (depth: ${depth})`)

      const { files, directories } = await fetchDirectoryListing(normalizedUrl, baseUrl, {
        allowedExtensions: includeMedia ? [] : allowedExtensions,
      })

      let xmlFoundHere = 0

      for (const file of files) {
        const extension = path.extname(file.name).toLowerCase()

        if (extension === ".xml") {
          xmlFiles.push(file)
          xmlFoundHere += 1
          onProgress?.(`Found XML: ${file.name}`)
          continue
        }

        if (includeMedia && normalizedMediaExtensions.includes(extension)) {
          mediaFiles.push(file)
          mediaCountsByExtension[extension] = (mediaCountsByExtension[extension] || 0) + 1
          onProgress?.(`Found media (${extension}): ${file.name}`)
          continue
        }

        warnings.push(`Skipped unsupported file ${file.name} at ${normalizedUrl}`)
      }

      if (xmlFoundHere > 0) {
        onProgress?.(
          `Found ${xmlFoundHere} XML file(s) in ${normalizedUrl}, stopping deeper scan from this branch`,
        )
        return
      }

      if (depth >= maxDepth || directories.length === 0) {
        return
      }

      const processedDirs = directories.filter((dir) => dir.toLowerCase().includes("processed"))
      const yearDirs = directories.filter((dir) => /^(?:19|20)\d{2}\/$/.test(dir))
      const monthDirs = directories.filter((dir) => /^(0[1-9]|1[0-2])\/$/.test(dir))
      const cityDirs = directories.filter(
        (dir) =>
          /^[A-Z][a-zA-Z]+\/$/.test(dir) &&
          !dir.toLowerCase().includes("processed") &&
          !dir.toLowerCase().includes("media") &&
          !dir.toLowerCase().includes("select") &&
          !dir.toLowerCase().includes("default"),
      )
      const otherDirs = directories.filter(
        (dir) =>
          !processedDirs.includes(dir) &&
          !yearDirs.includes(dir) &&
          !monthDirs.includes(dir) &&
          !cityDirs.includes(dir),
      )

      const prioritizedDirs = [...processedDirs, ...yearDirs, ...monthDirs, ...cityDirs, ...otherDirs]

      onProgress?.(
        `Found ${directories.length} directories to scan: ${prioritizedDirs.slice(0, 5).join(", ")}${
          prioritizedDirs.length > 5 ? "..." : ""
        }`,
      )

      for (const dir of prioritizedDirs) {
        const subUrl = normalizedUrl + dir
        await scanDirectory(subUrl, depth + 1)

        if (depth === 0 && xmlFiles.length >= maxXmlFiles) {
          if (Number.isFinite(maxXmlFiles)) {
            warnings.push(
              `Stopping scan after reaching remote XML limit (${maxXmlFiles}) to avoid timeouts at ${normalizedUrl}`,
            )
          }
          break
        }

        if (depth === 0 && cityDirs.includes(dir)) {
          rootCityScanCount += 1
          if (rootCityScanCount >= maxCityDirectories) {
            if (Number.isFinite(maxCityDirectories)) {
              warnings.push(
                `Stopping scan after visiting ${rootCityScanCount} city directories to respect configured limit`,
              )
            }
            break
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      console.error(`Error scanning ${normalizedUrl}:`, error)
      warnings.push(`Error scanning ${normalizedUrl}: ${message}`)
      onProgress?.(`Error scanning ${normalizedUrl}: ${message}`)
    }
  }

  await scanDirectory(baseUrl)

  onProgress?.(
    `Scan complete. Found ${xmlFiles.length} XML file(s) and ${mediaFiles.length} media file(s) across ${visitedUrls.size} path(s).`,
  )

  xmlFiles.sort((a, b) => a.name.localeCompare(b.name))
  mediaFiles.sort((a, b) => a.name.localeCompare(b.name))

  return {
    xmlFiles,
    mediaFiles,
    mediaCountsByExtension,
    warnings,
  }
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
