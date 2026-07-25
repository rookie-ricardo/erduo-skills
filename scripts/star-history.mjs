#!/usr/bin/env node
/**
 * Regenerate the star history chart committed under assets/.
 *
 * GitHub restricts the stargazers list to a repository's own admins and
 * collaborators, so no third-party service can read it anonymously any more —
 * a star-history.com embed in the README is fetched by GitHub's image proxy with
 * no token and will always fail. We read it ourselves with the owner's gh
 * credentials and commit the rendered SVG instead.
 *
 *   gh auth login && node scripts/star-history.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'rookie-ricardo/erduo-skills';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const W = 840;
const H = 400;
const PAD = { top: 52, right: 78, bottom: 46, left: 60 };
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

// Validated against GitHub's own README surfaces (#ffffff / #0d1117) with the
// dataviz palette validator: all checks pass in both modes.
const THEME = {
  light: {
    series: '#2a78d6',
    surface: '#ffffff',
    primary: '#0b0b0b',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
  },
  dark: {
    series: '#3987e5',
    surface: '#0d1117',
    primary: '#ffffff',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
  },
};

const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;

function fetchStarredAt() {
  const stamps = [];
  for (let page = 1; ; page++) {
    const raw = execFileSync(
      'gh',
      [
        'api',
        `repos/${REPO}/stargazers?per_page=100&page=${page}`,
        '-H',
        'Accept: application/vnd.github.star+json',
        '--jq',
        '.[].starred_at',
      ],
      { encoding: 'utf8', maxBuffer: 1 << 24 },
    ).trim();
    if (!raw) break;
    stamps.push(...raw.split('\n'));
    if (raw.split('\n').length < 100) break;
  }
  if (!stamps.length) throw new Error(`no stargazers returned for ${REPO}`);
  return stamps.map((s) => new Date(s)).sort((a, b) => a - b);
}

/** Daily cumulative totals, opening at zero the day before the first star. */
function toDailySeries(dates) {
  const floor = (d) => Math.floor(d.getTime() / DAY) * DAY;
  const first = floor(dates[0]);
  const last = floor(dates.at(-1));
  const series = [{ t: first - DAY, n: 0 }];
  let i = 0;
  for (let t = first; t <= last; t += DAY) {
    while (i < dates.length && dates[i].getTime() < t + DAY) i++;
    series.push({ t, n: i });
  }
  return series;
}

/**
 * Round tick values (1/2/2.5/5 x 10^k) below the current total. The scale tops
 * out at the total itself rather than the next round number: empty headroom
 * above the last point reads as a ceiling the repo failed to reach.
 */
function axisTicks(max, targetTicks = 4) {
  const magnitude = 10 ** Math.floor(Math.log10(max / targetTicks));
  const normalized = max / targetTicks / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks = [];
  for (let value = 0; value < max * 0.94; value += step) ticks.push(Math.round(value));
  return ticks;
}

function monthTicks(t0, t1) {
  const ticks = [];
  const cursor = new Date(t0);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  if (cursor.getTime() < t0) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= t1) {
    ticks.push({ t: cursor.getTime(), label: MONTHS[cursor.getUTCMonth()] });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return ticks;
}

function render(series, theme, mode) {
  const c = THEME[mode];
  const t0 = series[0].t;
  const t1 = series.at(-1).t;
  const total = series.at(-1).n;
  const yMax = total;
  const yTicks = axisTicks(total);

  const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * PLOT.w;
  const y = (n) => PAD.top + PLOT.h - (n / yMax) * PLOT.h;

  const points = series.map((p) => `${x(p.t).toFixed(1)},${y(p.n).toFixed(1)}`);
  const line = `M${points.join('L')}`;
  const area = `${line}L${x(t1).toFixed(1)},${y(0).toFixed(1)}L${x(t0).toFixed(1)},${y(0).toFixed(1)}Z`;

  const grid = yTicks
    .map(
      (n) =>
        `<line x1="${PAD.left}" y1="${y(n).toFixed(1)}" x2="${(PAD.left + PLOT.w).toFixed(1)}" y2="${y(n).toFixed(1)}" stroke="${n === 0 ? c.axis : c.grid}" stroke-width="1"/>`,
    )
    .join('\n  ');

  const yLabels = yTicks
    .map(
      (n) =>
        `<text x="${PAD.left - 12}" y="${(y(n) + 4).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${c.muted}">${n}</text>`,
    )
    .join('\n  ');

  const xLabels = monthTicks(t0, t1)
    .map(
      (tick) =>
        `<text x="${x(tick.t).toFixed(1)}" y="${PAD.top + PLOT.h + 24}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${c.muted}">${tick.label}</text>`,
    )
    .join('\n  ');

  const year = new Date(t1).getUTCFullYear();
  const endX = x(t1);
  const endY = y(total);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <title>Star history for ${REPO}</title>
  <desc>Cumulative GitHub stars from ${new Date(t0 + DAY).toISOString().slice(0, 10)} to ${new Date(t1).toISOString().slice(0, 10)}, ending at ${total} stars.</desc>
  ${grid}
  <path d="${area}" fill="${c.series}" fill-opacity="0.10"/>
  <path d="${line}" fill="none" stroke="${c.series}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="${c.series}"/>
  <text x="${(endX + 12).toFixed(1)}" y="${(endY + 5).toFixed(1)}" font-family="${FONT}" font-size="14" font-weight="500" fill="${c.primary}">${total}</text>
  ${yLabels}
  ${xLabels}
  <text x="${PAD.left}" y="28" font-family="${FONT}" font-size="15" font-weight="500" fill="${c.primary}">Star history</text>
  <text x="${PAD.left}" y="28" dx="102" font-family="${FONT}" font-size="13" fill="${c.muted}">${REPO} · ${year}</text>
</svg>
`;
}

const dates = fetchStarredAt();
const series = toDailySeries(dates);
await mkdir(OUT_DIR, { recursive: true });

for (const mode of ['light', 'dark']) {
  const file = join(OUT_DIR, mode === 'light' ? 'star-history.svg' : 'star-history-dark.svg');
  await writeFile(file, render(series, THEME[mode], mode));
  process.stdout.write(`${file}\n`);
}
process.stdout.write(`${dates.length} stars, ${series.length} daily points\n`);
