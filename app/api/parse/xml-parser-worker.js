const { parentPort, workerData } = require("worker_threads")
const fs = require("fs/promises")
const path = require("path")
const { parseStringPromise } = require("xml2js")
const fetch = require("node-fetch") // Ensure fetch is imported

// Helper function to check if a path is remote
function isRemotePath(filePath) {
  return filePath && (filePath.startsWith("http://") || filePath.startsWith("https://"))
}

// Helper function to find the main news component
function findMainNewsComponent(newsComponent) {
  if (!newsComponent) return null
  if (typeof newsComponent !== "object") return null

  if (newsComponent.Role && newsComponent.Role.FormalName === "PICTURE") return newsComponent

  if (newsComponent.NewsComponent) {
    const components = Array.isArray(newsComponent.NewsComponent)
      ? newsComponent.NewsComponent
      : [newsComponent.NewsComponent]
    for (const comp of components) {
      const found = findMainNewsComponent(comp)
      if (found) return found
    }
  }
  return null
}

// Helper function to extract CDATA content
function extractCData(element) {
  if (!element) return ""

  if (typeof element === "string") {
    return element.trim()
  }

  if (element && typeof element === "object" && element.hasOwnProperty("_")) {
    const content = String(element._).trim()
    return content
  }

  if (element && typeof element === "object" && element.$ && element.$.Value) {
    return String(element.$.Value).trim()
  }

  if (element && typeof element === "object") {
    const keys = Object.keys(element)
    if (keys.length === 0) return ""

    if (element.toString && element.toString() !== "[object Object]") {
      return element.toString().trim()
    }
  }

  return ""
}

// Helper function to check if file is an image
function isImageFile(fileName) {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".svg"]
  const ext = path.extname(fileName).toLowerCase()
  return imageExtensions.includes(ext)
}

// Helper function to extract base identifier from filename
function extractBaseIdentifier(fileName) {
  // Remove extension
  const baseName = path.basename(fileName, path.extname(fileName))

  // Extract date and main ID parts
  // Pattern: 2025-05-16_PNE25V14121_MED_3_Org or 2025-05-16_ABD25J42405_MED_7_Org_pr
  const parts = baseName.split("_")

  if (parts.length >= 4) {
    const date = parts[0] // 2025-05-16
    const id = parts[1] // PNE25V14121 or ABD25J42405
    const med = parts[2] // MED
    const num = parts[3] // 3 or 7

    return {
      date,
      id,
      med,
      num,
      fullBase: `${date}_${id}_${med}_${num}`,
      dateId: `${date}_${id}`,
      medNum: `${med}_${num}`,
    }
  }

  return {
    date: "",
    id: "",
    med: "",
    num: "",
    fullBase: baseName,
    dateId: "",
    medNum: "",
  }
}

// Helper function to check if two filenames are related
function areFilenamesRelated(xmlFileName, imageFileName) {
  const xmlBase = extractBaseIdentifier(xmlFileName)
  const imgBase = extractBaseIdentifier(imageFileName)

  // Check if they share the same date
  if (xmlBase.date && imgBase.date && xmlBase.date === imgBase.date) {
    // Check if they have similar structure
    if (xmlBase.med === imgBase.med) {
      return {
        related: true,
        confidence: "high",
        reason: `Same date (${xmlBase.date}) and media type (${xmlBase.med})`,
      }
    }

    return {
      related: true,
      confidence: "medium",
      reason: `Same date (${xmlBase.date})`,
    }
  }

  return {
    related: false,
    confidence: "none",
    reason: "No matching patterns found",
  }
}

// Helper function to list directory contents for debugging
async function listDirectoryContents(dirPath, verbose, workerId) {
  try {
    const files = await fs.readdir(dirPath)
    if (verbose) {
      console.log(`[Worker ${workerId}] Directory contents of ${dirPath}:`)
      files.forEach((file, index) => {
        console.log(`[Worker ${workerId}]   ${index + 1}. "${file}"`)
      })
    }
    return files
  } catch (error) {
    if (verbose) {
      console.log(`[Worker ${workerId}] Cannot read directory ${dirPath}: ${error.message}`)
    }
    return []
  }
}

