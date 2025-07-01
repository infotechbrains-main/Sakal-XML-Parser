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

// Helper function to check if file is an image
function isImageFile(fileName) {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".svg"]
  const ext = path.extname(fileName).toLowerCase()
  return imageExtensions.includes(ext)
}

// Simplified image path construction - just look in media folder
function constructImagePath(xmlFilePath, imageHref, verbose, workerId) {
  if (!imageHref) return ""

  // Get the directory containing the XML file
  const xmlDir = path.dirname(xmlFilePath)

  // Look for media folder at the same level as the processed folder
  const parentDir = path.dirname(xmlDir)
  const mediaDir = path.join(parentDir, "media")
  const imagePath = path.join(mediaDir, imageHref)

  if (verbose) {
    console.log(`[Worker ${workerId}] Constructing image path:`)
    console.log(`  - XML file: ${xmlFilePath}`)
    console.log(`  - XML directory: ${xmlDir}`)
    console.log(`  - Parent directory: ${parentDir}`)
    console.log(`  - Media directory: ${mediaDir}`)
    console.log(`  - Image filename: ${imageHref}`)
    console.log(`  - Full image path: ${imagePath}`)
  }

  return imagePath
}

// Simple image checker - just check if the file exists
async function checkImageExists(imagePath, verbose, workerId) {
  try {
    if (verbose) {
      console.log(`[Worker ${workerId}] Checking if image exists: ${imagePath}`)
    }

    await fs.access(imagePath)
    const stats = await fs.stat(imagePath)

    if (verbose) {
      console.log(`[Worker ${workerId}] Image found: ${imagePath}, size: ${stats.size} bytes`)
    }

    return {
      exists: true,
      size: stats.size,
      path: imagePath,
      fileName: path.basename(imagePath),
    }
  } catch (error) {
    if (verbose) {
      console.log(`[Worker ${workerId}] Image not found: ${imagePath}`)
    }
    return {
      exists: false,
      size: 0,
      path: imagePath,
      fileName: path.basename(imagePath),
    }
  }
}

