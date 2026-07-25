---
name: anthropic-style-diagram
description: "Draw architecture, flow and structural diagrams in the Anthropic/Claude visual language as SVG, then render and save them as PNG. Trigger ONLY when the user names that visual language — 'Anthropic 风格架构图', 'Claude 风格流程图', 'Anthropic style diagram', 'Claude style flowchart', 'Anthropic 配色的图' — or asks for another diagram in the same style after this skill has already produced one in the conversation. Also use to re-render or export an SVG that already uses this skill's class system (th/ts/box/arr/c-blue…). Do NOT use for a plain 画图/画流程图/draw a diagram request with no style named, for data charts, UI mockups, illustrations, TikZ or mermaid output, or database ERDs."
---

# Anthropic Style Diagram

Author a semantic SVG, let the browser do the rest. `scripts/render.mjs` supplies the
design system, resolves the theme, audits the layout, crops the viewBox to the real ink
bounds, bakes every computed style into literal attributes, and writes the PNG.

**You draw geometry and meaning. The script owns colour, theme, viewBox and export.**
Never hardcode a hex value, never write a `<style>` block, never compute the final
viewBox height by hand.

## Workflow

1. **Plan before drawing.** Count the nodes and group them by kind — one colour ramp
   per kind, never one per row. Decide the diagram type (see below). If the user named
   6+ components, split into an overview plus one diagram per sub-flow rather than
   cramming one canvas.
2. **Write the SVG** to a working path (scratchpad or `/tmp`), not the delivery path.
   Follow the authoring contract below; `references/example-structural.svg` and
   `references/example-cycle.svg` are the canonical shapes to imitate.
3. **Render**: `node scripts/render.mjs <working.svg> -o <target.png>`.
4. **Clear the audit.** Layout warnings print on stdout. Fix every one and re-render
   until the run is clean. A clean run only means nothing collides — that is the
   floor, not the bar.
5. **Review the render yourself** against the checklist below. Any failure sends you
   back to step 2. This step is not optional: the audit measures geometry, and almost
   everything that makes a diagram *wrong* lives outside geometry.
6. **Report** the saved path, and say what the review turned up.

### The review checklist

Read the rendered image, not your source. The source is what you meant; the image is
what the reader gets, and only one of those can be wrong.

1. **Read it cold.** Set aside what you set out to draw and say what the picture
   actually claims. If that differs from the request, the diagram is wrong — not the
   reader.
2. **Trace every arrow.** Each must start and end on the shape it means, and its
   direction must assert something true. An arrow down the page claims the lower node
   is used by the upper one; say that claim out loud and check it. Placing a component
   below another is an assertion, not a layout convenience.
3. **Find the loop.** If the subject has feedback — an agent, a control system, a
   retry path, a training cycle — locate the return edge in the image. If you cannot
   see it, it is not there, and a one-way drawing of a loop is simply false.
4. **Read every label.** Accurate, ≤5 words, sentence case, unclipped, and not
   claiming more than the system does.
5. **Check the colour.** Same colour must mean same category. If two nodes share a
   ramp only because they were next in the list, re-assign.
6. **Scan the whitespace.** Crowded regions and dead regions are both defects, and a
   uniform grid of same-sized boxes means the layout is carrying no information.

## Rendering

```bash
node scripts/render.mjs diagram.svg -o ~/Downloads/architecture.png
```

| Option | Default | Notes |
|---|---|---|
| `-o, --out <path>` | `./<name>.png` | Parent directories are created |
| `--theme <t>` | `light` | `light`, `dark`, or `both` (writes `<name>-dark.png` too) |
| `--scale <n>` | `2` | Pixel density. `3`–`4` for print or large social images |
| `--bg <v>` | `auto` | Theme paper colour; or `transparent`, or any `#rrggbb` |
| `--padding <n>` | `32` | Margin around content after cropping |
| `--no-fit` | — | Keep the authored viewBox instead of cropping to ink bounds |
| `--svg` | — | Also write a portable flattened `.svg` (no CSS, opens anywhere) |
| `--check` | — | Audit only, write nothing; exits non-zero when problems exist |
| `--json` | — | Machine-readable report |

The audit catches the three *mechanical* failure modes: text spilling out of its shape,
nodes overlapping, and connectors slicing through unrelated nodes. Round nodes are
measured as ellipses rather than as their bounding box, so ring layouts are checked as
strictly as grids. A clean run prints only the output paths. It says nothing about
whether the diagram is well composed or even correct — see "Composition" below, and
never treat a clean audit as approval.

First run needs Playwright. It is picked up from the skill, the project, or the global
npm root; if missing, `npm install` in this directory.

## Authoring contract

```svg
<svg viewBox="0 0 680 H" role="img">
  <title>Short name</title>
  <desc>One sentence describing what the diagram shows.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
  ...
</svg>
```

- `role="img"` with `<title>` and `<desc>` as the first two children. Always.
- **Canvas width 680** by default — the text-width table below is calibrated to it.
  Widen to at most ~1000 when the content genuinely needs more columns; never shrink
  to hug narrow content, centre it instead.
- Height is a rough guess. The renderer crops to the true bounds, so overestimate
  rather than clip.
- No `<script>`, no `onclick`, no `sendPrompt`, no `<a href>`, no gradients, no
  filters, no drop shadows, no emoji, no rotated text, no `<!-- comments -->`.
- `<defs>` holds the arrow marker and nothing else (plus a `<clipPath>` or one
  `<linearGradient>` in illustrative diagrams).