// Helper function to find image with enhanced matching logic
async function findImageWithEnhancedMatch(dirPath, targetFileName, verbose, workerId) {
  try {
    const files = await fs.readdir(dirPath)

    if (verbose) {
      console.log(`[Worker ${workerId}] Looking for "${targetFileName}" in directory with ${files.length} files`)
    }

    // Filter to only image files
    const imageFiles = files.filter((file) => isImageFile(file))

    if (verbose) {
      console.log(`[Worker ${workerId}] Found ${imageFiles.length} image files out of ${files.length} total files`)
    }

    // First try exact match (case sensitive)
    const exactMatch = imageFiles.find((file) => file === targetFileName)
    if (exactMatch) {
      const fullPath = path.join(dirPath, exactMatch)
      const stats = await fs.stat(fullPath)
      if (verbose) {
        console.log(`[Worker ${workerId}] Found exact match: "${exactMatch}"`)
      }
      return {
        exists: true,
        size: stats.size,
        path: fullPath,
        matchType: "exact",
        fileName: exactMatch,
      }
    }

    // Try case insensitive match
    const caseInsensitiveMatch = imageFiles.find((file) => file.toLowerCase() === targetFileName.toLowerCase())
    if (caseInsensitiveMatch) {
      const fullPath = path.join(dirPath, caseInsensitiveMatch)
      const stats = await fs.stat(fullPath)
      if (verbose) {
        console.log(`[Worker ${workerId}] Found case-insensitive match: "${caseInsensitiveMatch}"`)
      }
      return {
        exists: true,
        size: stats.size,
        path: fullPath,
        matchType: "case-insensitive",
        fileName: caseInsensitiveMatch,
      }
    }

    // Try enhanced pattern matching based on filename structure
    const xmlBaseName = path.basename(targetFileName, path.extname(targetFileName))

    if (verbose) {
      console.log(`[Worker ${workerId}] Trying enhanced pattern matching for: "${xmlBaseName}"`)
    }

    // Look for related files
    const relatedFiles = imageFiles
      .map((file) => {
        const relation = areFilenamesRelated(targetFileName, file)
        return {
          file,
          ...relation,
        }
      })
      .filter((item) => item.related)

    if (verbose && relatedFiles.length > 0) {
      console.log(`[Worker ${workerId}] Found ${relatedFiles.length} potentially related files:`)
      relatedFiles.forEach((item, index) => {
        console.log(`[Worker ${workerId}]   ${index + 1}. "${item.file}" (${item.confidence}: ${item.reason})`)
      })
    }

    // Pick the best match (highest confidence first)
    const bestMatch = relatedFiles.sort((a, b) => {
      const confidenceOrder = { high: 3, medium: 2, low: 1, none: 0 }
      return confidenceOrder[b.confidence] - confidenceOrder[a.confidence]
    })[0]

    if (bestMatch) {
      const fullPath = path.join(dirPath, bestMatch.file)
      const stats = await fs.stat(fullPath)
      if (verbose) {
        console.log(
          `[Worker ${workerId}] Found enhanced match: "${bestMatch.file}" (${bestMatch.confidence}: ${bestMatch.reason})`,
        )
      }
      return {
        exists: true,
        size: stats.size,
        path: fullPath,
        matchType: "enhanced-pattern",
        fileName: bestMatch.file,
        confidence: bestMatch.confidence,
        reason: bestMatch.reason,
      }
    }

    // Try basic partial match as fallback
    const baseName = path.basename(targetFileName, path.extname(targetFileName))
    const partialMatch = imageFiles.find((file) => {
      const fileBaseName = path.basename(file, path.extname(file))
      return fileBaseName.includes(baseName.substring(0, 10)) || baseName.includes(fileBaseName.substring(0, 10))
    })

    if (partialMatch) {
      const fullPath = path.join(dirPath, partialMatch)
      const stats = await fs.stat(fullPath)
      if (verbose) {
        console.log(`[Worker ${workerId}] Found partial match: "${partialMatch}" for "${targetFileName}"`)
      }
      return {
        exists: true,
        size: stats.size,
        path: fullPath,
        matchType: "partial",
        fileName: partialMatch,
      }
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] No image match found for "${targetFileName}" in ${dirPath}`)
      console.log(`[Worker ${workerId}] Available image files:`)
      imageFiles.slice(0, 10).forEach((file, index) => {
        console.log(`[Worker ${workerId}]   ${index + 1}. "${file}"`)
      })
      if (imageFiles.length > 10) {
        console.log(`[Worker ${workerId}]   ... and ${imageFiles.length - 10} more image files`)
      }
    }

    return {
      exists: false,
      size: 0,
      path: path.join(dirPath, targetFileName),
      matchType: "none",
      fileName: targetFileName,
    }
  } catch (error) {
    if (verbose) {
      console.log(`[Worker ${workerId}] Error searching in directory ${dirPath}: ${error.message}`)
    }
    return {
      exists: false,
      size: 0,
      path: path.join(dirPath, targetFileName),
      matchType: "error",
      fileName: targetFileName,
    }
  }
}

// Download remote image file
async function downloadRemoteImage(imageUrl, tempDir, verbose, workerId) {
  try {
    if (verbose) {
      console.log(`[Worker ${workerId}] Downloading remote image: ${imageUrl}`)
    }

    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const fileName = path.basename(new URL(imageUrl).pathname)
    const localPath = path.join(tempDir, fileName)

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    await fs.writeFile(localPath, buffer)

    if (verbose) {
      console.log(`[Worker ${workerId}] Downloaded image to: ${localPath}`)
    }

    return localPath
  } catch (error) {
    if (verbose) {
      console.error(`[Worker ${workerId}] Error downloading image ${imageUrl}:`, error.message)
    }
    throw error
  }
}

// Check if local image exists and get its size - ENHANCED VERSION
async function checkLocalImage(imagePath, verbose, workerId) {
  try {
    if (verbose) {
      console.log(`[Worker ${workerId}] Checking local image: ${imagePath}`)
    }

    const fileName = path.basename(imagePath)
    const dirPath = path.dirname(imagePath)

    // First try the exact path
    try {
      await fs.access(imagePath)
      const stats = await fs.stat(imagePath)

      if (verbose) {
        console.log(`[Worker ${workerId}] Local image found at exact path: ${imagePath}, size: ${stats.size} bytes`)
      }

      return {
        exists: true,
        size: stats.size,
        path: imagePath,
        matchType: "exact",
        fileName: fileName,
      }
    } catch (exactPathError) {
      if (verbose) {
        console.log(`[Worker ${workerId}] Image not found at exact path: ${imagePath}`)
      }
    }

    // Try enhanced matching in the expected directory
    if (verbose) {
      console.log(`[Worker ${workerId}] Trying enhanced match in directory: ${dirPath}`)
    }

    const enhancedResult = await findImageWithEnhancedMatch(dirPath, fileName, verbose, workerId)
    if (enhancedResult.exists) {
      return enhancedResult
    }

    // Try alternative directories with enhanced matching
    const alternativeDirs = [
      path.join(path.dirname(dirPath), "media"),
      path.join(path.dirname(dirPath), "images"),
      path.dirname(dirPath),
      path.dirname(workerData.xmlFilePath || ""),
    ]

    for (const altDir of alternativeDirs) {
      if (altDir === dirPath) continue // Skip if same as already tried

      if (verbose) {
        console.log(`[Worker ${workerId}] Trying alternative directory: ${altDir}`)
      }

      const altResult = await findImageWithEnhancedMatch(altDir, fileName, verbose, workerId)
      if (altResult.exists) {
        if (verbose) {
          console.log(`[Worker ${workerId}] Found image in alternative directory: ${altResult.path}`)
        }
        return altResult
      }
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] Local image not found after checking all possible paths for: ${fileName}`)
    }

    return {
      exists: false,
      size: 0,
      path: imagePath,
      matchType: "none",
      fileName: fileName,
    }
  } catch (error) {
    if (verbose) {
      console.error(`[Worker ${workerId}] Error checking local image ${imagePath}:`, error.message)
    }
    return {
      exists: false,
      size: 0,
      path: imagePath,
      matchType: "error",
      fileName: path.basename(imagePath),
    }
  }
}

