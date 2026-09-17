---
name: html-report
description: "Use when the user would understand faster from a visual than from chat text: charts, dashboards, budget/projection visuals, import summaries, or any rich report. Writes a self-contained HTML file the user opens in a browser. Examples: \"chart my spending\", \"visualize this projection\", \"make a dashboard\", \"show me as a report\""
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

## Workflow

1. Gather the data first (query code, DB, or files) — never hand-write plausible numbers; every figure must trace to a source.
2. Write **one self-contained `.html` file** (inline `<style>` + `<script>`, zero external requests so it works over `file://` offline):
   - Charts: inline SVG or dependency-free `<canvas>` JS. No CDN libraries.
   - No `fetch()` to local files (blocked under `file://`) — bake the data into the page.
   - Clean, neutral styling; dark-mode readable by default.
3. Write it to the repo (`docs/` or user-named path) or the session temp dir for throwaways — then reply with the absolute path plus a one-line summary of what's in it. The user opens it in a browser.

## Rules

- Never exfiltrate data: the file stays local, same as any other repo file.
- Keep it small enough to regenerate cheaply; prefer editing the existing report over creating a new file per iteration.

## Example

```
User: "chart my grocery spending by month"
1. Query transactions (expenses, category=groceries, signed amounts!) → monthly totals
2. Write docs/grocery-2026.html — inline SVG bar chart, data baked in
3. Reply: "docs/grocery-2026.html — 8 monthly bars, peak €612 in March"
```
