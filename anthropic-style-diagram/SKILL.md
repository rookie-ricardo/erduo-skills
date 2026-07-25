---
name: anthropic-style-diagram
description: >-
  Generate static SVG technical diagrams (flowchart, structural, illustrative)
  using Anthropic-aligned design tokens and reusable CSS classes. Use this
  when the user asks for architecture diagrams, process charts, concept maps,
  static browser-rendered SVG output with no interaction, or explicitly asks
  for Anthropic style / Claude style diagrams.
---

# Anthropic Style Diagram (Static SVG Skill)

Produce static SVG diagrams only.

## Trigger Rules
- Use this skill when the user explicitly asks for `Anthropic` style, `Claude` style, `Anthropic 风格`, or `Claude 风格` diagrams.
- Use this skill when the user wants a static SVG technical diagram that should match Anthropic/Claude visual language.

## Files In This Skill
- Core prompt spec: `anthropic-style-rewrite.md`
- Design system CSS: `style/anthropic-diagram-design-system.css`

Always follow `anthropic-style-rewrite.md` as the primary generation contract.
Use `style/anthropic-diagram-design-system.css` for token values and class semantics.

## Output Contract
- Output exactly one complete `<svg>` artifact per generation.
- No runtime behavior and no interaction hooks.
- No `onclick`, no `sendPrompt`, no `openLink`, no `<script>`, no `<a href>`.
- Root SVG must include:
  - `role="img"`
  - `<title>`
  - `<desc>`

## Diagram Types
- `flowchart`: sequence/process/decision flow.
- `structural`: containment/architecture layers.
- `illustrative`: mechanism intuition with shape metaphor.

## Style Contract
- Use official MCP token names (`--color-*`, `--font-*`, `--border-*`, `--color-ring-*`).
- Use predefined classes from CSS:
  - text: `t`, `ts`, `th`
  - node/container: `node`, `box`
  - connectors: `arr`, `leader`
  - ramps: `c-blue`, `c-teal`, `c-amber`, `c-green`, `c-red`, `c-purple`, `c-coral`, `c-pink`, `c-gray`
- Dark mode compatibility is mandatory.

## CSS Usage
Use one of these approaches:
1. Inline required CSS rules from `style/anthropic-diagram-design-system.css` in a `<style>` block.
2. If environment supports external stylesheets, reference the CSS file directly.

For single-file SVG portability, prefer inline style.

## Geometry And Text Rules
- Compute `viewBox` from actual layout bounds, do not hardcode 680 unless layout requires it.
- Keep labels readable and avoid collisions/line crossings.
- Use text width estimation and connector routing rules from `anthropic-style-rewrite.md`.

## Validation Checklist
- One complete SVG only.
- Accessibility tags present (`role`, `title`, `desc`).
- No interactivity.
- No clipped text.
- No connector crossing unrelated nodes.
- Token/class usage follows this skill files.
