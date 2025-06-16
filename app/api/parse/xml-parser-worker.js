const { parentPort, workerData } = require("worker_threads")
const fs = require("fs/promises")
const path = require("path")
const { parseStringPromise } = require("xml2js")

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

// Check if local image exists and get its size
async function checkLocalImage(imagePath, verbose, workerId) {
  try {
    await fs.access(imagePath)
    const stats = await fs.stat(imagePath)

    if (verbose) {
      console.log(`[Worker ${workerId}] Local image found: ${imagePath}, size: ${stats.size} bytes`)
    }

    return {
      exists: true,
      size: stats.size,
      path: imagePath,
    }
  } catch (error) {
    if (verbose) {
      console.log(`[Worker ${workerId}] Local image not found: ${imagePath}`)
    }
    return {
      exists: false,
      size: 0,
      path: imagePath,
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
      }
    } else {
      if (verbose) {
        console.log(`[Worker ${workerId}] Remote image not found: ${imageUrl} (${response.status})`)
      }
      return {
        exists: false,
        size: 0,
        path: imageUrl,
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

// Check if image passes filter criteria
function passesFilter(record, filterConfig) {
  if (!filterConfig?.enabled) return true

  const applyTextFilter = (fieldValue, filter) => {
    if (!filter || !filter.operator) return true

    const val = String(fieldValue || "")
      .toLowerCase()
      .trim()
    const filterVal = String(filter.value || "")
      .toLowerCase()
      .trim()

    switch (filter.operator) {
      case "like":
        return val.includes(filterVal)
      case "notLike":
        return !val.includes(filterVal)
      case "equals":
        return val === filterVal
      case "notEquals":
        return val !== filterVal
      case "startsWith":
        return val.startsWith(filterVal)
      case "endsWith":
        return val.endsWith(filterVal)
      case "notBlank":
        return val !== ""
      case "isBlank":
        return val === ""
      default:
        return true
    }
  }

  // Image dimension filters
  const imageWidth = Number.parseInt(record.imageWidth) || 0
  const imageHeight = Number.parseInt(record.imageHeight) || 0
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

  // File size filters
  const fileSizeBytes = record.actualFileSize || Number.parseInt(record.imageSize) || 0
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

  // Text filters
  if (!applyTextFilter(record.creditline, filterConfig.creditLine)) {
    if (workerData.verbose) {
      console.log(
        `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: creditLine filter failed. Value: "${record.creditline}", Filter: ${JSON.stringify(filterConfig.creditLine)}`,
      )
    }
    return false
  }
  if (!applyTextFilter(record.copyrightLine, filterConfig.copyright)) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: copyright filter failed`)
    }
    return false
  }
  if (!applyTextFilter(record.usageType, filterConfig.usageType)) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: usageType filter failed`)
    }
    return false
  }
  if (!applyTextFilter(record.rightsHolder, filterConfig.rightsHolder)) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: rightsHolder filter failed`)
    }
    return false
  }
  if (!applyTextFilter(record.location, filterConfig.location)) {
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
) {
  try {
    if (!imagePath || !userDefinedDestAbsPath) {
      if (verbose) console.log(`[Worker ${workerId}] Missing paths for move operation.`)
      return false
    }

    let localImagePath = ""
    const fileName = imageFileName || path.basename(imagePath)

    // Handle remote images - download first
    if (isRemotePath(imagePath)) {
      if (verbose) {
        console.log(`[Worker ${workerId}] Preparing to move remote image: ${imagePath}`)
      }

      // Create temp directory for remote image download
      const tempImageDir = path.join(originalRootDirForScan, "temp_images")
      await fs.mkdir(tempImageDir, { recursive: true })

      // Download the remote image
      localImagePath = await downloadRemoteImage(imagePath, tempImageDir, verbose, workerId)

      if (verbose) {
        console.log(`[Worker ${workerId}] Downloaded remote image for moving: ${localImagePath}`)
      }
    } else {
      // Handle local images - use directly
      if (verbose) {
        console.log(`[Worker ${workerId}] Preparing to move local image: ${imagePath}`)
      }

      // Check if local image exists
      try {
        await fs.access(imagePath)
        localImagePath = imagePath
      } catch (error) {
        if (verbose) console.log(`[Worker ${workerId}] Local image file does not exist: ${imagePath}`)
        return false
      }
    }

    // Determine destination path
    let finalDestPath
    let finalDestDir

    if (folderStructureOption === "replicate") {
      // For folder structure replication
      let relativePathFromRoot = ""

      if (isRemotePath(imagePath)) {
        // For remote files, extract relative path from URL
        const imageUrl = new URL(imagePath)
        const rootUrl = new URL(originalRootDirForScan)
        relativePathFromRoot = path.dirname(imageUrl.pathname.replace(rootUrl.pathname, ""))
      } else {
        // For local files, use standard path relative calculation
        relativePathFromRoot = path.relative(originalRootDirForScan, path.dirname(imagePath))
      }

      finalDestDir = path.join(userDefinedDestAbsPath, relativePathFromRoot)
      finalDestPath = path.join(finalDestDir, fileName)
    } else {
      // Flat structure - all images in one folder
      finalDestDir = userDefinedDestAbsPath
      finalDestPath = path.join(finalDestDir, fileName)
    }

    // Create destination directory
    await fs.mkdir(finalDestDir, { recursive: true })

    // Copy the image to destination
    await fs.copyFile(localImagePath, finalDestPath)

    if (verbose) {
      console.log(`[Worker ${workerId}] Successfully moved image: ${imagePath} -> ${finalDestPath}`)
    }

    // Clean up temporary file if it was a remote download
    if (isRemotePath(imagePath) && localImagePath !== imagePath) {
      try {
        await fs.unlink(localImagePath)
        if (verbose) {
          console.log(`[Worker ${workerId}] Cleaned up temporary file: ${localImagePath}`)
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
    }
    return false
  }
}

// Construct image path based on XML path (works for both local and remote)
function constructImagePath(xmlFilePath, imageHref, isRemote) {
  if (!imageHref) return ""

  if (isRemote) {
    // For remote files: convert processed path to media path
    // XML: http://172.16.0.104/photoapp/charitra/2006/06/processed/file.xml
    // IMG: http://172.16.0.104/photoapp/charitra/2006/06/media/image.jpg
    try {
      const xmlUrl = new URL(xmlFilePath.replace(/\\/g, "/"))
      const basePath = xmlUrl.pathname.replace("/processed/", "/media/")
      return `${xmlUrl.protocol}//${xmlUrl.host}${basePath}/${imageHref}`
    } catch (error) {
      console.error("Error constructing remote image path:", error)
      return ""
    }
  } else {
    // For local files: use existing logic
    const expectedImageDir = path.join(path.dirname(path.dirname(xmlFilePath)), "media")
    return path.join(expectedImageDir, imageHref)
  }
}

