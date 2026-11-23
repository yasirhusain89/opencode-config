#!/usr/bin/env node
/**
 * context_eval.mjs — Deterministic Session Context & Needed-Context Evaluator
 *
 * Scores OpenCode sessions from opencode.db (read-only) on:
 *   1. Needed Context Ratio (NCR, 0–100%): byte-weighted share of loaded tool
 *      context that was unique (non-duplicate within a compaction epoch),
 *      appropriately sized, and actually used (edited, cited in assistant
 *      findings, or bounded orientation/verification).
 *   2. Session Context Optimality Score (SCOS, 0–100): composite across 5
 *      coded dimensions:
 *        S1 (25 pts) Needed-Context Precision (from NCR)
 *        S2 (20 pts) Deduplication & Slice Discipline (duplicate line reads +
 *                    oversized >400-line full-file dumps)
 *        S3 (20 pts) Retrieval & Semantic Search Routing (search-thrash
 *                    detection, semantic:q / gitnexus usage when thrashing or
 *                    doing broad discovery, and repo index readiness)
 *        S4 (20 pts) KV-Cache Amplification & Delegation Hygiene (early-turn
 *                    context spikes, peak context vs 200k ceiling, compactions,
 *                    and subagent delegation vs main-session read dumps)
 *        S5 (15 pts) Tool & Bootstrap Hygiene (shell-for-read/grep anti-pattern,
 *                    unfiltered >8KB shell dumps, turn-1 static bootstrap ratio)
 *
 * Zero LLM calls (100% deterministic coded checks).
 *
 * Usage:
 *   node ~/.config/opencode/scripts/context_eval.mjs [options]
 *     --db <path>         Path to opencode.db (default: ~/.local/share/opencode/opencode.db)
 *     --project <substr>  Filter sessions by directory substring (e.g. mw5-advisor)
 *     --session <id>      Evaluate a single session ID in detail
 *     --min-turns <n>     Minimum assistant turns to include (default: 3)
 *     --limit <n>         Number of recent sessions to display in table (default: 15)
 *     --ollama-embed      Run local Ollama (nomic-embed-text on localhost:11434)
 *                         cosine-similarity checks to resolve the 3 semantic edge
 *                         cases (concept-prompt intent, implicit negative-proof
 *                         reads, oversized-slice relevance) with zero Go quota
 *     --suggest-thresholds
 *                         Print empirical rescue-rate curves per candidate cosine
 *                         threshold from the local calibration log (written by
 *                         --ollama-embed runs), flagging the elbow where marginal
 *                         gains flatten. Re-derive the 0.58/0.62 priors from this.
 *     --json              Emit machine-readable JSON report
 *     --self-test         Run deterministic unit assertions on synthetic fixtures
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const HOME = os.homedir();
const DEFAULT_DB = path.join(HOME, ".local/share/opencode/opencode.db");
const DEFAULT_CAL_LOG = path.join(
  HOME,
  ".local/share/opencode/context-eval-calibration.jsonl"
);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getOllamaUrl() {
  const raw = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
  const u = new URL(raw);
  if (!LOCAL_HOSTS.has(u.hostname) && process.env.SEMANTIC_ALLOW_REMOTE !== "1") {
    throw new Error(
      `Refusing non-localhost OLLAMA_URL=${raw} without SEMANTIC_ALLOW_REMOTE=1`
    );
  }
  return raw;
}

export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export async function ollamaEmbedBatch(texts, model = process.env.SEMANTIC_MODEL || "nomic-embed-text") {
  if (!texts.length) return [];
  const baseUrl = getOllamaUrl();
  const resp = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`Ollama /api/embed HTTP ${resp.status}`);
  }
  const body = await resp.json();
  return body.embeddings || [];
}

// Threshold constants for deterministic coded checks
export const THRESHOLDS = {
  OVERSIZED_READ_LINES: 400, // Single read call >400 lines without tight target
  ORIENTATION_MAX_LINES: 220, // First read of AGENTS.md / EXPERIENCE.md / package.json / Cargo.toml
  NEEDED_LINES_PER_SITE: 250, // Credited lines per edit/citation site before oversized penalty
  GREP_BUDGET_CHARS: 4000, // Per grep/glob output budget before match-flood penalty
  SHELL_VERIFY_BUDGET_CHARS: 4000, // Per verification command output budget
  SHELL_BLOAT_CHARS: 8000, // Shell output considered unfiltered bloat
  EARLY_TURNS_WINDOW: 10, // First N turns where context bloat amplifies across session
  EARLY_CTX_SPIKE_TOKENS: 80_000, // Context >80k within first 10 turns
  PEAK_CTX_SOFT_CAP: 180_000, // Soft ceiling before KV-cache / compaction pressure
  MAIN_DELEGATION_READ_CHARS: 80_000, // Main session reading >80KB across >=6 files without subagent
  SEMINDEX_STALE_DAYS: 7, // .semindex/index.db older than 7 days is flagged stale
};

const ORIENTATION_BASENAMES = new Set([
  "AGENTS.md",
  "EXPERIENCE.md",
  "README.md",
  "package.json",
  "Cargo.toml",
  "opencode.jsonc",
  "tsconfig.json",
]);

const SHELL_READ_ANTIPATTERN_RE =
  /^\s*(?:cat|sed\s+-n|head\b|tail\b|grep\b|rg\b|find\b|awk\b|wc\s+-l)\b/;

const SEMANTIC_CMD_RE =
  /(?:^|&&|\|\||;|\()\s*(?:(?:npm|pnpm)\s+(?:run\s+)?semantic:q\b|(?:uv\s+run[^\n;|]*|python3?\s+)[^\n;|]*semantic_index\.py\s+query\b)/;
const GITNEXUS_CODE_RE =
  /\bgitnexus[._](?:query|context|trace|impact|api_impact|cypher|pdg_query|explain)\b/;

/**
 * Inspect a project directory for semantic (.semindex/index.db) and graph (.gitnexus) readiness.
 */
