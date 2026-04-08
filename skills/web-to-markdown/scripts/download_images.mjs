#!/usr/bin/env node

/**
 * Image Download Utility
 * Downloads images from markdown content and replaces URLs with local paths
 */

import process from 'node:process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';
const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

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

let cuimpImageClientPromise = null;
let puppeteerConfigured = false;

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

function resolveConcurrencyLimit(value) {
  const concurrency = Number(value);
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error('--concurrency must be a positive number');
  }

  return Math.floor(concurrency);
}

function resolveReferer(imageUrl, pageUrl) {
  if (pageUrl) {
    try {
      return new URL(pageUrl).toString();
    } catch {
      // Fall through to image origin fallback.
    }
  }

  return `${new URL(imageUrl).origin}/`;
}

function buildImageHeaders(imageUrl, pageUrl) {
  return {
    'user-agent': DEFAULT_USER_AGENT,
    accept: IMAGE_ACCEPT,
    'accept-language': DEFAULT_ACCEPT_LANGUAGE,
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    referer: resolveReferer(imageUrl, pageUrl)
  };
}

function getHeader(headers, name) {
  return headers?.[name] || headers?.[name.toLowerCase()] || headers?.[name.toUpperCase()] || '';
}

function ensureImageContentType(contentType) {
  if (!contentType.startsWith('image/')) {
    throw new Error(`Not an image: ${contentType || 'unknown content-type'}`);
  }
}

function ensureImageBufferSize(buffer) {
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('Downloaded image too large (>10MB)');
  }
}

function getRawBodyBuffer(response) {
  if (Buffer.isBuffer(response?.rawBody)) {
    return response.rawBody;
  }

  if (response?.rawBody) {
    return Buffer.from(response.rawBody);
  }

  if (Buffer.isBuffer(response?.data)) {
    return response.data;
  }

  if (response?.data instanceof Uint8Array) {
    return Buffer.from(response.data);
  }

  return Buffer.alloc(0);
}

async function getCuimpImageClient() {
  if (!cuimpImageClientPromise) {
    cuimpImageClientPromise = import('cuimp').then(({ createCuimpHttp }) =>
      createCuimpHttp({
        descriptor: { browser: 'chrome', version: '136' },
        autoDownload: true,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {}
        }
      })
    );
  }

  return cuimpImageClientPromise;
}

async function primeCuimpSession(pageUrl, timeoutMs) {
  if (!pageUrl) {
    return;
  }

  const cuimpClient = await getCuimpImageClient();
  await cuimpClient.request({
    url: pageUrl,
    method: 'GET',
    timeout: timeoutMs,
    maxRedirects: 20,
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': DEFAULT_ACCEPT_LANGUAGE,
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      referer: pageUrl
    }
  });
}

async function getBrowserModules() {
  const [puppeteerModule, stealthModule, anonymizeModule] = await Promise.all([
    import('puppeteer-extra'),
    import('puppeteer-extra-plugin-stealth'),
    import('puppeteer-extra-plugin-anonymize-ua')
  ]);

  const puppeteer = puppeteerModule.default;
  const StealthPlugin = stealthModule.default;
  const AnonymizeUAPlugin = anonymizeModule.default;

  if (!puppeteerConfigured) {
    puppeteer.use(StealthPlugin());
    puppeteer.use(
      AnonymizeUAPlugin({
        customFn: () => DEFAULT_USER_AGENT,
        stripHeadless: true
      })
    );
    puppeteerConfigured = true;
  }

  return puppeteer;
}

function resolveChromeExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

async function createBrowserFallbackSession(pageUrl, timeoutMs) {
  const puppeteer = await getBrowserModules();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChromeExecutablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await browser.newPage();
  await page.setUserAgent(DEFAULT_USER_AGENT);
  await page.setViewport({ width: 1440, height: 2200, deviceScaleFactor: 2 });
  await page.setExtraHTTPHeaders({
    'accept-language': DEFAULT_ACCEPT_LANGUAGE,
    'sec-ch-ua': '"Chromium";v="123", "Google Chrome";v="123", "Not:A-Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"'
  });

  if (pageUrl) {
    await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });
  }

  return { browser, page };
}

async function downloadImageWithCuimp(imageUrl, outputPath, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const cuimpClient = await getCuimpImageClient();
  const response = await cuimpClient.request({
    url: imageUrl,
    method: 'GET',
    timeout: timeoutMs,
    maxRedirects: 20,
    headers: buildImageHeaders(imageUrl, options.pageUrl)
  });

  const statusCode = Number(response.status || 0);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode || 'request failed'}`);
  }

  const contentType = getHeader(response.headers, 'content-type');
  ensureImageContentType(contentType);

  const contentLength = getHeader(response.headers, 'content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
    throw new Error('Image too large (>10MB)');
  }

  const buffer = getRawBodyBuffer(response);
  if (!buffer.length) {
    throw new Error('Image response body was empty');
  }

  ensureImageBufferSize(buffer);
  await fs.writeFile(outputPath, buffer);
}

async function downloadImageWithBrowser(imageUrl, outputPath, options = {}, browserSession) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const session = browserSession || (await createBrowserFallbackSession(options.pageUrl, timeoutMs));

  await session.page.setExtraHTTPHeaders({
    ...buildImageHeaders(imageUrl, options.pageUrl),
    'sec-ch-ua': '"Chromium";v="123", "Google Chrome";v="123", "Not:A-Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"'
  });

  const response = await session.page.goto(imageUrl, {
    waitUntil: 'networkidle2',
    timeout: timeoutMs
  });

  if (!response) {
    throw new Error('Browser fallback returned no response');
  }

  const statusCode = response.status();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode}`);
  }

  const headers = response.headers();
  const contentType = getHeader(headers, 'content-type');
  ensureImageContentType(contentType);

  const contentLength = getHeader(headers, 'content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
    throw new Error('Image too large (>10MB)');
  }

  const buffer = await response.buffer();
  if (!buffer.length) {
    throw new Error('Browser fallback image body was empty');
  }

  ensureImageBufferSize(buffer);
  await fs.writeFile(outputPath, buffer);
}

