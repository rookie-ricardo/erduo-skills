#!/usr/bin/env node
/**
 * Render a semantic Anthropic-style SVG diagram to a PNG image.
 *
 * The authored SVG carries geometry and semantic classes only. This script
 * supplies the design system, resolves the theme, audits the layout, crops the
 * viewBox to the real ink bounds, flattens every computed style into literal
 * attributes, and rasterises the result.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(HERE, '..', 'assets', 'diagram.css');
const PAPER = { light: '#faf9f5', dark: '#141413' };

const USAGE = `Render an Anthropic-style SVG diagram to PNG.

  node render.mjs <input.svg> [options]

Options
  -o, --out <path>     Output PNG path. Default: ./<input-basename>.png
      --theme <t>      light | dark | both                   (default: light)
      --scale <n>      Pixel density multiplier              (default: 2)
      --bg <v>         auto | transparent | #rrggbb          (default: auto)
      --padding <n>    Padding around content, user units    (default: 32)
      --no-fit         Keep the authored viewBox instead of cropping to content
      --svg            Also write a portable flattened .svg beside the PNG
      --check          Audit only: report layout problems, write nothing
      --json           Emit machine-readable JSON on stdout
`;

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      theme: { type: 'string', default: 'light' },
      scale: { type: 'string', default: '2' },
      bg: { type: 'string', default: 'auto' },
      padding: { type: 'string', default: '32' },
      fit: { type: 'boolean', default: true },
      svg: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE);
    process.exit(positionals.length === 0 && !values.help ? 1 : 0);
  }

  if (!['light', 'dark', 'both'].includes(values.theme)) {
    throw new Error(`--theme must be light, dark or both (got "${values.theme}")`);
  }

  const scale = Number(values.scale);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`--scale must be a positive number`);

  const padding = Number(values.padding);
  if (!Number.isFinite(padding) || padding < 0) throw new Error(`--padding must be >= 0`);

  const input = resolve(positionals[0]);
  const stem = basename(input, extname(input));
  const out = values.out ? resolve(values.out) : resolve(process.cwd(), `${stem}.png`);

  return {
    input,
    out,
    themes: values.theme === 'both' ? ['light', 'dark'] : [values.theme],
    scale,
    bg: values.bg,
    padding,
    fit: values.fit,
    writeSvg: values.svg,
    check: values.check,
    json: values.json,
  };
}

/** Resolve playwright from the skill, the project, or the global npm root. */
async function loadChromium() {
  const require = createRequire(import.meta.url);
  const roots = [];
  try {
    // Strip npm's own config: running under `npm --prefix <dir> run` would otherwise
    // make "npm root -g" report that prefix instead of the real global root.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('npm_config_')),
    );
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', env }).trim());
  } catch {
    /* npm unavailable; local resolution may still succeed */
  }

  for (const specifier of ['playwright', ...roots.map((r) => join(r, 'playwright'))]) {
    try {
      return require(specifier).chromium;
    } catch {
      /* try the next candidate */
    }
  }

  throw new Error(
    'playwright not found. Run "npm install" inside skills/anthropic-style-diagram, ' +
      'or "npm install -g playwright && npx playwright install chromium".',
  );
}

