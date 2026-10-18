---
name: html-report
description: "Use when the user would understand faster from a visual than from chat text: charts, dashboards, budget/projection visuals, import summaries, or any rich report. Use ONLY for one-off local report files — not for building general web pages, sites, or apps. Examples: \"chart my spending\", \"visualize this projection\", \"make a dashboard\", \"show me as a report\""
---

# HTML Report

Ported from Antigravity's `generative_ui` pattern, adapted: opencode has no
artifact host or inline renderer, so the deliverable is a file the user opens
in a browser — not an embed.

## When to Use

- "Chart / plot / visualize X"
- "Make a dashboard / report out of this data"
- Any answer where a table in chat would bury the insight (MonArtha fits: budget overviews, retirement projections, import summaries)

## Decision tree

1. **Chat suffices?** A handful of numbers or a short table → answer in chat, no file.
2. **Visual wins?** Trends, comparisons, distributions → build the HTML file below.
3. **Interactive needed?** Filters/sliders/tabs → same file, dependency-free inline JS only.
4. **Escalate to Svelte 5?** Only if the vanilla build crosses the size/complexity budget below — never for build-time convenience.

## Workflow

1. Gather the data first (query code, DB, or files) — never hand-write plausible numbers; every figure must trace to a source.
2. Write **one self-contained `.html` file** (inline `<style>` + `<script>`, zero external requests so it works over `file://` offline):
   - Charts: inline SVG or dependency-free `<canvas>` JS. No CDN libraries.
   - No `fetch()` to local files (blocked under `file://`) — bake the data into the page via the embedded JSON block below.
   - Clean, neutral styling; dark-mode readable by default.
3. Write it to the repo (`docs/` or user-named path) or the session temp dir for throwaways — then reply with the absolute path plus a one-line summary of what's in it. The user opens it in a browser.

## Data pattern

Bake data into the page as an embedded JSON block — no `fetch()` to local
files (blocked under `file://`), no framework required:

```html
<script type="application/json" id="report-data">{"months":[...]}</script>
<script>
  const data = JSON.parse(document.getElementById('report-data').textContent);
</script>
```

Data and view stay separable: regenerate the JSON without touching the markup.

## Size & load budget (escalate to Svelte 5)

File size and load time are the budget — build time is not. Stay vanilla
until the report would cross one of these:

- inline JS approaching ~1,000 lines, or the `.html` file >500 kB
- 3+ linked interactive views (filters/tabs re-rendering shared state):
  hand-written DOM sync grows with every view, while Svelte 5's compiled
  output stays compact (~8-10 kB gzip runtime + components)

Past the budget, build with Vite + `vite-plugin-singlefile` so the
deliverable is still **one self-contained `.html` that works over
`file://`**, keeping the same embedded JSON data block. Never add Svelte to a
small report — a framework can only make it heavier; ~8 kB runtime plus a
pipeline buys nothing over 0 kB inline JS.

Escalated (interactive/Svelte) reports additionally get an automated
axe-core scan (Playwright + `@axe-core/playwright`, or the axe CLI) — static
checks don't cover widget semantics, focus order, or keyboard access.

## Craft standards

- Native primitives before JS: `<details>/<summary>` for collapsibles,
  `<dialog>` / popover API for modals and tooltips — most reports need no
  custom interactivity code at all.
- Container queries over media queries; charts and grids adapt to their
  container, not the viewport.
- `color-scheme: light dark` + `light-dark()` for dark mode instead of a
  duplicated palette.
- Accessibility + dataviz bar: semantic `<table>` alongside charts,
  SVG `<title>`/`<desc>` + `role="img"`, never color-only encoding, direct
  axis labels over legends.
- `@media print` styles, system font stack (no webfonts),
  `Intl.NumberFormat`/`Intl.DateTimeFormat` for currency and dates.

## Self-check before delivery

Run these statically while writing — no tooling; on simple reports they catch
most of what axe would flag:

- WCAG AA contrast on the chosen palette (4.5:1 body, 3:1 large text) —
  compute it, don't eyeball it.
- `lang` attribute, no skipped heading levels, `aria-label` or
  SVG `<title>`/`<desc>` on every non-text element.
- ≥16px body text, ~45-75ch line length, takeaway stated at the top of the
  page and in the one-line reply.

## Rules

- Never exfiltrate data: the file stays local, same as any other repo file.
- Keep it small enough to regenerate cheaply; prefer editing the existing report over creating a new file per iteration.
- No framework, no build by default; Svelte 5 single-file only past the size/complexity budget above.
- Minimize load time: embed only the fields the report renders, round numbers, charts as inline SVG (not base64 images), scripts at the end of `<body>`.

## Example

```
User: "chart my grocery spending by month"
1. Query transactions (expenses, category=groceries, signed amounts!) → monthly totals
2. Write docs/grocery-2026.html — inline SVG bar chart, data baked in
3. Reply: "docs/grocery-2026.html — 8 monthly bars, peak €612 in March"
```
