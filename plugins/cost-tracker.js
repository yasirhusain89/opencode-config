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

const HOME = os.homedir();
const SKILL_SCRIPTS = path.join(HOME, ".config/opencode/skills/model-benchmarks/scripts");
const SR_CALC = path.join(SKILL_SCRIPTS, "sr-calc.mjs");
const DB = path.join(HOME, ".local/share/opencode/opencode.db");
const LIVE = path.join(HOME, ".local/share/opencode/sr-live.json");
const SR = 0.01;
const RECOMPUTE_MS = 60_000;
const TURN_ALERT_USD = 0.25; // single-turn spend worth flagging (~1 heavy Argon turn)

let lastFull = 0;
let fired = new Set(); // rising-edge alert latches for this process

function readLive() {
  try {
    return JSON.parse(fs.readFileSync(LIVE, "utf8"));
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
  if (h5 >= 90) a.push("h5_90");
  else if (h5 >= 80) a.push("h5_80");
  else if (h5 >= 50) a.push("h5_50");
  if ((windows?.d7?.pct ?? 0) >= 80) a.push("d7_80");
  if ((windows?.d30?.pct ?? 0) >= 80) a.push("d30_80");
  return a;
}

export default async (input) => {
  const { $, client } = input;

  async function fullRecompute() {
    try {
      await $`node ${SR_CALC} --db ${DB} --json ${LIVE}`.quiet();
      lastFull = Date.now();
      const state = readLive();
      if (state) {
        // clear latches for alerts that no longer hold
        const now = new Set(alertsFor(state.windows));
        for (const f of [...fired]) if (!now.has(f)) fired.delete(f);
        return state;
      }
    } catch {
      /* sqlite/node hiccup — keep last state */
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
        if (!state || Date.now() - lastFull > RECOMPUTE_MS) {
          state = await fullRecompute();
          if (!state) return;
        }
        // Incremental patch: this turn's spend applies to every rolling window
        // until the next full recompute corrects for window slide.
        for (const w of Object.values(state.windows || {})) {
          if (w.usedUsd == null) continue;
          w.usedUsd = +(w.usedUsd + turnCost).toFixed(4);
          w.usedSR = Math.round(w.usedUsd / SR);
          if (w.allowedSR) w.pct = +(100 * w.usedUsd / (w.allowedSR * SR)).toFixed(1);
        }
        state.lastTurn = {
          at: new Date().toISOString(),
          model: `${info.providerID}/${info.modelID}`,
          usd: +turnCost.toFixed(4),
          sr: Math.round(turnCost / SR),
        };
        state.generated_at = new Date().toISOString();
        const alerts = alertsFor(state.windows);
        if (turnCost >= TURN_ALERT_USD) alerts.push("turn_heavy");
        state.alerts = alerts;
        writeLive(state);

        for (const a of alerts) {
          if (fired.has(a)) continue;
          fired.add(a);
          if (a === "turn_heavy") {
            await toast("Heavy turn", `${state.lastTurn.model} spent $${state.lastTurn.usd} (${state.lastTurn.sr} SR) in one turn.`);
          } else if (a === "h5_90" || a === "h5_80" || a === "h5_50") {
            await toast("Go 5h window", `${state.windows.h5.pct}% of the $12 / 1,200 SR rolling window used.`);
          } else if (a === "d7_80" || a === "d30_80") {
            await toast("Go cap pressure", `${a === "d7_80" ? "Weekly" : "Monthly"} window at ${state.windows[a.slice(0, 3)].pct}%.`);
          }
        }
      } catch {
        /* never break the session on cost bookkeeping */
      }
    },
  };
};
