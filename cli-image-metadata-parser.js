#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { createObjectCsvWriter } from 'csv-writer';
import { glob } from 'glob';
import { cpus } from 'os';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  rootDir: './images',
  outputCsv: './image_metadata.csv',
  batchSize: 100,
  maxWorkers: Math.max(1, cpus().length - 1),
  logFrequency: 100,
  help: false,
  verbose: false
};

// Parse command line arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--help' || arg === '-h') {
    options.help = true;
  } else if (arg === '--verbose' || arg === '-v') {
    options.verbose = true;
  } else if (arg === '--root' || arg === '-r') {
    options.rootDir = args[++i];
  } else if (arg === '--output' || arg === '-o') {
    options.outputCsv = args[++i];
  } else if (arg === '--batch-size' || arg === '-b') {
    options.batchSize = parseInt(args[++i], 10);
  } else if (arg === '--workers' || arg === '-w') {
    options.maxWorkers = parseInt(args[++i], 10);
  } else if (arg === '--log-frequency' || arg === '-l') {
    options.logFrequency = parseInt(args[++i], 10);
  }
}

// CSV header definition
const CSV_HEADERS = [
  { id: 'city', title: 'City' },
  { id: 'year', title: 'Year' },
  { id: 'month', title: 'Month' },
  { id: 'newsItemId', title: 'News Item ID' },
  { id: 'dateId', title: 'Date ID' },
  { id: 'providerId', title: 'Provider ID' },
  { id: 'headline', title: 'Headline' },
  { id: 'byline', title: 'Byline' },
  { id: 'dateline', title: 'Date Line' },
  { id: 'creditline', title: 'Credit Line' },
  { id: 'slugline', title: 'Slug Line' },
  { id: 'keywords', title: 'Keywords' },
  { id: 'edition', title: 'Edition' },
  { id: 'location', title: 'Location' },
  { id: 'country', title: 'Country' },
  { id: 'city_meta', title: 'City (Metadata)' },
  { id: 'pageNumber', title: 'Page Number' },
  { id: 'status', title: 'Status' },
  { id: 'urgency', title: 'Urgency' },
  { id: 'language', title: 'Language' },
  { id: 'subject', title: 'Subject' },
  { id: 'processed', title: 'Processed' },
  { id: 'published', title: 'Published' },
  { id: 'imageWidth', title: 'Image Width' },
  { id: 'imageHeight', title: 'Image Height' },
  { id: 'imageSize', title: 'Image Size (bytes)' },
  { id: 'imageHref', title: 'Image Href' },
  { id: 'xmlPath', title: 'XML Path' },
  { id: 'imagePath', title: 'Image Path' },
  { id: 'imageExists', title: 'Image Exists' },
  { id: 'creationDate', title: 'Creation Date' },
  { id: 'revisionDate', title: 'Revision Date' },
  { id: 'commentData', title: 'Comment Data' }
];

