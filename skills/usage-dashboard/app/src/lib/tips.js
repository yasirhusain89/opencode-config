// Per-session improvement tips, computed client-side from the raw metrics
// in sessions/<id>.js. Thresholds mirror the old generate.py Q_* constants.
import { fmt, hrs } from "./format.js";

export const T = {
  GAP_MIN: 15,
  TURNS_MANY: 8,
  PROMPT_CHARS: 4000,
  REASON_SHARE: 0.6,
  REASON_OUT: 20000,
  MAX_LIGHT_CALLS: 5,
  MAX_LIGHT_OUT: 5000,
  ERR_STREAK: 3,
  CACHE_HIT_LOW: 0.4,
  IN_BIG: 100000,
  ERR_RATE: 0.15,
  ERR_CALLS_MIN: 10,
  AFTER_ERR_S: 120,
  INTERRUPT_MIN: 3,
  // context-health thresholds mirror generate.py CTX_* constants
  SCOS_GOOD: 85,
  SCOS_OK: 60,
  NCR_GOOD: 80,
  DUP_PCT_HIGH: 20,
  DEAD_KB_HIGH: 50,
  OVERSIZED_MANY: 3,
};

export function userTips(s) {
  const tips = [];
  if (!s.turns && !s.asst) {
    tips.push("empty session — no messages recorded.");
    return tips;
  }
  if (s.gaps) {
    tips.push(
      `${s.gaps} idle gap(s) over ${T.GAP_MIN} min (wall ${hrs(s.wall_min)}) — end the session when stepping away so the prompt cache stays warm.`
    );
  }
  if (s.turns >= T.TURNS_MANY) {
    tips.push(
      `${s.turns} user turns — consolidating requirements up front usually cuts re-prompt churn.`
    );
  }
  if (s.first_prompt >= T.PROMPT_CHARS) {
    tips.push(
      `first prompt is ${fmt(s.first_prompt)} chars — large pastes re-bill as input on every turn; point at a file instead.`
    );
  }
  if (s.after_err) {
    tips.push(
      `${s.after_err} turn(s) started right after tool errors — fixing permissions/environment first is usually faster than re-prompting.`
    );
  }
  if (s.interrupted >= T.INTERRUPT_MIN) {
    tips.push(
      `${s.interrupted} of ${s.turns} turns were cut short by your next prompt before the agent finished — batching feedback and letting runs complete cuts re-work.`
    );
  }
  if (!s.calls && s.asst) {
    tips.push("Q&A session — no tool calls, nothing was touched.");
  }
  if (!tips.length) {
    tips.push("prompt cadence looks healthy — no obvious user-side waste.");
  }
  return tips;
}

export function modelTips(s) {
  const tips = [];
  if (
    s.reason_share != null &&
    s.reason_share >= T.REASON_SHARE &&
    s.out_tot >= T.REASON_OUT
  ) {
    tips.push(
      `reasoning is ${Math.round(100 * s.reason_share)}% of output tokens — a lower-effort variant likely suffices for routine turns.`
    );
  }
  const heavy = (s.variants || []).slice(0, 2).map((v) => v.v).filter((v) => v === "max" || v === "xhigh");
  if (heavy.length && s.calls <= T.MAX_LIGHT_CALLS && s.out_tot < T.MAX_LIGHT_OUT) {
    tips.push(
      `${heavy.join("/")} effort on a light session (${s.calls} calls, ${fmt(s.out_tot)} out tokens) — medium/high would do.`
    );
  }
  if (s.streak && s.streak.n >= T.ERR_STREAK) {
    tips.push(
      `tool ${s.streak.tool} errored ${s.streak.n}x in a row — the agent looped; a bail-out or an upstream fix would save the retries.`
    );
  }
  if ((s.providers || []).length > 1) {
    tips.push(
      `switched providers ${s.providers.length}x mid-session (${s.providers.join(", ")}) — each switch drops the prompt cache.`
    );
  }
  if (s.cache_hit != null && s.cache_hit < T.CACHE_HIT_LOW && s.in_cache > T.IN_BIG) {
    tips.push(
      `cache hit only ${Math.round(100 * s.cache_hit)}% of ${fmt(s.in_cache)} input — idle gaps or edits invalidated the cache.`
    );
  }
  if (s.err_rate != null && s.err_rate >= T.ERR_RATE && s.calls >= T.ERR_CALLS_MIN) {
    tips.push(
      `tool error rate ${Math.round(100 * s.err_rate)}% (${s.errors} of ${s.calls} calls) — check the failing tool/environment, not the model.`
    );
  }
  if (!tips.length) {
    tips.push("no loops or effort mismatch detected.");
  }
  return tips;
}