// Check if image passes filter criteria
function passesFilter(record, filterConfig) {
  if (!filterConfig?.enabled) {
    if (workerData.verbose) {
      console.log(`[Worker ${workerData.workerId}] Filters disabled - image ${record.imageHref} passes by default`)
    }
    return true
  }

  if (workerData.verbose) {
    console.log(`[Worker ${workerData.workerId}] Checking filters for image: ${record.imageHref}`)
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

  // File type filter
  if (filterConfig.allowedFileTypes && filterConfig.allowedFileTypes.length > 0) {
    const imageFileName = record.imageHref || ""
    if (imageFileName) {
      const fileExtension = imageFileName.split(".").pop()?.toLowerCase() || ""
      const isAllowedType = filterConfig.allowedFileTypes.some(
        (allowedType) => allowedType.toLowerCase() === fileExtension,
      )

      if (!isAllowedType) {
        if (workerData.verbose) {
          console.log(
            `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: file type .${fileExtension} not allowed`,
          )
        }
        return false
      }
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
  let fileSizeBytes = record.actualFileSize || 0
  if (!fileSizeBytes && record.imageSize) {
    const cleanSize = String(record.imageSize).replace(/,/g, "")
    fileSizeBytes = Number.parseInt(cleanSize) || 0
  }

  if (filterConfig.minFileSize && fileSizeBytes < filterConfig.minFileSize) {
    if (workerData.verbose) {
      console.log(
        `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: file size ${fileSizeBytes} < ${filterConfig.minFileSize}`,
      )
    }
    return false
  }

  if (filterConfig.maxFileSize && fileSizeBytes > filterConfig.maxFileSize) {
    if (workerData.verbose) {
      console.log(
        `[Worker ${workerData.workerId}] Image ${record.imageHref} filtered out: file size ${fileSizeBytes} > ${filterConfig.maxFileSize}`,
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
    console.log(`[Worker ${workerData.workerId}] Image ${record.imageHref} passed all filters`)
  }
  return true
}

// Move image to destination folder
async function moveImage(
  sourceImagePath,
  destinationBasePath,
  folderStructureOption,
  originalRootDir,
  verbose,
  workerId,
  imageFileName,
  xmlFilePath,
) {
  try {
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
    }

    // Verify source image exists
    try {
      await fs.access(sourceImagePath)
      if (verbose) {
        console.log(`[Worker ${workerId}] Verified source image exists: ${sourceImagePath}`)
      }
    } catch (error) {
      if (verbose) {
        console.log(`[Worker ${workerId}] Source image does not exist: ${sourceImagePath}`)
      }
      return false
    }

    // Determine destination path
    let finalDestDir
    let finalDestPath

    if (folderStructureOption === "replicate") {
      // Replicate the folder structure from the original root
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
          console.log(`[Worker ${workerId}] Replicating structure:`)
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
      console.log(`[Worker ${workerId}] Created destination directory: ${finalDestDir}`)
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
      console.log(`[Worker ${workerId}] Successfully moved image: ${sourceImagePath} -> ${finalDestPath}`)
    }

    return true
  } catch (error) {
    if (verbose) {
      console.error(`[Worker ${workerId}] Error moving image ${sourceImagePath}:`, error.message)
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
) {
  try {
    if (verbose) {
      console.log(`[Worker ${workerId}] Processing: ${xmlFilePath}`)
    }

    const xmlContent = await fs.readFile(xmlFilePath, "utf-8")
    const result = await parseStringPromise(xmlContent, {
      explicitArray: false,
      mergeAttrs: true,
    })

    // Extract folder structure from local path
    let city = "",
      year = "",
      month = ""
    const pathParts = xmlFilePath.split(path.sep)
    const yearIndex = pathParts.findIndex((part) => /^\d{4}$/.test(part))
    if (yearIndex !== -1) {
      year = pathParts[yearIndex]
      if (yearIndex > 0) city = pathParts[yearIndex - 1]
      if (yearIndex + 1 < pathParts.length && /^\d{2}$/.test(pathParts[yearIndex + 1])) {
        month = pathParts[yearIndex + 1]
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

    // Simple image handling - just construct path and check if exists
    let imagePath = ""
    let imageExists = false
    let actualFileSize = 0

    if (imageHref) {
      imagePath = constructImagePath(xmlFilePath, imageHref, verbose, workerId)

      if (verbose) {
        console.log(`[Worker ${workerId}] Constructed image path: ${imagePath}`)
      }

      if (imagePath) {
        const imageInfo = await checkImageExists(imagePath, verbose, workerId)
        imageExists = imageInfo.exists
        actualFileSize = imageInfo.size

        if (verbose) {
          console.log(`[Worker ${workerId}] Image check result:`)
          console.log(`  - Exists: ${imageExists}`)
          console.log(`  - Size: ${actualFileSize} bytes`)
          console.log(`  - Path: ${imagePath}`)
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
      imagePath: imagePath,
      imageExists: imageExists ? "Yes" : "No",
      creationDate,
      revisionDate,
      commentData,
    }

    const passed = passesFilter(record, filterConfig)
    let moved = false

    if (filterConfig?.enabled && !passed) {
      if (verbose) {
        console.log(`[Worker ${workerId}] File ${path.basename(xmlFilePath)} did not pass filters`)
      }
      return { record: null, passedFilter: false, imageMoved: false, workerId }
    }

    // Image moving - only if filters are enabled, image passed filters, and move is configured
    if (
      filterConfig?.enabled &&
      passed &&
      filterConfig?.moveImages &&
      filterConfig?.moveDestinationPath &&
      imageExists &&
      imageHref &&
      imagePath
    ) {
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
      console.log(`  - Image href: ${imageHref}`)
      console.log(`  - Image path: ${imagePath}`)
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
      if (filterConfig?.enabled) {
        console.log(`[Worker ${workerId}] Filters enabled`)
        if (filterConfig.moveImages) {
          console.log(`[Worker ${workerId}] Image moving enabled to: ${filterConfig.moveDestinationPath}`)
        }
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
