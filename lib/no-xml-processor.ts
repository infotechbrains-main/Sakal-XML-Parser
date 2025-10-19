import fs from "fs/promises"
import path from "path"
import { getImageMetadata, type ImageMetadata } from "./image-metadata"

export interface NoXmlProcessingStats {
  considered: number
  recorded: number
  filteredOut: number
  moved: number
}

export interface NoXmlProcessingOptions {
  rootDir: string
  mediaFiles: string[]
  matchedImagePaths: Set<string>
  filterConfig: any
  verbose?: boolean
  collectRecords?: boolean
  onRecord?: (record: Record<string, any>) => Promise<void> | void
  onLog?: (message: string) => void
  preferredDestinationPath?: string
}

export interface NoXmlProcessingResult {
  records: Record<string, any>[]
  stats: NoXmlProcessingStats
  errors: string[]
  destinationPath?: string
}

function log(message: string, onLog?: (msg: string) => void, verbose?: boolean) {
  if (verbose) {
    console.log(`[NoXML] ${message}`)
  }
  if (onLog) {
    onLog(message)
  }
}

function derivePathSegments(filePath: string, rootDir: string) {
  const normalizedRoot = path.resolve(rootDir)
  const relativePath = path.relative(normalizedRoot, filePath)
  const parts = relativePath.split(path.sep).filter(Boolean)

  let city = ""
  let year = ""
  let month = ""

  const yearIndex = parts.findIndex((part) => /^\d{4}$/.test(part))
  if (yearIndex !== -1) {
    year = parts[yearIndex]
    if (yearIndex > 0) {
      city = parts[yearIndex - 1]
    }
    if (yearIndex + 1 < parts.length && /^\d{2}$/.test(parts[yearIndex + 1])) {
      month = parts[yearIndex + 1]
    }
  }

  return {
    relativePath,
    city,
    year,
    month,
  }
}

