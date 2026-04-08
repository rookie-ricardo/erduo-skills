#!/usr/bin/env node

/**
 * Image Download Utility
 * Downloads images from markdown content and replaces URLs with local paths
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Regular expression to match markdown image syntax: ![alt](url)
 * Captures: alt text (group 1), URL (group 2)
 */
const MD_IMG_REGEX = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Regular expression to match HTML img tags: <img src="url" ...>
 * Captures: src attribute (group 1)
 */
const HTML_IMG_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

/**
 * Default user agent for image downloads
 */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

/**
 * Maximum image size (10MB) to prevent memory issues
 */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * Default timeout for image downloads (15 seconds)
 */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Supported image extensions
 */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'
]);

/**
 * Generate a unique filename from URL to avoid collisions
 * @param {string} url - Image URL
 * @returns {string} Unique filename with extension
 */
function generateFilename(url) {
  try {
    const urlObj = new URL(url);
    let ext = path.extname(urlObj.pathname).toLowerCase();
    
    // Default to .jpg if no extension found
    if (!ext || !IMAGE_EXTENSIONS.has(ext)) {
      ext = '.jpg';
    }
    
    // Generate a short hash from URL to ensure uniqueness
    const hash = createHash('md5').update(url).digest('hex').slice(0, 12);
    
    return `${hash}${ext}`;
  } catch {
    // Fallback: generate random filename
    const hash = createHash('md5').update(url).digest('hex').slice(0, 12);
    return `${hash}.jpg`;
  }
}

/**
 * Check if URL is a valid image URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isValidImageUrl(url) {
  try {
    const urlObj = new URL(url);
    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a single image and return the local filename
 * @param {string} imageUrl - URL of the image to download
 * @param {string} outputDir - Directory to save the image
 * @param {object} options - Download options
 * @returns {Promise<{success: boolean, url: string, filename: string|null, error: string|null}>}
 */
