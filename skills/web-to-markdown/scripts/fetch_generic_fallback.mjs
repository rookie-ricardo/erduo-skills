#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

puppeteer.use(StealthPlugin());
puppeteer.use(
  AnonymizeUAPlugin({
    customFn: () => CHROME_UA,
    stripHeadless: true
  })
);

function resolveChromeExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function fallbackExtract(doc) {
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '[class*="article"]',
    '[class*="content"]',
    '[class*="post"]',
    '[class*="entry"]'
  ];

  let bestNode = null;
  let bestScore = 0;

  for (const selector of selectors) {
    const nodes = doc.querySelectorAll(selector);
    for (const node of nodes) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const score = text.length;
      if (score > bestScore) {
        bestNode = node;
        bestScore = score;
      }
    }
  }

  if (!bestNode || bestScore < 180) {
    return null;
  }

  const title =
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.querySelector('title')?.textContent?.trim() ||
    '';

  return {
    title,
    byline: '',
    excerpt: (bestNode.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    content: bestNode.innerHTML
  };
}

function sanitizeHtml(inputHtml, pageUrl) {
  const dom = new JSDOM(inputHtml, { url: pageUrl });
  const doc = dom.window.document;

  const noiseSelectors = [
    'script',
    'style',
    'noscript',
    'iframe',
    'header',
    'footer',
    'nav',
    '.advertisement',
    '.ad',
    '[class*="ad-"]',
    '[id*="ad-"]'
  ];

  for (const selector of noiseSelectors) {
    doc.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const reader = new Readability(doc, {
    keepClasses: false,
    charThreshold: 160,
    nbTopCandidates: 10
  });

  const parsed = reader.parse();
  if (parsed && parsed.content) {
    return parsed;
  }

  const fallback = fallbackExtract(doc);
  if (fallback) {
    return fallback;
  }

  throw new Error('Failed to extract readable content from HTML');
}

function htmlToMarkdown(title, byline, excerpt, htmlContent) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_'
  });

  const bodyMarkdown = turndown.turndown(htmlContent).trim();
  const lines = [];

  if (title) {
    lines.push(`# ${title.trim()}`);
    lines.push('');
  }

  if (byline) {
    lines.push(`> Author: ${byline.trim()}`);
    lines.push('');
  }

  if (excerpt) {
    lines.push(`> ${excerpt.trim()}`);
    lines.push('');
  }

  lines.push(bodyMarkdown);
  return lines.join('\n').trim();
}

function isLikelyShell(markdown) {
  const text = (markdown || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (text.length < 250) {
    return true;
  }

  const signals = [
    'enable javascript',
    'access denied',
    'robot check',
    'please verify you are human',
    'continue to read',
    'log in to continue'
  ];

  return signals.some((signal) => text.includes(signal));
}

async function fetchHtmlDirect(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': CHROME_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Direct fetch failed (${response.status} ${response.statusText})`);
    }
    if (!text.trim()) {
      throw new Error('Direct fetch returned empty html');
    }

    return {
      resolvedUrl: response.url || url,
      html: text
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Direct fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 900;
      const timer = setInterval(() => {
        const max = Math.max(
          document.body?.scrollHeight || 0,
          document.documentElement?.scrollHeight || 0
        );
        window.scrollBy(0, distance);
        total += distance;
        if (total >= max) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
}

async function fetchByBrowser(url, timeoutMs) {
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

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    await page.setViewport({ width: 1440, height: 2200, deviceScaleFactor: 2 });
    await page.setExtraHTTPHeaders({
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    await sleep(900);
    await autoScroll(page);
    await sleep(500);

    const html = await page.content();
    return {
      resolvedUrl: page.url(),
      html
    };
  } finally {
    await browser.close();
  }
}

export async function fetchGenericToMarkdown(rawUrl, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;
  const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  let directError = null;
  try {
    const directResult = await fetchHtmlDirect(normalized, timeoutMs);
    const readable = sanitizeHtml(directResult.html, directResult.resolvedUrl);
    const markdown = htmlToMarkdown(
      readable.title,
      readable.byline,
      readable.excerpt,
      readable.content
    );

    if (isLikelyShell(markdown)) {
      throw new Error('Direct fetch returned likely shell/teaser content');
    }

    return {
      source: 'direct-readability',
      strategy: 'generic-http-fallback',
      requestedUrl: rawUrl,
      resolvedUrl: directResult.resolvedUrl,
      title: readable.title || '',
      markdown
    };
  } catch (error) {
    directError = error instanceof Error ? error.message : String(error);
  }

  const browserResult = await fetchByBrowser(normalized, timeoutMs);
  const readable = sanitizeHtml(browserResult.html, browserResult.resolvedUrl);
  const markdown = htmlToMarkdown(
    readable.title,
    readable.byline,
    readable.excerpt,
    readable.content
  );

  if (isLikelyShell(markdown)) {
    throw new Error(`Generic browser fallback returned likely shell content. HTTP error: ${directError || ''}`);
  }

  return {
    source: 'browser-readability',
    strategy: 'generic-browser-fallback',
    requestedUrl: rawUrl,
    resolvedUrl: browserResult.resolvedUrl,
    title: readable.title || '',
    markdown,
    fallbackReason: directError || ''
  };
}

function parseArgs(argv) {
  const args = {
    url: '',
    timeoutMs: 30000,
    json: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--timeout-ms') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--timeout-ms must be a positive number');
      }
      args.timeoutMs = value;
      i += 1;
      continue;
    }

    if (!args.url) {
      args.url = token;
      continue;
    }

    throw new Error(`Unexpected argument: ${token}`);
  }

  if (!args.url) {
    throw new Error('Usage: node scripts/fetch_generic_fallback.mjs <url> [--timeout-ms 30000] [--json]');
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const result = await fetchGenericToMarkdown(args.url, {
      timeoutMs: args.timeoutMs
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${result.markdown}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`fetch_generic_fallback failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