function passesFilter(record: Record<string, any>, filterConfig: any): boolean {
  if (!filterConfig || !filterConfig.enabled) {
    return true
  }

  const applyTextFilter = (fieldValue: unknown, filter: any) => {
    if (!filter || !filter.operator) {
      return true
    }

    const val = String(fieldValue ?? "")
      .toLowerCase()
      .trim()
    const filterVal = String(filter.value ?? "")
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

  const allowedTypes = filterConfig.allowedFileTypes || filterConfig.fileTypes || []
  if (allowedTypes && allowedTypes.length > 0) {
    const imageFileName = record.imageHref || ""
    if (imageFileName) {
      const fileExtension = imageFileName.split(".").pop()?.toLowerCase() || ""
      const normalizedAllowedTypes = allowedTypes.map((type: string) => type.toLowerCase())

      let isAllowedType = normalizedAllowedTypes.includes(fileExtension)
      if (!isAllowedType && (fileExtension === "tif" || fileExtension === "tiff")) {
        isAllowedType = normalizedAllowedTypes.includes("tif") || normalizedAllowedTypes.includes("tiff")
      }

      if (!isAllowedType) {
        return false
      }
    }
  }

  const imageWidth = Number.parseInt(record.imageWidth ?? "0", 10) || 0
  const imageHeight = Number.parseInt(record.imageHeight ?? "0", 10) || 0

  if (filterConfig.minWidth && imageWidth < filterConfig.minWidth) {
    return false
  }
  if (filterConfig.minHeight && imageHeight < filterConfig.minHeight) {
    return false
  }

  let fileSizeBytes = Number(record.actualFileSize || 0)
  if (!fileSizeBytes && record.imageSize) {
    const cleanSize = String(record.imageSize).replace(/,/g, "")
    fileSizeBytes = Number.parseInt(cleanSize, 10) || 0
  }

  if (filterConfig.minFileSize && fileSizeBytes < filterConfig.minFileSize) {
    return false
  }

  if (filterConfig.maxFileSize && fileSizeBytes > filterConfig.maxFileSize) {
    return false
  }

  if (!applyTextFilter(record.creditline, filterConfig.creditLine)) {
    return false
  }
  if (!applyTextFilter(record.copyrightLine, filterConfig.copyright)) {
    return false
  }
  if (!applyTextFilter(record.usageType, filterConfig.usageType)) {
    return false
  }
  if (!applyTextFilter(record.rightsHolder, filterConfig.rightsHolder)) {
    return false
  }
  if (!applyTextFilter(record.location, filterConfig.location)) {
    return false
  }

  return true
}

function deriveDateId(creationDate?: string): string {
  if (!creationDate) return ""
  const normalized = creationDate.replace(/[^0-9]/g, "")
  return normalized.slice(0, 8)
}

function buildRecord(
  filePath: string,
  metadata: ImageMetadata,
  rootDir: string,
  segments: ReturnType<typeof derivePathSegments>,
): Record<string, any> {
  const relativePath = segments.relativePath.split(path.sep).join("/")
  const fileName = path.basename(filePath)

  const keywords = metadata.keywords ?? []
  const keywordString = keywords.join("; ")

  return {
    city: metadata.city || segments.city || "",
    year: segments.year || "",
    month: segments.month || "",
    newsItemId: "",
    dateId: deriveDateId(metadata.creationDate),
    providerId: "",
    headline: metadata.headline || fileName,
    byline: metadata.byline || "",
    dateline: metadata.dateline || "",
    creditline: metadata.creditline || "",
    copyrightLine: metadata.copyrightLine || "",
    slugline: metadata.slugline || path.parse(fileName).name,
    keywords: keywordString,
    edition: metadata.edition || "",
    location: metadata.location || metadata.city || segments.city || "",
    country: metadata.country || "",
    city_meta: metadata.cityMeta || metadata.city || segments.city || "",
    pageNumber: metadata.pageNumber || "",
    status: metadata.status || "",
    urgency: metadata.urgency || "",
    language: metadata.language || "",
    subject: metadata.subject || keywordString,
    processed: metadata.processed || "",
    published: metadata.published || "",
    usageType: metadata.usageType || "",
    rightsHolder: metadata.rightsHolder || "",
    imageWidth: metadata.width ?? "",
    imageHeight: metadata.height ?? "",
    imageSize: metadata.imageSize ?? metadata.fileSize,
    actualFileSize: metadata.fileSize,
    imageHref: relativePath || fileName,
    xmlPath: "",
    imagePath: filePath,
    imageExists: "Yes",
    haveXml: "No",
    creationDate: metadata.creationDate || "",
    revisionDate: metadata.revisionDate || "",
    commentData: metadata.commentData || "",
  }
}

async function moveImageWithoutXml(
  sourceImagePath: string,
  destinationBasePath: string,
  folderStructureOption: "replicate" | "flat",
  rootDir: string,
): Promise<boolean> {
  try {
    const normalizedSource = path.resolve(sourceImagePath)
    const normalizedDestinationBase = path.resolve(destinationBasePath)

    let finalDestDir = normalizedDestinationBase

    if (folderStructureOption === "replicate") {
      const relativeDir = path.dirname(path.relative(path.resolve(rootDir), normalizedSource))
      finalDestDir = path.join(normalizedDestinationBase, relativeDir)
    }

    let finalDestPath = path.join(finalDestDir, path.basename(normalizedSource))

    await fs.mkdir(finalDestDir, { recursive: true })

    try {
      await fs.access(finalDestPath)
      const ext = path.extname(finalDestPath)
      const baseName = path.basename(finalDestPath, ext)
      const uniqueName = `${baseName}_${Date.now()}${ext}`
      finalDestPath = path.join(finalDestDir, uniqueName)
    } catch {
      // Destination available - proceed
    }

    await fs.copyFile(normalizedSource, finalDestPath)
    return true
  } catch {
    return false
  }
}

export async function processImagesWithoutXml(options: NoXmlProcessingOptions): Promise<NoXmlProcessingResult> {
  const {
    rootDir,
    mediaFiles,
    matchedImagePaths,
    filterConfig,
    verbose,
    collectRecords = true,
    onRecord,
    onLog,
    preferredDestinationPath,
  } = options

  const normalizedRoot = path.resolve(rootDir)
  const normalizedMatched = new Set(Array.from(matchedImagePaths).map((p) => path.normalize(p)))

  const unmatchedFiles = mediaFiles.filter((file) => !normalizedMatched.has(path.normalize(file)))

  const records: Record<string, any>[] = []
  const errors: string[] = []

  let recorded = 0
  let filteredOut = 0
  let moved = 0

  const destinationBasePath = (() => {
    if (filterConfig?.moveImages && filterConfig?.moveDestinationPath) {
      const base = filterConfig.moveDestinationPath.endsWith("_noxml")
        ? filterConfig.moveDestinationPath
        : `${filterConfig.moveDestinationPath}_noxml`
      return path.resolve(base)
    }

    return preferredDestinationPath
  })()

  if (destinationBasePath) {
    await fs.mkdir(destinationBasePath, { recursive: true }).catch(() => {})
  }

  log(`Found ${unmatchedFiles.length} image(s) without XML`, onLog, verbose)

  for (const filePath of unmatchedFiles) {
    try {
      const metadata = await getImageMetadata(filePath)
      const segments = derivePathSegments(filePath, normalizedRoot)
      const record = buildRecord(filePath, metadata, normalizedRoot, segments)

      const passes = passesFilter(record, filterConfig)
      if (!passes) {
        filteredOut++
        continue
      }

      if (collectRecords) {
        records.push(record)
      }

      if (onRecord) {
        await onRecord(record)
      }

      recorded++
      matchedImagePaths.add(path.normalize(filePath))

      if (destinationBasePath && filterConfig?.moveImages) {
        const structureOption = filterConfig?.moveFolderStructureOption || "replicate"
        const movedSuccessfully = await moveImageWithoutXml(filePath, destinationBasePath, structureOption, rootDir)
        if (movedSuccessfully) {
          moved++
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? `Failed processing image ${path.basename(filePath)}: ${error.message}`
          : `Failed processing image ${path.basename(filePath)}`
      errors.push(errorMessage)
      log(errorMessage, onLog, verbose)
    }
  }

  const stats: NoXmlProcessingStats = {
    considered: unmatchedFiles.length,
    recorded,
    filteredOut,
    moved,
  }

  if (verbose) {
    log(`Images without XML - considered: ${stats.considered}, recorded: ${stats.recorded}`, onLog, verbose)
    if (destinationBasePath) {
      log(`No-XML images destination: ${destinationBasePath}`, onLog, verbose)
    }
  }

  return {
    records,
    stats,
    errors,
    destinationPath: destinationBasePath ?? undefined,
  }
}
