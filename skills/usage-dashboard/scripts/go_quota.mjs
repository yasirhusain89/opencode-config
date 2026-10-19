#!/usr/bin/env node
// Fetch OpenCode Go plan-window usage into quota.json (merged by generate.py).
// Key: $OPENCODE_API_KEY, else ~/.local/share/opencode/.go-api-key (chmod 600).
// Create one at https://opencode.ai dashboard → API keys. The key is only
// ever sent as a Bearer header; nothing secret is printed or stored.
// Usage: node scripts/go_quota.mjs   (run by hand when curious; the dashboard
// shows "as of" time — daily regen does NOT refetch, by design: no network
// inside generate.py)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEY_FILE = path.join(os.homedir(), ".local/share/opencode/.go-api-key");
const OUT = path.join(os.homedir(), ".opencode/usage-dashboard/quota.json");

let key = (process.env.OPENCODE_API_KEY || "").trim();
if (!key) {
  try { key = fs.readFileSync(KEY_FILE, "utf8").trim(); }
  catch { key = ""; }
}
if (!key) {
  console.error("go_quota: no key. Set OPENCODE_API_KEY or write " + KEY_FILE + " (chmod 600).");
  process.exit(2);
}
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 20000);
let res;
try {
  res = await fetch("https://opencode.ai/zen/go/v1/usage", {
    headers: { Authorization: `Bearer ${key}` },
    signal: ctrl.signal,
  });
} catch (e) {
  console.error("go_quota: fetch failed: " + (e.cause?.message || e.message));
  process.exit(1);
} finally {
  clearTimeout(t);
}
if (!res.ok) {
  console.error(`go_quota: HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json().catch(() => null);
const usage = (body && body.usage) || {};
const pick = (w) => ({
  percent: usage?.[w]?.percent ?? null,
  resetInSec: usage?.[w]?.resetInSec ?? null,
});
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  fetched_at: new Date().toISOString(),
  rolling: pick("rolling"),
  weekly: pick("weekly"),
  monthly: pick("monthly"),
}, null, 1) + "\n");
const pct = (w) => (w.percent == null ? "n/a" : w.percent + "%");
console.log(`go_quota: rolling ${pct(pick("rolling"))} · weekly ${pct(pick("weekly"))} · monthly ${pct(pick("monthly"))}`);
