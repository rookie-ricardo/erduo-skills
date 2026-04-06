# Routing And Notes

## Routing Rules

- Default strategy: request `https://r.jina.ai/<url>` and treat the response as markdown/text.
- Generic fallback for default strategy:
  - step 1: `r.jina.ai` proxy,
  - step 2 (if step 1 fails): direct HTML fetch + Readability cleanup,
  - step 3 (if step 2 still fails): browser extraction.
- YouTube URLs (`youtube.com`, `youtu.be`): request `https://defuddle.md/<url>` to get transcript-oriented markdown.
- X/Twitter URLs (`x.com`, `twitter.com`): request `https://r.jina.ai/<url>`.
- WeChat/Zhihu/Feishu URLs: run two-stage extraction (`scripts/fetch_special_sites.mjs`):
  - stage 1: `cuimp` HTTP/TLS impersonation (`scripts/fetch_special_sites_http.mjs`) + Readability cleanup,
  - stage 2 fallback: browser impersonation when stage 1 fails or content is blocked.

## Special-Site Fetching Details

- HTTP stack: `cuimp` (curl-impersonate based Chrome impersonation).
- Browser fallback stack: `puppeteer-extra` + `stealth` + anonymized Chrome UA.
- Browser discovery order: `CHROME_PATH` env var, macOS system Chrome path, Chromium path, then Edge path.
- Login-wall resilience (best effort): remove known modal/overlay selectors and restore document/body scrolling.
- Dynamic content: scroll page to trigger lazy-loaded article blocks before extraction.
- Content cleanup: run Mozilla Readability and convert HTML to markdown with `turndown`.

## Operational Caveats

- The special-site script may still fail on hard anti-bot checks, private content, or strict account-only pages.
- Zhihu popup login modals are handled with DOM removal; if content is server-side hidden, the script cannot bypass that limitation.
- Keep legal/compliance responsibility with the operator when crawling protected pages.

## Script Entrypoints

- `node scripts/url_to_markdown.mjs <url>`: route and convert.
- `node scripts/url_to_markdown.mjs <url> --json`: include metadata (`strategy`, `source`, `resolvedUrl`).
- `node scripts/fetch_special_sites.mjs <url> --json`: force special-site browser workflow.
