#!/usr/bin/env node

import process from 'node:process';
import fs from 'node:fs';
import { fetchSpecialSiteHtml } from './fetch_special_sites_http.mjs';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const SPECIAL_HOSTS = [
  'mp.weixin.qq.com',
  'weixin.qq.com',
  'zhuanlan.zhihu.com',
  'www.zhihu.com',
  'zhihu.com',
  'feishu.cn',
  'www.feishu.cn',
  'feishu.cn/docs',
  'larkoffice.com',
  'www.larkoffice.com'
];

puppeteer.use(StealthPlugin());
puppeteer.use(
  AnonymizeUAPlugin({
    customFn: () => CHROME_UA,
    stripHeadless: true
  })
);

function isSpecialHost(hostname) {
  return SPECIAL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required');
  }

  const candidate = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  const parsed = new URL(candidate);
  if (!isSpecialHost(parsed.hostname)) {
    throw new Error(`Unsupported host for special fetch script: ${parsed.hostname}`);
  }

  return parsed.toString();
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
    throw new Error('Usage: node scripts/fetch_special_sites.mjs <url> [--timeout-ms 30000] [--json]');
  }

  return args;
}

async function dismissKnownOverlays(page) {
  const selectors = [
    // Zhihu login modal and overlays.
    '.signFlowModal',
    '.Modal-wrapper',
    '.Modal-backdrop',
    '.signFlowDialog',
    '.css-1ynzxqw',
    // Wechat QR prompts / overlays (best effort).
    '.js_wechat_qrcode',
    '.wx_tips',
    '.rich_media_global_msg',
    // Feishu modals.
    '[data-testid="modal-mask"]',
    '[class*="modal"]'
  ];

  await page.evaluate((overlaySelectors) => {
    for (const selector of overlaySelectors) {
      document.querySelectorAll(selector).forEach((node) => {
        try {
          node.remove();
        } catch (_) {
          // Ignore detached nodes.
        }
      });
    }

    // Restore page scroll when it is blocked by login walls.
    const html = document.documentElement;
    const body = document.body;
    if (html) {
      html.style.overflow = 'auto';
      html.style.position = 'static';
    }
    if (body) {
      body.style.overflow = 'auto';
      body.style.position = 'static';
      body.style.height = 'auto';
    }
  }, selectors);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 800;
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

function sanitizeHtml(inputHtml, pageUrl) {
  const dom = new JSDOM(inputHtml, { url: pageUrl });
  const doc = dom.window.document;

  // Remove common noisy nodes before Readability.
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
    '[id*="ad-"]',
    '.Modal-wrapper',
    '.Modal-backdrop',
    '.signFlowModal'
  ];

  for (const selector of noiseSelectors) {
    doc.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const reader = new Readability(doc, {
    keepClasses: false,
    charThreshold: 120,
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

  throw new Error('Failed to extract readable content with Mozilla Readability');
}

function fallbackExtract(doc) {
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.ql-editor',
    '.docx-editor',
    '[class*="doc-content"]',
    '[class*="article-content"]',
    '[class*="Post-RichText"]',
    '[class*="content"]'
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

  if (!bestNode || bestScore < 120) {
    return null;
  }

  const title =
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.querySelector('title')?.textContent?.trim() ||
    '';
  const excerpt = (bestNode.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);

  return {
    title,
    byline: '',
    excerpt,
    content: bestNode.innerHTML
  };
}

function htmlToMarkdown(title, byline, excerpt, htmlContent) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_'
  });

  turndown.addRule('removeEmptyLinks', {
    filter: 'a',
    replacement(content, node) {
      const href = node.getAttribute('href');
      if (!href) {
        return content;
      }
      const text = content.trim() || href;
      return `[${text}](${href})`;
    }
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

function detectBlockedContent(pageUrl, title, markdown) {
  const hostname = new URL(pageUrl).hostname.toLowerCase();
  const normalizedTitle = (title || '').toLowerCase();
  const normalizedBody = (markdown || '').toLowerCase();

  if (hostname.endsWith('zhihu.com')) {
    const blockedSignals = [
      '你似乎来到了没有知识存在的荒原',
      'go to home',
      '去往首页',
      'page error'
    ];

    const matched = blockedSignals.some(
      (signal) => normalizedTitle.includes(signal.toLowerCase()) || normalizedBody.includes(signal.toLowerCase())
    );

    if (matched) {
      throw new Error('Zhihu returned an error/blocked page instead of article content');
    }
  }

  if (hostname.endsWith('feishu.cn') || hostname.endsWith('larkoffice.com')) {
    if (normalizedTitle.includes('飞书云文档') && normalizedBody.length < 320) {
      throw new Error('Feishu returned shell/limited page instead of full document content');
    }
  }
}

function detectShellContent(pageUrl, title, markdown) {
  const hostname = new URL(pageUrl).hostname.toLowerCase();
  const normalizedTitle = (title || '').toLowerCase().trim();
  const normalizedBody = (markdown || '').toLowerCase();
  const contentLength = normalizedBody.replace(/\s+/g, '').length;

  if (hostname.endsWith('zhihu.com')) {
    const shellSignals = [
      '知乎，让每一次点击都充满意义',
      '欢迎来到知乎',
      '下载知乎app',
      '打开知乎'
    ];
    if (shellSignals.some((signal) => normalizedBody.includes(signal.toLowerCase()))) {
      return 'Zhihu shell page';
    }
    if ((normalizedTitle === '' || normalizedTitle === '知乎') && contentLength < 600) {
      return 'Zhihu content too short';
    }
  }

  if (hostname.endsWith('feishu.cn') || hostname.endsWith('larkoffice.com')) {
    if (normalizedTitle === 'docs' && contentLength < 900) {
      return 'Feishu docs shell page';
    }
    if (normalizedBody.includes('最近修改') && contentLength < 1000) {
      return 'Feishu metadata-only page';
    }
  }

  if (hostname.endsWith('weixin.qq.com')) {
    if (normalizedBody.includes('继续滑动看下一个') && contentLength < 900) {
      return 'WeChat teaser/shell page';
    }
  }

  return '';
}

async function waitForLikelyContent(page, targetUrl) {
  const hostname = new URL(targetUrl).hostname.toLowerCase();
  let selectors = [];

  if (hostname.endsWith('zhihu.com')) {
    selectors = ['article', '.Post-RichTextContainer', '[class*="RichText"]'];
  } else if (hostname.endsWith('feishu.cn') || hostname.endsWith('larkoffice.com')) {
    selectors = ['article', 'main', '.ql-editor', '[class*="doc-content"]'];
  } else if (hostname.endsWith('weixin.qq.com')) {
    selectors = ['#js_content', '.rich_media_content'];
  }

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 4500 });
      return;
    } catch {
      // Try next selector.
    }
  }
}