async function downloadImage(imageUrl, outputDir, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const filename = generateFilename(imageUrl);
  const outputPath = path.join(outputDir, filename);

  // Skip if already exists
  try {
    await fs.access(outputPath);
    return { success: true, url: imageUrl, filename, error: null };
  } catch {
    // File doesn't exist, proceed with download
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        'accept': 'image/*,*/*;q=0.1',
        'referer': `${new URL(imageUrl).origin}/`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return { success: false, url: imageUrl, filename, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return { success: false, url: imageUrl, filename, error: `Not an image: ${contentType}` };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
      return { success: false, url: imageUrl, filename, error: 'Image too large (>10MB)' };
    }

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Download with size check
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_SIZE) {
      return { success: false, url: imageUrl, filename, error: 'Downloaded image too large (>10MB)' };
    }

    await fs.writeFile(outputPath, Buffer.from(buffer));

    return { success: true, url: imageUrl, filename, error: null };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, url: imageUrl, filename, error: `Timeout after ${timeoutMs}ms` };
    }
    return { success: false, url: imageUrl, filename, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract all image URLs from markdown content
 * @param {string} markdown - Markdown content
 * @returns {string[]} Array of unique image URLs
 */
function extractImageUrls(markdown) {
  const urls = new Set();

  // Match markdown images: ![alt](url)
  for (const match of markdown.matchAll(MD_IMG_REGEX)) {
    const url = match[2].trim();
    if (isValidImageUrl(url)) {
      urls.add(url);
    }
  }

  // Match HTML img tags: <img src="url" ...>
  for (const match of markdown.matchAll(HTML_IMG_REGEX)) {
    const url = match[1].trim();
    if (isValidImageUrl(url)) {
      urls.add(url);
    }
  }

  return Array.from(urls);
}

/**
 * Replace image URLs with local paths in markdown
 * @param {string} markdown - Original markdown content
 * @param {Map<string, string>} urlToFilename - Map of URL to downloaded filename
 * @returns {string} Modified markdown with local paths
 */
function replaceImageUrls(markdown, urlToFilename) {
  // Pre-compile regex patterns for all URLs at once using alternation
  if (urlToFilename.size === 0) return markdown;

  // Build a single regex with all URLs as alternatives
  const escapedUrls = [...urlToFilename.keys()].map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const combinedRegex = new RegExp(
    `${MD_IMG_REGEX.source}|${HTML_IMG_REGEX.source.replace('["\']', '["\']')}`,
    'g'
  );

  return markdown.replace(combinedRegex, (match, ...groups) => {
    // Group indices: MD_IMG: 1=alt, 2=url; HTML_IMG: 3=before src, 4=url, 5=after src
    const mdAlt = groups[0];
    const mdUrl = groups[1];
    const htmlBefore = groups[3];
    const htmlUrl = groups[4];
    const htmlAfter = groups[5];

    if (mdUrl !== undefined && urlToFilename.has(mdUrl)) {
      return `![${mdAlt || ''}](${urlToFilename.get(mdUrl)})`;
    }
    if (htmlUrl !== undefined && urlToFilename.has(htmlUrl)) {
      return `${htmlBefore}${urlToFilename.get(htmlUrl)}${htmlAfter}`;
    }
    return match; // No replacement found
  });
}

/**
 * Download images and replace URLs with local paths
 * @param {string} markdown - Markdown content containing image URLs
 * @param {string} outputDir - Directory to save downloaded images
 * @param {object} options - Download options
 * @returns {Promise<{markdown: string, downloadedImages: Array, failedImages: Array, localPath: string}>}
 */
export async function downloadImagesAndReplace(markdown, outputDir, options = {}) {
  const imageUrls = extractImageUrls(markdown);

  if (imageUrls.length === 0) {
    return { markdown, downloadedImages: [], failedImages: [], localPath: outputDir };
  }

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const urlToFilename = new Map();
  const downloadedImages = [];
  const failedImages = [];

  // Download images in parallel with concurrency limit using Promise.allSettled
  const concurrencyLimit = options.concurrency || 5;

  for (let i = 0; i < imageUrls.length; i += concurrencyLimit) {
    const batch = imageUrls.slice(i, i + concurrencyLimit);
    const results = await Promise.allSettled(
      batch.map(url => downloadImage(url, outputDir, options))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        urlToFilename.set(result.value.url, result.value.filename);
        downloadedImages.push({ url: result.value.url, filename: result.value.filename });
      } else {
        const err = result.status === 'rejected' ? result.reason : result.value;
        failedImages.push({ url: err.url || err.message, error: err.error || String(err) });
      }
    }
  }

  const modifiedMarkdown = replaceImageUrls(markdown, urlToFilename);

  return {
    markdown: modifiedMarkdown,
    downloadedImages,
    failedImages,
    localPath: outputDir
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(argv) {
  const args = {
    markdown: '',
    outputDir: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    concurrency: 5,
    json: false
  };
  
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    
    if (token === '--json') {
      args.json = true;
      continue;
    }
    
    if (token === '--output' || token === '-o') {
      args.outputDir = argv[i + 1] || '';
      i += 1;
      continue;
    }
    
    if (token === '--timeout-ms') {
      args.timeoutMs = Number(argv[i + 1]) || DEFAULT_TIMEOUT_MS;
      i += 1;
      continue;
    }
    
    if (token === '--concurrency') {
      args.concurrency = Number(argv[i + 1]) || 5;
      i += 1;
      continue;
    }
    
    // First non-flag argument is markdown or file path
    if (!args.markdown) {
      args.markdown = token;
      continue;
    }
    
    // Second non-flag argument is output directory
    if (!args.outputDir) {
      args.outputDir = token;
      continue;
    }
  }
  
  if (!args.markdown) {
    throw new Error('Usage: node scripts/download_images.mjs <markdown_or_file> [output_dir] [--output <dir>] [--timeout-ms 15000] [--concurrency 5] [--json]');
  }
  
  if (!args.outputDir) {
    args.outputDir = './images';
  }
  
  return args;
}

/**
 * Main function for CLI usage
 */
async function main() {
  try {
    const args = parseArgs(process.argv);

    let markdown = args.markdown;

    // Check if input is a file path
    try {
      await fs.access(args.markdown);
      markdown = await fs.readFile(args.markdown, 'utf-8');
    } catch {
      // Not a file, use as raw markdown content
    }

    const result = await downloadImagesAndReplace(markdown, args.outputDir, {
      timeoutMs: args.timeoutMs,
      concurrency: args.concurrency
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    // Print summary
    if (result.downloadedImages.length > 0) {
      process.stdout.write(`Downloaded ${result.downloadedImages.length} image(s) to ${result.localPath}\n`);
    }
    if (result.failedImages.length > 0) {
      process.stderr.write(`Failed to download ${result.failedImages.length} image(s)\n`);
      for (const img of result.failedImages) {
        process.stderr.write(`  - ${img.url}: ${img.error}\n`);
      }
    }

    // Output modified markdown
    process.stdout.write('\n--- Modified Markdown ---\n');
    process.stdout.write(result.markdown);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`download_images failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}