import fs from "fs/promises"
import path from "path"
import sharp from "sharp"
import ExifReader from "exifreader"

export interface ImageMetadata {
  width?: number | null
  height?: number | null
  fileSize: number
  imageSize?: number | null
  creationDate?: string
  revisionDate?: string
  headline?: string
  byline?: string
  dateline?: string
  creditline?: string
  copyrightLine?: string
  slugline?: string
  keywords?: string[]
  edition?: string
  location?: string
  country?: string
  city?: string
  cityMeta?: string
  pageNumber?: string
  status?: string
  urgency?: string
  language?: string
  subject?: string
  processed?: string
  published?: string
  usageType?: string
  rightsHolder?: string
  commentData?: string
}

function normalizeDateString(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  // EXIF dates often use YYYY:MM:DD HH:MM:SS format
  if (/^\d{4}:\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
  }

  return trimmed
}

function extractTag(tags: Record<string, any>, key: string): string | undefined {
  const tag = tags[key]
  if (!tag) return undefined

  if (typeof tag.description === "string" && tag.description.trim().length > 0) {
    return tag.description.trim()
  }

  if (Array.isArray(tag.description)) {
    const str = tag.description
      .map((item: unknown) => (item == null ? "" : String(item).trim()))
      .filter(Boolean)
      .join(", ")
    return str || undefined
  }

  if (Array.isArray(tag.value)) {
    const str = tag.value
      .map((item: unknown) => (item == null ? "" : String(item).trim()))
      .filter(Boolean)
      .join(", ")
    return str || undefined
  }

  if (tag.value != null) {
    const val = String(tag.value).trim()
    return val || undefined
  }

  return undefined
}

function extractKeywords(tags: Record<string, any>): string[] {
  const keywordCandidates = [
    "Keywords",
    "XPKeywords",
    "Subject",
    "ImageKeywords",
    "HierarchicalSubject",
    "Category",
  ]

  const keywords = new Set<string>()

  for (const key of keywordCandidates) {
    const value = extractTag(tags, key)
    if (!value) continue

    value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => keywords.add(item))
  }

  return Array.from(keywords)
}

function deriveCityCountry(tags: Record<string, any>): { city?: string; country?: string; location?: string } {
  const city =
    extractTag(tags, "City") ||
    extractTag(tags, "Sub-location") ||
    extractTag(tags, "PhotoshopCity") ||
    extractTag(tags, "ProvinceState")

  const country =
    extractTag(tags, "Country") ||
    extractTag(tags, "CountryPrimaryLocationName") ||
    extractTag(tags, "CountryCode")

  const location = extractTag(tags, "Location") || extractTag(tags, "LocationShownCity")

  return {
    city: city || undefined,
    country: country || undefined,
    location: location || undefined,
  }
}

export async function getImageMetadata(filePath: string): Promise<ImageMetadata> {
  const absolutePath = path.resolve(filePath)
  const [fileBuffer, stats] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)])

  let width: number | null = null
  let height: number | null = null
  let imageSize: number | null = null

  try {
    const metadata = await sharp(fileBuffer).metadata()
    width = metadata.width ?? null
    height = metadata.height ?? null
    imageSize = metadata.size ?? stats.size
  } catch {
    // Ignore sharp errors; fall back to file stats only
    imageSize = stats.size
  }

  let tags: Record<string, any> = {}
  try {
    tags = ExifReader.load(fileBuffer) as unknown as Record<string, any>
  } catch {
    // If EXIF parsing fails, continue with defaults
  }

  const creationDate =
    normalizeDateString(extractTag(tags, "DateTimeOriginal")) ||
    normalizeDateString(extractTag(tags, "CreateDate")) ||
    normalizeDateString(extractTag(tags, "DateCreated")) ||
    stats.birthtime.toISOString()

  const revisionDate =
    normalizeDateString(extractTag(tags, "ModifyDate")) ||
    normalizeDateString(extractTag(tags, "LastModified")) ||
    stats.mtime.toISOString()

  const keywords = extractKeywords(tags)
  const { city, country, location } = deriveCityCountry(tags)

  const headline =
    extractTag(tags, "Headline") ||
    extractTag(tags, "Title") ||
    extractTag(tags, "ObjectName") ||
    path.basename(absolutePath)

  const byline = extractTag(tags, "By-line") || extractTag(tags, "Artist") || extractTag(tags, "Creator")
  const creditline = extractTag(tags, "Credit") || extractTag(tags, "CreditLine") || byline
  const dateline = extractTag(tags, "ContentLocationName") || [city, country].filter(Boolean).join(", ") || undefined
  const copyrightLine = extractTag(tags, "Copyright") || extractTag(tags, "Rights")
  const usageType = extractTag(tags, "UsageTerms") || extractTag(tags, "RightsUsageTerms")
  const rightsHolder = extractTag(tags, "UsageRights") || extractTag(tags, "OwnerName") || copyrightLine
  const commentData =
    extractTag(tags, "ImageDescription") ||
    extractTag(tags, "Description") ||
    extractTag(tags, "Caption-Abstract")

  return {
    width,
    height,
    fileSize: stats.size,
    imageSize,
    creationDate,
    revisionDate,
    headline,
    byline,
    dateline,
    creditline,
    copyrightLine,
    slugline: extractTag(tags, "Slug") || undefined,
    keywords,
    edition: extractTag(tags, "Edition") || undefined,
    location,
    country,
    city,
    cityMeta: city,
    pageNumber: extractTag(tags, "PageNumber") || undefined,
    status: extractTag(tags, "Status") || undefined,
    urgency: extractTag(tags, "Urgency") || undefined,
    language: extractTag(tags, "Language") || undefined,
    subject: extractTag(tags, "Subject") || (keywords.length > 0 ? keywords.join("; ") : undefined),
    processed: undefined,
    published: undefined,
    usageType,
    rightsHolder,
    commentData,
  }
}