// Check if remote image exists and get its size
async function checkRemoteImage(imageUrl, verbose, workerId) {
  try {
    const response = await fetch(imageUrl, { method: "HEAD" })
    if (response.ok) {
      const contentLength = response.headers.get("content-length")
      const size = contentLength ? Number.parseInt(contentLength) : 0

      if (verbose) {
        console.log(`[Worker ${workerId}] Remote image found: ${imageUrl}, size: ${size} bytes`)
      }

      return {
        exists: true,
        size: size,
        path: imageUrl,
        matchType: "exact",
        fileName: path.basename(new URL(imageUrl).pathname),
      }
    } else {
      if (verbose) {
        console.log(`[Worker ${workerId}] Remote image not found: ${imageUrl} (${response.status})`)
      }
      return {
        exists: false,
        size: 0,
        path: imageUrl,
        matchType: "none",
        fileName: path.basename(new URL(imageUrl).pathname),
      }
    }
  } catch (error) {
    if (verbose) {
      console.log(`[Worker ${workerId}] Remote image check failed: ${imageUrl} - ${error.message}`)
    }
    return {
      exists: false,
      size: 0,
      path: imageUrl,
      matchType: "error",
      fileName: "",
    }
  }
}

// Universal image checker - handles both local and remote
async function checkImageUniversal(imagePath, verbose, workerId) {
  if (isRemotePath(imagePath)) {
    return await checkRemoteImage(imagePath, verbose, workerId)
  } else {
    return await checkLocalImage(imagePath, verbose, workerId)
  }
}

