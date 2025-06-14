const { parentPort, workerData } = require("worker_threads")
const fs = require("fs/promises")
const path = require("path")
const { parseStringPromise } = require("xml2js")

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

// Check if image passes filter criteria - FIXED FILE SIZE LOGIC
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

  // FIXED: File size filters - convert bytes to the correct unit and add detailed logging
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

// Move image file to filtered folder
async function moveImageToFilteredFolder(
  originalImageAbsPath,
  userDefinedDestAbsPath,
  folderStructureOption,
  originalRootDirForScan,
  verbose,
  workerId,
) {
  try {
    if (!originalImageAbsPath || !userDefinedDestAbsPath) {
      if (verbose) console.log(`[Worker ${workerId}] Missing paths for move operation.`)
      return false
    }
    await fs.access(originalImageAbsPath)

    const fileName = path.basename(originalImageAbsPath)
    let finalDestPath
    let finalDestDir

    if (folderStructureOption === "replicate") {
      const relativePathFromRoot = path.relative(originalRootDirForScan, path.dirname(originalImageAbsPath))
      finalDestDir = path.join(userDefinedDestAbsPath, relativePathFromRoot)
      finalDestPath = path.join(finalDestDir, fileName)
    } else {
      finalDestDir = userDefinedDestAbsPath
      finalDestPath = path.join(finalDestDir, fileName)
    }

    await fs.mkdir(finalDestDir, { recursive: true })
    await fs.copyFile(originalImageAbsPath, finalDestPath)
    if (verbose) console.log(`[Worker ${workerId}] Moved image: ${originalImageAbsPath} -> ${finalDestPath}`)
    return true
  } catch (error) {
    if (verbose) console.error(`[Worker ${workerId}] Error moving image ${originalImageAbsPath}:`, error.message)
    return false
  }
}

// Process a single XML file
async function processXmlFileInWorker(xmlFilePath, filterConfig, originalRootDir, workerId, verbose) {
  try {
    if (verbose) console.log(`[Worker ${workerId}] Processing: ${xmlFilePath}`)

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

    const expectedImageDir = path.join(path.dirname(path.dirname(xmlFilePath)), "media")
    const imagePath = imageHref ? path.join(expectedImageDir, imageHref) : ""
    let imageExists = false
    if (imagePath) {
      try {
        await fs.access(imagePath)
        imageExists = true
      } catch {
        /* Image doesn't exist */
      }
    }

    let actualFileSize = 0
    if (imageExists && imagePath) {
      try {
        const stats = await fs.stat(imagePath)
        actualFileSize = stats.size
        if (verbose) {
          console.log(
            `[Worker ${workerId}] Actual file size from filesystem: ${actualFileSize} bytes (${Math.round((actualFileSize / 1024 / 1024) * 100) / 100}MB)`,
          )
          if (imageSize && Number.parseInt(imageSize) !== actualFileSize) {
            console.log(
              `[Worker ${workerId}] WARNING: XML size (${imageSize}) differs from actual file size (${actualFileSize})`,
            )
          }
        }
      } catch (err) {
        if (verbose) {
          console.log(`[Worker ${workerId}] Could not get actual file size: ${err.message}`)
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
      imagePath,
      imageExists: imageExists ? "Yes" : "No",
      creationDate,
      revisionDate,
      commentData,
    }

    if (verbose) {
      console.log(`[Worker ${workerId}] Extracted image metadata for ${path.basename(xmlFilePath)}:`)
      console.log(`  - Image file: ${imageHref}`)
      console.log(`  - Raw size from XML: "${imageSize}"`)
      console.log(`  - Dimensions: ${imageWidth}x${imageHeight}`)
      console.log(`  - Image exists: ${imageExists}`)
      if (imageSize) {
        const sizeBytes = Number.parseInt(imageSize) || 0
        console.log(`  - Size in bytes: ${sizeBytes}`)
        console.log(`  - Size in MB: ${Math.round((sizeBytes / 1024 / 1024) * 100) / 100}MB`)
      }
    }

    const passed = passesFilter(record, filterConfig)
    let moved = false

    if (filterConfig?.enabled && !passed) {
      if (verbose) {
        console.log(`[Worker ${workerId}] File ${path.basename(xmlFilePath)} did not pass filters`)
      }
      return { record: null, passedFilter: false, imageMoved: false, workerId }
    }

    if (
      filterConfig?.enabled &&
      passed &&
      filterConfig?.moveImages &&
      filterConfig?.moveDestinationPath &&
      filterConfig?.moveFolderStructureOption &&
      imageExists &&
      imagePath
    ) {
      moved = await moveImageToFilteredFolder(
        imagePath,
        filterConfig.moveDestinationPath,
        filterConfig.moveFolderStructureOption,
        originalRootDir,
        verbose,
        workerId,
      )
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

    const { xmlFilePath, filterConfig, originalRootDir, workerId, verbose } = workerData

    if (verbose) {
      console.log(`[Worker ${workerId}] Starting to process: ${path.basename(xmlFilePath)}`)
      if (filterConfig?.enabled) {
        console.log(`[Worker ${workerId}] Filter config:`, JSON.stringify(filterConfig, null, 2))
      }
    }

    const result = await processXmlFileInWorker(xmlFilePath, filterConfig, originalRootDir, workerId, verbose)

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
