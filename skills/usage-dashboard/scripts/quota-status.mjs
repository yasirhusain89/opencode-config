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
let sr = null;
try {
  const st = fs.statSync(SR_LIVE);
  sr = JSON.parse(fs.readFileSync(SR_LIVE, "utf8"));
  sr._ageMs = Date.now() - st.mtimeMs;
} catch { sr = null; }
if (!sr || !(sr._ageMs < 90000)) {
  try {
    const { execFileSync } = await import("node:child_process");
    const fresh = execFileSync("node", [SR_CALC], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    sr = JSON.parse(fresh);
    sr._ageMs = 0;
  } catch { /* keep stale sr (may be null) */ }
}
if (sr?.windows) {
  const bar = (p) => (p == null ? "n/a" : `${Math.round(p)}%`);
  const w = sr.windows;
  lines.push(`SR burn (1 SR = $0.01): 5h ${w.h5.usedSR}/${w.h5.allowedSR} SR ${bar(w.h5.pct)} of $12 · 7d ${w.d7.usedSR}/${w.d7.allowedSR} SR ${bar(w.d7.pct)} of $30 · 30d ${w.d30.usedSR}/${w.d30.allowedSR} SR ${bar(w.d30.pct)} of $60 — live as of ${sr._ageMs < 2000 ? "now" : ago(new Date(Date.now() - sr._ageMs).toISOString())}`);
  const gos = (sr.perModel || []).filter((m) => m.provider === "opencode-go" && (m.msgs.d7 > 0 || m.msgs.day > 0));
  for (const m of gos.sort((a, b) => b.usd.d7 - a.usd.d7)) {
    lines.push(`  ${m.model.split("/").pop()}: 7d ${m.msgs.d7} msgs $${m.usd.d7.toFixed(2)} ($${m.costPerMsg}/msg) · runway ~${m.allowedMsgs == null ? "n/a" : m.allowedMsgs.toLocaleString("en-US")} msgs on $${m.cap} cap`);
  }
  if (sr.alerts?.length) lines.push(`⚠ SR alerts: ${sr.alerts.join(", ")}`);
  if (sr.lastTurn && sr.lastTurn.sr >= 10) lines.push(`  last heavy turn: ${sr.lastTurn.model} $${sr.lastTurn.usd} (${sr.lastTurn.sr} SR)`);
} else {
  lines.push("SR burn: unknown — no sr-live.json yet (send one Go turn, the cost-tracker plugin seeds it).");
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