// Check if image passes filter criteria - ENHANCED WITH BETTER LOGGING
function passesFilter(record, filterConfig) {
  if (!filterConfig?.enabled) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Filters disabled - image ${record.imageHref} passes by default`)
    }
    return true
  }

  if (workerData.verbose) {
    console.log(`[Worker ${workerData.workerId}] Checking filters for image: ${record.imageHref}`)
    console.log(`[Worker ${workerData.workerId}] Filter config enabled: ${filterConfig.enabled}`)
  }

  const applyTextFilter = (fieldValue, filter, fieldName) => {
    if (!filter || !filter.operator) {
      if (workerData.verbose) {
        console.log(`[Worker ${workerData.workerId}] No ${fieldName} filter configured`)
      }
      return true
    }

    const val = String(fieldValue || "")
      .toLowerCase()
      .trim()
    const filterVal = String(filter.value || "")
      .toLowerCase()
      .trim()

    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] ${fieldName} filter: "${val}" ${filter.operator} "${filterVal}"`)
    }

    let result = true
    switch (filter.operator) {
      case "like":
        result = val.includes(filterVal)
        break
      case "notLike":
        result = !val.includes(filterVal)
        break
      case "equals":
        result = val === filterVal
        break
      case "notEquals":
        result = val !== filterVal
        break
      case "startsWith":
        result = val.startsWith(filterVal)
        break
      case "endsWith":
        result = val.endsWith(filterVal)
        break
      case "notBlank":
        result = val !== ""
        break
      case "isBlank":
        result = val === ""
        break
      default:
        result = true
    }

    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] ${fieldName} filter result: ${result}`)
    }

    return result
  }

  // File type filter - check first to avoid unnecessary processing
  if (filterConfig.allowedFileTypes && filterConfig.allowedFileTypes.length > 0) {
    const imageFileName = record.imageHref || ""
    if (imageFileName) {
      const fileExtension = imageFileName.split(".").pop()?.toLowerCase() || ""
      const isAllowedType = filterConfig.allowedFileTypes.some(
        (allowedType) => allowedType.toLowerCase() === fileExtension,
      )

      if (workerData.verbose) {
        console.log(
          `[Worker ${workerData.workerId}] File type filter: .${fileExtension} in [${filterConfig.allowedFileTypes.join(", ")}] = ${isAllowedType}`,
        )
      }

      if (!isAllowedType) {
        if (workerData.verbose) {
          console.log(
            `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: file type .${fileExtension} not in allowed types [${filterConfig.allowedFileTypes.map((t) => `.${t}`).join(", ")}]`,
          )
        }
        return false
      }
    } else {
      if (workerData.verbose) {
        console.log(`[Worker ${workerData.workerId}] Image filtered out: no image filename found`)
      }
      return false
    }
  }

  // Image dimension filters
  const imageWidth = Number.parseInt(record.imageWidth) || 0
  const imageHeight = Number.parseInt(record.imageHeight) || 0

  if (workerData.verbose) {
    console.log(`[Worker ${workerData.workerId}] Image dimensions: ${imageWidth}x${imageHeight}`)
  }

  if (filterConfig.minWidth && imageWidth < filterConfig.minWidth) {
    if (workerData.verbose) {
      console.log(
        `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: width ${imageWidth} < ${filterConfig.minWidth}`,
      )
    }
    return false
  }
  if (filterConfig.minHeight && imageHeight < filterConfig.minHeight) {
    if (workerData.verbose) {
      console.log(
        `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: height ${imageHeight} < ${filterConfig.minHeight}`,
      )
    }
    return false
  }

  // File size filters - handle comma-separated numbers
  let fileSizeBytes = record.actualFileSize || 0
  if (!fileSizeBytes && record.imageSize) {
    // Handle comma-separated numbers like "7,871,228"
    const cleanSize = String(record.imageSize).replace(/,/g, "")
    fileSizeBytes = Number.parseInt(cleanSize) || 0
  }

  const sizeSource = record.actualFileSize ? "filesystem" : "XML"
  const verbose = workerData.verbose
  const workerId = workerData.workerId

  if (verbose) {
    console.log(`[Worker ${workerId}] File size check for ${record.imageHref}:`)
    console.log(`  - Size source: ${sizeSource}`)
    console.log(`  - File size: ${fileSizeBytes} bytes (${Math.round((fileSizeBytes / 1024 / 1024) * 100) / 100}MB)`)
  }

  if (filterConfig.minFileSize) {
    if (verbose) {
      console.log(
        `  - Min file size filter: ${filterConfig.minFileSize} bytes (${Math.round(filterConfig.minFileSize / 1024)}KB)`,
      )
    }
    if (fileSizeBytes < filterConfig.minFileSize) {
      if (verbose) {
        console.log(
          `[Worker ${workerId}] Image ${record.imageHref} filtered out: file size ${fileSizeBytes} bytes (${Math.round(fileSizeBytes / 1024)}KB) < ${filterConfig.minFileSize} bytes (${Math.round(filterConfig.minFileSize / 1024)}KB)`,
        )
      }
      return false
    }
  }

  if (filterConfig.maxFileSize) {
    if (verbose) {
      console.log(
        `  - Max file size filter: ${filterConfig.maxFileSize} bytes (${Math.round((filterConfig.maxFileSize / 1024 / 1024) * 100) / 100}MB)`,
      )
    }
    if (fileSizeBytes > filterConfig.maxFileSize) {
      if (verbose) {
        console.log(
          `[Worker ${workerId}] Image ${record.imageHref} filtered out: file size ${fileSizeBytes} bytes (${Math.round((fileSizeBytes / 1024 / 1024) * 100) / 100}MB) > ${filterConfig.maxFileSize} bytes (${Math.round((filterConfig.maxFileSize / 1024 / 1024) * 100) / 100}MB)`,
        )
      }
      return false
    }
  }

  // Text filters with enhanced logging
  if (!applyTextFilter(record.creditline, filterConfig.creditLine, "creditLine")) {
    if (workerData.verbose) {
      console.log(
        `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: creditLine filter failed. Value: "${record.creditline}", Filter: ${JSON.stringify(filterConfig.creditLine)}`,
      )
    }
    return false
  }
  if (!applyTextFilter(record.copyrightLine, filterConfig.copyright, "copyright")) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: copyright filter failed`)
    }
    return false
  }
  if (!applyTextFilter(record.usageType, filterConfig.usageType, "usageType")) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: usageType filter failed`)
    }
    return false
  }
  if (!applyTextFilter(record.rightsHolder, filterConfig.rightsHolder, "rightsHolder")) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: rightsHolder filter failed`)
    }
    return false
  }
  if (!applyTextFilter(record.location, filterConfig.location, "location")) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: location filter failed`)
    }
    return false
  }

  if (workerData.verbose) {
    console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} passed all filters`)
  }
  return true
}