// Main thread code
if (isMainThread) {
  // Show help if requested
  if (options.help) {
    console.log(`
XML to CSV Image Metadata Parser

Usage:
  node cli-image-metadata-parser.js [options]

Options:
  -h, --help                 Show this help message
  -v, --verbose              Enable verbose logging
  -r, --root <dir>           Root directory containing images (default: ./images)
  -o, --output <file>        Output CSV file path (default: ./image_metadata.csv)
  -b, --batch-size <num>     Number of files per batch (default: 100)
  -w, --workers <num>        Number of worker threads (default: CPU count - 1)
  -l, --log-frequency <num>  Log progress every N files (default: 100)

Example:
  node cli-image-metadata-parser.js --root /path/to/images --output metadata.csv
    `);
    process.exit(0);
  }

  // Main function to process all XML files
  async function main() {
    console.time('Total processing time');
    console.log(`Starting XML processing with ${options.maxWorkers} workers...`);
    console.log(`Root directory: ${options.rootDir}`);
    console.log(`Output CSV: ${options.outputCsv}`);
    
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(options.outputCsv);
      await fs.mkdir(outputDir, { recursive: true });
      
      // Find all XML files using glob pattern
      const xmlPattern = path.join(options.rootDir, '**', 'processed', '*.xml');
      console.log(`Searching for XML files with pattern: ${xmlPattern}`);
      
      const xmlFiles = await glob(xmlPattern);
      console.log(`Found ${xmlFiles.length} XML files to process`);
      
      if (xmlFiles.length === 0) {
        console.log('No XML files found. Please check the directory structure.');
        return;
      }

      // Split files into batches for workers
      const batches = [];
      for (let i = 0; i < xmlFiles.length; i += options.batchSize) {
        batches.push(xmlFiles.slice(i, i + options.batchSize));
      }
      
      console.log(`Split files into ${batches.length} batches`);
      
      // Process batches with workers
      const results = await Promise.all(
        batches.map((batch, index) => 
          processWithWorker(batch, index)
        )
      );
      
      // Flatten results
      const allRecords = results.flat().filter(Boolean);
      console.log(`Successfully processed ${allRecords.length} XML files`);
      
      // Write all records to CSV
      console.log(`Writing ${allRecords.length} records to CSV...`);
      const csvWriter = createObjectCsvWriter({
        path: options.outputCsv,
        header: CSV_HEADERS
      });
      
      await csvWriter.writeRecords(allRecords);
      console.log(`CSV file created successfully at ${options.outputCsv}`);
      
    } catch (err) {
      console.error('Error processing XML files:', err);
    }
    
    console.timeEnd('Total processing time');
  }

  // Process a batch of files with a worker
  function processWithWorker(files, batchIndex) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { files, batchIndex, options }
      });
      
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  // Run the main function
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
// Worker thread code
else {
  const { files, batchIndex, options } = workerData;
  
  async function workerProcess() {
    const records = [];
    
    console.log(`Worker ${batchIndex}: Starting to process ${files.length} files`);
    
    for (let i = 0; i < files.length; i++) {
      try {
        const record = await processXmlFile(files[i]);
        if (record) {
          records.push(record);
        }
        
        // Log progress occasionally
        if ((i + 1) % options.logFrequency === 0 || i === files.length - 1) {
          console.log(`Worker ${batchIndex}: Processed ${i + 1}/${files.length} files`);
        }
      } catch (err) {
        console.error(`Worker ${batchIndex}: Error processing ${files[i]}:`, err.message);
      }
    }
    
    console.log(`Worker ${batchIndex}: Completed processing ${records.length} valid records`);
    parentPort.postMessage(records);
  }
  
  // Process a single XML file
  async function processXmlFile(xmlFilePath) {
    // Read and parse XML file
    const xmlContent = await fs.readFile(xmlFilePath, 'utf-8');
    const result = await parseStringPromise(xmlContent, { 
      explicitArray: false,
      mergeAttrs: true
    });
    
    // Extract path components
    const pathParts = xmlFilePath.split(path.sep);
    
    // Find city, year, month from path
    let city = '', year = '', month = '';
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === 'images' && i + 3 < pathParts.length) {
        city = pathParts[i + 1];
        year = pathParts[i + 2];
        month = pathParts[i + 3];
        break;
      }
    }
    
    try {
      // Extract data from XML structure
      const newsML = result.NewsML;
      if (!newsML) throw new Error('Invalid XML structure: NewsML not found');
      
      const newsItem = newsML.NewsItem;
      if (!newsItem) throw new Error('Invalid XML structure: NewsItem not found');
      
      const newsIdentifier = newsItem.Identification?.NewsIdentifier;
      if (!newsIdentifier) throw new Error('Invalid XML structure: NewsIdentifier not found');
      
      const newsItemId = newsIdentifier.NewsItemId || '';
      const dateId = newsIdentifier.DateId || '';
      const providerId = newsIdentifier.ProviderId || '';
      
      // Extract news management data
      const newsManagement = newsItem.NewsManagement || {};
      const status = newsManagement.Status?.FormalName || '';
      const urgency = newsManagement.Urgency?.FormalName || '';
      const creationDate = newsManagement.FirstCreated || '';
      const revisionDate = newsManagement.ThisRevisionCreated || '';
      
      // Find the main news component
      const mainComponent = findMainNewsComponent(newsItem.NewsComponent);
      if (!mainComponent) throw new Error('Main news component not found');
      
      // Extract comment data
      let commentData = '';
      if (mainComponent.Comment) {
        commentData = extractCData(mainComponent.Comment);
      }
      
      // Extract headline and other metadata
      let headline = '', byline = '', dateline = '', creditline = '', slugline = '', keywords = '';
      let edition = '', location = '', pageNumber = '', country = '', city_meta = '';
      let language = '', subject = '', processed = '', published = '';
      let imageWidth = '', imageHeight = '', imageSize = '', imageHref = '';
      
      if (mainComponent.NewsLines) {
        headline = extractCData(mainComponent.NewsLines.HeadLine);
        byline = extractCData(mainComponent.NewsLines.ByLine);
        dateline = extractCData(mainComponent.NewsLines.DateLine);
        creditline = extractCData(mainComponent.NewsLines.CreditLine);
        slugline = extractCData(mainComponent.NewsLines.SlugLine);
        
        // Extract keywords
        if (mainComponent.NewsLines.KeywordLine) {
          const keywordLines = Array.isArray(mainComponent.NewsLines.KeywordLine) 
            ? mainComponent.NewsLines.KeywordLine 
            : [mainComponent.NewsLines.KeywordLine];
          
          keywords = keywordLines
            .map(k => extractCData(k))
            .filter(Boolean)
            .join(', ');
        }
      }
      
      // Extract administrative metadata
      if (mainComponent.AdministrativeMetadata) {
        const adminMeta = mainComponent.AdministrativeMetadata;
        
        if (adminMeta.Property) {
          const props = Array.isArray(adminMeta.Property) 
            ? adminMeta.Property 
            : [adminMeta.Property];
          
          for (const prop of props) {
            if (prop.FormalName === 'Edition') edition = prop.Value || '';
            if (prop.FormalName === 'Location') location = prop.Value || '';
            if (prop.FormalName === 'PageNumber') pageNumber = prop.Value || '';
          }
        }
      }
      
      // Extract descriptive metadata
      if (mainComponent.DescriptiveMetadata) {
        const descMeta = mainComponent.DescriptiveMetadata;
        
        language = descMeta.Language?.FormalName || '';
        subject = descMeta.SubjectCode?.Subject?.FormalName || '';
        
        if (descMeta.Property) {
          const props = Array.isArray(descMeta.Property) 
            ? descMeta.Property 
            : [descMeta.Property];
          
          for (const prop of props) {
            if (prop.FormalName === 'Processed') processed = prop.Value || '';
            if (prop.FormalName === 'Published') published = prop.Value || '';
            
            if (prop.FormalName === 'Location') {
              if (prop.Property) {
                const locProps = Array.isArray(prop.Property) 
                  ? prop.Property 
                  : [prop.Property];
                
                for (const locProp of locProps) {
                  if (locProp.FormalName === 'Country') country = locProp.Value || '';
                  if (locProp.FormalName === 'City') city_meta = locProp.Value || '';
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
          : [mainComponent.ContentItem];
        
        for (const item of contentItems) {
          if (item.Href && item.Href.endsWith('.jpg') && !item.Href.includes('_th.jpg')) {
            imageHref = item.Href;
            
            if (item.Characteristics) {
              imageSize = item.Characteristics.SizeInBytes || '';
              
              if (item.Characteristics.Property) {
                const props = Array.isArray(item.Characteristics.Property) 
                  ? item.Characteristics.Property 
                  : [item.Characteristics.Property];
                
                for (const prop of props) {
                  if (prop.FormalName === 'width') imageWidth = prop.Value || '';
                  if (prop.FormalName === 'height') imageHeight = prop.Value || '';
                }
              }
            }
            break;
          }
        }
      }
      
      // Construct expected image path
      const expectedImageDir = path.join(
        path.dirname(path.dirname(xmlFilePath)), // go up from processed dir
        'media'
      );
      
      const imagePath = imageHref ? path.join(expectedImageDir, imageHref) : '';
      let imageExists = false;
      
      // Check if image exists
      if (imagePath) {
        try {
          await fs.access(imagePath);
          imageExists = true;
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
        imageExists: imageExists ? 'Yes' : 'No',
        creationDate,
        revisionDate,
        commentData
      };
    } catch (err) {
      if (options.verbose) {
        console.error(`Error extracting data from ${xmlFilePath}:`, err.message);
      }
      return null;
    }
  }

  // Helper function to find the main news component
  function findMainNewsComponent(newsComponent) {
    if (!newsComponent) return null;
    
    // If NewsComponent has Role with FormalName="PICTURE", it's what we want
    if (newsComponent.Role && newsComponent.Role.FormalName === 'PICTURE') {
      return newsComponent;
    }
    
    // Otherwise, check nested NewsComponent
    if (newsComponent.NewsComponent) {
      if (Array.isArray(newsComponent.NewsComponent)) {
        for (const comp of newsComponent.NewsComponent) {
          const found = findMainNewsComponent(comp);
          if (found) return found;
        }
      } else {
        return findMainNewsComponent(newsComponent.NewsComponent);
      }
    }
    
    return null;
  }

  // Helper function to extract CDATA content
  function extractCData(element) {
    if (!element) return '';
    if (typeof element === 'string') return element.trim();
    if (element._) return element._.trim();
    return '';
  }
  
  // Start worker processing
  workerProcess().catch(err => {
    console.error(`Worker error:`, err);
    process.exit(1);
  });
}
