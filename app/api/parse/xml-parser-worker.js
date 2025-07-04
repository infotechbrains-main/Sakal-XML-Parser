const { parentPort, workerData } = require("worker_threads")
const fs = require("fs/promises")
const path = require("path")
const { parseStringPromise } = require("xml2js")

// Add comprehensive error tracking
const workerState = {
  id: workerData?.workerId || "unknown",
  status: "initializing",
  currentStep: "startup",
  errors: [],
  warnings: [],
}

function logWorkerState(step, details = "") {
  workerState.currentStep = step
  if (workerData?.verbose) {
    console.log(`[Worker ${workerState.id}] STATE: ${step} ${details}`)
  }
}

function logWorkerError(error, step = "unknown") {
  const errorInfo = {
    step,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  }
  workerState.errors.push(errorInfo)
  console.error(`[Worker ${workerState.id}] ERROR in ${step}:`, error.message)
  if (workerData?.verbose) {
    console.error(`[Worker ${workerState.id}] ERROR STACK:`, error.stack)
  }
}

// Helper function to check if a path is remote
function isRemotePath(filePath) {
  return filePath && (filePath.startsWith("http://") || filePath.startsWith("https://"))
}

// Helper function to fetch remote file content
async function fetchRemoteFile(url) {
  try {
    logWorkerState("fetching_remote_file", url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const content = await response.text()
    logWorkerState("fetched_remote_file", `${content.length} bytes`)
    return content
  } catch (error) {
    logWorkerError(error, "fetchRemoteFile")
    throw new Error(`Failed to fetch remote file ${url}: ${error.message}`)
  }
}

// Helper function to download remote file to temp location
async function downloadRemoteFile(url, tempDir) {
  try {
    logWorkerState("downloading_remote_file", url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const fileName = path.basename(new URL(url).pathname)
    const localPath = path.join(tempDir, fileName)

    const buffer = await response.arrayBuffer()
    await fs.writeFile(localPath, Buffer.from(buffer))

    logWorkerState("downloaded_remote_file", `${buffer.byteLength} bytes to ${localPath}`)
    return localPath
  } catch (error) {
    logWorkerError(error, "downloadRemoteFile")
    throw new Error(`Failed to download remote file ${url}: ${error.message}`)
  }
}

// Helper function to create temp directory
async function createTempDir() {
  try {
    logWorkerState("creating_temp_dir")
    const tempDir = path.join(
      require("os").tmpdir(),
      `xml-parser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    )
    await fs.mkdir(tempDir, { recursive: true })
    logWorkerState("created_temp_dir", tempDir)
    return tempDir
  } catch (error) {
    logWorkerError(error, "createTempDir")
    throw error
  }
}

// Helper function to cleanup temp directory
async function cleanupTempDir(tempDir) {
  try {
    logWorkerState("cleaning_temp_dir", tempDir)
    await fs.rm(tempDir, { recursive: true, force: true })
    logWorkerState("cleaned_temp_dir", tempDir)
  } catch (error) {
    logWorkerError(error, "cleanupTempDir")
    // Don't throw - cleanup errors are not critical
  }
}

// Helper function to find the main news component
function findMainNewsComponent(newsComponent) {
  try {
    logWorkerState("finding_main_news_component")
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
  } catch (error) {
    logWorkerError(error, "findMainNewsComponent")
    return null
  }
}

// Helper function to extract CDATA content
function extractCData(element) {
  try {
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
  } catch (error) {
    logWorkerError(error, "extractCData")
    return ""
  }
}

// Helper function to check if file is an image
function isImageFile(fileName) {
  try {
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".svg"]
    const ext = path.extname(fileName).toLowerCase()
    return imageExtensions.includes(ext)
  } catch (error) {
    logWorkerError(error, "isImageFile")
    return false
  }
}

// Enhanced image path finder - tries multiple possible locations
async function findImagePath(xmlFilePath, imageHref, verbose, workerId, associatedImagePath, isRemote, tempDir) {
  try {
    logWorkerState("finding_image_path", imageHref)

    if (!imageHref) return null

    // If we have an associated image path from the watcher, use it first
    if (associatedImagePath && workerData.isWatchMode) {
      try {
        await fs.access(associatedImagePath)
        const stats = await fs.stat(associatedImagePath)

        if (verbose) {
          console.log(`[Worker ${workerId}] ✓ Using associated image from watcher: ${associatedImagePath}`)
          console.log(`[Worker ${workerId}] Image size: ${stats.size} bytes`)
        }

        return {
          exists: true,
          size: stats.size,
          path: associatedImagePath,
          fileName: path.basename(associatedImagePath),
          foundAt: "watcher_provided",
        }
      } catch (error) {
        if (verbose) {
          console.log(`[Worker ${workerId}] ✗ Associated image from watcher not accessible: ${associatedImagePath}`)
        }
      }
    }

    // Handle remote images
    if (isRemote) {
      try {
        logWorkerState("searching_remote_image", imageHref)

        // Try to construct the image URL based on the XML URL
        const xmlUrl = new URL(xmlFilePath)
        const baseUrl = `${xmlUrl.protocol}//${xmlUrl.host}`
        const xmlPath = xmlUrl.pathname

        // Try different possible image locations relative to XML
        const possibleImagePaths = [
          // Media folder at same level as processed
          path.dirname(path.dirname(xmlPath)) + "/media/" + imageHref,
          // Same directory as XML
          path.dirname(xmlPath) + "/" + imageHref,
          // Images folder at same level
          path.dirname(path.dirname(xmlPath)) + "/images/" + imageHref,
          // Root media folder
          "/media/" + imageHref,
          // Root images folder
          "/images/" + imageHref,
        ]

        if (verbose) {
          console.log(`[Worker ${workerId}] Searching for remote image: ${imageHref}`)
          console.log(`[Worker ${workerId}] XML URL: ${xmlFilePath}`)
          console.log(`[Worker ${workerId}] Trying ${possibleImagePaths.length} possible remote locations...`)
        }

        for (let i = 0; i < possibleImagePaths.length; i++) {
          const imagePath = possibleImagePaths[i]
          const imageUrl = baseUrl + imagePath

          try {
            logWorkerState("checking_remote_image", `location ${i + 1}: ${imageUrl}`)
            const response = await fetch(imageUrl, { method: "HEAD" })
            if (response.ok) {
              const contentLength = response.headers.get("content-length")
              const size = contentLength ? Number.parseInt(contentLength) : 0

              if (verbose) {
                console.log(`[Worker ${workerId}] ✓ Found remote image at location ${i + 1}: ${imageUrl}`)
                console.log(`[Worker ${workerId}] Image size: ${size} bytes`)
              }

              // Download the image to temp directory for processing
              try {
                logWorkerState("downloading_found_image", imageUrl)
                const localImagePath = await downloadRemoteFile(imageUrl, tempDir)
                const stats = await fs.stat(localImagePath)

                logWorkerState("downloaded_found_image", `${stats.size} bytes`)
                return {
                  exists: true,
                  size: stats.size,
                  path: localImagePath,
                  fileName: imageHref,
                  foundAt: `remote_location_${i + 1}`,
                  remoteUrl: imageUrl,
                  isRemoteDownloaded: true, // Flag to indicate this is a downloaded remote image
                }
              } catch (downloadError) {
                logWorkerError(downloadError, "downloadFoundImage")
                if (verbose) {
                  console.log(`[Worker ${workerId}] ✗ Failed to download remote image: ${downloadError.message}`)
                }
                // Return info about found image even if download failed
                return {
                  exists: true,
                  size: size,
                  path: imageUrl, // Use URL as path for remote
                  fileName: imageHref,
                  foundAt: `remote_location_${i + 1}`,
                  remoteUrl: imageUrl,
                  downloadFailed: true,
                }
              }
            }
          } catch (error) {
            if (verbose && i < 3) {
              console.log(`[Worker ${workerId}] ✗ Remote image not found at location ${i + 1}: ${imageUrl}`)
            }
          }
        }

        if (verbose) {
          console.log(
            `[Worker ${workerId}] ✗ Remote image not found in any of the ${possibleImagePaths.length} locations`,
          )
        }

        return {
          exists: false,
          size: 0,
          path: baseUrl + possibleImagePaths[0],
          fileName: imageHref,
          foundAt: "not_found",
          remoteUrl: baseUrl + possibleImagePaths[0],
        }
      } catch (error) {
        logWorkerError(error, "findRemoteImage")
        if (verbose) {
          console.log(`[Worker ${workerId}] ✗ Error searching for remote image: ${error.message}`)
        }
        return {
          exists: false,
          size: 0,
          path: imageHref,
          fileName: imageHref,
          foundAt: "error",
          error: error.message,
        }
      }
    }

    // Handle local images (existing logic)
    logWorkerState("searching_local_image", imageHref)
    const xmlDir = path.dirname(xmlFilePath)
    const parentDir = path.dirname(xmlDir)

    // List of possible image locations to try
    const possiblePaths = [
      // Standard media folder at same level as processed
      path.join(parentDir, "media", imageHref),
      // Media folder inside the same directory as XML
      path.join(xmlDir, "media", imageHref),
      // Images folder at same level as processed
      path.join(parentDir, "images", imageHref),
      // Images folder inside the same directory as XML
      path.join(xmlDir, "images", imageHref),
      // Same directory as XML file
      path.join(xmlDir, imageHref),
      // Parent directory
      path.join(parentDir, imageHref),
      // One level up from parent
      path.join(path.dirname(parentDir), "media", imageHref),
      path.join(path.dirname(parentDir), "images", imageHref),
    ]

    if (verbose) {
      console.log(`[Worker ${workerId}] Searching for local image: ${imageHref}`)
      console.log(`[Worker ${workerId}] XML file: ${xmlFilePath}`)
      console.log(`[Worker ${workerId}] Trying ${possiblePaths.length} possible locations...`)
    }

    // Try each possible path
    for (let i = 0; i < possiblePaths.length; i++) {
      const testPath = possiblePaths[i]
      try {
        await fs.access(testPath)
        const stats = await fs.stat(testPath)

        if (verbose) {
          console.log(`[Worker ${workerId}] ✓ Found image at location ${i + 1}: ${testPath}`)
          console.log(`[Worker ${workerId}] Image size: ${stats.size} bytes`)
        }

        return {
          exists: true,
          size: stats.size,
          path: testPath,
          fileName: path.basename(testPath),
          foundAt: `location_${i + 1}`,
        }
      } catch (error) {
        if (verbose && i < 3) {
          // Only log first few attempts to avoid spam
          console.log(`[Worker ${workerId}] ✗ Not found at location ${i + 1}: ${testPath}`)
        }
      }
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] ✗ Image not found in any of the ${possiblePaths.length} locations`)
      console.log(`[Worker ${workerId}] Searched locations:`)
      possiblePaths.slice(0, 5).forEach((p, i) => {
        console.log(`[Worker ${workerId}]   ${i + 1}. ${p}`)
      })
      if (possiblePaths.length > 5) {
        console.log(`[Worker ${workerId}]   ... and ${possiblePaths.length - 5} more locations`)
      }
    }

    return {
      exists: false,
      size: 0,
      path: possiblePaths[0], // Return the first attempted path as default
      fileName: imageHref,
      foundAt: "not_found",
    }
  } catch (error) {
    logWorkerError(error, "findImagePath")
    return {
      exists: false,
      size: 0,
      path: imageHref,
      fileName: imageHref,
      foundAt: "error",
      error: error.message,
    }
  }
}

// Check if image passes filter criteria - FIXED VERSION
function passesFilter(record, filterConfig) {
  try {
    logWorkerState("checking_filters", record.imageHref)

    // Debug log the filter config received
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Filter config received:`, JSON.stringify(filterConfig, null, 2))
    }

    if (!filterConfig || !filterConfig.enabled) {
      if (workerData.verbose) {
        console.log(`[Worker ${workerData.workerId}] Filters disabled - image ${record.imageHref} passes by default`)
      }
      return true
    }

    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] ✓ Filters are ENABLED - checking image: ${record.imageHref}`)
    }

    const applyTextFilter = (fieldValue, filter, fieldName) => {
      if (!filter || !filter.operator) {
        return true
      }

      const val = String(fieldValue || "")
        .toLowerCase()
        .trim()
      const filterVal = String(filter.value || "")
        .toLowerCase()
        .trim()

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

      return result
    }

    // File type filter - FIXED to handle both .tif and .tiff
    const allowedTypes = filterConfig.allowedFileTypes || filterConfig.fileTypes || []
    if (allowedTypes && allowedTypes.length > 0) {
      const imageFileName = record.imageHref || ""
      if (imageFileName) {
        const fileExtension = imageFileName.split(".").pop()?.toLowerCase() || ""

        // Create a normalized list of allowed extensions
        const normalizedAllowedTypes = allowedTypes.map((type) => type.toLowerCase())

        // Handle special case for TIFF files - both .tif and .tiff should be accepted if either is allowed
        let isAllowedType = normalizedAllowedTypes.includes(fileExtension)

        // Special handling for TIFF files
        if (!isAllowedType && (fileExtension === "tif" || fileExtension === "tiff")) {
          isAllowedType = normalizedAllowedTypes.includes("tif") || normalizedAllowedTypes.includes("tiff")
        }

        if (workerData.verbose) {
          console.log(`[Worker ${workerData.workerId}] File type check:`)
          console.log(`  - Image extension: .${fileExtension}`)
          console.log(`  - Allowed types: [${allowedTypes.join(", ")}]`)
          console.log(`  - Normalized allowed types: [${normalizedAllowedTypes.join(", ")}]`)
          console.log(`  - Is allowed: ${isAllowedType}`)
        }

        if (!isAllowedType) {
          if (workerData.verbose) {
            console.log(
              `[Worker ${workerData.workerId}] ✗ Image ${record.imageHref} filtered out: file type .${fileExtension} not in allowed types`,
            )
          }
          return false
        }
      }
    }

    // Image dimension filters
    const imageWidth = Number.parseInt(record.imageWidth) || 0
    const imageHeight = Number.parseInt(record.imageHeight) || 0

    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Dimension check:`)
      console.log(`  - Image dimensions: ${imageWidth}x${imageHeight}`)
      console.log(`  - Min width filter: ${filterConfig.minWidth || "none"}`)
      console.log(`  - Min height filter: ${filterConfig.minHeight || "none"}`)
    }

    if (filterConfig.minWidth && imageWidth < filterConfig.minWidth) {
      if (workerData.verbose) {
        console.log(
          `[Worker ${workerData.workerId}] ✗ Image ${record.imageHref} filtered out: width ${imageWidth} < ${filterConfig.minWidth}`,
        )
      }
      return false
    }
    if (filterConfig.minHeight && imageHeight < filterConfig.minHeight) {
      if (workerData.verbose) {
        console.log(
          `[Worker ${workerData.workerId}] ✗ Image ${record.imageHref} filtered out: height ${imageHeight} < ${filterConfig.minHeight}`,
        )
      }
      return false
    }

    // File size filters
    let fileSizeBytes = record.actualFileSize || 0
    if (!fileSizeBytes && record.imageSize) {
      const cleanSize = String(record.imageSize).replace(/,/g, "")
      fileSizeBytes = Number.parseInt(cleanSize) || 0
    }

    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] File size check:`)
      console.log(`  - Actual file size: ${fileSizeBytes} bytes`)
      console.log(`  - Min size filter: ${filterConfig.minFileSize || "none"}`)
      console.log(`  - Max size filter: ${filterConfig.maxFileSize || "none"}`)
    }

    if (filterConfig.minFileSize && fileSizeBytes < filterConfig.minFileSize) {
      if (workerData.verbose) {
        console.log(
          `[Worker ${workerData.workerId}] ✗ Image ${record.imageHref} filtered out: file size ${fileSizeBytes} < ${filterConfig.minFileSize}`,
        )
      }
      return false
    }

    if (filterConfig.maxFileSize && fileSizeBytes > filterConfig.maxFileSize) {
      if (workerData.verbose) {
        console.log(
          `[Worker ${workerData.workerId}] ✗ Image ${record.imageHref} filtered out: file size ${fileSizeBytes} > ${filterConfig.maxFileSize}`,
        )
      }
      return false
    }

    // Text filters
    if (!applyTextFilter(record.creditline, filterConfig.creditLine, "creditLine")) {
      return false
    }
    if (!applyTextFilter(record.copyrightLine, filterConfig.copyright, "copyright")) {
      return false
    }
    if (!applyTextFilter(record.usageType, filterConfig.usageType, "usageType")) {
      return false
    }
    if (!applyTextFilter(record.rightsHolder, filterConfig.rightsHolder, "rightsHolder")) {
      return false
    }
    if (!applyTextFilter(record.location, filterConfig.location, "location")) {
      return false
    }

    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] ✓ Image ${record.imageHref} passed all filters`)
    }
    return true
  } catch (error) {
    logWorkerError(error, "passesFilter")
    // If filter check fails, default to passing
    return true
  }
}

