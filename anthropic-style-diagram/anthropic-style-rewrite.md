# Imagine Static SVG Prompt (Anthropic MCP Aligned)

## Scope
This prompt is for **static image output** only.
- Output only one complete `<svg>` artifact.
- No runtime behavior.
- No interactive events.

## Runtime Assumptions
Prefer tokenized styling via shared CSS.
- Primary reference CSS: `anthropic-style-diagram/style/anthropic-diagram-design-system.css`
- If the runtime supports external stylesheet loading, reference that file.
- If not, inline the required CSS from that file into `<style>` before the SVG.

Do not rely on JS runtime, CDN, or injected helpers.

## Hard Bans
- No `onclick`, no event handlers, no `sendPrompt`, no `openLink`.
- No `<script>`.
- No `<a href>` for navigational interaction in static output.
- No `read_me/modules` indirection.
- No fixed canvas assumptions like `viewBox="0 0 680 ..."` unless the actual layout computation leads to it.

## Accessibility
Root SVG must include:
```svg
<svg width="100%" viewBox="0 0 W H" role="img">
  <title>...</title>
  <desc>...</desc>
  ...
</svg>
```

## Official Token System (Use Complete Set)
Use the official MCP design token names already implemented in `style/anthropic-diagram-design-system.css`:

- Background: `--color-background-*`
- Text: `--color-text-*`
- Border: `--color-border-*`
- Ring: `--color-ring-*`
- Typography: `--font-*`, `--font-weight-*`, `--font-text-*`, `--font-heading-*`
- Radius/width: `--border-radius-*`, `--border-width-regular`

Do not hardcode neutral UI colors when a token exists.

## Predefined SVG Classes (Required)
Use these preloaded classes from the CSS file:
- Text: `t`, `ts`, `th`
- Containers: `box`, `node`
- Connectors: `arr`, `leader`
- Color ramps: `c-blue`, `c-teal`, `c-amber`, `c-green`, `c-red`, `c-purple`, `c-coral`, `c-pink`, `c-gray`

## Color Palette (9 Ramps x 7 Steps)
| Class | Ramp | 50 | 100 | 200 | 400 | 600 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `c-purple` | Purple | `#EEEDFE` | `#CECBF6` | `#AFA9EC` | `#7F77DD` | `#534AB7` | `#3C3489` | `#26215C` |
| `c-teal` | Teal | `#E1F5EE` | `#9FE1CB` | `#5DCAA5` | `#1D9E75` | `#0F6E56` | `#085041` | `#04342C` |
| `c-coral` | Coral | `#FAECE7` | `#F5C4B3` | `#F0997B` | `#D85A30` | `#993C1D` | `#712B13` | `#4A1B0C` |
| `c-pink` | Pink | `#FBEAF0` | `#F4C0D1` | `#ED93B1` | `#D4537E` | `#993556` | `#72243E` | `#4B1528` |
| `c-gray` | Gray | `#F1EFE8` | `#D3D1C7` | `#B4B2A9` | `#888780` | `#5F5E5A` | `#444441` | `#2C2C2A` |
| `c-blue` | Blue | `#E6F1FB` | `#B5D4F4` | `#85B7EB` | `#378ADD` | `#185FA5` | `#0C447C` | `#042C53` |
| `c-green` | Green | `#EAF3DE` | `#C0DD97` | `#97C459` | `#639922` | `#3B6D11` | `#27500A` | `#173404` |
| `c-amber` | Amber | `#FAEEDA` | `#FAC775` | `#EF9F27` | `#BA7517` | `#854F0B` | `#633806` | `#412402` |
| `c-red` | Red | `#FCEBEB` | `#F7C1C1` | `#F09595` | `#E24B4A` | `#A32D2D` | `#791F1F` | `#501313` |

## Dark Mode Rules (Mandatory)
Use the ramp mapping implemented in CSS:
- Light mode: fill `50`, stroke `600`, title `800`, subtitle `600`
- Dark mode: fill `800`, stroke `200`, title `100`, subtitle `200`

For neutral UI blocks and text, always rely on `--color-*` tokens, never fixed black/white literals.

## Typography Rules
- Use only `400` and `500` by default in diagrams (`600` and `700` only when explicitly needed by host UI style).
- `th`: 14px for node title
- `t`: 14px for primary label
- `ts`: 12px for secondary label
- Minimum font size: 11px
- Sentence case only

## Diagram Layout Rules
### 1) Flowchart
- Single dominant direction (top-down or left-right).
- Prefer 3-6 nodes.
- Keep at least 20px gap between neighboring boxes.
- Avoid line crossing through unrelated nodes.

### 2) Structural
- Outer container + grouped inner regions.
- Containment hierarchy should be explicit by nesting and spacing.
- Keep depth <= 3 layers.

### 3) Illustrative
- Use shape-based metaphor for mechanism explanation.
- Keep labels readable and outside dense geometry when needed.
- Use `leader` lines for callouts.

## Coordinate Calculation Methods
- Center text in box `(x,y,w,h)`:
  - `text_x = x + w / 2`
  - `text_y = y + h / 2`
  - `text-anchor="middle" dominant-baseline="central"`
- Vertical connector from box A bottom center to box B top center:
  - `x1 = ax + aw / 2`, `y1 = ay + ah`
  - `x2 = bx + bw / 2`, `y2 = by`
- L-turn connector if straight line intersects unrelated box:
  - `M x1 y1 L x1 ymid L x2 ymid L x2 y2`

## Text Width Estimation Table
Use these approximations before placing text:

| Text sample | Chars | Weight | Size | Approx width |
|---|---:|---:|---:|---:|
| Authentication Service | 22 | 500 | 14px | 167px |
| Background Job Processor | 24 | 500 | 14px | 201px |
| Detects and validates incoming tokens | 37 | 400 | 14px | 279px |
| forwards request to | 19 | 400 | 12px | 123px |
| 数据库服务器连接 | 8 | 400 | 14px | 112px |

Rule of thumb:
- 14px title: `width ~= chars * 7.5px`
- 12px subtitle: `width ~= chars * 6.5px`
- Required box width: `text_width + 2 * horizontal_padding`

## SVG Connector Marker
Include once in `<defs>`:
```svg
<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
  <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</marker>
```

## Quality Checklist
- One complete SVG only.
- No interaction/event/link behavior.
- `<title>` + `<desc>` present.
- All text uses `t`, `ts`, or `th`.
- No clipped labels.
- No connector crossing through unrelated nodes.
- Dark mode remains legible.
- Uses official token names and shared CSS file.