// Process a single XML file
async function processXmlFileInWorker(xmlFilePath, filterConfig, originalRootDir, workerId, verbose, isRemote) {
  try {
    if (verbose) {
      console.log(`[Worker ${workerId}] Processing: ${xmlFilePath}`)
      console.log(`[Worker ${workerId}] Mode: ${isRemote ? "Remote" : "Local"}`)
    }

    const xmlContent = await fs.readFile(xmlFilePath, "utf-8")
    const result = await parseStringPromise(xmlContent, {
      explicitArray: false,
      mergeAttrs: true,
    })

    const pathParts = xmlFilePath.split(path.sep)
    let city = "",
      year = "",
      month = ""

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

    if (imageHref) {
      // Construct image path (local or remote)
      imagePath = constructImagePath(xmlFilePath, imageHref, isRemote)

      if (verbose) {
        console.log(`[Worker ${workerId}] Constructed image path: ${imagePath}`)
      }

      // Check image existence and get size (universal method)
      const imageInfo = await checkImageUniversal(imagePath, verbose, workerId)
      imageExists = imageInfo.exists
      actualFileSize = imageInfo.size
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
      imagePath: imagePath,
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
      console.log(`  - Image path: ${imagePath}`)
      console.log(`  - Path type: ${isRemotePath(imagePath) ? "Remote" : "Local"}`)
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
      imagePath
    ) {
      try {
        moved = await moveImageUniversal(
          imagePath,
          filterConfig.moveDestinationPath,
          filterConfig.moveFolderStructureOption,
          originalRootDir,
          verbose,
          workerId,
          imageHref,
        )

        if (verbose) {
          console.log(`[Worker ${workerId}] Image move result: ${moved ? "SUCCESS" : "FAILED"}`)
        }
      } catch (error) {
        if (verbose) {
          console.error(`[Worker ${workerId}] Error during image move:`, error.message)
        }
      }
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

    const { xmlFilePath, filterConfig, originalRootDir, workerId, verbose, isRemote } = workerData

    if (verbose) {
      console.log(`[Worker ${workerId}] Starting to process: ${path.basename(xmlFilePath)}`)
      console.log(`[Worker ${workerId}] Processing mode: ${isRemote ? "Remote" : "Local"}`)
      if (filterConfig?.enabled) {
        console.log(`[Worker ${workerId}] Filter config:`, JSON.stringify(filterConfig, null, 2))
      }
    }

    const result = await processXmlFileInWorker(xmlFilePath, filterConfig, originalRootDir, workerId, verbose, isRemote)

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