export function checkRepoRetrievalIndex(dirPath, nowMs = Date.now()) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return { hasSemScript: false, semIndex: "missing", semAgeDays: null, gitnexus: "missing" };
  }
  const pkgPath = path.join(dirPath, "package.json");
  let hasSemScript = false;
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      hasSemScript = Boolean(pkg?.scripts?.["semantic:q"]);
    } catch {
      hasSemScript = false;
    }
  }
  const semDb = path.join(dirPath, ".semindex", "index.db");
  let semIndex = "missing";
  let semAgeDays = null;
  if (fs.existsSync(semDb)) {
    const mtimeMs = fs.statSync(semDb).mtimeMs;
    semAgeDays = +((nowMs - mtimeMs) / 86400e3).toFixed(1);
    semIndex = semAgeDays <= THRESHOLDS.SEMINDEX_STALE_DAYS ? "fresh" : "stale";
  }
  const gnDir = path.join(dirPath, ".gitnexus");
  let gitnexus = "missing";
  let gnAgeDays = null;
  if (fs.existsSync(gnDir)) {
    const mtimeMs = fs.statSync(gnDir).mtimeMs;
    gnAgeDays = +((nowMs - mtimeMs) / 86400e3).toFixed(1);
    gitnexus = gnAgeDays <= THRESHOLDS.SEMINDEX_STALE_DAYS ? "fresh" : "stale";
  }
  return { hasSemScript, semIndex, semAgeDays, gitnexus, gnAgeDays };
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

function normPath(p, workdir = "") {
  if (!p) return "";
  if (workdir && p.startsWith(workdir + "/")) {
    return p.slice(workdir.length + 1);
  }
  return p;
}

/**
 * Evaluate a single session's messages deterministically.
 * @param {object} meta - row from session_v2
 * @param {Array<{seq:number, type:string, data:string}>} rawMsgs - rows from session_message
 * @param {object} [repoStatus] - output of checkRepoRetrievalIndex
 */
