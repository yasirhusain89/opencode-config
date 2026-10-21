#!/usr/bin/env node
// Compact quota/spend summary for the /quota TUI command (and humans).
// Reads only local generated files — no network, never exits nonzero.
// Usage: node scripts/quota-status.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.OCUD_OUT || path.join(os.homedir(), ".opencode/usage-dashboard");
const readGlobal = (f, prefix) => {
  try { return stripGlobal(fs.readFileSync(path.join(OUT, f), "utf8"), prefix); }
  catch { return null; }
};
const stripGlobal = (raw, prefix) => {
  const s = raw.trim();
  if (!s.startsWith(prefix)) return null;
  try { return JSON.parse(s.slice(prefix.length).replace(/;\s*$/, "")); }
  catch { return null; }
};
const money = (x) => (x == null ? "n/a" : "$" + Number(x).toFixed(2));
const pct = (x) => (x == null ? "n/a" : `${Math.round(x)}%`);
const ago = (iso) => {
  // accepts ISO ("...+00:00") and generate.py's "YYYY-MM-DD HH:MM TZ" stamp
  const s = String(iso || "").replace(/ ([A-Z]{2,5})$/, "").replace(" ", "T");
  const t = Date.parse(s);
  if (!t) return "unknown time";
  const h = (Date.now() - t) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const ageMs = (iso) => {
  const s = String(iso || "").replace(/ ([A-Z]{2,5})$/, "").replace(" ", "T");
  const t = Date.parse(s);
  return Number.isFinite(t) ? Date.now() - t : NaN;
};
const resetIn = (s) => {
  if (s == null) return "";
  if (s < 3600) return ` (resets in ${Math.round(s / 60)}m)`;
  if (s < 86400) return ` (resets in ${(s / 3600).toFixed(1)}h)`;
  return ` (resets in ${(s / 86400).toFixed(1)}d)`;
};

const lines = [];
// Live SR burn (Layer 1): sr-live.json maintained by plugins/cost-tracker.js.
// Recompute inline when stale (>90s) so /quota is never older than a minute.
const SR_CALC = path.join(os.homedir(), ".config/opencode/skills/model-benchmarks/scripts/sr-calc.mjs");
const SR_LIVE = path.join(os.homedir(), ".local/share/opencode/sr-live.json");
const parseTs = (x) => {
  const s = String(x || "").replace(/ ([A-Z]{2,5})$/, "").replace(" ", "T");
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
};
let sr = null;
try { sr = JSON.parse(fs.readFileSync(SR_LIVE, "utf8")); } catch { sr = null; }
const genAt = sr ? parseTs(sr.generated_at) : NaN;
const fullAt = (sr && parseTs(sr.fullRecomputeAt)) || genAt;
let stateAgeMs = Number.isFinite(fullAt) ? Date.now() - fullAt : NaN;
let recomputedInline = false;
// Recompute inline when the file is old OR was written by pre-v2 code.
if (!sr || sr.schema !== 2 || !(stateAgeMs < 90000)) {
  try {
    const { execFileSync } = await import("node:child_process");
    const fresh = execFileSync("node", [SR_CALC], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    sr = JSON.parse(fresh);
    stateAgeMs = 0;
    recomputedInline = true;
  } catch { /* keep stale sr (may be null) */ }
}
if (sr?.windows) {
  const p = (x) => (x == null ? "n/a" : `${Math.round(x)}%`);
  const dur = (sec) => (sec == null || !Number.isFinite(sec) || sec < 0 ? null
    : sec >= 86400 ? `${(sec / 86400).toFixed(1)}d` : sec >= 3600 ? `${(sec / 3600).toFixed(1)}h` : `${Math.max(1, Math.round(sec / 60))}m`);
  const w = sr.windows;
  const win = (label, x) => {
    if (!x) return `${label} n/a`;
    const left = x.remainingPct == null ? "" : ` · ${p(x.remainingPct)} left`;
    const drop = x.freesAt ? dur((parseTs(x.freesAt) - Date.now()) / 1000) : null;
    return `${label} ${p(x.pct)} used${left}${drop ? ` · next drop in ${drop}` : ""}`;
  };
  // Freshness: idle time is not staleness. If nothing was spent since the last
  // full recompute, an hours-old file is still exact — only activity after the
  // stamp can have accumulated uncorrected incremental drift.
  const lastAct = sr.lastActivity ? parseTs(sr.lastActivity) : NaN;
  const drifted = Number.isFinite(lastAct) && Number.isFinite(fullAt) && lastAct > fullAt;
  const stale = !recomputedInline && stateAgeMs > 10 * 60e3 && drifted;
  const stamp = recomputedInline ? "as of now"
    : !sr.fullRecomputeAt || sr.schema !== 2
      ? "state written by an older cost-tracker — restart OpenCode to refresh"
      : stale ? `STALE — full recompute ${ago(new Date(fullAt).toISOString())}, see ~/.local/share/opencode/sr-debug.log`
      : `as of ${stateAgeMs < 2000 ? "now" : ago(new Date(Date.now() - stateAgeMs).toISOString())}${drifted ? " (incremental)" : ""}`;
  lines.push(`Go burn (est.): ${win("7d", w.d7)} | ${win("30d", w.d30)} | ${win("5h", w.h5)} — ${stamp}`);
  const capUsd = w.d7.allowedSR != null ? w.d7.allowedSR * 0.01 : null;
  if (capUsd != null && sr.paceUsdPerDay > 0) {
    const leftUsd = Math.max(0, capUsd - w.d7.usedUsd);
    const days = leftUsd / sr.paceUsdPerDay;
    lines.push(`  pace $${sr.paceUsdPerDay.toFixed(2)}/day (7d) · weekly headroom $${leftUsd.toFixed(2)} → ${days < 7 ? `exhausts in ~${days.toFixed(1)}d at this pace` : "holds at this pace"}`);
  }
  const gos = (sr.perModel || []).filter((m) => m.provider === "opencode-go" && m.msgs.d30 > 0);
  for (const m of gos.sort((a, b) => b.usd.d30 - a.usd.d30)) {
    const cap = m.cap == null ? "no cap" : `of $${m.cap} cap`;
    const left = m.remainingMsgs == null ? "" : ` · ~${m.remainingMsgs.toLocaleString("en-US")} msgs left`;
    lines.push(`  ${m.model.split("/").pop()}: 7d ${m.msgs.d7} msgs $${m.usd.d7.toFixed(2)} · 30d $${m.usd.d30.toFixed(2)} ${cap}${left}`);
  }
  if (sr.alerts?.length) lines.push(`⚠ alerts: ${sr.alerts.join(", ")}`);
  if (sr.lastTurn && sr.lastTurn.usd >= 0.05) lines.push(`  last heavy turn: ${sr.lastTurn.model} $${sr.lastTurn.usd}`);
} else {
  lines.push("Go burn: unknown — no sr-live.json yet (send one Go turn, the cost-tracker plugin seeds it).");
}
const raw = readGlobal("data.js", "window.__OCUD__ = ");
const hero = raw?.hero;
if (!hero) {
  console.log("No dashboard data yet — run generate.py first.");
  process.exit(0);
}
// Go plan quota (needs scripts/go_quota.mjs + an API key; absent = unknown)
if (hero.quota) {
  const q = hero.quota;
  lines.push(`Go plan: rolling ${pct(q.rolling?.percent)}${resetIn(q.rolling?.resetInSec)} · week ${pct(q.weekly?.percent)} · month ${pct(q.monthly?.percent)} — as of ${ago(q.fetched_at)}${ageMs(q.fetched_at) > 30 * 3600000 ? " (STALE — re-run go_quota.mjs)" : ""}`);
} else {
  lines.push("Go plan quota: unknown — run scripts/go_quota.mjs (needs an opencode.ai API key).");
}
// OpenRouter key budget
const or = JSON.parse(JSON.stringify(raw.credits?.providers?.openrouter ?? null));
if (or && !or.error) {
  lines.push(`OpenRouter key${or.label ? ` ${or.label}` : ""}: ${money(or.budget_spend_usd ?? or.usage)} spent of ${money(or.budget_usd ?? or.limit)} loaded (${money(or.budget_remaining_usd ?? or.limit_remaining)} left) · free daily ${or.free_daily ? `${or.free_daily.used}/${or.free_daily.limit}` : "n/a"}`);
} else {
  lines.push("OpenRouter credits: unknown — run scripts/provider_credits.mjs.");
}
// Recorded spend + pressure
lines.push(`Actually paid ${money(hero.actual)} · metered value covered by plan ${money(hero.metered_covered)} · ${raw.rate429?.count ?? 0}× 429 in last 24h (dashboard generated ${ago(raw.generated)}).`);
const flags = raw.billing_flags || [];
if (flags.length) {
  lines.push("⚠ Verify billing (opencode records $0 here): " + flags.map((f) => `${f.provider}/${f.model} (${f.msgs} msgs)`).join(", "));
} else {
  lines.push("No billing flags — every key-authed call is on a known-free model.");
}
console.log(lines.join("\n"));
