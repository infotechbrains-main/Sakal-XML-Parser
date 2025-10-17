# Sakal XML Parser - Complete Documentation

## 📋 Table of Contents
- [Overview](#overview)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Getting Started](#getting-started)
- [Configuration Options](#configuration-options)
- [Processing Modes](#processing-modes)
- [Configuration Templates](#configuration-templates)
- [Advanced Features](#advanced-features)
- [API Endpoints](#api-endpoints)
- [File Structure](#file-structure)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

**Sakal XML Parser** is a powerful Next.js-based web application designed to parse XML files containing image metadata and convert them into CSV format. The application is specifically built to handle large-scale image metadata extraction from XML files (particularly news media content) with advanced filtering, processing, and file management capabilities.

### Primary Use Case
- Parse XML files containing news item metadata (headlines, bylines, image information, etc.)
- Extract EXIF and metadata from associated image files
- Apply sophisticated filters to process only relevant files
- Export structured data to CSV format
- Manage and organize processed images
- Monitor directories for new files in real-time

---

## ✨ Features

### Core Functionality
- ✅ **Multi-threaded XML Processing** - Parallel processing using Worker threads for optimal performance
- ✅ **Multiple Processing Modes** - Regular, Stream, and Chunked processing options
- ✅ **Real-time Progress Tracking** - Live updates with detailed statistics
- ✅ **Advanced Filtering System** - Filter by file type, dimensions, file size, and metadata
- ✅ **Configuration Templates** - Save and reuse your complete configurations
- ✅ **Image Management** - Move/organize filtered images with folder structure options
- ✅ **Remote File Support** - Process files from HTTP/HTTPS servers
- ✅ **File Watching** - Automatic monitoring and processing of new files
- ✅ **Session History** - Track and resume previous processing sessions
- ✅ **Pause/Resume Capability** - Interrupt and continue long-running processes
- ✅ **Export & Download** - Download processed CSV files directly

### Data Extraction
The parser extracts comprehensive metadata including:
- **News Metadata**: City, Year, Month, News Item ID, Date ID, Provider ID
- **Content Details**: Headline, Byline, Dateline, Credit Line, Copyright, Slug Line
- **Classification**: Keywords, Edition, Location, Country, Page Number
- **Status Info**: Processing status, Urgency, Language, Subject
- **Image Data**: Width, Height, File Size, Path, Existence verification
- **Technical Details**: Creation Date, Revision Date, Usage Type, Rights Holder
- **EXIF Data**: Camera settings, GPS data, and other embedded information

---

## 🏗️ System Architecture

### Technology Stack
- **Framework**: Next.js 14.2.16 (React 18)
- **Language**: TypeScript
- **UI Components**: Radix UI with Tailwind CSS
- **XML Parsing**: fast-xml-parser, xml2js
- **CSV Generation**: csv-writer
- **File Watching**: chokidar
- **Image Processing**: sharp, exifreader
- **Deployment**: Docker, Vercel

### Architecture Components

```
┌─────────────────────────────────────────────┐
│           Next.js Frontend (UI)             │
│  - Configuration Interface                  │
│  - Real-time Progress Display               │
│  - History & Session Management             │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           API Routes (Backend)              │
│  - /api/parse (Regular Mode)                │
│  - /api/parse/stream (Stream Mode)          │
│  - /api/parse/chunked (Chunked Mode)        │
│  - /api/watch/* (File Watcher)              │
│  - /api/history/* (Session Management)      │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│        Worker Thread Pool                   │
│  - XML Parsing (xml-parser-worker.js)       │
│  - Metadata Extraction                      │
│  - Filter Application                       │
│  - Image Processing                         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│         Data & File System                  │
│  - XML Files (Input)                        │
│  - CSV Files (Output)                       │
│  - Processing History (JSON)                │
│  - Session State (JSON)                     │
└─────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20 or higher
- pnpm (recommended) or npm
- Sufficient disk space for processing large datasets

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/infotechbrains-main/Sakal-XML-Parser.git
   cd Sakal-XML-Parser
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   # or
   npm install
   ```

3. **Run development server**
   ```bash
   pnpm dev
   # or
   npm run dev
   ```

4. **Open browser**
   Navigate to `http://localhost:3000`

### Quick Start Guide

1. **Configure Basic Settings** (Basic tab)
   - Enter root directory path containing XML files
   - Set output CSV filename
   - Choose output folder location
   - Set number of worker threads (default: 4)

2. **Select Processing Mode** (Basic tab)
   - **Stream Mode** (Recommended): Real-time processing with progress updates
   - **Regular Mode**: Standard processing with batch results
   - **Chunked Mode**: Process in chunks with optional pauses

3. **Configure Filters** (Filters tab - Optional)
   - Enable filtering checkbox
   - Set file type restrictions
   - Configure dimension filters (width/height)
   - Set file size constraints
   - Add metadata filters (credit line, copyright, etc.)

4. **Start Processing**
   - Click "Start Processing" button
   - Monitor real-time progress in the Console/Logs tab
   - View statistics and errors as they occur

5. **Download Results**
   - Once complete, click "Download CSV" button
   - File will be saved to your specified output location

---

## ⚙️ Configuration Options

### Basic Configuration

#### Root Directory
- **Path to XML files**: Local filesystem path or HTTP/HTTPS URL
- **Example (Local)**: `/Users/username/Documents/xml-files`
- **Example (Remote)**: `https://example.com/xml-files/`
- **Note**: Directory will be scanned recursively

#### Output Settings
- **Output File**: Name for the generated CSV file (default: `image_metadata.csv`)
- **Output Folder**: Directory where CSV will be saved (optional, defaults to project root)

#### Performance Settings
- **Number of Workers**: Parallel worker threads (1-16)
  - **Recommended**: 4-8 for most systems
  - **Lower values**: Better for systems with limited RAM
  - **Higher values**: Faster processing on powerful machines

#### Verbose Logging
- Enable detailed console output for debugging
- Shows individual file processing steps
- Useful for troubleshooting issues

---

## 🔄 Processing Modes

### 1. Stream Mode (Recommended)
**Best for**: Real-time monitoring and most use cases

**Features**:
- Server-Sent Events (SSE) for live updates
- Immediate progress feedback
- Memory efficient
- Can be interrupted and resumed
- Continuous CSV writing

**Use when**:
- You need real-time progress updates
- Processing large directories
- Want immediate visibility into errors
- Need responsive UI during processing

**Configuration**:
```javascript
{
  processingMode: "stream",
  numWorkers: 4,
  verbose: true
}
```

### 2. Regular Mode
**Best for**: Batch processing and API usage

**Features**:
- Traditional request/response pattern
- Results returned after completion
- All data in memory until finished
- Simpler error handling

**Use when**:
- Processing small to medium datasets
- Integrating with automated workflows
- Don't need real-time updates
- Prefer simpler architecture

**Configuration**:
```javascript
{
  processingMode: "regular",
  numWorkers: 4,
  verbose: false
}
```

### 3. Chunked Mode
**Best for**: Very large datasets requiring breaks

**Features**:
- Processes files in configurable chunks
- Optional pauses between chunks
- Prevents system overload
- Maintains progress state
- Can resume from any chunk

**Configuration**:
```javascript
{
  processingMode: "chunked",
  chunkSize: 100,          // Files per chunk
  pauseBetweenChunks: true,
  pauseDuration: 5,        // Seconds
  numWorkers: 4
}
```

**Use when**:
- Processing tens of thousands of files
- System resources are constrained
- Need to avoid overheating/throttling
- Want scheduled breaks for system maintenance

---

## � Configuration Templates

### Overview
Configuration Templates allow you to save your entire setup (basic settings, filters, chunked mode, watch settings) and reuse them instantly. This is perfect for:
- Switching between different processing environments (production, testing, development)
- Maintaining consistent settings across multiple runs
- Quickly applying complex filter combinations
- Sharing configurations with team members

### Saving a Template

#### Steps to Save:
1. Configure all your settings in the Basic, Filters, Chunked, and Watch tabs
2. Navigate to the **Basic Configuration** tab
3. Scroll down to the **Configuration Templates** section
4. Click **"💾 Save Current as Template"** button
5. Enter a descriptive template name (e.g., "Production Setup", "High Quality Images")
6. Optionally add a description explaining the template's purpose
7. Click **"Save Template"**

#### What Gets Saved:
A template captures ALL your configuration settings:

**Basic Settings:**
- Root directory path
- Output file name
- Output folder path
- Number of workers
- Verbose logging toggle
- Processing mode (Regular/Stream/Chunked)

**Filter Settings:**
- Filter enabled/disabled state
- Selected file types (JPG, PNG, TIFF, etc.)
- Custom file extensions
- Minimum/Maximum image dimensions (width/height)
- Minimum/Maximum file sizes
- Metadata filters (Credit Line, Copyright, Usage Type, etc.)
- Image moving configuration

**Chunked Processing Settings:**
- Chunk size
- Pause between chunks toggle
- Pause duration

**Watch Mode Settings:**
- Watch mode enabled/disabled
- Watch directory path
- Watch interval
- Watch output file/folder

### Using Templates

#### Applying a Template:
1. Go to the **Basic Configuration** tab
2. Find the **Configuration Templates** section
3. Browse your saved templates
4. Click anywhere on the template card OR click the **▶️ Play button** to apply

**Result:** All settings from the template are instantly applied to your current configuration. The template card will show an "Active" badge.

#### Template Card Information:
Each template card displays:
- **Template Name** - Your custom name
- **Description** - Optional description
- **Root Directory** - Source path being processed
- **Output File** - CSV filename
- **Processing Mode** - Regular/Stream/Chunked
- **Workers** - Number of worker threads
- **Filters Badge** - Shows if filters are enabled
- **Creation Date** - When the template was created

### Managing Templates

#### Deleting a Template:
1. Find the template you want to delete
2. Click the **🗑️ Delete button** (red trash icon)
3. Confirm the deletion

**Note:** This action cannot be undone. The template will be permanently removed.

#### Template Storage:
- Templates are stored in `data/config_templates.json`
- Automatic backup is created before each save
- Templates persist across application restarts
- Stored locally on the server (not in browser)

### Example Use Cases

#### Example 1: Production vs Testing
**Production Template:**
```
Name: "Production - Full Quality"
Description: "Process all high-quality images for production"
Settings:
  - Root: /production/xml-files
  - Output: production_metadata.csv
  - Workers: 8
  - Mode: Stream
  - Filters: Enabled
    - Min Width: 2048px
    - Min Height: 2048px
    - Min File Size: 1MB
    - File Types: JPG, PNG, TIFF
```

**Testing Template:**
```
Name: "Testing - Sample Set"
Description: "Quick test with small dataset"
Settings:
  - Root: /test/sample-xml
  - Output: test_output.csv
  - Workers: 2
  - Mode: Regular
  - Filters: Disabled
```

#### Example 2: Different Quality Tiers
**High Quality Template:**
```
Name: "High Quality Only"
Filters:
  - Min Width: 3840px
  - Min Height: 2160px
  - Min Size: 5MB
  - Usage Type: Commercial
```

**Web Quality Template:**
```
Name: "Web Optimized"
Filters:
  - Min Width: 1200px
  - Max Width: 3000px
  - Max Size: 2MB
  - File Types: JPG, PNG, WEBP
```

#### Example 3: Specific Content Types
**Editorial Images Template:**
```
Name: "Editorial Content"
Filters:
  - Usage Type: Editorial
  - Credit Line: Contains "Reuters"
  - Min Width: 1920px
```

**Stock Photos Template:**
```
Name: "Stock Photography"
Filters:
  - Usage Type: Commercial
  - Rights Holder: Not Empty
  - Min Width: 2048px
  - Move Images: Yes
  - Destination: /archive/stock-photos
```

### Best Practices

#### Naming Conventions:
- Use descriptive names that indicate purpose
- Include environment name if applicable (Prod, Dev, Test)
- Include quality tier if relevant (High, Medium, Web)
- Example: "Prod-HighQuality-Commercial"

#### Template Organization:
- Create templates for each common workflow
- Keep descriptions up-to-date
- Delete unused templates regularly
- Document special configurations in description

#### Template Maintenance:
- Review templates quarterly
- Update paths if directories change
- Test templates after system changes
- Back up `config_templates.json` externally

### Quick Workflow with Templates

**Typical Daily Use:**
1. Open application
2. Click on appropriate template (e.g., "Daily Production Run")
3. Verify root directory is accessible
4. Click "Start Processing"
5. Monitor progress in Logs tab

**No need to manually configure:**
- ✅ Worker count
- ✅ Processing mode
- ✅ Filter settings
- ✅ Output paths
- ✅ Chunking options

**Time saved:** 2-5 minutes per processing run!

### API Integration

Templates can also be managed via API:

**List All Templates:**
```bash
GET /api/templates
```

**Get Specific Template:**
```bash
GET /api/templates/{templateId}
```

**Create Template:**
```bash
POST /api/templates
{
  "name": "My Template",
  "description": "Description here",
  "config": { ...configuration object... }
}
```

**Delete Template:**
```bash
DELETE /api/templates/{templateId}
```

### Troubleshooting Templates

**Template not applying correctly:**
- Verify all paths in template still exist
- Check file permissions on directories
- Ensure filter values are still valid

**Template save failed:**
- Check disk space in `data/` directory
- Verify write permissions
- Check browser console for errors

**Templates not appearing:**
- Refresh the page
- Check `data/config_templates.json` exists
- Verify JSON file is not corrupted

---

## �🔍 Advanced Features

### File Filtering System

#### File Type Filters
Select which image formats to process:
- ✅ JPG/JPEG
- ✅ PNG
- ✅ TIFF
- ✅ BMP
- 📝 Custom extensions (comma-separated)

**Example**: `webp, heic, raw`

#### Dimension Filters
Filter images by pixel dimensions:
- **Minimum Width**: Only process images wider than X pixels
- **Maximum Width**: Skip images wider than X pixels
- **Minimum Height**: Only process images taller than Y pixels
- **Maximum Height**: Skip images taller than Y pixels

**Use Case**: Filter out thumbnails or oversized images
```javascript
{
  minWidth: 800,
  minHeight: 600,
  maxWidth: 5000,
  maxHeight: 5000
}
```

#### File Size Filters
Filter by actual file size on disk:
- **Minimum File Size**: Skip small files
- **Maximum File Size**: Skip large files
- **Units**: Bytes, KB, MB, GB

**Use Case**: Exclude tiny thumbnails or limit processing to manageable sizes
```javascript
{
  minFileSize: 50,      // 50 KB
  minFileSizeUnit: "KB",
  maxFileSize: 10,      // 10 MB
  maxFileSizeUnit: "MB"
}
```

#### Metadata Filters
Advanced filtering based on XML metadata:

**Available Metadata Filters**:
- **Credit Line**: Filter by photo credit
- **Copyright**: Filter by copyright information
- **Usage Type**: Filter by usage rights
- **Rights Holder**: Filter by rights owner
- **Location**: Filter by geographic location

**Operators**:
- `equals`: Exact match
- `contains`: Partial match
- `startsWith`: Begins with
- `endsWith`: Ends with
- `notEquals`: Exclude matches
- `notContains`: Exclude partial matches

**Example Configuration**:
```javascript
{
  creditLine: {
    operator: "contains",
    value: "Reuters"
  },
  usageType: {
    operator: "equals",
    value: "Editorial"
  }
}
```

### Image Moving/Organization

Automatically move filtered images to a destination folder:

#### Configuration
- **Enable Image Moving**: Toggle to activate
- **Destination Path**: Target directory for moved images
- **Folder Structure Options**:
  - **Replicate Structure**: Maintain original folder hierarchy
  - **Flat Structure**: Move all images to single folder

#### Use Cases
1. **Archive Qualified Images**: Move approved images to archive
2. **Organize by Filter**: Separate images meeting criteria
3. **Cleanup Processing**: Move processed files out of source directory

**Example**:
```javascript
{
  moveImages: true,
  moveDestinationPath: "/archive/qualified-images",
  moveFolderStructureOption: "replicate"
}
```

### File Watching (Auto-processing)

Monitor a directory for new XML files and process automatically:

#### Features
- Real-time file system monitoring
- Automatic processing of new files
- Applies configured filters
- Append to existing CSV or create new
- Minimal resource usage when idle

#### Configuration
- **Watch Directory**: Path to monitor
- **Check Interval**: Polling frequency (seconds)
- **Output File**: CSV for watched files
- **Use Filters**: Apply filter configuration
- **Workers**: Number of processing threads

#### Starting a Watcher
```javascript
POST /api/watch/start
{
  rootDir: "/path/to/watch",
  outputFile: "watched_images.csv",
  filterConfig: {...},
  numWorkers: 2,
  verbose: true
}
```

#### Stopping a Watcher
```javascript
POST /api/watch/stop
{
  watcherId: "watcher_123456"
}
```

### Session History & Resume

#### Session Management
- All processing sessions are automatically saved
- View history with detailed statistics
- Resume interrupted sessions
- Delete old sessions
- Export session configuration

#### Session Information Includes
- Start/End timestamps
- Configuration used
- Processing statistics
- Output file location
- Error logs
- Files processed list

#### Resuming a Session
1. Navigate to History tab
2. Find interrupted or paused session
3. Click "Resume" button
4. Processing continues from last file

---

## 🌐 API Endpoints

### Processing Endpoints

#### POST `/api/parse`
Regular mode processing
```javascript
{
  rootDir: string,
  outputFile: string,
  outputFolder?: string,
  numWorkers?: number,
  verbose?: boolean,
  filterConfig?: FilterConfig
}
```

#### POST `/api/parse/stream`
Stream mode processing (SSE)
```javascript
// Same as /api/parse
// Returns: text/event-stream
```

#### POST `/api/parse/chunked`
Chunked mode processing
```javascript
{
  rootDir: string,
  outputFile: string,
  chunkSize?: number,
  pauseBetweenChunks?: boolean,
  pauseDuration?: number,
  // ... other fields
}
```

#### POST `/api/parse/pause`
Pause current processing
```javascript
{
  sessionId: string
}
```

#### POST `/api/resume`
Resume regular mode processing
```javascript
{
  sessionId: string
}
```

#### POST `/api/resume-chunked`
Resume chunked mode processing
```javascript
{
  sessionId: string
}
```

### History Endpoints

#### GET `/api/history`
Get all processing sessions
```javascript
// Returns: { sessions: ProcessingSession[] }
```

#### GET `/api/history/[sessionId]`
Get specific session details
```javascript
// Returns: ProcessingSession
```

#### DELETE `/api/history/[sessionId]`
Delete a session from history

### Status Endpoints

#### GET `/api/status`
Get current processing status
```javascript
// Returns: {
//   isProcessing: boolean,
//   currentSession: ProcessingSession | null,
//   stats: ProcessingStats
// }
```

#### GET `/api/processing-state`
Get detailed processing state

### Watch Endpoints

#### POST `/api/watch/start`
Start file watcher
```javascript
{
  rootDir: string,
  filterConfig?: FilterConfig,
  outputFile?: string,
  numWorkers?: number
}
```

#### GET `/api/watch/status`
Get watcher status

#### POST `/api/watch/stop`
Stop file watcher
```javascript
{
  watcherId: string
}
```

### Download Endpoint

#### GET `/api/download?file=path`
Download generated CSV file

### Template Endpoints

#### GET `/api/templates`
Get all configuration templates
```javascript
// Returns: 
{
  success: true,
  templates: ConfigTemplate[]
}
```

#### GET `/api/templates/[id]`
Get specific template by ID
```javascript
// Returns:
{
  success: true,
  template: ConfigTemplate
}
```

#### POST `/api/templates`
Create a new template
```javascript
{
  name: string,
  description?: string,
  config: {
    rootDir: string,
    outputFile: string,
    outputFolder: string,
    numWorkers: number,
    verbose: boolean,
    processingMode: "regular" | "stream" | "chunked",
    filterEnabled: boolean,
    filterConfig: FilterConfig,
    // ... all other configuration options
  }
}
// Returns:
{
  success: true,
  template: ConfigTemplate
}
```

#### PUT `/api/templates/[id]`
Update existing template
```javascript
{
  name?: string,
  description?: string,
  config?: ConfigObject
}
```

#### DELETE `/api/templates/[id]`
Delete a template
```javascript
// Returns:
{
  success: true
}
```

---

## 📁 File Structure

```
Sakal-XML-Parser/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── parse/               # Processing endpoints
│   │   │   ├── route.ts         # Regular mode
│   │   │   ├── stream/route.ts  # Stream mode
│   │   │   ├── chunked/route.ts # Chunked mode
│   │   │   ├── pause/route.ts   # Pause processing
│   │   │   └── xml-parser-worker.js # Worker thread
│   │   ├── watch/               # File watcher
│   │   │   ├── start/route.ts
│   │   │   ├── status/route.ts
│   │   │   └── stop/route.ts
│   │   ├── history/             # Session history
│   │   │   ├── route.ts
│   │   │   └── [sessionId]/route.ts
│   │   ├── templates/           # Template management
│   │   │   ├── route.ts         # List/create templates
│   │   │   └── [id]/route.ts    # Get/update/delete template
│   │   ├── resume/route.ts      # Resume processing
│   │   ├── status/route.ts      # Status checks
│   │   └── download/route.ts    # File downloads
│   ├── globals.css              # Global styles
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Main UI (2600+ lines)
├── components/                   # React Components
│   ├── ui/                      # Radix UI components
│   └── theme-provider.tsx       # Theme management
├── lib/                         # Utility Libraries
│   ├── persistent-history.ts    # Session persistence
│   ├── processing-history.ts    # History management
│   ├── template-manager.ts      # Template management
│   ├── remote-file-handler.ts   # Remote file support
│   ├── watcher-manager.ts       # File watching
│   └── utils.ts                 # General utilities
├── data/                        # Runtime Data
│   ├── processing_history.json  # Session history
│   ├── current_session.json     # Active session
│   └── config_templates.json    # Saved templates
├── public/                      # Static Assets
├── Dockerfile                   # Docker configuration
├── docker-compose.yml           # Docker Compose (if exists)
├── next.config.mjs              # Next.js config
├── package.json                 # Dependencies
├── tailwind.config.js           # Tailwind CSS config
├── tsconfig.json                # TypeScript config
├── HELP.md                      # This comprehensive guide
└── README.md                    # Basic info
```

---

## 🐳 Deployment

### Docker Deployment

#### Building the Image
```bash
# Build Next.js application
pnpm run build

# Build Docker image
docker build -t sakal-xml-parser .
```

#### Running the Container
```bash
docker run -p 3000:3000 \
  -v /path/to/xml/files:/data/xml \
  -v /path/to/output:/data/output \
  sakal-xml-parser
```

#### Docker Compose
```yaml
version: '3.8'
services:
  sakal-parser:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./xml-files:/data/xml
      - ./output:/data/output
      - ./data:/app/data
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

### Vercel Deployment

#### Prerequisites
- Vercel account
- GitHub repository connected

#### Deployment Steps
1. Connect repository to Vercel
2. Configure build settings:
   - **Framework**: Next.js
   - **Build Command**: `pnpm build`
   - **Output Directory**: `.next`
3. Add environment variables (if any)
4. Deploy

**Note**: File system access limitations on Vercel - best for remote file processing

### Traditional Server Deployment

#### Using PM2
```bash
# Install PM2
npm install -g pm2

# Build application
pnpm run build

# Start with PM2
pm2 start npm --name "sakal-parser" -- start

# Save PM2 configuration
pm2 save
pm2 startup
```

#### Using systemd
```ini
[Unit]
Description=Sakal XML Parser
After=network.target

[Service]
Type=simple
User=nodeuser
WorkingDirectory=/opt/sakal-xml-parser
ExecStart=/usr/bin/node /opt/sakal-xml-parser/.next/standalone/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## 🔧 Troubleshooting

### Common Issues

#### "No XML files found"
**Causes**:
- Incorrect root directory path
- Permissions issues
- XML files in unexpected format

**Solutions**:
1. Verify path is correct and accessible
2. Check file permissions: `ls -la /path/to/xml`
3. Ensure files have `.xml` extension (case-insensitive)
4. Try verbose mode to see detailed scanning logs

#### "Worker thread error"
**Causes**:
- XML parsing errors
- Malformed XML files
- Memory issues

**Solutions**:
1. Reduce number of workers
2. Enable verbose logging to identify problematic files
3. Check XML file validity
4. Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=4096`

#### "Cannot write CSV file"
**Causes**:
- Permission issues
- Disk space full
- Invalid output path

**Solutions**:
1. Check write permissions on output folder
2. Verify disk space: `df -h`
3. Use absolute paths for output
4. Ensure output directory exists

#### "Processing stuck/frozen"
**Causes**:
- Very large files
- Network timeout (remote files)
- System resource exhaustion

**Solutions**:
1. Use chunked mode with pauses
2. Reduce number of workers
3. Check system resources: `top` or `htop`
4. Increase timeout for remote files
5. Restart the processing with smaller chunk size

#### "Memory issues / Out of memory"
**Causes**:
- Too many workers
- Very large XML files
- Insufficient system RAM

**Solutions**:
1. Reduce worker count to 2-4
2. Use chunked mode
3. Increase Node.js memory limit
4. Process in smaller batches
5. Close other applications

#### "Remote files not downloading"
**Causes**:
- Network connectivity
- Server authentication
- CORS issues

**Solutions**:
1. Check network connection
2. Verify server allows directory listing
3. Check server logs for errors
4. Use VPN if server has geo-restrictions
5. Contact server administrator

### Performance Optimization

#### For Large Datasets (10,000+ files)
```javascript
{
  processingMode: "chunked",
  chunkSize: 100,
  pauseBetweenChunks: true,
  pauseDuration: 2,
  numWorkers: 6
}
```

#### For Limited Resources
```javascript
{
  processingMode: "stream",
  numWorkers: 2,
  verbose: false
}
```

#### For Maximum Speed
```javascript
{
  processingMode: "stream",
  numWorkers: 8,
  verbose: false,
  // Disable unnecessary filters
  filterConfig: { enabled: false }
}
```

### Debug Mode

Enable verbose logging to see detailed processing information:

```javascript
{
  verbose: true
}
```

This will show:
- Individual file processing steps
- Worker thread assignments
- Filter application results
- Detailed error messages
- Timing information

### Logs Location

- **Console Logs**: Visible in browser console (F12)
- **Server Logs**: Check terminal running the application
- **Session History**: Stored in `data/processing_history.json`
- **Current Session**: Stored in `data/current_session.json`

### Getting Help

1. **Check Logs**: Enable verbose mode and check console
2. **Review History**: Check session history for patterns
3. **Test Small Dataset**: Try with 10-20 files first
4. **GitHub Issues**: Report bugs at repository issues page
5. **Documentation**: Re-read relevant sections

---

## 📊 CSV Output Format

### Generated Columns

| Column | Description | Example |
|--------|-------------|---------|
| City | Publication city | `Mumbai` |
| Year | Publication year | `2024` |
| Month | Publication month | `10` |
| News Item ID | Unique item identifier | `NI123456` |
| Date ID | Date identifier | `20241015` |
| Provider ID | Content provider ID | `PROV001` |
| Headline | Article headline | `Breaking News Today` |
| Byline | Author/photographer | `John Doe` |
| Date Line | Location and date | `Mumbai, Oct 15` |
| Credit Line | Photo credit | `Reuters` |
| Copyright Line | Copyright info | `© 2024 Reuters` |
| Slug Line | Internal reference | `mumbai-floods-2024` |
| Keywords | Search keywords | `news, politics, india` |
| Edition | Publication edition | `Morning Edition` |
| Location | Geographic location | `Maharashtra` |
| Country | Country code/name | `India` |
| City (Metadata) | City from metadata | `Mumbai` |
| Page Number | Page in publication | `A1` |
| Status | Processing status | `Published` |
| Urgency | Priority level | `High` |
| Language | Content language | `English` |
| Subject | Subject category | `Politics` |
| Processed | Processing timestamp | `2024-10-15T10:30:00Z` |
| Published | Publication timestamp | `2024-10-15T06:00:00Z` |
| Usage Type | Usage rights | `Editorial` |
| Rights Holder | Rights owner | `News Agency` |
| Image Width | Width in pixels | `1920` |
| Image Height | Height in pixels | `1080` |
| Image Size | Size from XML (bytes) | `1048576` |
| Actual File Size | Real file size (bytes) | `1050000` |
| Image Href | Image filename | `IMG_001.jpg` |
| XML Path | Full XML file path | `/data/2024/10/item.xml` |
| Image Path | Full image file path | `/data/2024/10/IMG_001.jpg` |
| Image Exists | File existence check | `true` |
| Creation Date | File creation date | `2024-10-15T08:00:00Z` |
| Revision Date | Last modified date | `2024-10-15T09:00:00Z` |
| Comment Data | Additional comments | `High resolution` |

---

## 🔒 Security Considerations

### File System Access
- Application requires read access to XML source directories
- Application requires write access to output directories
- Be cautious with root-level directory access
- Use specific paths rather than system root

### Remote File Access
- Remote URLs are fetched without authentication by default
- Implement authentication if accessing protected resources
- Validate URLs to prevent SSRF attacks
- Use HTTPS for secure transfers

### Data Privacy
- Processing history stored locally in `data/` folder
- Contains file paths and configuration
- Clear history regularly if processing sensitive data
- Secure the deployment server appropriately

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes with clear commit messages
4. Test thoroughly
5. Submit a pull request

---

## 📝 License

This project is proprietary software developed for Sakal Media Group.

---

## 📞 Support

For issues, questions, or feature requests:
- **GitHub Issues**: [Create an issue](https://github.com/infotechbrains-main/Sakal-XML-Parser/issues)
- **Email**: support@infotechbrains.com
- **Documentation**: This file

---

## 📈 Changelog

### Version 0.1.0 (Current)
- ✅ Initial release
- ✅ Multiple processing modes
- ✅ Advanced filtering system
- ✅ File watcher functionality
- ✅ Session history and resume
- ✅ Remote file support
- ✅ Docker deployment support

---

**Last Updated**: October 16, 2025
**Version**: 0.1.0
**Maintained By**: InfoTech Brains
