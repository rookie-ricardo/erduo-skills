# Diagram types

## Routing: read the verb, not the noun

The same subject wants a different diagram depending on whether the user is trying to
*document* it or *understand* it.

| User asks | Type | What to draw |
|---|---|---|
| "what are the training steps" | Flowchart | Forward → loss → backward → update |
| "TCP handshake sequence" | Flowchart | SYN → SYN-ACK → ACK, three boxes |
| "transformer architecture" | Structural | Embedding, attention heads, FFN, layer norm |
| "what's inside a cell" | Structural | Organelles nested in the cell boundary |
| "how do LLMs work" | Illustrative | Token row, stacked layer slabs, attention threads |
| "how does attention work" | Illustrative | One query token, a fan of lines to every key, opacity = weight |
| "how does gradient descent work" | Illustrative | Contour surface, a ball, a trail of steps |
| "how does a hash map work" | Illustrative | A key falling through a funnel into one of N buckets |
| "draw the database schema" | mermaid | `erDiagram` syntax, not this skill |

*"How does X work"* with no further qualification routes to illustrative. It is the more
ambitious choice — do not retreat to a flowchart because it feels safer.

Never mix families in one canvas. If both are wanted, draw the intuition version first
to build the mental model, then the reference version as a second file, with prose in
between.

## Complexity budget

Hard limits, checked before drawing:

- Subtitles ≤5 words.
- One ramp per category — 2–3 in a simple flow, more when the subject genuinely has
  more categories. Never one ramp per row.
- 4–5 nodes per tier at full width (~140px each). Five or more means shrink to ≤110px,
  wrap to two rows, or split the diagram. Do not give every tier the same count — a
  uniform grid reads as a table, not a structure.
- 3–6 nodes total in a flowchart.
- Containment at most 3 levels deep.

When the prompt itself is over budget — "draw auth, products, orders, payments, gateway
and the queue" — do not draw all of it at once. Produce a stripped overview with the
boxes and one or two main arrows, then one diagram per interesting sub-flow. Count the
nouns before you draw.

## Flowchart

Sequential processes, cause and effect, decision trees. One dominant direction.

Single-line node, 44px:

```svg
<g class="node c-blue">
  <rect x="100" y="20" width="180" height="44" rx="8"/>
  <text class="th" x="190" y="42" text-anchor="middle" dominant-baseline="central">T-cells</text>
</g>
```

Title plus subtitle, 56px:

```svg
<g class="node c-blue">
  <rect x="100" y="20" width="200" height="56" rx="8"/>
  <text class="th" x="200" y="38" text-anchor="middle" dominant-baseline="central">Dendritic cells</text>
  <text class="ts" x="200" y="56" text-anchor="middle" dominant-baseline="central">Detect foreign antigens</text>
</g>
```

Connector, and the L-bend detour when a straight line would cross something:

```svg
<line x1="200" y1="76" x2="200" y2="120" class="arr" marker-end="url(#arrow)"/>
<path class="arr" fill="none" d="M 200 76 L 200 98 L 420 98 L 420 120" marker-end="url(#arrow)"/>
```

Use `class="node box"` for neutral steps. Keep every box in a tier the same height.

Arrow labels are usually unnecessary — if the meaning is not obvious from source and
target, it belongs in the subtitle or in your prose. A label floating in space collides
with things and reads as ambiguous.

### Cycles

Default to a line of stages with a `leader` path returning along the outside. It
keeps every Cartesian spacing rule, reads unambiguously left to right, and leaves
room for the satellite nodes a stage feeds:

```svg
<path class="leader" d="M 640 337 L 657 337 L 657 188 L 640 188" marker-end="url(#arrow)"/>
```

Lay the stages around a ring when the cycle has **no natural entry point** — a
control loop, a lifecycle, a feedback process a reader could join at any stage —
and only up to 6 nodes. Past six the labels crowd, the arcs shorten, and the
direction of travel stops being readable. A ring with an obvious start and end is
a line pretending to be a circle; draw the line.