// Universal image mover - handles both local and remote images
async function moveImageUniversal(
  imagePath,
  userDefinedDestAbsPath,
  folderStructureOption,
  originalRootDirForScan,
  verbose,
  workerId,
  imageFileName,
  originalRemoteStructure = null,
) {
  try {
    if (!imagePath || !userDefinedDestAbsPath) {
      if (verbose) console.log(`[Worker ${workerId}] Missing paths for move operation.`)
      return false
    }

    let sourceImagePath = ""
    const fileName = imageFileName || path.basename(imagePath)

    if (verbose) {
      console.log(`[Worker ${workerId}] Starting image move operation:`)
      console.log(`  - Source: ${imagePath}`)
      console.log(`  - Destination base: ${userDefinedDestAbsPath}`)
      console.log(`  - Folder structure: ${folderStructureOption}`)
      console.log(`  - Image filename: ${fileName}`)
    }

    // Validate that we're moving an actual image file, not XML
    if (!isImageFile(imagePath)) {
      if (verbose) {
        console.log(`[Worker ${workerId}] Skipping move: ${imagePath} is not an image file`)
      }
      return false
    }

    // Handle remote images - download first
    if (isRemotePath(imagePath)) {
      if (verbose) {
        console.log(`[Worker ${workerId}] Preparing to move remote image: ${imagePath}`)
      }

      // Create temp directory for remote image download
      const tempImageDir = path.join(originalRootDirForScan, "temp_images")
      await fs.mkdir(tempImageDir, { recursive: true })

      // Download the remote image
      sourceImagePath = await downloadRemoteImage(imagePath, tempImageDir, verbose, workerId)

      if (verbose) {
        console.log(`[Worker ${workerId}] Downloaded remote image for moving: ${sourceImagePath}`)
      }
    } else {
      // Handle local images - find the actual file first
      if (verbose) {
        console.log(`[Worker ${workerId}] Preparing to move local image: ${imagePath}`)
      }

      // Use the improved image checker to find the actual file
      const imageInfo = await checkLocalImage(imagePath, verbose, workerId)

      if (!imageInfo.exists) {
        if (verbose) console.log(`[Worker ${workerId}] Local image file does not exist: ${imagePath}`)
        return false
      }

      sourceImagePath = imageInfo.path
      if (verbose) {
        console.log(`[Worker ${workerId}] Found local image at: ${sourceImagePath}`)
      }
    }

    // Double-check that the source is an image file
    if (!isImageFile(sourceImagePath)) {
      if (verbose) {
        console.log(`[Worker ${workerId}] Skipping move: source ${sourceImagePath} is not an image file`)
      }
      return false
    }

    // Determine destination path
    let finalDestPath
    let finalDestDir

    if (folderStructureOption === "replicate") {
      // For folder structure replication
      let relativePathFromRoot = ""

      if (originalRemoteStructure) {
        // Use the original remote structure for path calculation
        relativePathFromRoot = path.join(
          originalRemoteStructure.city || "unknown",
          originalRemoteStructure.year || "unknown",
          originalRemoteStructure.month || "unknown",
          "media",
        )
      } else if (isRemotePath(imagePath)) {
        // For remote files, extract relative path from URL
        try {
          const imageUrl = new URL(imagePath)
          const rootUrl = new URL(originalRootDirForScan)
          relativePathFromRoot = path.dirname(imageUrl.pathname.replace(rootUrl.pathname, ""))
        } catch (error) {
          relativePathFromRoot = "remote_images"
        }
      } else {
        // For local files, use standard path relative calculation
        try {
          relativePathFromRoot = path.relative(originalRootDirForScan, path.dirname(sourceImagePath))
        } catch (error) {
          relativePathFromRoot = "local_images"
        }
      }

      finalDestDir = path.join(userDefinedDestAbsPath, relativePathFromRoot)
      finalDestPath = path.join(finalDestDir, path.basename(sourceImagePath))
    } else {
      // Flat structure - all images in one folder
      finalDestDir = userDefinedDestAbsPath
      finalDestPath = path.join(finalDestDir, path.basename(sourceImagePath))
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] Destination paths:`)
      console.log(`  - Final directory: ${finalDestDir}`)
      console.log(`  - Final file path: ${finalDestPath}`)
    }

    // Create destination directory
    await fs.mkdir(finalDestDir, { recursive: true })

    // Check if destination file already exists
    try {
      await fs.access(finalDestPath)
      // File exists, create unique name
      const ext = path.extname(finalDestPath)
      const baseName = path.basename(finalDestPath, ext)
      const timestamp = Date.now()
      const uniqueFileName = `${baseName}_${timestamp}${ext}`
      finalDestPath = path.join(finalDestDir, uniqueFileName)

      if (verbose) {
        console.log(`[Worker ${workerId}] File exists, using unique name: ${uniqueFileName}`)
      }
    } catch {
      // File doesn't exist, use original path
    }

    // Copy the image to destination
    await fs.copyFile(sourceImagePath, finalDestPath)

    if (verbose) {
      console.log(`[Worker ${workerId}] Successfully moved image: ${sourceImagePath} -> ${finalDestPath}`)
    }

    // Clean up temporary file if it was a remote download
    if (isRemotePath(imagePath) && sourceImagePath !== imagePath) {
      try {
        await fs.unlink(sourceImagePath)
        if (verbose) {
          console.log(`[Worker ${workerId}] Cleaned up temporary file: ${sourceImagePath}`)
        }
      } catch (cleanupError) {
        if (verbose) {
          console.log(`[Worker ${workerId}] Warning: Could not clean up temp file: ${cleanupError.message}`)
        }
      }
    }

    return true
  } catch (error) {
    if (verbose) {
      console.error(`[Worker ${workerId}] Error moving image ${imagePath}:`, error.message)
      console.error(`[Worker ${workerId}] Stack trace:`, error.stack)
    }
    return false
  }
}

// Construct image path based on original remote URL and folder structure
function constructRemoteImagePath(originalRemoteXmlUrl, imageHref, verbose, workerId) {
  if (!imageHref || !originalRemoteXmlUrl) return ""

  try {
    if (verbose) {
      console.log(`[Worker ${workerId}] Constructing remote image path:`)
      console.log(`  - Original XML URL: ${originalRemoteXmlUrl}`)
      console.log(`  - Image filename: ${imageHref}`)
    }

    // Parse the original remote XML URL
    const xmlUrl = new URL(originalRemoteXmlUrl)

    // Extract path components
    // Expected: /photoapp/charitra/2006/11/processed/file.xml
    // Want: /photoapp/charitra/2006/11/media/image.jpg
    const pathParts = xmlUrl.pathname.split("/").filter((part) => part.length > 0)

    if (verbose) {
      console.log(`  - Path parts: ${JSON.stringify(pathParts)}`)
    }

    // Find the 'processed' folder and replace with 'media'
    const processedIndex = pathParts.findIndex((part) => part.toLowerCase() === "processed")
    if (processedIndex !== -1) {
      pathParts[processedIndex] = "media"
      // Remove the XML filename (last part)
      pathParts.pop()
    } else {
      // If no 'processed' folder found, assume the structure and build media path
      // Remove the last part (XML filename) and add 'media'
      pathParts.pop()
      pathParts.push("media")
    }

    // Construct the image URL
    const imagePath = "/" + pathParts.join("/") + "/" + imageHref
    const imageUrl = `${xmlUrl.protocol}//${xmlUrl.host}${imagePath}`

    if (verbose) {
      console.log(`  - Constructed image URL: ${imageUrl}`)
    }

    return imageUrl
  } catch (error) {
    if (verbose) {
      console.error(`[Worker ${workerId}] Error constructing remote image path:`, error.message)
    }
    return ""
  }
}

