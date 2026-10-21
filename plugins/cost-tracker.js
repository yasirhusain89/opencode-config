// cost-tracker — Layer 1 engine for SR cost visibility.
//
// Listens to the `event` hook (message.updated for completed assistant turns),
// keeps a live standardized-request state file at
//   ~/.local/share/opencode/sr-live.json
// and fires threshold toasts. The macOS menu-bar companion (Layer 2) and the
// upgraded /quota command both read from this file / the shared sr-calc module.
//
// Design constraints (see EXPERIENCE.md):
// - NEVER throw: a cost plugin must not break sessions. Every path is guarded.
// - No polling, no sleeps: recompute is throttled (60s) and only runs on events.
// - No network: DB + local quota.json only.
// - Multi-process safe: full recomputes always come from DB ground truth, so
//   concurrent writers self-correct; increments between recomputes are best-effort.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOME = os.homedir();
const SKILL_SCRIPTS = path.join(HOME, ".config/opencode/skills/model-benchmarks/scripts");
const SR_CALC = path.join(SKILL_SCRIPTS, "sr-calc.mjs");
const DB = path.join(HOME, ".local/share/opencode/opencode.db");
const LIVE = path.join(HOME, ".local/share/opencode/sr-live.json");
const DEBUG_LOG = path.join(HOME, ".local/share/opencode/sr-debug.log");
const SR = 0.01;
const SCHEMA = 2; // must match sr-calc.mjs; older writers' files are ignored
const WARN_PCT = 70;
const CRIT_PCT = 90;
const RECOMPUTE_MS = 60_000;
const TURN_ALERT_USD = 0.25; // single-turn spend worth flagging (~1 heavy Argon turn)

// The plugin host (Desktop/Electron) may run with a minimal PATH that lacks
// `node`/`sqlite3`. sr-calc shells to `sqlite3`, so make sure the usual macOS
// locations are present for this process (superset only, never removes).
try {
  const need = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const have = new Set((process.env.PATH || "").split(":").filter(Boolean));
  for (const d of need) have.add(d);
  process.env.PATH = [...have].join(":");
} catch {
  /* keep inherited PATH */
}

// Recompute failures used to be swallowed silently, which let sr-live.json
// drift for hours (incremental patches only add; window slide and midnight
// rollover need a full recompute). Log them to a bounded debug file instead.
function debug(msg) {
  try {
    let prefix = "";
    try {
      const st = fs.statSync(DEBUG_LOG);
      if (st.size > 50 * 1024) {
        prefix = fs.readFileSync(DEBUG_LOG, "utf8").slice(-25 * 1024) + "\n…truncated…\n";
        fs.writeFileSync(DEBUG_LOG, prefix);
      }
    } catch {
      /* no log yet — plain append below */
    }
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* debug logging must never break the session */
  }
}

let lastFull = 0;
let fired = new Set(); // rising-edge alert latches for this process

function readLive() {
  try {
    const state = JSON.parse(fs.readFileSync(LIVE, "utf8"));
    // A long-running process can still be executing pre-v2 code and rewrite
    // this file (seen 2026-10-21: generated_at newer than fullRecomputeAt).
    // Treat an unknown/absent schema as "no state" so the current process
    // recomputes from the DB instead of trusting a writer it cannot read.
    if (state?.schema !== SCHEMA) return null;
    return state;
  } catch {
    return null;
  }
}
function writeLive(state) {
  try {
    fs.writeFileSync(LIVE, JSON.stringify(state, null, 1) + "\n");
  } catch {
    /* state dir unwritable — stay silent, never break the session */
  }
}
function alertsFor(windows) {
  const a = [];
  const h5 = windows?.h5?.pct ?? 0;
  if (h5 >= CRIT_PCT) a.push("h5_90");
  else if (h5 >= 80) a.push("h5_80");
  for (const w of ["d7", "d30"]) {
    const p = windows?.[w]?.pct ?? 0;
    if (p >= CRIT_PCT) a.push(`${w}_90`);
    else if (p >= WARN_PCT) a.push(`${w}_70`);
  }
  return a;
}