export function evaluateSession(meta, rawMsgs, repoStatus = null) {
  const workdir = meta.directory || "";
  const repoIdx = repoStatus || checkRepoRetrievalIndex(workdir);

  let turns = 0;
  let compactions = 0;
  const turnCtxTokens = [];
  let turn1Tokens = 0;

  // Per-compaction-epoch line state: normPath -> Map<lineNum, "fresh" | "dirty">
  let fileLineState = new Map();
  // Aggregated reads across session: normPath -> Array<readRecord>
  const fileReads = new Map();
  const editedFiles = new Map(); // normPath -> editCount
  const assistantTexts = [];
  const userPrompts = [];

  let totalToolOutChars = 0;
  let totalReadCalls = 0;
  let totalReadChars = 0;
  let totalReadLines = 0;
  let unmodifiedDupReadCalls = 0;
  let unmodifiedDupLines = 0;
  let unmodifiedDupChars = 0;
  let postEditDupLines = 0;
  let postEditDupChars = 0;
  let oversizedReadCalls = 0;
  let oversizedExcessChars = 0;

  let grepCalls = 0;
  let emptyGrepCalls = 0;
  let grepChars = 0;
  let grepNeededChars = 0;
  let searchStreak = 0;
  let maxSearchStreak = 0;

  let shellCalls = 0;
  let shellChars = 0;
  let shellNeededChars = 0;
  let shellReadAntiPatternCalls = 0;
  let shellReadAntiPatternChars = 0;
  let shellBloatCalls = 0;

  let semanticSearchCalls = 0;
  let gitnexusSearchCalls = 0;
  let subagentCalls = 0;
  let subagentChars = 0;
  let skillCalls = 0;
  let skillChars = 0;
  let otherToolChars = 0;
  let otherNeededChars = 0;

  // Discovery streak before first edit/citation
  let uneditedFilesInStreak = new Set();

  for (const m of rawMsgs) {
    if (m.type === "compaction") {
      compactions++;
      fileLineState = new Map();
      continue;
    }
    if (m.type === "user") {
      try {
        const ud = JSON.parse(m.data);
        const ut =
          typeof ud.text === "string"
            ? ud.text
            : Array.isArray(ud.content)
              ? ud.content.map((x) => x.text || "").join("\n")
              : "";
        if (ut) userPrompts.push(ut);
      } catch {
        // ignore malformed user row
      }
      continue;
    }
    if (m.type !== "assistant") continue;
    let d;
    try {
      d = JSON.parse(m.data);
    } catch {
      continue;
    }

    if (d.tokens) {
      turns++;
      const ctx =
        (d.tokens.input || 0) +
        (d.tokens.cache?.read || 0) +
        (d.tokens.cache?.write || 0);
      if (ctx > 0) {
        turnCtxTokens.push({ turn: turns, seq: m.seq, ctx });
        if (turn1Tokens === 0) turn1Tokens = ctx;
      }
    }

    for (const c of d.content || []) {
      if (c.type === "text" && c.text) {
        assistantTexts.push(c.text);
        continue;
      }
      if (c.type !== "tool") continue;

      const name = c.name || "";
      const inp = c.state?.input || {};
      const outArr = Array.isArray(c.state?.content) ? c.state.content : [];
      const outText = outArr.map((x) => x.text || "").join("\n");
      const outLen = outText.length;
      totalToolOutChars += outLen;

      if (name === "edit" || name === "write" || name === "apply_patch") {
        const p = normPath(inp.path || "", workdir);
        if (p) {
          editedFiles.set(p, (editedFiles.get(p) || 0) + 1);
          const st = fileLineState.get(p);
          if (st) {
            for (const k of st.keys()) st.set(k, "dirty");
          }
        }
        searchStreak = 0;
        otherToolChars += outLen;
        otherNeededChars += Math.min(outLen, 2000);
      } else if (name === "read") {
        totalReadCalls++;
        totalReadChars += outLen;
        const p = normPath(inp.path || "", workdir);
        const mHeader = outText.match(
          /^Read (?:file|directory) .+?, (?:lines|entries) (\d+)-(\d+)/
        );
        const startLine = mHeader ? +mHeader[1] : inp.offset || 1;
        const endLine = mHeader
          ? +mHeader[2]
          : startLine + Math.max(1, outText.split("\n").length - 2);
        const span = Math.max(1, endLine - startLine + 1);
        totalReadLines += span;

        if (!fileLineState.has(p)) fileLineState.set(p, new Map());
        const st = fileLineState.get(p);
        let freshOverlap = 0;
        let dirtyOverlap = 0;
        for (let ln = startLine; ln <= endLine; ln++) {
          const prev = st.get(ln);
          if (prev === "fresh") freshOverlap++;
          else if (prev === "dirty") dirtyOverlap++;
          st.set(ln, "fresh");
        }

        if (freshOverlap > 0) unmodifiedDupReadCalls++;
        unmodifiedDupLines += freshOverlap;
        postEditDupLines += dirtyOverlap;

        const freshDupChars = Math.round(outLen * (freshOverlap / span));
        const dirtyDupChars = Math.round(outLen * (dirtyOverlap / span));
        const uniqueFreshChars = Math.max(0, outLen - freshDupChars - dirtyDupChars);

        unmodifiedDupChars += freshDupChars;
        postEditDupChars += dirtyDupChars;

        const isOversized = span > THRESHOLDS.OVERSIZED_READ_LINES;
        if (isOversized) oversizedReadCalls++;
        else searchStreak = 0; // A targeted slice read means the preceding search landed

        if (!fileReads.has(p)) fileReads.set(p, []);
        fileReads.get(p).push({
          seq: m.seq,
          startLine,
          endLine,
          span,
          outLen,
          uniqueFreshChars,
          freshDupChars,
          dirtyDupChars,
          isOversized,
          snippet: outText.slice(0, 1400),
          tailSnippet: isOversized ? outText.slice(-1400) : "",
        });
      } else if (name === "grep" || name === "glob") {
        grepCalls++;
        grepChars += outLen;
        searchStreak++;
        if (searchStreak > maxSearchStreak) maxSearchStreak = searchStreak;
        const isEmpty = /No files found|No matches found|^$/i.test(outText.trim());
        if (isEmpty) {
          emptyGrepCalls++;
        } else {
          grepNeededChars += Math.min(outLen, THRESHOLDS.GREP_BUDGET_CHARS);
        }
      } else if (name === "shell" || name === "bash") {
        shellCalls++;
        shellChars += outLen;
        const cmd = (inp.command || "").trim();
        if (SEMANTIC_CMD_RE.test(cmd)) {
          semanticSearchCalls++;
          searchStreak = 0;
          shellNeededChars += Math.min(outLen, THRESHOLDS.GREP_BUDGET_CHARS);
        } else if (SHELL_READ_ANTIPATTERN_RE.test(cmd)) {
          shellReadAntiPatternCalls++;
          shellReadAntiPatternChars += outLen;
          // Credit at most 25% of shell-read anti-pattern output
          shellNeededChars += Math.round(Math.min(outLen, 2000) * 0.25);
        } else {
          if (outLen > THRESHOLDS.SHELL_BLOAT_CHARS) shellBloatCalls++;
          shellNeededChars += Math.min(outLen, THRESHOLDS.SHELL_VERIFY_BUDGET_CHARS);
        }
      } else if (name === "execute") {
        const code = inp.code || "";
        if (GITNEXUS_CODE_RE.test(code)) {
          gitnexusSearchCalls++;
          searchStreak = 0;
          otherToolChars += outLen;
          otherNeededChars += Math.min(outLen, THRESHOLDS.GREP_BUDGET_CHARS);
        } else {
          otherToolChars += outLen;
          otherNeededChars += Math.min(outLen, THRESHOLDS.SHELL_VERIFY_BUDGET_CHARS);
        }
      } else if (name.startsWith("gitnexus_")) {
        if (GITNEXUS_CODE_RE.test(name.replace("gitnexus_", "gitnexus."))) {
          gitnexusSearchCalls++;
          searchStreak = 0;
        }
        otherToolChars += outLen;
        otherNeededChars += Math.min(outLen, THRESHOLDS.GREP_BUDGET_CHARS);
      } else if (name === "subagent" || name === "task") {
        subagentCalls++;
        subagentChars += outLen;
        otherToolChars += outLen;
        otherNeededChars += Math.min(outLen, 8000);
      } else if (name === "skill") {
        skillCalls++;
        skillChars += outLen;
        otherToolChars += outLen;
        otherNeededChars += Math.min(outLen, 15000);
      } else {
        otherToolChars += outLen;
        otherNeededChars += Math.min(outLen, 3000);
      }
    }
  }

  // Classify each read file as Needed vs Dead, and compute Needed Read Chars
  const fullAssistantText = assistantTexts.join("\n");
  let neededReadChars = 0;
  let deadReadChars = 0;
  let deadFilesCount = 0;
  let usedFilesCount = 0;

  const deadFileCandidates = [];
  const oversizedCandidates = [];
  const usedBasenames = [];

  for (const [p, reads] of fileReads) {
    const base = path.basename(p);
    const editCount =
      editedFiles.get(p) ||
      [...editedFiles.entries()].find(
        ([ef]) => ef.endsWith("/" + base) || p.endsWith("/" + path.basename(ef))
      )?.[1] ||
      0;
    const wasEdited = editCount > 0;
    // Count how many times the file basename or path is cited in assistant responses
    const citeMatches =
      base.length > 2
        ? fullAssistantText.split(base).length - 1
        : 0;
    const wasCited = citeMatches > 0;
    const isOrientation =
      ORIENTATION_BASENAMES.has(base) &&
      reads.length === 1 &&
      reads[0].span <= THRESHOLDS.ORIENTATION_MAX_LINES;

    const isUsed = wasEdited || wasCited || isOrientation;
    if (!isUsed) {
      deadFilesCount++;
      uneditedFilesInStreak.add(p);
      let uniqueCharsForFile = 0;
      for (const r of reads) {
        deadReadChars += r.outLen;
        uniqueCharsForFile += r.uniqueFreshChars;
      }
      deadFileCandidates.push({
        path: p,
        uniqueFreshChars: uniqueCharsForFile,
        snippet: reads[0]?.snippet || p,
      });
      continue;
    }

    usedFilesCount++;
    usedBasenames.push(base);
    const actionSites = Math.max(1, editCount + Math.min(4, citeMatches));
    const maxCreditedLinesPerCall = Math.max(
      THRESHOLDS.OVERSIZED_READ_LINES,
      actionSites * THRESHOLDS.NEEDED_LINES_PER_SITE
    );

    for (const r of reads) {
      // Credit unique fresh lines up to maxCreditedLinesPerCall
      const sliceFactor =
        r.span > maxCreditedLinesPerCall ? maxCreditedLinesPerCall / r.span : 1;
      const creditedFresh = Math.round(r.uniqueFreshChars * sliceFactor);
      const excessFresh = r.uniqueFreshChars - creditedFresh;
      oversizedExcessChars += excessFresh;
      if (excessFresh > 500 && r.tailSnippet) {
        oversizedCandidates.push({
          path: p,
          excessFresh,
          snippet: r.tailSnippet,
        });
      }

      // Credit at most 50% of small post-edit verification reads (<=80 lines)
      const creditedPostEdit =
        r.span <= 80 ? Math.round(r.dirtyDupChars * 0.5) : 0;

      neededReadChars += creditedFresh + creditedPostEdit;
    }
  }

  const totalNeededChars =
    neededReadChars + grepNeededChars + shellNeededChars + otherNeededChars;
  const ncr =
    totalToolOutChars > 0
      ? clamp((totalNeededChars / totalToolOutChars) * 100, 0, 100)
      : 100;

  // Determine whether semantic / graph search was needed in this session
  // Needed when:
  //   (a) Search thrash: >=4 consecutive searches without landing on a targeted read/edit,
  //       or >=2 empty grep misses (or >=1 empty grep when >=25% of greps miss)
  //   (b) Broad blind file discovery: >=4 dead (unedited+uncited) files read
  //   (c) Massive top-to-bottom full-file scanning: >=3 oversized (>400 line) reads with 0 semantic/graph calls
  const hadLexicalThrash =
    maxSearchStreak >= 4 ||
    emptyGrepCalls >= 2 ||
    (grepCalls >= 3 && emptyGrepCalls >= 1 && emptyGrepCalls / grepCalls >= 0.25);
  const hadBlindFileHunt = deadFilesCount >= 4;
  const hadBruteForceFullRead = oversizedReadCalls >= 3 && grepCalls < 2;
  const semanticNeeded =
    hadLexicalThrash || hadBlindFileHunt || hadBruteForceFullRead;
  const usedSemanticOrGraph =
    semanticSearchCalls > 0 || gitnexusSearchCalls > 0;

  // KV-cache trajectory stats
  const ctxValues = turnCtxTokens.map((t) => t.ctx);
  const peakCtxTokens = ctxValues.length ? Math.max(...ctxValues) : 0;
  const avgCtxTokens = ctxValues.length
    ? Math.round(ctxValues.reduce((a, b) => a + b, 0) / ctxValues.length)
    : 0;
  const sumCtxTokens = ctxValues.reduce((a, b) => a + b, 0);
  const earlyTurns = turnCtxTokens.filter(
    (t) => t.turn <= THRESHOLDS.EARLY_TURNS_WINDOW
  );
  const earlyPeakCtxTokens = earlyTurns.length
    ? Math.max(...earlyTurns.map((t) => t.ctx))
    : 0;
  const earlySpike = earlyPeakCtxTokens > THRESHOLDS.EARLY_CTX_SPIKE_TOKENS;

  // Did a main session do heavy multi-file reading in-process instead of delegating?
  const isMainSession = !meta.parent_id && meta.agent !== "researcher" && meta.agent !== "explore" && meta.agent !== "reviewer";
  const neededDelegation =
    isMainSession &&
    turns >= 15 &&
    totalReadChars > THRESHOLDS.MAIN_DELEGATION_READ_CHARS &&
    fileReads.size >= 6;
  const usedDelegation = subagentCalls > 0;

  // --- Compute the 5 deterministic sub-scores (SCOS = S1 + S2 + S3 + S4 + S5) ---

  // S1: Needed-Context Precision (25 pts)
  // Full 25 pts at NCR >= 80%, linear scale down to 0 at NCR = 0%
  const s1_precision = +(25 * clamp(ncr / 80, 0, 1)).toFixed(2);

  // S2: Deduplication & Slice Discipline (20 pts)
  // 12 pts for low unmodified duplicate line rate; 8 pts for low oversized read call rate
  const dupLineRate =
    totalReadLines > 0 ? unmodifiedDupLines / totalReadLines : 0;
  const oversizedCallRate =
    totalReadCalls > 0 ? oversizedReadCalls / totalReadCalls : 0;
  const s2_dedup = +(
    12 * clamp(1 - dupLineRate / 0.5, 0, 1) +
    8 * clamp(1 - oversizedCallRate / 0.5, 0, 1)
  ).toFixed(2);

  // S3: Retrieval & Semantic Search Routing (20 pts)
  // Starts at 20 pts; deducts for unmitigated search thrash, blind file hunts,
  // brute-force full-file scans without semantic/graph search, and missing/stale repo index
  let s3 = 20;
  if (semanticNeeded && !usedSemanticOrGraph) {
    if (hadLexicalThrash) s3 -= 7;
    if (hadBlindFileHunt) s3 -= 6;
    if (hadBruteForceFullRead) s3 -= 5;
  } else if (semanticNeeded && usedSemanticOrGraph) {
    // Used semantic/graph search when needed — mild deduction only if dead reads still high
    if (deadFilesCount >= 8) s3 -= 3;
  }
  if (repoIdx.semIndex === "missing" && repoIdx.gitnexus === "missing") {
    s3 -= 4;
  } else if (repoIdx.semIndex === "stale") {
    s3 -= 2;
  }
  const s3_retrieval = +clamp(s3, 0, 20).toFixed(2);

  // S4: KV-Cache Amplification & Delegation Hygiene (20 pts)
  let s4 = 20;
  if (earlySpike) {
    // Penalty proportional to how far early peak exceeded 80k (up to 7 pts)
    s4 -= clamp(((earlyPeakCtxTokens - THRESHOLDS.EARLY_CTX_SPIKE_TOKENS) / 120_000) * 7, 2, 7);
  }
  if (peakCtxTokens > THRESHOLDS.PEAK_CTX_SOFT_CAP) {
    s4 -= clamp(((peakCtxTokens - THRESHOLDS.PEAK_CTX_SOFT_CAP) / 150_000) * 6, 1, 6);
  }
  if (compactions > 0) {
    s4 -= Math.min(4, compactions * 2);
  }
  if (neededDelegation && !usedDelegation) {
    s4 -= 5;
  }
  const s4_cache = +clamp(s4, 0, 20).toFixed(2);

  // S5: Tool & Bootstrap Hygiene (15 pts)
  let s5 = 15;
  if (shellReadAntiPatternCalls > 0) {
    s5 -= Math.min(6, shellReadAntiPatternCalls * 1.5);
  }
  if (shellBloatCalls > 0) {
    s5 -= Math.min(5, shellBloatCalls * 1.5);
  }
  // Turn-1 static bootstrap overhead penalty if turn1 > 12.5k and session is short (<8 turns)
  if (turn1Tokens > 12_500 && turns > 0 && turns < 8) {
    s5 -= 2;
  }
  const s5_hygiene = +clamp(s5, 0, 15).toFixed(2);

  const scos = +(
    s1_precision +
    s2_dedup +
    s3_retrieval +
    s4_cache +
    s5_hygiene
  ).toFixed(1);

  return {
    id: meta.id,
    directory: workdir,
    project: path.basename(workdir || "unknown"),
    title: meta.title || "(untitled)",
    agent: meta.agent || "main",
    isSubagent: Boolean(meta.parent_id),
    timeCreated: meta.time_created,
    turns,
    compactions,
    scores: {
      scos,
      ncr: +ncr.toFixed(1),
      s1_precision,
      s2_dedup,
      s3_retrieval,
      s4_cache,
      s5_hygiene,
    },
    contextBytes: {
      totalToolOutChars,
      totalNeededChars,
      totalReadChars,
      neededReadChars,
      unmodifiedDupChars,
      postEditDupChars,
      oversizedExcessChars,
      deadReadChars,
      grepChars,
      shellChars,
      subagentChars,
      skillChars,
    },
    reads: {
      totalReadCalls,
      distinctFilesRead: fileReads.size,
      usedFilesCount,
      deadFilesCount,
      totalReadLines,
      unmodifiedDupReadCalls,
      unmodifiedDupLines,
      dupLinePct:
        totalReadLines > 0
          ? +((unmodifiedDupLines * 100) / totalReadLines).toFixed(1)
          : 0,
      oversizedReadCalls,
    },
    retrieval: {
      grepCalls,
      emptyGrepCalls,
      maxSearchStreak,
      semanticSearchCalls,
      gitnexusSearchCalls,
      semanticNeeded,
      hadLexicalThrash,
      hadBlindFileHunt,
      hadBruteForceFullRead,
      usedSemanticOrGraph,
      repoIndex: repoIdx,
    },
    cacheTrajectory: {
      turn1Tokens,
      earlyPeakCtxTokens,
      peakCtxTokens,
      avgCtxTokens,
      sumCtxTokens,
      earlySpike,
      neededDelegation,
      usedDelegation,
      subagentCalls,
    },
    hygiene: {
      shellCalls,
      shellReadAntiPatternCalls,
      shellReadAntiPatternChars,
      shellBloatCalls,
    },
    _embedCandidates: {
      promptText: userPrompts.slice(0, 2).join("\n").slice(0, 1400),
      outcomeText: assistantTexts.slice(-2).join("\n").slice(0, 1400),
      usedBasenames,
      deadFileCandidates: deadFileCandidates.slice(0, 16),
      oversizedCandidates: oversizedCandidates.slice(0, 12),
    },
  };
}