// Move image to destination folder - UPDATED to handle remote images
async function moveImage(
  sourceImagePath,
  destinationBasePath,
  folderStructureOption,
  originalRootDir,
  verbose,
  workerId,
  imageFileName,
  xmlFilePath,
  isRemoteDownloaded = false,
) {
  try {
    logWorkerState("moving_image", sourceImagePath)

    if (!sourceImagePath || !destinationBasePath) {
      if (verbose) console.log(`[Worker ${workerId}] Missing paths for move operation.`)
      return false
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] Starting image move operation:`)
      console.log(`  - Source: ${sourceImagePath}`)
      console.log(`  - Destination base: ${destinationBasePath}`)
      console.log(`  - Folder structure: ${folderStructureOption}`)
      console.log(`  - Image filename: ${imageFileName}`)
      console.log(`  - XML file path: ${xmlFilePath}`)
      console.log(`  - Is remote downloaded: ${isRemoteDownloaded}`)
    }

    // For remote images that haven't been downloaded, we can't move them
    const isRemoteSource = isRemotePath(sourceImagePath)
    if (isRemoteSource && !isRemoteDownloaded) {
      if (verbose) {
        console.log(`[Worker ${workerId}] ✗ Cannot move remote image directly: ${sourceImagePath}`)
        console.log(`[Worker ${workerId}] Remote images need to be downloaded first`)
      }
      return false
    }

    // Verify source image exists (for local files and downloaded remote files)
    try {
      await fs.access(sourceImagePath)
      if (verbose) {
        console.log(`[Worker ${workerId}] ✓ Verified source image exists: ${sourceImagePath}`)
      }
    } catch (error) {
      if (verbose) {
        console.log(`[Worker ${workerId}] ✗ Source image does not exist: ${sourceImagePath}`)
      }
      return false
    }

    // Determine destination path
    let finalDestDir
    let finalDestPath

    if (folderStructureOption === "replicate") {
      // For remote files, extract structure from URL
      if (isRemotePath(xmlFilePath)) {
        try {
          const url = new URL(xmlFilePath)
          const pathParts = url.pathname.split("/").filter((part) => part.length > 0)

          // Find the structure: photoapp/City/Year/Month/processed
          const photoappIndex = pathParts.findIndex((part) => part.toLowerCase() === "photoapp")
          if (photoappIndex !== -1 && pathParts.length > photoappIndex + 3) {
            const city = pathParts[photoappIndex + 1]
            const year = pathParts[photoappIndex + 2]
            const month = pathParts[photoappIndex + 3]

            // Create structure: City/Year/Month/media
            const relativePath = path.join(city, year, month, "media")
            finalDestDir = path.join(destinationBasePath, relativePath)

            if (verbose) {
              console.log(`[Worker ${workerId}] Remote structure replication:`)
              console.log(`  - URL path: ${url.pathname}`)
              console.log(`  - Extracted: ${city}/${year}/${month}`)
              console.log(`  - Final dest dir: ${finalDestDir}`)
            }
          } else {
            // Fallback to flat structure
            finalDestDir = destinationBasePath
            if (verbose) {
              console.log(`[Worker ${workerId}] Could not extract remote structure, using flat`)
            }
          }
        } catch (error) {
          if (verbose) {
            console.log(`[Worker ${workerId}] Error parsing remote URL, using flat structure: ${error.message}`)
          }
          finalDestDir = destinationBasePath
        }
      } else {
        // Local file structure replication
        try {
          const xmlDir = path.dirname(xmlFilePath)
          const relativePathFromRoot = path.relative(originalRootDir, xmlDir)

          // Replace 'processed' with 'media' in the path if it exists
          const pathParts = relativePathFromRoot.split(path.sep)
          const processedIndex = pathParts.findIndex((part) => part.toLowerCase() === "processed")
          if (processedIndex !== -1) {
            pathParts[processedIndex] = "media"
          }

          const adjustedRelativePath = pathParts.join(path.sep)
          finalDestDir = path.join(destinationBasePath, adjustedRelativePath)

          if (verbose) {
            console.log(`[Worker ${workerId}] Local structure replication:`)
            console.log(`  - XML dir: ${xmlDir}`)
            console.log(`  - Relative path: ${relativePathFromRoot}`)
            console.log(`  - Adjusted path: ${adjustedRelativePath}`)
            console.log(`  - Final dest dir: ${finalDestDir}`)
          }
        } catch (error) {
          if (verbose) {
            console.log(`[Worker ${workerId}] Error calculating relative path, using flat structure: ${error.message}`)
          }
          finalDestDir = destinationBasePath
        }
      }
    } else {
      // Flat structure - all images in one folder
      finalDestDir = destinationBasePath
    }

    finalDestPath = path.join(finalDestDir, imageFileName)

    if (verbose) {
      console.log(`[Worker ${workerId}] Destination paths:`)
      console.log(`  - Final directory: ${finalDestDir}`)
      console.log(`  - Final file path: ${finalDestPath}`)
    }

    // Create destination directory
    await fs.mkdir(finalDestDir, { recursive: true })
    if (verbose) {
      console.log(`[Worker ${workerId}] ✓ Created destination directory: ${finalDestDir}`)
    }

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
      console.log(`[Worker ${workerId}] ✓ Successfully moved image: ${sourceImagePath} -> ${finalDestPath}`)
    }

    return true
  } catch (error) {
    logWorkerError(error, "moveImage")
    if (verbose) {
      console.error(`[Worker ${workerId}] ✗ Error moving image ${sourceImagePath}:`, error.message)
      console.error(`[Worker ${workerId}] Stack trace:`, error.stack)
    }
    return false
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
  associatedImagePath,
) {
  let tempDir = null

  try {
    logWorkerState("processing_xml_file", xmlFilePath)

    if (verbose) {
      console.log(`[Worker ${workerId}] Processing: ${xmlFilePath}`)
      console.log(`[Worker ${workerId}] Filter config:`, JSON.stringify(filterConfig, null, 2))
      if (associatedImagePath) {
        console.log(`[Worker ${workerId}] Associated image: ${associatedImagePath}`)
      }
      if (isRemote) {
        console.log(`[Worker ${workerId}] Remote processing mode enabled`)
      }
    }

    // Create temp directory for remote file processing
    if (isRemote) {
      tempDir = await createTempDir()
      if (verbose) {
        console.log(`[Worker ${workerId}] Created temp directory: ${tempDir}`)
      }
    }

    // Read XML content (local or remote)
    let xmlContent
    if (isRemote) {
      if (verbose) {
        console.log(`[Worker ${workerId}] Fetching remote XML: ${xmlFilePath}`)
      }
      xmlContent = await fetchRemoteFile(xmlFilePath)
    } else {
      logWorkerState("reading_local_xml", xmlFilePath)
      xmlContent = await fs.readFile(xmlFilePath, "utf-8")
    }

    logWorkerState("parsing_xml", `${xmlContent.length} bytes`)
    const result = await parseStringPromise(xmlContent, {
      explicitArray: false,
      mergeAttrs: true,
    })

    logWorkerState("extracting_metadata")

    // Extract folder structure from local path or URL
    let city = "",
      year = "",
      month = ""

    if (isRemote) {
      // Extract from URL path
      const url = new URL(xmlFilePath)
      const pathParts = url.pathname.split("/").filter((part) => part.length > 0)
      const yearIndex = pathParts.findIndex((part) => /^\d{4}$/.test(part))
      if (yearIndex !== -1) {
        year = pathParts[yearIndex]
        if (yearIndex > 0) city = pathParts[yearIndex - 1]
        if (yearIndex + 1 < pathParts.length && /^\d{2}$/.test(pathParts[yearIndex + 1])) {
          month = pathParts[yearIndex + 1]
        }
      }
    } else {
      // Extract from local path
      const pathParts = xmlFilePath.split(path.sep)
      const yearIndex = pathParts.findIndex((part) => /^\d{4}$/.test(part))
      if (yearIndex !== -1) {
        year = pathParts[yearIndex]
        if (yearIndex > 0) city = pathParts[yearIndex - 1]
        if (yearIndex + 1 < pathParts.length && /^\d{2}$/.test(pathParts[yearIndex + 1])) {
          month = pathParts[yearIndex + 1]
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

    // Extract image information from ContentItem with HIGHRES MediaType
    if (mainComponent.ContentItem) {
      const contentItems = Array.isArray(mainComponent.ContentItem)
        ? mainComponent.ContentItem
        : [mainComponent.ContentItem]

      for (const item of contentItems) {
        if (item.MediaType && item.MediaType.FormalName === "HIGHRES") {
          imageHref = item.Href || ""

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
          break // Found HIGHRES, stop looking
        }
      }
    }

    // Enhanced image finding - tries multiple locations
    let imagePath = ""
    let imageExists = false
    let actualFileSize = 0
    let imageInfo = null

    if (imageHref) {
      imageInfo = await findImagePath(xmlFilePath, imageHref, verbose, workerId, associatedImagePath, isRemote, tempDir)
      imageExists = imageInfo.exists
      actualFileSize = imageInfo.size
      imagePath = imageInfo.path

      if (verbose) {
        console.log(`[Worker ${workerId}] Image search result:`)
        console.log(`  - Exists: ${imageExists}`)
        console.log(`  - Size: ${actualFileSize} bytes`)
        console.log(`  - Path: ${imagePath}`)
        if (imageInfo.foundAt) {
          console.log(`  - Found at: ${imageInfo.foundAt}`)
        }
        if (imageInfo.remoteUrl) {
          console.log(`  - Remote URL: ${imageInfo.remoteUrl}`)
        }
        if (imageInfo.downloadFailed) {
          console.log(`  - Download failed: ${imageInfo.downloadFailed}`)
        }
        if (imageInfo.isRemoteDownloaded) {
          console.log(`  - Remote image downloaded to temp: ${imageInfo.isRemoteDownloaded}`)
        }
      }
    }

    logWorkerState("building_record")
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
      imagePath: imagePath,
      imageExists: imageExists ? "Yes" : "No",
      creationDate,
      revisionDate,
      commentData,
    }

    const passed = passesFilter(record, filterConfig)
    let moved = false

    // Determine if we should move the image - UPDATED for remote images
    const shouldMoveImage =
      filterConfig?.moveImages &&
      filterConfig?.moveDestinationPath &&
      imageExists &&
      imageHref &&
      imagePath &&
      !imageInfo?.downloadFailed &&
      // For remote images, we can move if they were downloaded
      (imageInfo?.isRemoteDownloaded || !isRemote) &&
      // Move if filters are disabled (move all images)
      (!filterConfig?.enabled ||
        // Or move if filters are enabled and image passed
        (filterConfig?.enabled && passed))

    if (verbose) {
      console.log(`[Worker ${workerId}] Image move decision:`)
      console.log(`  - Move images enabled: ${filterConfig?.moveImages}`)
      console.log(`  - Destination path set: ${!!filterConfig?.moveDestinationPath}`)
      console.log(`  - Image exists: ${imageExists}`)
      console.log(`  - Is remote: ${isRemote}`)
      console.log(`  - Remote downloaded: ${imageInfo?.isRemoteDownloaded || false}`)
      console.log(`  - Download failed: ${imageInfo?.downloadFailed || false}`)
      console.log(`  - Filters enabled: ${filterConfig?.enabled}`)
      console.log(`  - Passed filters: ${passed}`)
      console.log(`  - Should move: ${shouldMoveImage}`)
    }

    if (shouldMoveImage) {
      try {
        if (verbose) {
          console.log(`[Worker ${workerId}] Attempting to move image: ${imagePath}`)
          console.log(`[Worker ${workerId}] Move config:`)
          console.log(`  - Destination: ${filterConfig.moveDestinationPath}`)
          console.log(`  - Folder structure: ${filterConfig.moveFolderStructureOption}`)
        }

        moved = await moveImage(
          imagePath,
          filterConfig.moveDestinationPath,
          filterConfig.moveFolderStructureOption || "replicate",
          originalRootDir,
          verbose,
          workerId,
          imageHref,
          xmlFilePath,
          imageInfo?.isRemoteDownloaded || false,
        )

        if (verbose) {
          console.log(`[Worker ${workerId}] Image move result: ${moved ? "SUCCESS" : "FAILED"}`)
        }
      } catch (error) {
        logWorkerError(error, "moveImageAttempt")
        if (verbose) {
          console.error(`[Worker ${workerId}] Error during image move:`, error.message)
        }
      }
    }

    // ALWAYS return the record - let the main process decide what to do with it
    const fileName = isRemote ? new URL(xmlFilePath).pathname.split("/").pop() : path.basename(xmlFilePath)

    if (verbose) {
      console.log(
        `[Worker ${workerId}] File ${fileName} processed successfully. Passed filter: ${passed}, Image moved: ${moved}, Record returned: true`,
      )
    }

    logWorkerState("processing_complete", "success")
    workerState.status = "completed"

    return {
      record: record, // Always return the record
      passedFilter: passed,
      imageMoved: moved,
      workerId,
    }
  } catch (err) {
    logWorkerError(err, "processXmlFileInWorker")
    const fileName = isRemote ? new URL(xmlFilePath).pathname.split("/").pop() : path.basename(xmlFilePath)
    console.error(`[Worker ${workerId}] Error processing ${fileName}:`, err.message)
    if (verbose) {
      console.error(`[Worker ${workerId}] Stack trace:`, err.stack)
    }

    workerState.status = "error"
    return { record: null, passedFilter: false, imageMoved: false, error: err.message, workerId }
  } finally {
    // Cleanup temp directory
    if (tempDir) {
      await cleanupTempDir(tempDir)
      if (verbose) {
        console.log(`[Worker ${workerId}] Cleaned up temp directory: ${tempDir}`)
      }
    }
  }
}

// Safe message sending function
function sendResult(result) {
  try {
    logWorkerState("sending_result")
    if (parentPort) {
      parentPort.postMessage(result)
      logWorkerState("result_sent", "success")
    } else {
      console.error(`[Worker ${workerState.id}] No parentPort available to send result`)
      logWorkerState("result_sent", "no_parent_port")
    }
  } catch (error) {
    logWorkerError(error, "sendResult")
    console.error(`[Worker ${workerState.id}] Error sending result:`, error.message)
  }
}

// Clean exit function
function cleanExit(code = 0) {
  logWorkerState("clean_exit", `code ${code}`)

  // Give a small delay to ensure all logs are flushed
  setTimeout(() => {
    process.exit(code)
  }, 50)
}

// Main worker execution with comprehensive error handling
async function main() {
  try {
    logWorkerState("main_start")
    workerState.status = "running"

    if (!workerData) {
      throw new Error("No workerData provided")
    }

    const {
      xmlFilePath,
      filterConfig,
      originalRootDir,
      workerId,
      verbose,
      isRemote,
      originalRemoteXmlUrl,
      associatedImagePath,
    } = workerData

    // Update worker state
    workerState.id = workerId || "unknown"

    if (verbose) {
      const fileName = isRemote ? new URL(xmlFilePath).pathname.split("/").pop() : path.basename(xmlFilePath)
      console.log(`[Worker ${workerId}] Starting to process: ${fileName}`)
      console.log(`[Worker ${workerId}] Filter config received:`, JSON.stringify(filterConfig, null, 2))
      if (filterConfig?.enabled) {
        console.log(`[Worker ${workerId}] ✓ Filters are ENABLED`)
      } else {
        console.log(`[Worker ${workerId}] Filters are disabled`)
      }
      if (filterConfig?.moveImages) {
        console.log(`[Worker ${workerId}] Image moving enabled to: ${filterConfig.moveDestinationPath}`)
      }
      if (isRemote) {
        console.log(`[Worker ${workerId}] Remote processing mode: ${isRemote}`)
      }
    }

    logWorkerState("calling_process_function")
    const result = await processXmlFileInWorker(
      xmlFilePath,
      filterConfig,
      originalRootDir,
      workerId,
      verbose,
      isRemote,
      originalRemoteXmlUrl,
      associatedImagePath,
    )

    if (verbose) {
      const fileName = isRemote ? new URL(xmlFilePath).pathname.split("/").pop() : path.basename(xmlFilePath)
      console.log(`[Worker ${workerId}] Finished processing: ${fileName}`)
    }

    logWorkerState("sending_final_result")
    sendResult(result)

    logWorkerState("main_complete", "success")
    workerState.status = "completed"

    // Clean exit after successful completion
    cleanExit(0)
  } catch (error) {
    logWorkerError(error, "main")
    console.error(`[Worker ${workerState.id}] Fatal error in main:`, error.message)

    workerState.status = "fatal_error"

    const errorResult = {
      record: null,
      passedFilter: false,
      imageMoved: false,
      error: error.message,
      workerId: workerData?.workerId || 0,
      workerState: workerState,
    }

    sendResult(errorResult)

    // Clean exit after error
    cleanExit(1)
  }
}

// Handle uncaught exceptions gracefully
process.on("uncaughtException", (error) => {
  logWorkerError(error, "uncaughtException")
  console.error(`[Worker ${workerState.id}] Uncaught Exception:`, error.message)

  workerState.status = "uncaught_exception"

  const errorResult = {
    record: null,
    passedFilter: false,
    imageMoved: false,
    error: `Uncaught Exception: ${error.message}`,
    workerId: workerData?.workerId || 0,
    workerState: workerState,
  }

  sendResult(errorResult)
  cleanExit(1)
})

// Handle unhandled promise rejections gracefully
process.on("unhandledRejection", (reason, promise) => {
  const errorMsg = String(reason)
  logWorkerError(new Error(errorMsg), "unhandledRejection")
  console.error(`[Worker ${workerState.id}] Unhandled Rejection:`, errorMsg)

  workerState.status = "unhandled_rejection"

  const errorResult = {
    record: null,
    passedFilter: false,
    imageMoved: false,
    error: `Unhandled Rejection: ${errorMsg}`,
    workerId: workerData?.workerId || 0,
    workerState: workerState,
  }

  sendResult(errorResult)
  cleanExit(1)
})

// Handle SIGTERM gracefully
process.on("SIGTERM", () => {
  console.log(`[Worker ${workerState.id}] Received SIGTERM, shutting down gracefully`)
  workerState.status = "terminated"
  cleanExit(0)
})

// Handle SIGINT gracefully
process.on("SIGINT", () => {
  console.log(`[Worker ${workerState.id}] Received SIGINT, shutting down gracefully`)
  workerState.status = "interrupted"
  cleanExit(0)
})

// Execute main function
logWorkerState("worker_startup")
main().catch((error) => {
  logWorkerError(error, "main_catch")
  console.error(`[Worker ${workerState.id}] Main function failed:`, error.message)

  workerState.status = "main_failed"

  const errorResult = {
    record: null,
    passedFilter: false,
    imageMoved: false,
    error: `Main function failed: ${error.message}`,
    workerId: workerData?.workerId || 0,
    workerState: workerState,
  }

  sendResult(errorResult)
  cleanExit(1)
})
