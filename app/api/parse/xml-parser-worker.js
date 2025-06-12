const { parentPort } = require("worker_threads")
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
  if (typeof element === "string") return element.trim()
  if (element && typeof element === "object" && element._) return String(element._).trim()
  if (element && typeof element === "object" && element.$ && element.$.Value) return String(element.$.Value).trim()
  return ""
}

// Check if image passes filter criteria
function passesFilter(record, filterConfig) {
  if (!filterConfig?.enabled) return true

  const applyTextFilter = (fieldValue, filter) => {
    if (!filter || !filter.operator) return true

    const val = (fieldValue || "").toLowerCase()
    const filterVal = (filter.value || "").toLowerCase()

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
        return val.trim() !== ""
      case "isBlank":
        return val.trim() === ""
      default:
        return true
    }
  }

  const imageWidth = Number.parseInt(record.imageWidth) || 0
  const imageHeight = Number.parseInt(record.imageHeight) || 0
  if (filterConfig.minWidth && imageWidth < filterConfig.minWidth) return false
  if (filterConfig.minHeight && imageHeight < filterConfig.minHeight) return false

  const fileSize = Number.parseInt(record.imageSize) || 0
  if (filterConfig.minFileSize && fileSize < filterConfig.minFileSize) return false
  if (filterConfig.maxFileSize && fileSize > filterConfig.maxFileSize) return false

  if (!applyTextFilter(record.creditline, filterConfig.creditLine)) return false
  if (!applyTextFilter(record.copyrightLine, filterConfig.copyright)) return false
  if (!applyTextFilter(record.usageType, filterConfig.usageType)) return false
  if (!applyTextFilter(record.rightsHolder, filterConfig.rightsHolder)) return false
  if (!applyTextFilter(record.location, filterConfig.location)) return false

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
    await fs.access(originalImageAbsPath) // Check if source exists

    const fileName = path.basename(originalImageAbsPath)
    let finalDestPath
    let finalDestDir

    if (folderStructureOption === "replicate") {
      const relativePathFromRoot = path.relative(originalRootDirForScan, path.dirname(originalImageAbsPath))
      finalDestDir = path.join(userDefinedDestAbsPath, relativePathFromRoot)
      finalDestPath = path.join(finalDestDir, fileName)
    } else {
      // "single"
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

    // Simplified path parsing
    const yearIndex = pathParts.findIndex((part) => /^\d{4}$/.test(part))
    if (yearIndex !== -1) {
      year = pathParts[yearIndex]
      if (yearIndex > 0) city = pathParts[yearIndex - 1]
      if (yearIndex + 1 < pathParts.length && /^\d{2}$/.test(pathParts[yearIndex + 1])) {
        month = pathParts[yearIndex + 1]
      }
    }

    // Fallback logic for city/year/month
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

    if (mainComponent.UsageRights) {
      usageType = extractCData(mainComponent.UsageRights.UsageType)
      rightsHolder = extractCData(mainComponent.UsageRights.RightsHolder)
      if (!copyrightLine && mainComponent.UsageRights.Property) {
        const usageProps = Array.isArray(mainComponent.UsageRights.Property)
          ? mainComponent.UsageRights.Property
          : [mainComponent.UsageRights.Property]
        for (const prop of usageProps) {
          if (prop.FormalName === "CopyrightNotice" || prop.FormalName === "Copyright") {
            copyrightLine = prop.Value || ""
            break
          }
        }
      }
    }

    if (mainComponent.ContentItem) {
      const contentItems = Array.isArray(mainComponent.ContentItem)
        ? mainComponent.ContentItem
        : [mainComponent.ContentItem]
      for (const item of contentItems) {
        if (item.MediaType && item.MediaType.FormalName === "Picture") {
          if (item.DataContent && item.DataContent.Characteristics) {
            imageSize = item.DataContent.Characteristics.SizeInBytes || ""
            if (item.DataContent.Characteristics.Property) {
              const props = Array.isArray(item.DataContent.Characteristics.Property)
                ? item.DataContent.Characteristics.Property
                : [item.DataContent.Characteristics.Property]
              for (const prop of props) {
                if (prop.FormalName === "width") imageWidth = prop.Value || ""
                if (prop.FormalName === "height") imageHeight = prop.Value || ""
              }
            }
          } else if (item.Characteristics) {
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
          imageHref = item.Href || (item.DataContent ? item.DataContent.Href : "") || ""
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
      imageHref,
      xmlPath: xmlFilePath,
      imagePath,
      imageExists: imageExists ? "Yes" : "No",
      creationDate,
      revisionDate,
      commentData,
    }

    const passed = passesFilter(record, filterConfig)
    let moved = false

    if (filterConfig?.enabled && !passed) {
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

    return { record: passed ? record : null, passedFilter: passed, imageMoved: moved, workerId }
  } catch (err) {
    if (verbose) console.error(`[Worker ${workerId}] Error processing ${xmlFilePath}:`, err.message)
    return { record: null, passedFilter: false, imageMoved: false, error: err.message, workerId }
  }
}

if (parentPort) {
  parentPort.on("message", async (task) => {
    const { xmlFilePath, filterConfig, originalRootDir, workerId, verbose } = task
    const result = await processXmlFileInWorker(xmlFilePath, filterConfig, originalRootDir, workerId, verbose)
    parentPort.postMessage(result)
  })
} else {
  console.log("Worker started without parentPort. This script is intended to be run as a worker thread.")
}
