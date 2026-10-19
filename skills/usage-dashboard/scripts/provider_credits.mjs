#!/usr/bin/env node
// Snapshot key-authed provider credit state into credits.json (merged by
// generate.py). Keys come from opencode's own auth.json — nothing new to store,
// nothing secret is printed or written (only balances/usage numbers).
// Providers without a known balance endpoint are reported as unknown.
// Usage: node scripts/provider_credits.mjs   (run by hand, e.g. monthly or
// when the billing-flags warning appears; daily regen does NOT refetch)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AUTH = path.join(os.homedir(), ".local/share/opencode/auth.json");
const OUT = path.join(os.homedir(), ".opencode/usage-dashboard/credits.json");

const shape = (o, depth = 0) => {
  if (o && typeof o === "object") {
    if (Array.isArray(o)) return o.length ? [shape(o[0], depth + 1)] : [];
    if (depth > 3) return "{...}";
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return typeof o;
};

async function openrouterCredits(key) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (process.env.CREDITS_DEBUG_SHAPE) {
      console.log("openrouter shape: " + JSON.stringify(shape(body)));
      return null;
    }
    const d = (body && body.data) || {};
    const b = d.effective_budget || {};
    return {
      label: d.label ?? null,
      is_free_tier: d.is_free_tier ?? null,
      // credits consumed on this key (lifetime + windows)
      usage: d.usage ?? null,
      usage_daily: d.usage_daily ?? null,
      usage_weekly: d.usage_weekly ?? null,
      usage_monthly: d.usage_monthly ?? null,
      // key caps / active budget
      limit: d.limit ?? null,
      limit_remaining: d.limit_remaining ?? null,
      budget_usd: b.limit_usd ?? null,
      budget_spend_usd: b.spend_usd ?? null,
      budget_remaining_usd: b.remaining_usd ?? null,
      // free-model daily quota (the tier all recorded OR usage sits on)
      free_daily: d.free_model_daily_requests ?? null,
      expires_at: d.expires_at ?? null,
    };
  } catch (e) {
    return { error: "fetch failed: " + (e.cause?.message || e.message) };
  } finally {
    clearTimeout(t);
  }
}

let auth = {};
try { auth = JSON.parse(fs.readFileSync(AUTH, "utf8")); }
catch { console.error("provider_credits: cannot read " + AUTH); process.exit(1); }

const out = { fetched_at: new Date().toISOString(), providers: {} };
if (auth.openrouter?.key) out.providers.openrouter = await openrouterCredits(auth.openrouter.key);
else out.providers.openrouter = { error: "no key in auth.json" };
// NVIDIA: no public balance endpoint known — verify spend on the console.
// (Kept explicit so the dashboard shows "unknown" instead of silently $0.)
out.providers.nvidia = { error: "no balance API known — check build.nvidia.com console" };

if (process.env.CREDITS_DEBUG_SHAPE) process.exit(0);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log("provider_credits: " + JSON.stringify(out.providers));
