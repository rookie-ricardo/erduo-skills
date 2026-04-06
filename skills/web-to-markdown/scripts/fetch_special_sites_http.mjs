#!/usr/bin/env node

import process from 'node:process';
import { createCuimpHttp } from 'cuimp';

const SPECIAL_HOSTS = [
  'mp.weixin.qq.com',
  'weixin.qq.com',
  'zhuanlan.zhihu.com',
  'www.zhihu.com',
  'zhihu.com',
  'feishu.cn',
  'www.feishu.cn',
  'larkoffice.com',
  'www.larkoffice.com'
];

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const cuimpClient = createCuimpHttp({
  descriptor: { browser: 'chrome', version: '136' },
  autoDownload: true,
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  }
});

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
    throw new Error(`Unsupported host for special HTTP fetch: ${parsed.hostname}`);
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
    throw new Error('Usage: node scripts/fetch_special_sites_http.mjs <url> [--timeout-ms 30000] [--json]');
  }

  return args;
}

function buildHeaders(url) {
  const parsed = new URL(url);
  const origin = `${parsed.protocol}//${parsed.host}`;
  return {
    'user-agent': CHROME_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'upgrade-insecure-requests': '1',
    referer: origin
  };
}

export async function fetchSpecialSiteHtml(rawUrl, options = {}) {
  const url = normalizeUrl(rawUrl);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;

  const response = await cuimpClient.request({
    url,
    method: 'GET',
    timeout: timeoutMs,
    maxRedirects: 20,
    headers: buildHeaders(url)
  });

  const resolvedUrl = response.request?.url || url;
  const statusCode = Number(response.status || 0);
  const contentType = response.headers?.['content-type'] || response.headers?.['Content-Type'] || '';
  const html =
    typeof response.data === 'string'
      ? response.data
      : response.rawBody
        ? response.rawBody.toString('utf-8')
        : '';

  return {
    source: 'cuimp',
    strategy: 'special-http-fetch',
    requestedUrl: rawUrl,
    resolvedUrl,
    statusCode,
    contentType,
    html
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const result = await fetchSpecialSiteHtml(args.url, {
      timeoutMs: args.timeoutMs
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${result.html}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`fetch_special_sites_http failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