export async function fetchSpecialSiteToMarkdown(rawUrl, options = {}) {
  const url = normalizeUrl(rawUrl);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;

  let httpFetcherError = null;
  try {
    const httpResult = await fetchSpecialSiteHtml(url, { timeoutMs });
    const readable = sanitizeHtml(httpResult.html, httpResult.resolvedUrl || url);
    const markdown = htmlToMarkdown(
      readable.title,
      readable.byline,
      readable.excerpt,
      readable.content
    );
    detectBlockedContent(httpResult.resolvedUrl || url, readable.title, markdown);
    const shellReason = detectShellContent(httpResult.resolvedUrl || url, readable.title, markdown);
    if (shellReason) {
      throw new Error(shellReason);
    }

    return {
      source: 'curl-cffi+readability',
      strategy: 'special-http-fetch',
      requestedUrl: rawUrl,
      resolvedUrl: httpResult.resolvedUrl || url,
      title: readable.title || '',
      byline: readable.byline || '',
      excerpt: readable.excerpt || '',
      markdown
    };
  } catch (error) {
    httpFetcherError = error instanceof Error ? error.message : String(error);
  }

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
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'sec-ch-ua': '"Chromium";v="123", "Google Chrome";v="123", "Not:A-Brand";v="8"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"'
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    await waitForLikelyContent(page, url);
    await sleep(1200);
    await dismissKnownOverlays(page);
    await autoScroll(page);
    await sleep(500);

    const html = await page.content();
    const readable = sanitizeHtml(html, url);
    const markdown = htmlToMarkdown(
      readable.title,
      readable.byline,
      readable.excerpt,
      readable.content
    );
    detectBlockedContent(page.url(), readable.title, markdown);
    const shellReason = detectShellContent(page.url(), readable.title, markdown);
    if (shellReason) {
      throw new Error(`Browser fallback still returned shell content: ${shellReason}`);
    }

    return {
      source: 'browser-readability',
      strategy: 'special-browser-fetch-fallback',
      requestedUrl: rawUrl,
      resolvedUrl: page.url(),
      title: readable.title || '',
      byline: readable.byline || '',
      excerpt: readable.excerpt || '',
      markdown,
      fallbackReason: httpFetcherError || ''
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const result = await fetchSpecialSiteToMarkdown(args.url, {
      timeoutMs: args.timeoutMs
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${result.markdown}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`fetch_special_sites failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