/**
 * Download a single image and return the local filename
 * @param {string} imageUrl - URL of the image to download
 * @param {string} outputDir - Directory to save the image
 * @param {object} options - Download options
 * @returns {Promise<{success: boolean, url: string, filename: string|null, error: string|null}>}
 */
async function downloadImage(imageUrl, outputDir, options = {}) {
  const filename = generateFilename(imageUrl);
  const outputPath = path.join(outputDir, filename);

  // Skip if already exists
  try {
    await fs.access(outputPath);
    return { success: true, url: imageUrl, filename, error: null };
  } catch {
    // File doesn't exist, proceed with download
  }

  try {
    await fs.mkdir(outputDir, { recursive: true });

    await downloadImageWithCuimp(imageUrl, outputPath, options);

    return { success: true, url: imageUrl, filename, error: null };
  } catch (error) {
    return { success: false, url: imageUrl, filename, error: error.message };
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
  if (urlToFilename.size === 0) return markdown;

  const markdownReplaced = markdown.replace(MD_IMG_REGEX, (match, alt, url) => {
    if (!urlToFilename.has(url)) {
      return match;
    }

    return `![${alt || ''}](${urlToFilename.get(url)})`;
  });

  return markdownReplaced.replace(HTML_IMG_REGEX, (match, url) => {
    if (!urlToFilename.has(url)) {
      return match;
    }

    return match.replace(url, urlToFilename.get(url));
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
  const concurrencyLimit = resolveConcurrencyLimit(options.concurrency ?? 5);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  if (imageUrls.length === 0) {
    return { markdown, downloadedImages: [], failedImages: [], localPath: outputDir };
  }

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  try {
    await primeCuimpSession(options.pageUrl, timeoutMs);
  } catch {
    // Session priming is best-effort. Individual image downloads still attempt cuimp first,
    // then browser fallback if needed.
  }

  const urlToFilename = new Map();
  const downloadedImages = [];
  const failedImages = [];
  let browserSession = null;

  try {
    for (let i = 0; i < imageUrls.length; i += concurrencyLimit) {
      const batch = imageUrls.slice(i, i + concurrencyLimit);
      const results = await Promise.allSettled(
        batch.map((url) => downloadImage(url, outputDir, options))
      );

      for (const [index, result] of results.entries()) {
        const imageUrl = batch[index];

        if (result.status === 'fulfilled' && result.value.success) {
          urlToFilename.set(result.value.url, result.value.filename);
          downloadedImages.push({ url: result.value.url, filename: result.value.filename });
          continue;
        }

        const cuimpError =
          result.status === 'rejected'
            ? result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
            : result.value.error || 'Unknown cuimp download failure';

        const filename = generateFilename(imageUrl);
        const outputPath = path.join(outputDir, filename);

        try {
          if (!browserSession) {
            browserSession = await createBrowserFallbackSession(
              options.pageUrl,
              timeoutMs
            );
          }

          await downloadImageWithBrowser(imageUrl, outputPath, options, browserSession);
          urlToFilename.set(imageUrl, filename);
          downloadedImages.push({ url: imageUrl, filename });
        } catch (browserError) {
          const browserMessage = browserError instanceof Error ? browserError.message : String(browserError);
          failedImages.push({
            url: imageUrl,
            error: `cuimp failed: ${cuimpError}; browser fallback failed: ${browserMessage}`
          });
        }
      }
    }
  } finally {
    if (browserSession) {
      await browserSession.browser.close();
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
    pageUrl: '',
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

    if (token === '--page-url') {
      args.pageUrl = argv[i + 1] || '';
      i += 1;
      continue;
    }
    
    if (token === '--timeout-ms') {
      args.timeoutMs = Number(argv[i + 1]) || DEFAULT_TIMEOUT_MS;
      i += 1;
      continue;
    }
    
    if (token === '--concurrency') {
      args.concurrency = resolveConcurrencyLimit(argv[i + 1]);
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
    throw new Error('Usage: node scripts/download_images.mjs <markdown_or_file> [output_dir] [--output <dir>] [--page-url <url>] [--timeout-ms 15000] [--concurrency 5] [--json]');
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
      pageUrl: args.pageUrl,
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