/**
 * Resolve the 3 semantic edge cases using local Ollama embeddings (nomic-embed-text, 0 Go quota):
 *   1. Concept prompt vs lexical prompt intent (exAnteConceptPrompt)
 *   2. Rescuing unedited+uncited read files that have high semantic cosine similarity (>=0.65)
 *      to the prompt+outcome (negative proof / supporting architectural context)
 *   3. Rescuing oversized read slices whose tail content has high cosine similarity (>=0.70)
 */
export async function enrichWithOllamaEmbeddings(ev) {
  const cand = ev._embedCandidates;
  if (!cand) return ev;

  const anchorText = `${cand.promptText}\n${cand.outcomeText}`.trim();
  if (!anchorText) {
    delete ev._embedCandidates;
    return ev;
  }

  // Edge Case 1: Did the user prompt explicitly mention the used filenames, or was it conceptual?
  const promptLower = (cand.promptText || "").toLowerCase();
  const mentionedUsedFiles = cand.usedBasenames.filter((b) =>
    promptLower.includes(b.toLowerCase().replace(/\.[^.]+$/, ""))
  );
  const lexicalAnchorRatio =
    cand.usedBasenames.length > 0
      ? +(mentionedUsedFiles.length / cand.usedBasenames.length).toFixed(2)
      : 0;

  const inputs = [anchorText];
  if (cand.promptText && cand.outcomeText) {
    inputs.push(cand.promptText, cand.outcomeText);
  }
  const deadStartIdx = inputs.length;
  for (const d of cand.deadFileCandidates) inputs.push(d.snippet);
  const overStartIdx = inputs.length;
  for (const o of cand.oversizedCandidates) inputs.push(o.snippet);

  const vecs = await ollamaEmbedBatch(inputs);
  const anchorVec = vecs[0];
  let promptOutcomeSim = null;
  if (cand.promptText && cand.outcomeText && vecs[1] && vecs[2]) {
    promptOutcomeSim = +cosineSim(vecs[1], vecs[2]).toFixed(3);
  }

  // Edge Case 2: Rescue semantically relevant dead files (nomic-embed-text code-to-prose cosine >= 0.58)
  let rescuedFiles = 0;
  let rescuedChars = 0;
  const deadFileSimilarities = [];
  for (let i = 0; i < cand.deadFileCandidates.length; i++) {
    const d = cand.deadFileCandidates[i];
    const v = vecs[deadStartIdx + i];
    const sim = +cosineSim(anchorVec, v).toFixed(3);
    const rescued = sim >= 0.58;
    if (rescued) {
      rescuedFiles++;
      // Credit 75% of unique fresh chars (up to 16KB per file) as supporting context
      rescuedChars += Math.round(Math.min(d.uniqueFreshChars, 16_000) * 0.75);
    }
    deadFileSimilarities.push({ path: d.path, cosine: sim, rescued });
  }

  // Edge Case 3: Rescue semantically relevant oversized slice tails (cosine >= 0.62)
  let rescuedSliceChars = 0;
  const oversizedSimilarities = [];
  for (let i = 0; i < cand.oversizedCandidates.length; i++) {
    const o = cand.oversizedCandidates[i];
    const v = vecs[overStartIdx + i];
    const sim = +cosineSim(anchorVec, v).toFixed(3);
    oversizedSimilarities.push(sim);
    if (sim >= 0.62) {
      rescuedSliceChars += Math.round(o.excessFresh * 0.5);
    }
  }

  const adjNeededChars =
    ev.contextBytes.totalNeededChars + rescuedChars + rescuedSliceChars;
  const adjNCR =
    ev.contextBytes.totalToolOutChars > 0
      ? +clamp((adjNeededChars * 100) / ev.contextBytes.totalToolOutChars, 0, 100).toFixed(1)
      : ev.scores.ncr;
  const adjS1 = +(25 * clamp(adjNCR / 80, 0, 1)).toFixed(2);

  // Ex-ante concept prompt detection: user prompt had 0 filename anchors and read >=3 files
  const exAnteConceptPrompt =
    lexicalAnchorRatio === 0 &&
    ev.reads.distinctFilesRead >= 3 &&
    (promptOutcomeSim === null || promptOutcomeSim >= 0.50);

  const adjSCOS = +(
    adjS1 +
    ev.scores.s2_dedup +
    ev.scores.s3_retrieval +
    ev.scores.s4_cache +
    ev.scores.s5_hygiene
  ).toFixed(1);

  ev.ollamaSemantic = {
    lexicalAnchorRatio,
    promptOutcomeSim,
    exAnteConceptPrompt,
    rescuedSupportingFiles: rescuedFiles,
    rescuedSupportingChars: rescuedChars,
    rescuedOversizedSliceChars: rescuedSliceChars,
    adjustedNCR: adjNCR,
    adjustedSCOS: adjSCOS,
    deadFileSimilarities,
  };
  delete ev._embedCandidates;

  // Calibration-over-time: append this session's raw cosine observations to a
  // local JSONL log (zero quota, local-only). Thresholds below stay as user-set
  // bootstrap priors; re-derive them empirically with --suggest-thresholds
  // once the log holds enough sessions. Never throws.
  try {
    const logPath = process.env.CONTEXT_EVAL_CAL_LOG || DEFAULT_CAL_LOG;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        ts: Date.now(),
        session: ev.id,
        project: ev.project,
        deadCosines: deadFileSimilarities.map((d) => d.cosine),
        oversizedCosines: oversizedSimilarities,
        rescuedSupportingFiles: rescuedFiles,
        rescuedSupportingChars: rescuedChars,
        rescuedOversizedSliceChars: rescuedSliceChars,
        adjustedNCR: adjNCR,
        adjustedSCOS: adjSCOS,
      }) + "\n"
    );
  } catch {
    // calibration logging is best-effort; scoring must never fail on it
  }
  return ev;
}

