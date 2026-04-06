#!/usr/bin/env node

import process from 'node:process';

const R_JINA_BASE = 'https://r.jina.ai/';
const DEFUDDLE_BASE = 'https://defuddle.md/';

const X_HOSTS = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'];
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
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

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

function parseArgs(argv) {
  const args = {
    url: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
    throw new Error('Usage: node scripts/url_to_markdown.mjs <url> [--json] [--timeout-ms 30000]');
  }

  return args;
}

function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL is required');
  }

  const trimmed = rawUrl.trim();
  const defuddleDirectPrefix = `${DEFUDDLE_BASE}http`;
  if (trimmed.toLowerCase().startsWith(defuddleDirectPrefix)) {
    const embedded = trimmed.slice(DEFUDDLE_BASE.length);
    try {
      return new URL(embedded);
    } catch {
      throw new Error(`Invalid defuddle-embedded URL: ${rawUrl}`);
    }
  }

  const rJinaDirectPrefix = `${R_JINA_BASE}http`;
  if (trimmed.toLowerCase().startsWith(rJinaDirectPrefix)) {
    const embedded = trimmed.slice(R_JINA_BASE.length);
    try {
      return new URL(embedded);
    } catch {
      throw new Error(`Invalid r.jina.ai-embedded URL: ${rawUrl}`);
    }
  }

  const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(prefixed);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
}

function isInHosts(hostname, hostList) {
  return hostList.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function pickStrategy(urlObj) {
  const host = urlObj.hostname.toLowerCase();

  if (isInHosts(host, SPECIAL_HOSTS)) {
    return 'special-browser-fetch';
  }

  if (isInHosts(host, YOUTUBE_HOSTS)) {
    return 'defuddle';
  }

  if (isInHosts(host, X_HOSTS)) {
    return 'r-jina';
  }

  return 'r-jina';
}

function buildProxyUrl(base, targetUrl) {
  return `${base}${targetUrl}`;
}

async function fetchMarkdownFromProxy(proxyUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Proxy request failed (${response.status} ${response.statusText})`);
    }

    const text = (await response.text()).trim();
    if (!text) {
      throw new Error('Proxy returned empty content');
    }

    return {
      markdown: text,
      contentType: response.headers.get('content-type') || ''
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function urlToMarkdown(rawUrl, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const normalized = normalizeUrl(rawUrl);
  const normalizedUrl = normalized.toString();
  const strategy = pickStrategy(normalized);

  if (strategy === 'special-browser-fetch') {
    let fetchSpecialSiteToMarkdown;
    try {
      ({ fetchSpecialSiteToMarkdown } = await import('./fetch_special_sites.mjs'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Special-site dependencies are missing. Run 'npm install' in the skill folder first. Details: ${reason}`
      );
    }

    const result = await fetchSpecialSiteToMarkdown(normalizedUrl, { timeoutMs });
    return {
      source: result.source,
      strategy: result.strategy || strategy,
      proxyUrl: '',
      requestedUrl: rawUrl,
      resolvedUrl: result.resolvedUrl,
      title: result.title || '',
      markdown: result.markdown,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {})
    };
  }

  if (strategy === 'defuddle') {
    const proxyUrl = buildProxyUrl(DEFUDDLE_BASE, normalizedUrl);
    try {
      const proxyResult = await fetchMarkdownFromProxy(proxyUrl, timeoutMs);
      return {
        source: 'defuddle',
        strategy,
        proxyUrl,
        requestedUrl: rawUrl,
        resolvedUrl: normalizedUrl,
        title: '',
        contentType: proxyResult.contentType,
        markdown: proxyResult.markdown
      };
    } catch (defuddleError) {
      const reason = defuddleError instanceof Error ? defuddleError.message : String(defuddleError);
      const { fetchGenericToMarkdown } = await import('./fetch_generic_fallback.mjs');
      const fallback = await fetchGenericToMarkdown(normalizedUrl, { timeoutMs });
      return {
        source: fallback.source,
        strategy: fallback.strategy,
        proxyUrl: proxyUrl,
        requestedUrl: rawUrl,
        resolvedUrl: fallback.resolvedUrl,
        title: fallback.title || '',
        markdown: fallback.markdown,
        fallbackReason: reason
      };
    }
  }

  const proxyUrl = buildProxyUrl(R_JINA_BASE, normalizedUrl);
  try {
    const proxyResult = await fetchMarkdownFromProxy(proxyUrl, timeoutMs);
    return {
      source: 'r.jina.ai',
      strategy,
      proxyUrl,
      requestedUrl: rawUrl,
      resolvedUrl: normalizedUrl,
      title: '',
      contentType: proxyResult.contentType,
      markdown: proxyResult.markdown
    };
  } catch (jinaError) {
    const reason = jinaError instanceof Error ? jinaError.message : String(jinaError);
    const { fetchGenericToMarkdown } = await import('./fetch_generic_fallback.mjs');
    const fallback = await fetchGenericToMarkdown(normalizedUrl, { timeoutMs });
    return {
      source: fallback.source,
      strategy: fallback.strategy,
      proxyUrl,
      requestedUrl: rawUrl,
      resolvedUrl: fallback.resolvedUrl,
      title: fallback.title || '',
      markdown: fallback.markdown,
      fallbackReason: reason
    };
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const result = await urlToMarkdown(args.url, { timeoutMs: args.timeoutMs });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${result.markdown}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`url_to_markdown failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