// Construct image path based on XML path (works for both local and remote)
function constructImagePath(xmlFilePath, imageHref, isRemote, originalRemoteXmlUrl, verbose, workerId) {
  if (!imageHref) return ""

  if (isRemote && originalRemoteXmlUrl) {
    // For remote files: use the original remote URL to construct image path
    return constructRemoteImagePath(originalRemoteXmlUrl, imageHref, verbose, workerId)
  } else if (!isRemote) {
    // For local files: try multiple possible paths
    const xmlDir = path.dirname(xmlFilePath)

    // Try media directory at same level as processed
    const mediaDir = path.join(path.dirname(xmlDir), "media")
    const mediaPath = path.join(mediaDir, imageHref)

    if (verbose) {
      console.log(`[Worker ${workerId}] Constructing local image path:`)
      console.log(`  - XML file: ${xmlFilePath}`)
      console.log(`  - Image filename: ${imageHref}`)
      console.log(`  - Trying media directory: ${mediaPath}`)
    }

    return mediaPath
  }

  return ""
}

// Extract folder structure from remote URL
function extractRemoteStructure(remoteXmlUrl, verbose, workerId) {
  try {
    const url = new URL(remoteXmlUrl)
    const pathParts = url.pathname.split("/").filter((part) => part.length > 0)

    // Expected structure: /photoapp/charitra/2006/11/processed/file.xml
    // Extract: city, year, month
    let city = "",
      year = "",
      month = ""

    // Look for year pattern (4 digits)
    const yearIndex = pathParts.findIndex((part) => /^\d{4}$/.test(part))
    if (yearIndex !== -1 && yearIndex > 0) {
      city = pathParts[yearIndex - 1]
      year = pathParts[yearIndex]
      if (yearIndex + 1 < pathParts.length && /^\d{1,2}$/.test(pathParts[yearIndex + 1])) {
        month = pathParts[yearIndex + 1]
      }
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] Extracted remote structure: city=${city}, year=${year}, month=${month}`)
    }

    return { city, year, month }
  } catch (error) {
    if (verbose) {
      console.error(`[Worker ${workerId}] Error extracting remote structure:`, error.message)
    }
    return { city: "", year: "", month: "" }
  }
}

// Process a single XML file
async function processXmlFileInWorker(
  xmlFilePath,
  filterConfig,
  originalRootDir,
  workerId,
  verbose,
  isRemote,
  originalRemoteXmlUrl,
) {
  try {
    if (verbose) {
      console.log(`[Worker ${workerId}] Processing: ${xmlFilePath}`)
      console.log(`[Worker ${workerId}] Mode: ${isRemote ? "Remote" : "Local"}`)
      if (originalRemoteXmlUrl) {
        console.log(`[Worker ${workerId}] Original remote URL: ${originalRemoteXmlUrl}`)
      }
    }

    const xmlContent = await fs.readFile(xmlFilePath, "utf-8")
    const result = await parseStringPromise(xmlContent, {
      explicitArray: false,
      mergeAttrs: true,
    })

    // Extract folder structure from original remote URL or local path
    let city = "",
      year = "",
      month = ""
    let remoteStructure = null

    if (isRemote && originalRemoteXmlUrl) {
      remoteStructure = extractRemoteStructure(originalRemoteXmlUrl, verbose, workerId)
      city = remoteStructure.city
      year = remoteStructure.year
      month = remoteStructure.month
    } else {
      // For local files, extract from path
      const pathParts = xmlFilePath.split(path.sep)
      const yearIndex = pathParts.findIndex((part) => /^\d{4}$/.test(part))
      if (yearIndex !== -1) {
        year = pathParts[yearIndex]
        if (yearIndex > 0) city = pathParts[yearIndex - 1]
        if (yearIndex + 1 < pathParts.length && /^\d{2}$/.test(pathParts[yearIndex + 1])) {
          month = pathParts[yearIndex + 1]
        }
      }

      for (let i = 0; i < pathParts.length; i++) {
        if (pathParts[i].toLowerCase() === "images" && i + 3 < pathParts.length) {
          city = pathParts[i + 1]
          year = pathParts[i + 2]
          month = pathParts[i + 3]
          break
        }
      }
    }

    const newsML = result.NewsML
    if (!newsML) throw new Error("Invalid XML structure: NewsML not found")
    const newsItem = newsML.NewsItem
    if (!newsItem) throw new Error("Invalid XML structure: NewsItem not found")

    const newsIdentifier = newsItem.Identification?.NewsIdentifier
    if (!newsIdentifier) throw new Error("Invalid XML structure: NewsIdentifier not found")

    const newsItemId = newsIdentifier.NewsItemId || ""
    const dateId = newsIdentifier.DateId || ""
    const providerId = newsIdentifier.ProviderId || ""

    const newsManagement = newsItem.NewsManagement || {}
    const status = newsManagement.Status?.FormalName || ""
    const urgency = newsManagement.Urgency?.FormalName || ""
    const creationDate = newsManagement.FirstCreated || ""
    const revisionDate = newsManagement.ThisRevisionCreated || ""

    const mainComponent = findMainNewsComponent(newsItem.NewsComponent)
    if (!mainComponent) throw new Error("Main news component not found")

    let commentData = ""
    if (mainComponent.Comment) {
      commentData = extractCData(mainComponent.Comment)
    }

    let headline = "",
      byline = "",
      dateline = "",
      creditline = "",
      slugline = "",
      keywords = "",
      copyrightLine = ""
    let edition = "",
      location = "",
      pageNumber = "",
      country = "",
      city_meta = ""
    let language = "",
      subject = "",
      processed = "",
      published = ""
    let imageWidth = "",
      imageHeight = "",
      imageSize = "",
      imageHref = ""
    let usageType = "",
      rightsHolder = ""

    if (mainComponent.NewsLines) {
      headline = extractCData(mainComponent.NewsLines.HeadLine)
      byline = extractCData(mainComponent.NewsLines.ByLine)
      dateline = extractCData(mainComponent.NewsLines.DateLine)
      creditline = extractCData(mainComponent.NewsLines.CreditLine)
      slugline = extractCData(mainComponent.NewsLines.SlugLine)
      copyrightLine = extractCData(mainComponent.NewsLines.CopyrightLine)
      if (mainComponent.NewsLines.KeywordLine) {
        const keywordLines = Array.isArray(mainComponent.NewsLines.KeywordLine)
          ? mainComponent.NewsLines.KeywordLine
          : [mainComponent.NewsLines.KeywordLine]
        keywords = keywordLines
          .map((k) => extractCData(k))
          .filter(Boolean)
          .join(", ")
      }
    }

    if (mainComponent.AdministrativeMetadata?.Property) {
      const props = Array.isArray(mainComponent.AdministrativeMetadata.Property)
        ? mainComponent.AdministrativeMetadata.Property
        : [mainComponent.AdministrativeMetadata.Property]
      for (const prop of props) {
        if (prop.FormalName === "Edition") edition = prop.Value || ""
        if (prop.FormalName === "Location") location = prop.Value || ""
        if (prop.FormalName === "PageNumber") pageNumber = prop.Value || ""
      }
    }

    if (mainComponent.DescriptiveMetadata) {
      const descMeta = mainComponent.DescriptiveMetadata
      language = descMeta.Language?.FormalName || ""
      subject = descMeta.SubjectCode?.Subject?.FormalName || ""
      if (descMeta.Property) {
        const props = Array.isArray(descMeta.Property) ? descMeta.Property : [descMeta.Property]
        for (const prop of props) {
          if (prop.FormalName === "Processed") processed = prop.Value || ""
          if (prop.FormalName === "Published") published = prop.Value || ""
          if (prop.FormalName === "Location") {
            if (prop.Property) {
              const locProps = Array.isArray(prop.Property) ? prop.Property : [prop.Property]
              for (const locProp of locProps) {
                if (locProp.FormalName === "Country") country = locProp.Value || ""
                if (locProp.FormalName === "City") city_meta = locProp.Value || ""
              }
            }
          }
        }
      }
    }

    if (mainComponent.RightsMetadata?.UsageRights) {
      usageType = extractCData(mainComponent.RightsMetadata.UsageRights.UsageType)
      rightsHolder = extractCData(mainComponent.RightsMetadata.UsageRights.RightsHolder)
    } else if (mainComponent.UsageRights) {
      usageType = extractCData(mainComponent.UsageRights.UsageType)
      rightsHolder = extractCData(mainComponent.UsageRights.RightsHolder)
    }

    if (!copyrightLine && mainComponent.RightsMetadata?.UsageRights?.Property) {
      const usageProps = Array.isArray(mainComponent.RightsMetadata.UsageRights.Property)
        ? mainComponent.RightsMetadata.UsageRights.Property
        : [mainComponent.RightsMetadata.UsageRights.Property]
      for (const prop of usageProps) {
        if (prop.FormalName === "CopyrightNotice" || prop.FormalName === "Copyright") {
          copyrightLine = prop.Value || ""
          break
        }
      }
    }

    if (mainComponent.ContentItem) {
      const contentItems = Array.isArray(mainComponent.ContentItem)
        ? mainComponent.ContentItem
        : [mainComponent.ContentItem]
      for (const item of contentItems) {
        if (item.MediaType && (item.MediaType.FormalName === "HIGHRES" || item.MediaType.FormalName === "Picture")) {
          if (item.Characteristics) {
            imageSize = item.Characteristics.SizeInBytes || ""
            if (item.Characteristics.Property) {
              const props = Array.isArray(item.Characteristics.Property)
                ? item.Characteristics.Property
                : [item.Characteristics.Property]
              for (const prop of props) {
                if (prop.FormalName === "width") imageWidth = prop.Value || ""
                if (prop.FormalName === "height") imageHeight = prop.Value || ""
              }
            }
          }
          imageHref = item.Href || ""
          break
        }
      }
    }

    // Universal image handling - works for both local and remote
    let imagePath = ""
    let imageExists = false
    let actualFileSize = 0
    let actualImagePath = ""
    let matchInfo = {}

    if (imageHref) {
      // Construct image path (local or remote)
      imagePath = constructImagePath(xmlFilePath, imageHref, isRemote, originalRemoteXmlUrl, verbose, workerId)

      if (verbose) {
        console.log(`[Worker ${workerId}] Constructed image path: ${imagePath}`)
      }

      // Check image existence and get size (universal method)
      if (imagePath) {
        const imageInfo = await checkImageUniversal(imagePath, verbose, workerId)
        imageExists = imageInfo.exists
        actualFileSize = imageInfo.size
        actualImagePath = imageInfo.path // This is the actual found path
        matchInfo = {
          matchType: imageInfo.matchType,
          fileName: imageInfo.fileName,
          confidence: imageInfo.confidence,
          reason: imageInfo.reason,
        }

        if (verbose) {
          console.log(`[Worker ${workerId}] Image check result:`)
          console.log(`  - Exists: ${imageExists}`)
          console.log(`  - Size: ${actualFileSize} bytes`)
          console.log(`  - Found at: ${actualImagePath}`)
          console.log(`  - Match type: ${imageInfo.matchType}`)
          if (imageInfo.confidence) {
            console.log(`  - Confidence: ${imageInfo.confidence}`)
            console.log(`  - Reason: ${imageInfo.reason}`)
          }
        }
      }
    }

    const record = {
      city,
      year,
      month,
      newsItemId,
      dateId,
      providerId,
      headline,
      byline,
      dateline,
      creditline,
      copyrightLine,
      slugline,
      keywords,
      edition,
      location,
      country,
      city_meta,
      pageNumber,
      status,
      urgency,
      language,
      subject,
      processed,
      published,
      usageType,
      rightsHolder,
      imageWidth,
      imageHeight,
      imageSize,
      actualFileSize,
      imageHref,
      xmlPath: xmlFilePath,
      imagePath: actualImagePath || imagePath, // Use actual found path
      imageExists: imageExists ? "Yes" : "No",
      creationDate,
      revisionDate,
      commentData,
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] Extracted image metadata for ${path.basename(xmlFilePath)}:`)
      console.log(`  - Image file: ${imageHref}`)
      console.log(`  - Raw size from XML: "${imageSize}"`)
      console.log(`  - Actual file size: ${actualFileSize} bytes`)
      console.log(`  - Dimensions: ${imageWidth}x${imageHeight}`)
      console.log(`  - Image exists: ${imageExists}`)
      console.log(`  - Image path: ${actualImagePath || imagePath}`)
      console.log(`  - Path type: ${isRemotePath(actualImagePath || imagePath) ? "Remote" : "Local"}`)
    }

    const passed = passesFilter(record, filterConfig)
    let moved = false

    if (filterConfig?.enabled && !passed) {
      if (verbose) {
        console.log(`[Worker ${workerId}] File ${path.basename(xmlFilePath)} did not pass filters`)
      }
      return { record: null, passedFilter: false, imageMoved: false, workerId }
    }

    // Universal image moving - handles both local and remote
    if (
      filterConfig?.enabled &&
      passed &&
      filterConfig?.moveImages &&
      filterConfig?.moveDestinationPath &&
      filterConfig?.moveFolderStructureOption &&
      imageExists &&
      imageHref &&
      (actualImagePath || imagePath)
    ) {
      try {
        if (verbose) {
          console.log(`[Worker ${workerId}] Attempting to move image: ${actualImagePath || imagePath}`)
        }

        moved = await moveImageUniversal(
          actualImagePath || imagePath, // Use the actual found path
          filterConfig.moveDestinationPath,
          filterConfig.moveFolderStructureOption,
          originalRootDir,
          verbose,
          workerId,
          matchInfo.fileName || imageHref,
          remoteStructure,
        )

        if (verbose) {
          console.log(`[Worker ${workerId}] Image move result: ${moved ? "SUCCESS" : "FAILED"}`)
        }
      } catch (error) {
        if (verbose) {
          console.error(`[Worker ${workerId}] Error during image move:`, error.message)
        }
      }
    } else if (verbose) {
      console.log(`[Worker ${workerId}] Image move skipped:`)
      console.log(`  - Filters enabled: ${filterConfig?.enabled}`)
      console.log(`  - Passed filters: ${passed}`)
      console.log(`  - Move images enabled: ${filterConfig?.moveImages}`)
      console.log(`  - Destination path: ${filterConfig?.moveDestinationPath}`)
      console.log(`  - Image exists: ${imageExists}`)
    }

    if (verbose) {
      console.log(
        `[Worker ${workerId}] File ${path.basename(xmlFilePath)} processed successfully. Passed filter: ${passed}, Image moved: ${moved}`,
      )
    }

    return { record: passed ? record : null, passedFilter: passed, imageMoved: moved, workerId }
  } catch (err) {
    console.error(`[Worker ${workerId}] Error processing ${xmlFilePath}:`, err.message)
    if (verbose) {
      console.error(`[Worker ${workerId}] Stack trace:`, err.stack)
    }
    return { record: null, passedFilter: false, imageMoved: false, error: err.message, workerId }
  }
}