/**
 * Run deterministic unit self-tests on synthetic session fixtures.
 */
export function runSelfTest() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`Self-test failed: ${msg}`);
  };

  // Fixture 1: Optimal surgical session (targeted grep -> small slice read -> edit -> cite)
  const optimalMeta = {
    id: "ses_test_optimal",
    directory: "/tmp/proj",
    title: "Surgical fix",
    agent: "build",
    parent_id: null,
    time_created: Date.now(),
  };
  const optimalMsgs = [
    {
      seq: 1,
      type: "assistant",
      data: JSON.stringify({
        tokens: { input: 9000, output: 100, cache: { read: 0, write: 0 } },
        content: [
          {
            type: "tool",
            name: "grep",
            state: {
              input: { pattern: "calcTotal" },
              content: [{ type: "text", text: "src/math.ts:42: export function calcTotal()" }],
            },
          },
          {
            type: "tool",
            name: "read",
            state: {
              input: { path: "src/math.ts", offset: 35, limit: 30 },
              content: [
                {
                  type: "text",
                  text: "Read file src/math.ts, lines 35-64\n" + "x\n".repeat(30),
                },
              ],
            },
          },
        ],
      }),
    },
    {
      seq: 2,
      type: "assistant",
      data: JSON.stringify({
        tokens: { input: 500, output: 80, cache: { read: 9100, write: 0 } },
        content: [
          {
            type: "tool",
            name: "edit",
            state: {
              input: { path: "src/math.ts", oldString: "a", newString: "b" },
              content: [{ type: "text", text: "Edited src/math.ts" }],
            },
          },
          {
            type: "text",
            text: "Fixed the rounding bug in `src/math.ts:42`.",
          },
        ],
      }),
    },
  ];
  const rOpt = evaluateSession(optimalMeta, optimalMsgs, {
    hasSemScript: true,
    semIndex: "fresh",
    semAgeDays: 1,
    gitnexus: "fresh",
  });
  assert(rOpt.scores.ncr >= 90, `Expected optimal NCR >= 90, got ${rOpt.scores.ncr}`);
  assert(rOpt.scores.scos >= 90, `Expected optimal SCOS >= 90, got ${rOpt.scores.scos}`);
  assert(rOpt.reads.unmodifiedDupLines === 0, "Expected 0 dup lines");

  // Fixture 2: Bloated thrashing session (duplicate full reads, dead reads, empty greps, no semantic search)
  const bloatedMsgs = [
    {
      seq: 1,
      type: "assistant",
      data: JSON.stringify({
        tokens: { input: 14000, output: 100, cache: { read: 110000, write: 0 } },
        content: [
          ...[1, 2, 3, 4].map((i) => ({
            type: "tool",
            name: "grep",
            state: {
              input: { pattern: `unknown_concept_${i}` },
              content: [{ type: "text", text: "No matches found" }],
            },
          })),
          ...[1, 2, 3, 4, 5].map((i) => ({
            type: "tool",
            name: "read",
            state: {
              input: { path: `src/dead_${i}.ts` },
              content: [
                {
                  type: "text",
                  text: `Read file src/dead_${i}.ts, lines 1-600\n` + "line content here\n".repeat(600),
                },
              ],
            },
          })),
          // Duplicate unmodified read of dead_1.ts
          {
            type: "tool",
            name: "read",
            state: {
              input: { path: "src/dead_1.ts" },
              content: [
                {
                  type: "text",
                  text: "Read file src/dead_1.ts, lines 1-600\n" + "line content here\n".repeat(600),
                },
              ],
            },
          },
          {
            type: "tool",
            name: "shell",
            state: {
              input: { command: "cat src/dead_2.ts" },
              content: [{ type: "text", text: "x".repeat(10000) }],
            },
          },
        ],
      }),
    },
  ];
  const rBloat = evaluateSession(optimalMeta, bloatedMsgs, {
    hasSemScript: false,
    semIndex: "missing",
    semAgeDays: null,
    gitnexus: "missing",
  });
  assert(rBloat.scores.ncr < 15, `Expected bloated NCR < 15, got ${rBloat.scores.ncr}`);
  assert(rBloat.scores.scos < 45, `Expected bloated SCOS < 45, got ${rBloat.scores.scos}`);
  assert(rBloat.retrieval.semanticNeeded === true, "Expected semanticNeeded=true");
  assert(rBloat.retrieval.usedSemanticOrGraph === false, "Expected usedSemanticOrGraph=false");

  // Calibration-log + threshold-suggestion path (local-only, no embeddings needed)
  const tmpLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ctxeval-")), "cal.jsonl");
  fs.appendFileSync(
    tmpLog,
    JSON.stringify({ ts: 1, session: "s1", project: "p", deadCosines: [0.5, 0.6, 0.7], oversizedCosines: [0.55] }) + "\n"
  );
  const captured = [];
  const origLog = console.log;
  console.log = (...a) => captured.push(a.join(" "));
  try {
    suggestThresholds(tmpLog);
  } finally {
    console.log = origLog;
  }
  const out = captured.join("\n");
  assert(out.includes("Calibration: 1 enriched sessions"), "Expected calibration session count");
  assert(out.includes("Dead-file supporting-context rescue: 3 observations"), "Expected dead-file curve");
  assert(out.includes("Oversized-slice-tail rescue: 1 observations"), "Expected slice-tail curve");
  fs.rmSync(path.dirname(tmpLog), { recursive: true, force: true });

  console.log("self-test OK (optimal SCOS=" + rOpt.scores.scos + ", bloated SCOS=" + rBloat.scores.scos + ")");
}

