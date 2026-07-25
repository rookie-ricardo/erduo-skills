# Design system reference

The renderer injects `assets/diagram.css` and bakes the result into the exported file.
These values are here so you can reason about contrast and fit — you never write them
into the SVG yourself.

## Colour ramps

Nine ramps, seven stops each. 50 is the lightest fill, 600 the border, 800–900 the text
tone on a light fill.

| Class | 50 | 100 | 200 | 400 | 600 | 800 | 900 |
|---|---|---|---|---|---|---|---|
| `c-purple` | `#EEEDFE` | `#CECBF6` | `#AFA9EC` | `#7F77DD` | `#534AB7` | `#3C3489` | `#26215C` |
| `c-teal` | `#E1F5EE` | `#9FE1CB` | `#5DCAA5` | `#1D9E75` | `#0F6E56` | `#085041` | `#04342C` |
| `c-coral` | `#FAECE7` | `#F5C4B3` | `#F0997B` | `#D85A30` | `#993C1D` | `#712B13` | `#4A1B0C` |
| `c-pink` | `#FBEAF0` | `#F4C0D1` | `#ED93B1` | `#D4537E` | `#993556` | `#72243E` | `#4B1528` |
| `c-gray` | `#F1EFE8` | `#D3D1C7` | `#B4B2A9` | `#888780` | `#5F5E5A` | `#444441` | `#2C2C2A` |
| `c-blue` | `#E6F1FB` | `#B5D4F4` | `#85B7EB` | `#378ADD` | `#185FA5` | `#0C447C` | `#042C53` |
| `c-green` | `#EAF3DE` | `#C0DD97` | `#97C459` | `#639922` | `#3B6D11` | `#27500A` | `#173404` |
| `c-amber` | `#FAEEDA` | `#FAC775` | `#EF9F27` | `#BA7517` | `#854F0B` | `#633806` | `#412402` |
| `c-red` | `#FCEBEB` | `#F7C1C1` | `#F09595` | `#E24B4A` | `#A32D2D` | `#791F1F` | `#501313` |

How a `c-*` class resolves, handled for you in both themes:

| Slot | Light | Dark |
|---|---|---|
| Shape fill | 50 | 800 |
| Shape stroke | 600 | 200 |
| Title (`t`, `th`) | 800 | 100 |
| Subtitle (`ts`) | 600 | 200 |

Title and subtitle deliberately land on different stops — same-stop text reads flat,
and the weight difference alone is not enough separation.

Neutral tokens behind `box`, `arr`, `leader` and unclassed text:

| Token | Light | Dark |
|---|---|---|
| Paper (PNG background) | `#FAF9F5` | `#141413` |
| Text primary | `#141413` | `#FAF9F5` |
| Text secondary | `#3D3D3A` | `#C2C0B6` |
| Surface (`box` fill) | `#F5F4ED` | `#262624` |
| Border | `#1F1E1D66` | `#DEDCD166` |

### Assigning colour

Colour encodes category, not order. Do not walk the ramps like a rainbow — step 1 blue,
step 2 amber, step 3 red is noise. Instead:

- All nodes of one kind share one ramp: every immune cell purple, every pathogen coral,
  every outcome teal.
- Nodes are coloured by default. Leaving every node neutral and tinting only the
  containers drains the diagram — `box` exists for homogeneous sub-parts inside one
  container, nothing more.
- `c-gray` for neutral, structural or external nodes — start states, end states,
  plumbing, the outside world.
- One ramp per category. Two or three is right for a simple flow; a diagram with six
  real categories may use six. What is forbidden is a ramp per row.
- Prefer purple, teal, coral and pink for generic categories. Blue, green, amber and red
  carry strong UI connotations (info, success, warning, error) — spend them only when
  the node genuinely means that.
- Illustrative diagrams are the exception: there colour maps to a physical property, so
  warm ramps for heat or energy, cool for cold or calm, green for organic, gray for
  inert structure.
- If colour carries meaning the reader cannot infer, add a one-line legend.

## Typography

- Two sizes only: 14px (`t`, `th`) and 12px (`ts`). Never below 11px.
- Two weights only: 400 regular and 500 medium (`th`). Never 600 or 700.
- Sentence case everywhere. Never Title Case, never ALL CAPS.
- No decorative step numbers, no oversized headings floating outside boxes.

### Width calibration

Measured in the diagram font at 1:1 — the canvas renders one user unit per CSS pixel,
which is why the authoring width matters.

| Sample | Chars | Weight | Size | Width |
|---|---:|---:|---:|---:|
| Authentication Service | 22 | 500 | 14px | 167px |
| Background Job Processor | 24 | 500 | 14px | 201px |
| Detects and validates incoming tokens | 37 | 400 | 14px | 279px |
| forwards request to | 19 | 400 | 12px | 123px |
| データベースサーバー接続 | 12 | 400 | 14px | 181px |

Rules of thumb: 14px title ≈ `chars × 8`, 12px subtitle ≈ `chars × 7`, CJK ≈ `chars × 14`.
Required box width is `text_width + 24`. Chemical formulas, maths notation, subscripts
and Unicode symbols run 30–50% wider than plain Latin — pad accordingly.

## Spacing

| Measure | Value |
|---|---|
| Gap between boxes in a tier | ≥20px (60px reads best in sparse flowcharts) |
| Gap between tiers | 40–60px |
| Padding inside a box | 24px horizontal, 12px to the text edge |
| Padding inside a container | ≥20px on every side |
| Line spacing inside a box | 20–22px |
| Arrowhead to box edge | 10px |
| Single-line box height | 44px |
| Title + subtitle box height | 56px |
| Corner radius | `rx="8"` for nodes, `rx="12"` for containers |
| Stroke width | 0.5 for shape borders, 1.5 for connectors |

`rx` at or above half the height turns a box into a pill — only ever deliberate.

## Accessibility and output

- `role="img"` plus `<title>` and `<desc>` as the first two children of the root.
  `<desc>` is one sentence describing what the diagram shows, not a restatement of the
  title.
- Never rely on colour alone to separate categories. Pair it with position, shape, or a
  sparse hatch `<pattern>` when the distinction carries data.
- The exported PNG is opaque paper by default so it reads correctly wherever it lands.
  `--bg transparent` is available when the image will be composited.
- `--theme both` produces a light and a dark file from one source, which is the cheap
  way to cover both a light blog and a dark deck.
