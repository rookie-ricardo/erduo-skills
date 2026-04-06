---
name: web-to-markdown
description: "Convert a web URL into cleaned Markdown with deterministic routing. Use when Codex needs to read article-like content from links and should apply source-aware fetch strategies: default to r.jina.ai for general pages (including X/Twitter), use defuddle.md for YouTube links, and use browser-impersonated extraction for WeChat/Zhihu/Feishu pages with Mozilla Readability cleanup."
---

# Web To Markdown

Convert URLs into usable Markdown by applying domain-aware fetching routes, then return the cleaned content directly.

## Quick Workflow

1. Normalize and validate the input URL.
2. Select route:
- `r.jina.ai`: general web + X/Twitter.
- `defuddle.md`: YouTube transcript/content extraction.
- `special-browser-fetch`: WeChat/Zhihu/Feishu.
3. Return markdown text (or JSON metadata if needed).

For generic URLs (non-YouTube, non-WeChat/Zhihu/Feishu), use this fallback chain:

- try `r.jina.ai` first,
- if it fails, fallback to direct HTTP fetch + Readability,
- if direct fetch still fails or returns shell-like content, fallback to browser extraction.

## Commands

Run from this skill directory (`skills/web-to-markdown`):

```bash
npm install
node scripts/url_to_markdown.mjs <url>
```

Return metadata with markdown:

```bash
node scripts/url_to_markdown.mjs <url> --json
```

Force special-site browser extraction:

```bash
node scripts/fetch_special_sites.mjs <url> --json
```

## Routing Policy

- Default route: `https://r.jina.ai/<url>`.
- YouTube (`youtube.com`, `youtu.be`): `https://defuddle.md/<url>`.
- X/Twitter (`x.com`, `twitter.com`): `https://r.jina.ai/<url>`.
- WeChat/Zhihu/Feishu: run `scripts/fetch_special_sites.mjs`.
- If input is already proxy-formatted (`https://defuddle.md/https://...` or `https://r.jina.ai/https://...`), normalize back to the original URL and re-apply routing.

## Special-Site Extraction Behavior

Use a two-stage strategy for WeChat/Zhihu/Feishu:

1. Try `cuimp` HTTP/TLS impersonation first, then clean HTML with Mozilla Readability.
2. If stage 1 fails or returns blocked/shell content, fallback to `puppeteer-extra` browser impersonation.

- HTTP stage impersonates modern Chrome TLS/HTTP profile via `cuimp`.
- Browser stage impersonates a modern Chrome user agent and standard `sec-ch-ua` headers.
- Remove known login modals and backdrop overlays (best effort).
- Scroll the page to trigger lazy-loaded article blocks.
- Parse cleaned document with Mozilla Readability.
- Convert extracted HTML body to Markdown via Turndown.
- Resolve browser executable from `CHROME_PATH` first, then system Chrome/Chromium/Edge paths.

If special-site extraction fails due to anti-bot checks, account-only pages, or network limits, report failure clearly and ask for fallback input (for example raw page text).

## Output Contract

For normal usage, output markdown only.

When `--json` is used, return:

- `source`: backend source (`r.jina.ai`, `defuddle`, `cuimp`, `browser-readability`).
- `strategy`: selected route (`r-jina`, `defuddle`, `special-http-fetch`, `special-browser-fetch-fallback`).
- `requestedUrl`: original input.
- `resolvedUrl`: normalized/final URL.
- `markdown`: extracted markdown body.

## Resources

- [references/routing-and-notes.md](references/routing-and-notes.md): domain routing rules and operational caveats.
- `scripts/url_to_markdown.mjs`: primary entrypoint.
- `scripts/fetch_special_sites_http.mjs`: WeChat/Zhihu/Feishu HTTP impersonation fetcher (`cuimp` JS).
- `scripts/fetch_special_sites.mjs`: two-stage extractor (HTTP-first, browser-fallback).