export default async (input) => {
  const { $, client } = input;

  async function fullRecompute() {
    // Primary: import sr-calc in-process (no `node` binary or shell quoting
    // needed — the plugin host itself runs JS). Fallback: the old CLI spawn.
    let state = null;
    try {
      const { calcSR } = await import(pathToFileURL(SR_CALC).href);
      state = calcSR(DB);
    } catch (e) {
      debug(`recompute import failed: ${(e && e.message) || e}; trying CLI`);
      try {
        await $`node ${SR_CALC} --db ${DB} --json ${LIVE}`.quiet();
        state = readLive();
      } catch (e2) {
        debug(`recompute CLI failed: ${(e2 && e2.message) || e2}`);
      }
    }
    if (state) {
      try {
        lastFull = Date.now();
        // Persisted recompute stamp: readers (quota-status) must judge
        // staleness from this, NOT the file mtime — every incremental patch
        // rewrites the file, so mtime is always "fresh" even when the ground
        // truth underneath is hours old (2026-10-21: h5 stuck at 83% vs 1%
        // true because recomputes failed silently and mtime masked it).
        state.fullRecomputeAt = new Date().toISOString();
        writeLive(state);
        // clear latches for alerts that no longer hold
        const now = new Set(alertsFor(state.windows));
        for (const f of [...fired]) if (!now.has(f)) fired.delete(f);
        return state;
      } catch (e) {
        debug(`recompute write failed: ${(e && e.message) || e}`);
      }
    }
    return readLive();
  }

  async function toast(title, message) {
    try {
      await client.tui.showToast({ title, message, variant: "warning" });
    } catch {
      /* Desktop / headless: menu-bar companion covers alerting */
    }
  }

  return {
    event: async ({ event }) => {
      try {
        if (event.type !== "message.updated") return;
        const info = event.properties?.info;
        if (!info || info.role !== "assistant" || !info.time?.completed) return;
        const turnCost = Number(info.cost) || 0;

        let state = readLive();
        let recomputed = false;
        if (!state || Date.now() - lastFull > RECOMPUTE_MS) {
          const before = lastFull;
          state = await fullRecompute();
          recomputed = state != null && lastFull !== before;
          if (!state) return;
        }
        // Incremental patch: this turn's spend applies to every rolling window
        // until the next full recompute corrects for window slide.
        // Skipped when a recompute just ran in this event: the DB scan may
        // already include this turn, and adding it again double-counts. Worst
        // case the turn lands in the next recompute (≤60s), bounded to one
        // turn instead of unbounded drift.
        if (!recomputed) {
          for (const w of Object.values(state.windows || {})) {
            if (w.usedUsd == null) continue;
            w.usedUsd = +(w.usedUsd + turnCost).toFixed(4);
            w.usedSR = Math.round(w.usedUsd / SR);
            if (w.allowedSR) w.pct = +(100 * w.usedUsd / (w.allowedSR * SR)).toFixed(1);
            if (w.pct != null) w.remainingPct = +(100 - w.pct).toFixed(1);
          }
        }
        state.lastTurn = {
          at: new Date().toISOString(),
          model: `${info.providerID}/${info.modelID}`,
          usd: +turnCost.toFixed(4),
          sr: Math.round(turnCost / SR),
        };
        // NOTE: generated_at stays at the last full recompute (set by sr-calc);
        // incremental touches record patched_at so readers can see drift risk.
        state.patched_at = new Date().toISOString();
        const alerts = alertsFor(state.windows);
        if (turnCost >= TURN_ALERT_USD) alerts.push("turn_heavy");
        state.alerts = alerts;
        writeLive(state);

        for (const a of alerts) {
          if (fired.has(a)) continue;
          fired.add(a);
          if (a === "turn_heavy") {
            await toast("Heavy turn", `${state.lastTurn.model} spent $${state.lastTurn.usd} in one turn.`);
          } else if (a === "h5_90" || a === "h5_80") {
            await toast("Go 5h window", `${Math.round(state.windows.h5.pct)}% used — ${Math.round(state.windows.h5.remainingPct ?? 0)}% left.`);
          } else if (a.endsWith("_90") || a.endsWith("_70")) {
            const w = a.split("_")[0];
            const win = state.windows[w];
            await toast("Go cap pressure", `${w === "d7" ? "Weekly" : "Monthly"} window ${Math.round(win.pct)}% used — ${Math.round(win.remainingPct ?? 0)}% left.`);
          }
        }
      } catch {
        /* never break the session on cost bookkeeping */
      }
    },
  };
};
