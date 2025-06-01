import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"
import { parseStringPromise } from "xml2js"
import { createObjectCsvWriter } from "csv-writer"

// CSV header definition
const CSV_HEADERS = [
  { id: "city", title: "City" },
  { id: "year", title: "Year" },
  { id: "month", title: "Month" },
  { id: "newsItemId", title: "News Item ID" },
  { id: "dateId", title: "Date ID" },
  { id: "providerId", title: "Provider ID" },
  { id: "headline", title: "Headline" },
  { id: "byline", title: "Byline" },
  { id: "dateline", title: "Date Line" },
  { id: "creditline", title: "Credit Line" },
  { id: "slugline", title: "Slug Line" },
  { id: "keywords", title: "Keywords" },
  { id: "edition", title: "Edition" },
  { id: "location", title: "Location" },
  { id: "country", title: "Country" },
  { id: "city_meta", title: "City (Metadata)" },
  { id: "pageNumber", title: "Page Number" },
  { id: "status", title: "Status" },
  { id: "urgency", title: "Urgency" },
  { id: "language", title: "Language" },
  { id: "subject", title: "Subject" },
  { id: "processed", title: "Processed" },
  { id: "published", title: "Published" },
  { id: "imageWidth", title: "Image Width" },
  { id: "imageHeight", title: "Image Height" },
  { id: "imageSize", title: "Image Size (bytes)" },
  { id: "imageHref", title: "Image Href" },
  { id: "xmlPath", title: "XML Path" },
  { id: "imagePath", title: "Image Path" },
  { id: "imageExists", title: "Image Exists" },
  { id: "creationDate", title: "Creation Date" },
  { id: "revisionDate", title: "Revision Date" },
  { id: "commentData", title: "Comment Data" },
]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { rootDir, outputFile = "image_metadata.csv", batchSize = 100, verbose = false, filterConfig = null } = body

    console.log("Received request:", { rootDir, outputFile, batchSize, verbose, filterConfig })

    if (!rootDir) {
      return NextResponse.json({ error: "Root directory is required" }, { status: 400 })
    }

    // Create output file path in the project root
    const outputPath = path.join(process.cwd(), outputFile)
    console.log("Output path:", outputPath)

    // Create filtered images folder if needed
    let filteredImagesPath = ""
    if (filterConfig?.moveImages && filterConfig?.outputFolder) {
      filteredImagesPath = path.join(rootDir, filterConfig.outputFolder)
      try {
        await fs.mkdir(filteredImagesPath, { recursive: true })
        console.log(`Created filtered images folder: ${filteredImagesPath}`)
      } catch (error) {
        console.log(`Error creating filtered folder: ${error}`)
      }
    }

    // Find XML files using manual directory traversal
    console.log("Searching for XML files...")
    const xmlFiles = await findXmlFilesManually(rootDir)
    console.log(`Found ${xmlFiles.length} XML files`)

    if (xmlFiles.length === 0) {
      try {
        const dirContents = await fs.readdir(rootDir, { recursive: true })
        const allFiles = dirContents.map((f) => f.toString())
        const xmlInDir = allFiles.filter((file) => file.toLowerCase().endsWith(".xml"))
        const sampleFiles = allFiles.slice(0, 20)

        return NextResponse.json(
          {
            error: "No XML files found",
            message: `Searched in: ${rootDir}`,
            debug: {
              totalFiles: allFiles.length,
              xmlFiles: xmlInDir.length,
              sampleFiles: sampleFiles,
              xmlFilesFound: xmlInDir.slice(0, 10),
            },
          },
          { status: 404 },
        )
      } catch (dirError) {
        return NextResponse.json(
          {
            error: "Directory read error",
            message: `Could not read directory: ${rootDir}`,
          },
          { status: 404 },
        )
      }
    }

    // Process files in batches
    const allRecords = []
    let processedCount = 0
    let successCount = 0
    let errorCount = 0
    let filteredCount = 0
    let movedCount = 0
    const errors: string[] = []

    console.log(`Starting to process ${xmlFiles.length} XML files`)
    if (filterConfig?.enabled) {
      console.log("Filtering enabled:", filterConfig)
    }

    for (let i = 0; i < xmlFiles.length; i += batchSize) {
      const batch = xmlFiles.slice(i, i + batchSize)
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} files`)

      for (const xmlFile of batch) {
        try {
          const result = await processXmlFile(xmlFile, filterConfig, filteredImagesPath)
          if (result) {
            if (result.record) {
              allRecords.push(result.record)
              successCount++

              if (result.passedFilter) {
                filteredCount++
              }

              if (result.imageMoved) {
                movedCount++
              }
            } else {
              errorCount++
              errors.push(`Failed to extract data from ${xmlFile}`)
            }
          } else {
            errorCount++
            errors.push(`Failed to process ${xmlFile}`)
          }
          processedCount++

          // Log progress every 50 files
          if (processedCount % 50 === 0) {
            console.log(`Progress: ${processedCount}/${xmlFiles.length} files processed`)
          }
        } catch (error) {
          errorCount++
          const errorMsg = `Error processing ${xmlFile}: ${error instanceof Error ? error.message : "Unknown error"}`
          errors.push(errorMsg)
          if (verbose) {
            console.error(errorMsg)
          }
        }
      }
    }

    console.log(
      `Processing complete. ${successCount} successful, ${errorCount} errors, ${filteredCount} filtered, ${movedCount} moved`,
    )

    // Write CSV file
    if (allRecords.length > 0) {
      const csvWriter = createObjectCsvWriter({
        path: outputPath,
        header: CSV_HEADERS,
      })

      await csvWriter.writeRecords(allRecords)
      console.log(`CSV file written to: ${outputPath}`)
    } else {
      console.log("No records to write to CSV")
    }

    return NextResponse.json({
      success: true,
      stats: {
        totalFiles: xmlFiles.length,
        processedFiles: processedCount,
        successfulFiles: successCount,
        errorFiles: errorCount,
        recordsWritten: allRecords.length,
        filteredFiles: filteredCount,
        movedFiles: movedCount,
      },
      outputFile: outputPath,
      errors: verbose ? errors : errors.slice(0, 10),
    })
  } catch (error) {
    console.error("Error in parse API:", error)
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// Manual directory traversal function
async function findXmlFilesManually(rootDir: string): Promise<string[]> {
  const xmlFiles: string[] = []

  async function traverse(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          await traverse(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".xml")) {
          xmlFiles.push(fullPath)
        }
      }
    } catch (error) {
      console.log(`Error traversing ${dir}:`, error)
    }
  }

  await traverse(rootDir)
  return xmlFiles
}

// Check if image passes filter criteria
function passesFilter(record: any, filterConfig: any): boolean {
  if (!filterConfig?.enabled) return true

  const imageWidth = Number.parseInt(record.imageWidth) || 0
  const imageHeight = Number.parseInt(record.imageHeight) || 0
  const fileSize = Number.parseInt(record.imageSize) || 0

  // Check image dimensions
  if (filterConfig.minWidth && imageWidth < filterConfig.minWidth) {
    return false
  }

  if (filterConfig.minHeight && imageHeight < filterConfig.minHeight) {
    return false
  }

  // Check file size
  if (filterConfig.minFileSize && fileSize < filterConfig.minFileSize) {
    return false
  }

  if (filterConfig.maxFileSize && fileSize > filterConfig.maxFileSize) {
    return false
  }

  return true
}

// Move image file to filtered folder
async function moveImageToFilteredFolder(imagePath: string, filteredImagesPath: string): Promise<boolean> {
  try {
    if (!imagePath || !filteredImagesPath) return false

    // Check if source image exists
    await fs.access(imagePath)

    // Create destination path
    const fileName = path.basename(imagePath)
    const destPath = path.join(filteredImagesPath, fileName)

    // Create subdirectories if needed
    const destDir = path.dirname(destPath)
    await fs.mkdir(destDir, { recursive: true })

    // Copy the file (we use copy instead of move to preserve original)
    await fs.copyFile(imagePath, destPath)

    console.log(`Moved image: ${imagePath} -> ${destPath}`)
    return true
  } catch (error) {
    console.log(`Error moving image ${imagePath}:`, error)
    return false
  }
}

// Process a single XML file
async function processXmlFile(xmlFilePath: string, filterConfig: any, filteredImagesPath: string): Promise<any | null> {
  try {
    console.log(`Processing: ${xmlFilePath}`)

    // Read and parse XML file
    const xmlContent = await fs.readFile(xmlFilePath, "utf-8")
    const result = await parseStringPromise(xmlContent, {
      explicitArray: false,
      mergeAttrs: true,
    })

    // Extract path components
    const pathParts = xmlFilePath.split(path.sep)

    // Find city, year, month from path
    let city = "",
      year = "",
      month = ""
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === "images" && i + 3 < pathParts.length) {
        city = pathParts[i + 1]
        year = pathParts[i + 2]
        month = pathParts[i + 3]
        break
      }
    }

    // If not found with "images", try to extract from any part of the path
    if (!city || !year || !month) {
      // Look for year pattern (4 digits)
      const yearMatch = pathParts.find((part) => /^\d{4}$/.test(part))
      if (yearMatch) {
        const yearIndex = pathParts.indexOf(yearMatch)
        if (yearIndex > 0) city = pathParts[yearIndex - 1]
        year = yearMatch
        if (yearIndex + 1 < pathParts.length) month = pathParts[yearIndex + 1]
      }
    }

    // Extract data from XML structure
    const newsML = result.NewsML
    if (!newsML) throw new Error("Invalid XML structure: NewsML not found")

    const newsItem = newsML.NewsItem
    if (!newsItem) throw new Error("Invalid XML structure: NewsItem not found")

    const newsIdentifier = newsItem.Identification?.NewsIdentifier
    if (!newsIdentifier) throw new Error("Invalid XML structure: NewsIdentifier not found")

    const newsItemId = newsIdentifier.NewsItemId || ""
    const dateId = newsIdentifier.DateId || ""
    const providerId = newsIdentifier.ProviderId || ""

    // Extract news management data
    const newsManagement = newsItem.NewsManagement || {}
    const status = newsManagement.Status?.FormalName || ""
    const urgency = newsManagement.Urgency?.FormalName || ""
    const creationDate = newsManagement.FirstCreated || ""
    const revisionDate = newsManagement.ThisRevisionCreated || ""

    // Find the main news component
    const mainComponent = findMainNewsComponent(newsItem.NewsComponent)
    if (!mainComponent) throw new Error("Main news component not found")

    // Extract comment data
    let commentData = ""
    if (mainComponent.Comment) {
      commentData = extractCData(mainComponent.Comment)
    }

    // Extract headline and other metadata
    let headline = "",
      byline = "",
      dateline = "",
      creditline = "",
      slugline = "",
      keywords = ""
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

    if (mainComponent.NewsLines) {
      headline = extractCData(mainComponent.NewsLines.HeadLine)
      byline = extractCData(mainComponent.NewsLines.ByLine)
      dateline = extractCData(mainComponent.NewsLines.DateLine)
      creditline = extractCData(mainComponent.NewsLines.CreditLine)
      slugline = extractCData(mainComponent.NewsLines.SlugLine)

      // Extract keywords
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

    // Extract administrative metadata
    if (mainComponent.AdministrativeMetadata) {
      const adminMeta = mainComponent.AdministrativeMetadata

      if (adminMeta.Property) {
        const props = Array.isArray(adminMeta.Property) ? adminMeta.Property : [adminMeta.Property]

        for (const prop of props) {
          if (prop.FormalName === "Edition") edition = prop.Value || ""
          if (prop.FormalName === "Location") location = prop.Value || ""
          if (prop.FormalName === "PageNumber") pageNumber = prop.Value || ""
        }
      }
    }

    // Extract descriptive metadata
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

    // Extract image characteristics
    if (mainComponent.ContentItem) {
      const contentItems = Array.isArray(mainComponent.ContentItem)
        ? mainComponent.ContentItem
        : [mainComponent.ContentItem]

      for (const item of contentItems) {
        if (item.Href && item.Href.endsWith(".jpg") && !item.Href.includes("_th.jpg")) {
          imageHref = item.Href

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
          break
        }
      }
    }

    // Construct expected image path
    const expectedImageDir = path.join(
      path.dirname(path.dirname(xmlFilePath)), // go up from processed dir
      "media",
    )

    const imagePath = imageHref ? path.join(expectedImageDir, imageHref) : ""
    let imageExists = false

    // Check if image exists
    if (imagePath) {
      try {
        await fs.access(imagePath)
        imageExists = true
      } catch {
        // Image doesn't exist
      }
    }

    // Create record for CSV
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

    // Check if record passes filter
    const passedFilter = passesFilter(record, filterConfig)
    let imageMoved = false

    // If filtering is enabled and record doesn't pass, return null (skip this record)
    if (filterConfig?.enabled && !passedFilter) {
      return { record: null, passedFilter: false, imageMoved: false }
    }

    // Move image if filtering is enabled, record passed, and move option is enabled
    if (filterConfig?.enabled && passedFilter && filterConfig?.moveImages && imageExists && imagePath) {
      imageMoved = await moveImageToFilteredFolder(imagePath, filteredImagesPath)
    }

    return {
      record: passedFilter ? record : null,
      passedFilter,
      imageMoved,
    }
  } catch (err) {
    console.error(`Error extracting data from ${xmlFilePath}:`, err)
    return null
  }
}

// Helper function to find the main news component
function findMainNewsComponent(newsComponent: any): any {
  if (!newsComponent) return null

  // If NewsComponent has Role with FormalName="PICTURE", it's what we want
  if (newsComponent.Role && newsComponent.Role.FormalName === "PICTURE") {
    return newsComponent
  }

  // Otherwise, check nested NewsComponent
  if (newsComponent.NewsComponent) {
    if (Array.isArray(newsComponent.NewsComponent)) {
      for (const comp of newsComponent.NewsComponent) {
        const found = findMainNewsComponent(comp)
        if (found) return found
      }
    } else {
      return findMainNewsComponent(newsComponent.NewsComponent)
    }
  }

  return null
}

// Helper function to extract CDATA content
function extractCData(element: any): string {
  if (!element) return ""
  if (typeof element === "string") return element.trim()
  if (element._) return element._.trim()
  return ""
}