### Classes — the only styling you write

| Class | Applies to | Effect |
|---|---|---|
| `th` | `<text>` | 14px medium — node titles |
| `t` | `<text>` | 14px regular — primary labels |
| `ts` | `<text>` | 12px regular — subtitles, callouts |
| `box` | `<g>` or shape | Neutral surface fill with a hairline border |
| `node` | `<g>` | Marks a node group; pair with `box` or a `c-*` ramp |
| `arr` | `<line>`/`<path>` | Connector stroke; add `marker-end="url(#arrow)"` |
| `leader` | `<path>` | Thin dashed callout/feedback line |
| `c-purple` `c-teal` `c-coral` `c-pink` `c-gray` `c-blue` `c-green` `c-amber` `c-red` | `<g>` or shape | Colour ramp — fill, border and text tones, both themes |

Put `c-*` on the group that directly holds the shape and text. It uses direct-child
selectors: an extra nested `<g>` breaks the fill.

Every `<text>` needs `t`, `ts` or `th` — an unclassed one renders as raw black.

### Colour the nodes, not just the containers

**Every node carries a ramp by default.** Nodes of the same kind share one; a diagram
where the boxes are all neutral and only the containers are tinted looks drained and
flat — that is the single most common way these diagrams go ugly.

`class="box"` is neutral on purpose, and it has exactly one job: homogeneous sub-parts
*inside* one coloured container, where the container already carries the category and
tinting the children would invent distinctions that do not exist. Do not generalise that
pattern to a whole diagram.

One ramp per category, not per row — colour must never track sequence. A six-category
diagram legitimately uses six ramps; a three-step flow uses one or two. `c-gray` for
neutral, structural or external nodes. Prefer purple, teal, coral and pink for generic
categories; reserve blue, green, amber and red for genuinely informational, successful,
warning or error concepts.

### Composition — decide these before you draw

The four judgements the audit will never make for you. Get them right here, then
confirm them against the rendered image with the review checklist above:

- **Uniform grids are a failure mode.** If every tier holds the same number of
  identically sized boxes, the layout carries no information and reads as a
  spreadsheet. Vary box widths to match their content and vary the count per tier.
  Convergence, branching and a full-width emphasis row are what make a diagram look
  like a structure rather than a table.
- **Find the feedback edges.** Anything with a loop in it — an agent, a control system,
  a retry path, a training cycle — drawn as a one-way stack is not simplified, it is
  wrong. Route the return edge as a `leader` path around the outside, or lay the
  stages in a ring when the cycle has no natural entry point; `references/diagram-types.md`
  carries the polar geometry for that.
- **Not everything is a stack.** Before placing a box below another, say the dependency
  out loud: "the lower one is used by the upper one." A component the core talks to
  bidirectionally belongs *beside* it with a two-headed arrow
  (`marker-start` and `marker-end`), not underneath it.
- **Find the one thing the diagram is about** and give it more weight — a container, a
  wider box, the only saturated colour in a neutral field. A diagram where everything
  is equally prominent has no subject.

### Geometry

- **Box width from the longest label**: `max(title_chars × 8, subtitle_chars × 7) + 24`.
  At 14px a character is ~8px; at 12px ~7px. CJK glyphs are ~14px. Formulas,
  subscripts and symbols run 30–50% wider — pad generously.
- **Heights**: 44px single line, 56px title + subtitle, +20px per extra subtitle line.
  Keep every box in a tier the same height.
- **Spacing**: ≥20px between boxes in a tier, 40–60px between tiers, ≥20px padding
  inside a container, 10px between an arrowhead and the box it points at.
- **Tier packing**: sum the widths and gaps before placing. Four 130px boxes with three
  20px gaps is 580px — fits. Four 160px boxes is 640px — does not.
- **Centre text**: `x = rect_x + w/2`, `y` = the centre of *its own line*, with
  `text-anchor="middle" dominant-baseline="central"`.
- `<text>` never wraps. Each line is its own `<text>` or a `<tspan>` with an explicit
  `x` and `dy`. If a subtitle needs wrapping it is too long.
- **Connectors**: a straight line that would cross an unrelated box gets an L-bend
  instead — `M x1 y1 L x1 ymid L x2 ymid L x2 y2` with `fill="none"`. Feedback loops
  route around the outside as a `leader` path; never draw the cycle as a ring.
- Prefer one dominant direction — all top-down or all left-right.

### Text budget

Subtitles are ≤5 words. Detail belongs in your prose reply, not inside the box.
Sentence case everywhere — never Title Case, never ALL CAPS. Only two sizes exist:
14px and 12px. Avoid floating labels: every `<text>` sits inside a box or is a leader
callout.

## Diagram types

- **Flowchart** — steps, decisions, transformations. *"what are the steps"*, *"what
  happens when…"*, *"what's the flow"*.
- **Structural** — containment and architecture; things inside things. *"what's the
  architecture"*, *"how is this organised"*, *"where does X live"*.
- **Illustrative** — a spatial metaphor that builds intuition. *"how does X actually
  work"*, *"I don't get X"*, *"give me an intuition for"*. Freeform shapes, colour
  encodes intensity rather than category.

Route on the verb, not the noun: "transformer architecture" is structural, "how does
attention work" is illustrative. `references/diagram-types.md` has the full playbook
and copy-ready snippets; `references/design-system.md` has the ramp table and the
detailed spacing and typography rules.

Database schemas and ERDs are not this skill's job — emit mermaid `erDiagram` instead.