/** Everything below runs inside the page; it must be self-contained. */
function pageScript() {
  const SHAPES = 'rect,circle,ellipse,polygon,path,line,polyline';
  const INK = `${SHAPES},text,image,use`;

  const rendered = (svg) =>
    [...svg.querySelectorAll(INK)].filter((el) => !el.closest('defs') && !el.closest('marker'));

  function makeSpace(svg) {
    const box = svg.getBoundingClientRect();
    const [vx, vy] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    return (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - box.left + vx,
        y: r.top - box.top + vy,
        w: r.width,
        h: r.height,
        right: r.right - box.left + vx,
        bottom: r.bottom - box.top + vy,
      };
    };
  }

  function label(el) {
    const g = el.closest('g');
    const text = g?.querySelector('text');
    const name = text?.textContent?.trim();
    return name ? `"${name}"` : `<${el.tagName}>`;
  }

  function overlapArea(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  const contains = (outer, inner, tol = 1) =>
    outer.x - tol <= inner.x &&
    outer.y - tol <= inner.y &&
    outer.right + tol >= inner.right &&
    outer.bottom + tol >= inner.bottom;

  function audit(svg, toUser) {
    const warnings = [];
    const rects = [...svg.querySelectorAll('rect')].filter((el) => !el.closest('defs'));
    const boxes = rects.map((el) => ({ el, box: toUser(el) }));

    for (const text of svg.querySelectorAll('text')) {
      const owner = text.closest('g')?.querySelector(':scope > rect');
      if (!owner) continue;
      const t = toUser(text);
      const r = toUser(owner);
      const spill = Math.max(r.x - t.x, t.right - r.right, r.y - t.y, t.bottom - r.bottom);
      if (spill > 1) {
        warnings.push(
          `text overflow: "${text.textContent.trim()}" spills ${spill.toFixed(0)}px outside its box ` +
            `(box ${r.w.toFixed(0)}x${r.h.toFixed(0)} at ${r.x.toFixed(0)},${r.y.toFixed(0)}) — widen the rect or shorten the label`,
        );
      }
    }

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (contains(a.box, b.box) || contains(b.box, a.box)) continue;
        if (overlapArea(a.box, b.box) > 4) {
          warnings.push(
            `boxes overlap: ${label(a.el)} and ${label(b.el)} intersect — increase the gap or shrink one box`,
          );
        }
      }
    }

    for (const line of svg.querySelectorAll('line,path,polyline')) {
      if (line.closest('defs') || typeof line.getTotalLength !== 'function') continue;
      const length = line.getTotalLength();
      if (!length) continue;
      const ctm = line.getScreenCTM();
      const svgBox = svg.getBoundingClientRect();
      const [vx, vy] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
      const at = (t) => {
        const p = line.getPointAtLength(length * t).matrixTransform(ctm);
        return { x: p.x - svgBox.left + vx, y: p.y - svgBox.top + vy };
      };
      const ends = [at(0), at(1)];

      for (const { el, box } of boxes) {
        const touchesEnd = ends.some(
          (p) => p.x >= box.x - 6 && p.x <= box.right + 6 && p.y >= box.y - 6 && p.y <= box.bottom + 6,
        );
        if (touchesEnd) continue;
        for (let t = 0.12; t <= 0.88; t += 0.04) {
          const p = at(t);
          if (p.x > box.x + 2 && p.x < box.right - 2 && p.y > box.y + 2 && p.y < box.bottom - 2) {
            warnings.push(
              `connector crosses ${label(el)} — route around it with an L-shaped path`,
            );
            break;
          }
        }
      }
    }

    return [...new Set(warnings)];
  }

  function fitViewBox(svg, toUser, padding) {
    const items = rendered(svg).map(toUser).filter((b) => b.w > 0 || b.h > 0);
    if (!items.length) return null;
    const x = Math.min(...items.map((b) => b.x)) - padding;
    const y = Math.min(...items.map((b) => b.y)) - padding;
    const w = Math.max(...items.map((b) => b.right)) + padding - x;
    const h = Math.max(...items.map((b) => b.bottom)) + padding - y;
    return [x, y, w, h].map((n) => Math.round(n * 100) / 100);
  }

  /** Give every marker a literal colour so context-stroke never leaves the browser. */
  function resolveMarkers(svg) {
    const byColour = new Map();
    for (const el of svg.querySelectorAll('[marker-end],[marker-start],[marker-mid]')) {
      const colour = getComputedStyle(el).stroke;
      for (const attr of ['marker-end', 'marker-start', 'marker-mid']) {
        const ref = el.getAttribute(attr);
        const id = ref?.match(/^url\(["']?#(.+?)["']?\)$/)?.[1];
        if (!id) continue;
        const source = svg.querySelector(`marker#${CSS.escape(id)}`);
        if (!source) continue;

        const key = `${id}|${colour}`;
        let variant = byColour.get(key);
        if (!variant) {
          variant = source.cloneNode(true);
          variant.id = `${id}-${byColour.size}`;
          for (const child of variant.querySelectorAll('*')) {
            for (const prop of ['stroke', 'fill']) {
              const value = child.getAttribute(prop);
              if (value === 'context-stroke' || value === 'context-fill') {
                child.setAttribute(prop, colour);
              }
            }
          }
          source.parentNode.appendChild(variant);
          byColour.set(key, variant);
        }
        el.setAttribute(attr, `url(#${variant.id})`);
      }
    }
    for (const marker of svg.querySelectorAll('marker')) {
      if (![...byColour.values()].includes(marker)) marker.remove();
    }
  }

  const PROPS = {
    shape: [
      'fill',
      'fill-opacity',
      'stroke',
      'stroke-width',
      'stroke-opacity',
      'stroke-dasharray',
      'stroke-linecap',
      'stroke-linejoin',
      'opacity',
    ],
    text: [
      'fill',
      'fill-opacity',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'letter-spacing',
      'text-anchor',
      'dominant-baseline',
      'opacity',
    ],
  };

  const DEFAULTS = {
    'fill-opacity': '1',
    'stroke-opacity': '1',
    opacity: '1',
    'stroke-dasharray': 'none',
    'stroke-linecap': 'butt',
    'stroke-linejoin': 'miter',
    'font-style': 'normal',
    'letter-spacing': 'normal',
    'text-anchor': 'start',
    'dominant-baseline': 'auto',
  };

  /** Bake computed styles into presentation attributes so the SVG needs no CSS. */
  function flatten(svg) {
    const targets = [...svg.querySelectorAll(`${INK},tspan,g`)].filter(
      (el) => !el.closest('defs'),
    );

    // Snapshot every computed value first: stripping a parent's class mid-walk
    // would silently drop the styles its children still depend on.
    const snapshot = targets.map((el) => {
      const computed = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const props =
        tag === 'g' ? ['opacity'] : ['text', 'tspan'].includes(tag) ? PROPS.text : PROPS.shape;
      const painted = computed.stroke !== 'none';
      return {
        el,
        entries: props
          .filter((prop) => !(prop === 'stroke-width' && !painted))
          .map((prop) => [prop, computed.getPropertyValue(prop)])
          .filter(([prop, value]) => value && value !== DEFAULTS[prop]),
      };
    });

    for (const { el, entries } of snapshot) {
      for (const [prop, value] of entries) el.setAttribute(prop, value);
      el.removeAttribute('class');
    }

    for (const style of svg.querySelectorAll('style')) style.remove();
    for (const el of svg.querySelectorAll('[class]')) el.removeAttribute('class');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.removeAttribute('style');
  }

  window.__diagram = { makeSpace, audit, fitViewBox, resolveMarkers, flatten };
}

async function renderTheme({ chromium, source, css, theme, options }) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      deviceScaleFactor: options.scale,
      colorScheme: theme,
    });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;overflow:visible}</style></head><body>${source}
       <script>(${pageScript})()</script></body></html>`,
      { waitUntil: 'load' },
    );
    await page.evaluate(() => document.fonts.ready);

    const result = await page.evaluate(
      ({ fit, padding }) => {
        const { makeSpace, audit, fitViewBox, resolveMarkers, flatten } = window.__diagram;
        const svg = document.querySelector('svg');
        if (!svg) throw new Error('no <svg> element found in the input file');
        if (!svg.getAttribute('viewBox')) throw new Error('the root <svg> needs a viewBox');

        const lock = () => {
          const [, , w, h] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
          svg.setAttribute('width', w);
          svg.setAttribute('height', h);
        };

        lock();
        const warnings = audit(svg, makeSpace(svg));

        if (fit) {
          const box = fitViewBox(svg, makeSpace(svg), padding);
          if (box) svg.setAttribute('viewBox', box.join(' '));
          lock();
        }

        resolveMarkers(svg);
        flatten(svg);

        const [, , width, height] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
        return { warnings, width, height, markup: svg.outerHTML };
      },
      { fit: options.fit, padding: options.padding },
    );

    if (options.check) return { ...result, png: null };

    const background =
      options.bg === 'auto' ? PAPER[theme] : options.bg === 'transparent' ? null : options.bg;
    if (background) await page.evaluate((c) => (document.body.style.background = c), background);

    const png = await page.locator('svg').screenshot({ omitBackground: !background });
    return { ...result, png };
  } finally {
    await browser.close();
  }
}

function outputPath(base, theme, themes, extension) {
  const dir = dirname(base);
  const stem = basename(base, extname(base));
  const suffix = themes.length > 1 && theme === 'dark' ? '-dark' : '';
  return join(dir, `${stem}${suffix}${extension}`);
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const [chromium, source, css] = await Promise.all([
    loadChromium(),
    readFile(options.input, 'utf8'),
    readFile(CSS_PATH, 'utf8'),
  ]);

  const report = { input: options.input, outputs: [], warnings: [] };

  for (const theme of options.themes) {
    const result = await renderTheme({ chromium, source, css, theme, options });
    report.warnings.push(...result.warnings);

    if (options.check) continue;

    const png = outputPath(options.out, theme, options.themes, '.png');
    await mkdir(dirname(png), { recursive: true });
    await writeFile(png, result.png);
    report.outputs.push({
      theme,
      png,
      pixels: `${Math.round(result.width * options.scale)}x${Math.round(result.height * options.scale)}`,
    });

    if (options.writeSvg) {
      const svg = outputPath(options.out, theme, options.themes, '.svg');
      await writeFile(svg, `${result.markup}\n`);
      report.outputs.at(-1).svg = svg;
    }
  }

  report.warnings = [...new Set(report.warnings)];

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const out of report.outputs) {
      process.stdout.write(`${out.png}  ${out.pixels}px  (${out.theme})\n`);
      if (out.svg) process.stdout.write(`${out.svg}  portable svg\n`);
    }
    if (report.warnings.length) {
      process.stdout.write(`\n${report.warnings.length} layout warning(s):\n`);
      for (const w of report.warnings) process.stdout.write(`  - ${w}\n`);
    } else if (options.check) {
      process.stdout.write('layout clean: no overflow, overlap or crossed connectors\n');
    }
  }

  process.exit(report.warnings.length && options.check ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