export function scosClass(scos) {
  if (scos == null) return "note";
  if (scos >= T.SCOS_GOOD) return "ok-flag";
  if (scos >= T.SCOS_OK) return "";
  return "bad-flag";
}

export function ncrClass(ncr) {
  if (ncr == null) return "note";
  if (ncr >= T.NCR_GOOD) return "ok-flag";
  if (ncr >= 50) return "";
  return "bad-flag";
}

// Context-loading guidance, computed from the deterministic SCOS/NCR
// drivers in sessions/<id>.js (generate.py score_v2_context). Raw numbers
// only in the payload; the advice lives here.
export function contextTips(s) {
  const tips = [];
  const c = s.ctx;
  if (!c) {
    return ["context not scored (pre-Nov-14 session, before context tracking)."];
  }
  if (c.dup_pct >= T.DUP_PCT_HIGH) {
    tips.push(
      `${c.dup_pct}% of lines read were unmodified re-reads — never re-read lines already loaded this session; use targeted offset/limit slices around grep hits instead of paging whole files.`
    );
  }
  if (c.dead_kb >= T.DEAD_KB_HIGH) {
    tips.push(
      `${c.dead_kb} KB loaded from ${c.dead_files} file(s) never edited or cited — orient with a semantic query or delegate broad exploration to a subagent so dead reads stay out of the main session's cache.`
    );
  }
  if (c.oversized_calls >= T.OVERSIZED_MANY) {
    tips.push(
      `${c.oversized_calls} full-file (>400-line) dumps — read the slice around each hit instead of paging top-to-bottom in main; each early full read amplifies across every later turn.`
    );
  }
  if (c.semantic_needed && !c.used_semantic) {
    const why = [
      c.had_thrash ? "lexical search thrashed" : null,
      c.had_blind ? "broad blind file reads" : null,
    ].filter(Boolean).join(" + ") || "exploration pattern";
    tips.push(
      `semantic/graph search was needed (${why}) but never used — escalate after 2 empty greps: semantic:q for meaning/unknown-vocabulary, gitnexus query/context for callers and flows.`
    );
  }
  if (c.early_spike) {
    tips.push(
      `context spiked past 80K tokens within the first 10 turns (peak ${c.peak_k}K) — that early bloat re-bills every turn; land the file list with grep/semantic first, then read slices.`
    );
  }
  if (c.need_deleg && !c.used_deleg) {
    tips.push(
      `heavy multi-file exploration in the main session with no subagent — fan out to explore/researcher so discovery reads stay out of the main KV cache.`
    );
  }
  if (c.shell_anti) {
    tips.push(
      `${c.shell_anti} shell call(s) used for file reads (cat/sed/head/grep) — native read/grep tools keep output bounded and attributable; shell dumps bypass slice budgets.`
    );
  }
  if (c.compactions) {
    tips.push(
      `${c.compactions} compaction(s) — context pressure forced a summary; smaller slices and earlier delegation delay the cliff.`
    );
  }
  if (!tips.length) {
    tips.push(
      `context loading looks healthy (SCOS ${c.scos}, NCR ${c.ncr}%) — keep the slice discipline.`
    );
  }
  return tips;
}