/**
 * Suggest empirically grounded rescue thresholds from the calibration log.
 * For each candidate threshold, counts how many dead-file / oversized-slice
 * observations would be rescued, and flags the elbow where marginal gains
 * drop below 10% of the total rescued at the loosest threshold.
 */
export function suggestThresholds(logPath = process.env.CONTEXT_EVAL_CAL_LOG || DEFAULT_CAL_LOG) {
  let lines = [];
  try {
    lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    console.log(`No calibration log yet at ${logPath}. Run with --ollama-embed first.`);
    return;
  }
  const dead = [];
  const over = [];
  for (const ln of lines) {
    try {
      const r = JSON.parse(ln);
      if (Array.isArray(r.deadCosines)) dead.push(...r.deadCosines);
      if (Array.isArray(r.oversizedCosines)) over.push(...r.oversizedCosines);
    } catch {
      // skip malformed lines
    }
  }
  const report = (label, sims, current) => {
    console.log(`\n${label}: ${sims.length} observations across ${lines.length} sessions (current rescue >= ${current})`);
    console.log("thr    rescued   marginal");
    let prev = sims.length;
    let first = true;
    for (let t = 0.5; t <= 0.7501; t += 0.05) {
      const thr = +t.toFixed(2);
      const n = sims.filter((s) => s >= thr).length;
      const marginal = first ? n : prev - n;
      const elbow = !first && prev > 0 && marginal / prev < 0.1 ? "  <-- elbow" : "";
      const mark = Math.abs(thr - current) < 0.001 ? "  <-- current" : "";
      console.log(`${thr.toFixed(2)}   ${String(n).padStart(7)}   ${String(marginal).padStart(7)}${mark}${elbow}`);
      prev = n;
      first = false;
    }
  };
  console.log(`Calibration: ${lines.length} enriched sessions`);
  report("Dead-file supporting-context rescue", dead, 0.58);
  report("Oversized-slice-tail rescue", over, 0.62);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    runSelfTest();
    return;
  }
  if (args.includes("--suggest-thresholds")) {
    const getArg = (flag, def = null) => {
      const idx = args.indexOf(flag);
      return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : def;
    };
    suggestThresholds(getArg("--cal-log", process.env.CONTEXT_EVAL_CAL_LOG || DEFAULT_CAL_LOG));
    return;
  }

  const getArg = (flag, def = null) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : def;
  };
  const dbPath = getArg("--db", DEFAULT_DB);
  const projectFilter = getArg("--project", null);
  const sessionFilter = getArg("--session", null);
  const minTurns = parseInt(getArg("--min-turns", "3"), 10);
  const limit = parseInt(getArg("--limit", "15"), 10);
  const asJson = args.includes("--json");
  const useOllamaEmbed = args.includes("--ollama-embed");

  const db = new DatabaseSync(dbPath, { readOnly: true });

  let sql = `
    SELECT id, directory, title, agent, parent_id, cost,
           tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
           time_created
    FROM session_v2
    WHERE (tokens_input + tokens_cache_read) > 0
  `;
  const params = [];
  if (sessionFilter) {
    sql += ` AND id = ?`;
    params.push(sessionFilter);
  } else if (projectFilter) {
    sql += ` AND directory LIKE ?`;
    params.push(`%${projectFilter}%`);
  }
  sql += ` ORDER BY time_created DESC`;

  const sessions = db.prepare(sql).all(...params);
  const msgStmt = db.prepare(`
    SELECT seq, type, data
    FROM session_message
    WHERE session_id = ? AND type IN ('assistant', 'compaction', 'user')
    ORDER BY seq
  `);

  const repoCache = new Map();
  const results = [];

  for (const meta of sessions) {
    if (!repoCache.has(meta.directory)) {
      repoCache.set(meta.directory, checkRepoRetrievalIndex(meta.directory));
    }
    const rawMsgs = msgStmt.all(meta.id);
    const ev = evaluateSession(meta, rawMsgs, repoCache.get(meta.directory));
    if (!sessionFilter && ev.turns < minTurns) continue;
    results.push(ev);
  }

  if (useOllamaEmbed) {
    const targetSlice = results.slice(0, limit);
    for (const r of targetSlice) {
      await enrichWithOllamaEmbeddings(r);
    }
  }
  for (const r of results) {
    delete r._embedCandidates;
  }

  // Aggregate summary
  const n = results.length || 1;
  const avg = (fn) => +(results.reduce((s, r) => s + fn(r), 0) / n).toFixed(1);
  const sum = (fn) => results.reduce((s, r) => s + fn(r), 0);

  const totToolChars = sum((r) => r.contextBytes.totalToolOutChars);
  const totNeededChars = sum((r) => r.contextBytes.totalNeededChars);
  const totReadChars = sum((r) => r.contextBytes.totalReadChars);
  const totNeededReadChars = sum((r) => r.contextBytes.neededReadChars);
  const totDupReadChars = sum((r) => r.contextBytes.unmodifiedDupChars);
  const totDeadReadChars = sum((r) => r.contextBytes.deadReadChars);
  const totOversizedChars = sum((r) => r.contextBytes.oversizedExcessChars);
  const totReadLines = sum((r) => r.reads.totalReadLines);
  const totDupLines = sum((r) => r.reads.unmodifiedDupLines);

  const semanticNeededSessions = results.filter((r) => r.retrieval.semanticNeeded);
  const semanticUsedWhenNeeded = semanticNeededSessions.filter(
    (r) => r.retrieval.usedSemanticOrGraph
  );
  const delegationNeededSessions = results.filter((r) => r.cacheTrajectory.neededDelegation);
  const delegationUsedWhenNeeded = delegationNeededSessions.filter(
    (r) => r.cacheTrajectory.usedDelegation
  );

  const summary = {
    evaluatedSessions: results.length,
    minTurnsFilter: minTurns,
    aggregateScores: {
      meanSCOS: avg((r) => r.scores.scos),
      meanSessionNCR: avg((r) => r.scores.ncr),
      byteWeightedNCR:
        totToolChars > 0 ? +((totNeededChars * 100) / totToolChars).toFixed(1) : 100,
      meanS1_Precision_25: avg((r) => r.scores.s1_precision),
      meanS2_Dedup_20: avg((r) => r.scores.s2_dedup),
      meanS3_Retrieval_20: avg((r) => r.scores.s3_retrieval),
      meanS4_Cache_20: avg((r) => r.scores.s4_cache),
      meanS5_Hygiene_15: avg((r) => r.scores.s5_hygiene),
    },
    contextBreakdownMB: {
      totalToolOutputMB: +(totToolChars / 1e6).toFixed(2),
      totalNeededOutputMB: +(totNeededChars / 1e6).toFixed(2),
      totalReadMB: +(totReadChars / 1e6).toFixed(2),
      neededReadMB: +(totNeededReadChars / 1e6).toFixed(2),
      unmodifiedDupReadMB: +(totDupReadChars / 1e6).toFixed(2),
      oversizedSliceExcessMB: +(totOversizedChars / 1e6).toFixed(2),
      deadExploratoryReadMB: +(totDeadReadChars / 1e6).toFixed(2),
      unmodifiedDupLinePct:
        totReadLines > 0 ? +((totDupLines * 100) / totReadLines).toFixed(1) : 0,
    },
    retrievalAndDelegation: {
      semanticNeededCount: semanticNeededSessions.length,
      semanticNeededPct: +((semanticNeededSessions.length * 100) / n).toFixed(1),
      semanticUsedWhenNeededCount: semanticUsedWhenNeeded.length,
      semanticAdoptionWhenNeededPct:
        semanticNeededSessions.length > 0
          ? +((semanticUsedWhenNeeded.length * 100) / semanticNeededSessions.length).toFixed(1)
          : 100,
      totalSemanticCalls: sum((r) => r.retrieval.semanticSearchCalls),
      totalGitnexusCalls: sum((r) => r.retrieval.gitnexusSearchCalls),
      delegationNeededCount: delegationNeededSessions.length,
      delegationUsedWhenNeededCount: delegationUsedWhenNeeded.length,
      earlySpikeSessionsCount: results.filter((r) => r.cacheTrajectory.earlySpike).length,
      compactionSessionsCount: results.filter((r) => r.compactions > 0).length,
      shellReadAntiPatternCalls: sum((r) => r.hygiene.shellReadAntiPatternCalls),
    },
    repoRetrievalReadiness: Object.fromEntries(repoCache.entries()),
    recentSessions: results.slice(0, limit),
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("=== OpenCode Session Context & Needed-Context Evaluation ===");
  console.log(
    `Evaluated: ${summary.evaluatedSessions} sessions (minTurns >= ${minTurns})`
  );
  console.log(
    `Mean SCOS: ${summary.aggregateScores.meanSCOS}/100 | Mean Session NCR: ${summary.aggregateScores.meanSessionNCR}% | Byte-Weighted NCR: ${summary.aggregateScores.byteWeightedNCR}%`
  );
  console.log(
    `Sub-scores: S1 Precision ${summary.aggregateScores.meanS1_Precision_25}/25 | S2 Dedup/Slice ${summary.aggregateScores.meanS2_Dedup_20}/20 | S3 Retrieval ${summary.aggregateScores.meanS3_Retrieval_20}/20 | S4 KV-Cache ${summary.aggregateScores.meanS4_Cache_20}/20 | S5 Hygiene ${summary.aggregateScores.meanS5_Hygiene_15}/15`
  );
  console.log("\n--- Read & Tool Context Breakdown ---");
  console.log(
    `Total Tool Output: ${summary.contextBreakdownMB.totalToolOutputMB} MB (Needed: ${summary.contextBreakdownMB.totalNeededOutputMB} MB, ${summary.aggregateScores.byteWeightedNCR}%)`
  );
  console.log(
    `Total File Reads : ${summary.contextBreakdownMB.totalReadMB} MB -> Needed Unique Slice: ${summary.contextBreakdownMB.neededReadMB} MB | Unmodified Dup: ${summary.contextBreakdownMB.unmodifiedDupReadMB} MB (${summary.contextBreakdownMB.unmodifiedDupLinePct}% of lines) | Oversized Excess: ${summary.contextBreakdownMB.oversizedSliceExcessMB} MB | Dead Reads: ${summary.contextBreakdownMB.deadExploratoryReadMB} MB`
  );
  console.log("\n--- Semantic Search & Delegation Findings ---");
  console.log(
    `Sessions needing semantic/graph search: ${summary.retrievalAndDelegation.semanticNeededCount}/${summary.evaluatedSessions} (${summary.retrievalAndDelegation.semanticNeededPct}%) -> Used when needed: ${summary.retrievalAndDelegation.semanticUsedWhenNeededCount} (${summary.retrievalAndDelegation.semanticAdoptionWhenNeededPct}%)`
  );
  console.log(
    `Main sessions needing subagent delegation: ${summary.retrievalAndDelegation.delegationNeededCount} -> Delegated: ${summary.retrievalAndDelegation.delegationUsedWhenNeededCount}`
  );
  console.log(
    `Early-turn (>80k token) context spikes: ${summary.retrievalAndDelegation.earlySpikeSessionsCount} sessions | Compactions: ${summary.retrievalAndDelegation.compactionSessionsCount} sessions | Shell-for-Read anti-pattern calls: ${summary.retrievalAndDelegation.shellReadAntiPatternCalls}`
  );
  console.log("\n--- Recent Sessions (Top " + Math.min(limit, results.length) + ") ---");
  for (const r of results.slice(0, limit)) {
    const dt = new Date(r.timeCreated).toISOString().slice(0, 10);
    const semTag = r.retrieval.semanticNeeded
      ? r.retrieval.usedSemanticOrGraph
        ? "SEM:USED"
        : "SEM:MISSED"
      : "SEM:OK";
    const ollamaCol = r.ollamaSemantic
      ? ` | EmbSCOS ${String(r.ollamaSemantic.adjustedSCOS).padStart(4)} (AdjNCR ${String(r.ollamaSemantic.adjustedNCR + "%").padStart(5)}, +${r.ollamaSemantic.rescuedSupportingFiles}f)`
      : "";
    console.log(
      `${dt} | ${r.id.slice(0, 14)} | ${r.project.padEnd(12).slice(0, 12)} | ${r.agent.padEnd(10).slice(0, 10)} | SCOS ${String(r.scores.scos).padStart(4)} | NCR ${String(r.scores.ncr + "%").padStart(5)} | Dup ${String(r.reads.dupLinePct + "%").padStart(5)} | PeakCtx ${String(Math.round(r.cacheTrajectory.peakCtxTokens / 1000) + "k").padStart(5)} | ${semTag}${ollamaCol} | ${r.title.slice(0, 34)}`
    );
  }
}

main();