// Main worker execution
async function main() {
  try {
    if (!workerData) {
      throw new Error("No workerData provided")
    }

    const { xmlFilePath, filterConfig, originalRootDir, workerId, verbose, isRemote, originalRemoteXmlUrl } = workerData

    if (verbose) {
      console.log(`[Worker ${workerId}] Starting to process: ${path.basename(xmlFilePath)}`)
      console.log(`[Worker ${workerId}] Processing mode: ${isRemote ? "Remote" : "Local"}`)
      if (originalRemoteXmlUrl) {
        console.log(`[Worker ${workerId}] Original remote XML URL: ${originalRemoteXmlUrl}`)
      }
      if (filterConfig?.enabled) {
        console.log(`[Worker ${workerId}] Filter config:`, JSON.stringify(filterConfig, null, 2))
      }
    }

    const result = await processXmlFileInWorker(
      xmlFilePath,
      filterConfig,
      originalRootDir,
      workerId,
      verbose,
      isRemote,
      originalRemoteXmlUrl,
    )

    if (verbose) {
      console.log(`[Worker ${workerId}] Finished processing: ${path.basename(xmlFilePath)}`)
    }

    if (parentPort) {
      parentPort.postMessage(result)
    } else {
      console.error(`[Worker ${workerId}] No parentPort available to send result`)
    }
  } catch (error) {
    console.error(`[Worker ${workerData?.workerId || "unknown"}] Fatal error:`, error.message)
    if (parentPort) {
      parentPort.postMessage({
        record: null,
        passedFilter: false,
        imageMoved: false,
        error: error.message,
        workerId: workerData?.workerId || 0,
      })
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Worker main function failed:", error)
  process.exit(1)
})
