import { type NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"
import { parseStringPromise } from "xml2js"
import { createObjectCsvWriter } from "csv-writer"
import { glob } from "glob"

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
    const { rootDir, outputFile, workers, batchSize, verbose } = body

    if (!rootDir) {
      return NextResponse.json({ error: "Root directory is required" }, { status: 400 })
    }

    // Find all XML files using glob pattern
    const xmlPattern = path.join(rootDir, "**", "processed", "*.xml")
    const xmlFiles = await glob(xmlPattern)

    if (xmlFiles.length === 0) {
      return NextResponse.json(
        {
          error: "No XML files found",
          message: "Please check the directory structure",
        },
        { status: 404 },
      )
    }

    // Process files in batches
    const allRecords = []
    let processedCount = 0
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < xmlFiles.length; i += batchSize) {
      const batch = xmlFiles.slice(i, i + batchSize)

      for (const xmlFile of batch) {
        try {
          const record = await processXmlFile(xmlFile)
          if (record) {
            allRecords.push(record)
            successCount++
          } else {
            errorCount++
          }
          processedCount++
        } catch (error) {
          errorCount++
          if (verbose) {
            console.error(`Error processing ${xmlFile}:`, error)
          }
        }
      }
    }

    // Write CSV file
    const csvWriter = createObjectCsvWriter({
      path: outputFile,
      header: CSV_HEADERS,
    })

    await csvWriter.writeRecords(allRecords)

    return NextResponse.json({
      success: true,
      stats: {
        totalFiles: xmlFiles.length,
        processedFiles: processedCount,
        successfulFiles: successCount,
        errorFiles: errorCount,
      },
      outputFile,
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

// Process a single XML file
async function processXmlFile(xmlFilePath: string) {
  try {
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

    // Return record for CSV
    return {
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
