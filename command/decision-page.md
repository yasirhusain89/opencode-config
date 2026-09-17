---
description: Build a visual Q&A decision page for a design or planning topic — one interactive, visual demo per question plus a copy-as-Markdown decision record.
agent: build
---

$ARGUMENTS is the design/planning topic (e.g. "transaction categorization rules"). If it is empty or vague, ask what decision needs locking before doing anything else.

## Step 0 — Ground first

Read the project's `AGENTS.md` plus the docs relevant to the topic before drafting anything. Every example on the page must use the repo's real names, real conventions, and real sample values — never invented APIs. Cite `file:line` in the page footer for the sources used.

## Step 1 — Derive the lock-gate questions

From the topic and the conversation's think-through so far, list the decisions that gate implementation (schema shape, predicate semantics, conflict resolution, storage vs display, export format, UI home, rollout scope). Tag questions that block schema/API work as BLOCKER. Aim for 6–14 questions; each must have two genuinely different options (a recommended A and a real alternative B), never a strawman.

## Step 2 — Build the page

Create `docs/<slug>-decisions.html` (slug from the topic). Single self-contained file: inline CSS/JS, zero dependencies, no emoji in UI.

**Visual-explanation rule (hard requirement):** every question card must teach through something the user can *see*, not just read. Each card needs at least one of: a live interactive demo (reorder/toggle/type-and-watch), a before/after table, a match-matrix table, mini bars, or side-by-side sketches. Plain-text explanation is allowed only where a visual is genuinely impossible — and then the card must still show a concrete worked example with real values. Reuse one shared sample dataset across all cards so cause and effect stay comparable.

Required page structure:

1. Header: topic, one-line purpose, and the pipeline/stages strip if the design has phases.
2. Shared sample-data block (ledger rows, sample rules, sample entities — whatever the demos run against).
3. One card per question: title + BLOCKER tag where applicable, one-line "why this gates the build", the visual demo, then Option A (RECOMMENDED badge + one-line tradeoff) / Option B (ALTERNATIVE badge + one-line tradeoff) as radio inputs named `q1`…`qN`.
4. Sticky progress bar (`n of N decided`, updates on change).
5. Summary panel: builds a Markdown decision record live (`- Q-label: Option …` per question, `OPEN` for unanswered) with a Copy button (clipboard API + manual-copy fallback).

## Step 3 — Verify and open

1. Parse-check the HTML (e.g. Python `html.parser`) and confirm the radio count equals questions × 2.
2. Open it for the user (`open <file>` on macOS) and report the path plus how to reopen it.
3. Tell the user the loop: decide on the page → copy → paste the record back in chat → you lock the final spec from it.

## Step 4 — Close the loop (when the record comes back)

Turn the pasted record into a frozen, build-ready spec (semantics, schema, commands, UI, phases, tests). Offer to delete the helper HTML file once decisions are locked — it is a working aid, not app docs.