Ring geometry — `n` nodes of radius `r` on a circle of radius `R` centred at
`(cx, cy)`:

- node `i` sits at `θᵢ = -90° + 360°·i/n`, putting the first node at the top:
  `x = cx + R·cos θᵢ`, `y = cy + R·sin θᵢ`
- `R ≥ r / sin(180°/n) + 12` keeps neighbours from touching
- the arc from node `i` to `i+1` clears both shapes by running from `θᵢ + gap` to
  `θᵢ₊₁ − gap`, where `gap = asin(r/R) + 5°`
- draw it as `M x₀ y₀ A R R 0 0 1 x₁ y₁` — sweep flag `1` travels clockwise
- keep the centre for the cycle's name, never for a further node

Text inside a circle has far less room than its bounding box suggests: a label fits
only if all four of its corners stay inside the shape. Budget about `1.4·r` of
usable width and keep to a 2-word title plus a short subtitle.
`references/example-cycle.svg` is a complete five-stage ring.

## Structural

Containment: things inside other things. Use when the explanation depends on *where*
something happens — blocks in inodes in partitions, L1 inside a core, organelles inside
a cell.

- Outer container: large rounded rect, `rx="12"`, its own ramp, label at the top centre
  or top-left inside.
- Inner regions: `rx="8"`, `class="node box"` for neutral children, or a different ramp
  when the region is semantically distinct from its parent.
- ≥20px padding inside every container; inner regions must never touch the edge.
- External inputs sit outside with arrows pointing in; outputs sit outside with arrows
  pointing out. Keep those labels to a word or two.
- Regions hold a 14px name and a ≤5-word description. Nothing else.

```svg
<g class="c-teal">
  <rect x="40" y="118" width="600" height="140" rx="12"/>
  <text class="th" x="340" y="136" text-anchor="middle" dominant-baseline="central">Core agent loop</text>
</g>
<g class="node box">
  <rect x="60" y="152" width="155" height="72" rx="8"/>
  <text class="th" x="137" y="174" text-anchor="middle" dominant-baseline="central">State &amp; context</text>
  <text class="ts" x="137" y="198" text-anchor="middle" dominant-baseline="central">Conversation history</text>
</g>
```

`references/example-structural.svg` is a complete worked example of this pattern.

Size leaf tiers first and work upward: a parent must be at least as wide as the sum of
its children plus their gaps and its own padding.

## Illustrative

For intuition. Physical subjects become simplified versions of themselves; abstract
subjects become spatial metaphors.

What changes from the reference rules:

- Shapes are freeform — `<path>`, `<ellipse>`, `<circle>`, `<polygon>`.
- Layout follows the subject's geometry, not a grid. Overlap and layering are welcome
  for shapes, never for text.
- Colour encodes intensity rather than category: warm for active or hot, cool for
  dormant or cold.
- Small shape indicators are allowed inside drawn objects — triangles for flames,
  circles for bubbles. Still no icons inside reference-diagram boxes.
- One `<linearGradient>` is permitted, and only to show a continuous physical property.

Everything else holds: 14/12px text, semantic classes, the arrow marker, `<title>` and
`<desc>`.

Composition order: main silhouette first, then internal structure, then external
connections, then state indicators.

Labels sit *outside* the object on a thin dashed `leader` line, right side by default
with `text-anchor="start"`. Never let a stroke cross a label.

Lines stop at component edges. When a wire meets a bulb, draw two segments that stop at
the boundary rather than one line hidden by a fill — the background is not guaranteed,
so an occluding fill is a coupling waiting to break.

Schematic containers are dashed rects with a label. Do not draw literal server towers,
cloud outlines or organelle ovals in a diagram that is otherwise a schema.

## Physical-colour scenes

Sky, water, grass, skin, materials: use hardcoded hex throughout and never mix with
`c-*` classes. A scene should not invert between themes. Mixing a hardcoded background
with theme-responsive foreground breaks — half inverts, half does not. Render such a
diagram with a single explicit `--theme`.
