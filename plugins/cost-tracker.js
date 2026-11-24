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
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOME = os.homedir();
const SKILL_SCRIPTS = path.join(HOME, ".config/opencode/skills/model-benchmarks/scripts");
const SR_CALC = path.join(SKILL_SCRIPTS, "sr-calc.mjs");
const DB = path.join(HOME, ".local/share/opencode/opencode.db");
const LIVE = path.join(HOME, ".local/share/opencode/sr-live.json");
const DEBUG_LOG = path.join(HOME, ".local/share/opencode/sr-debug.log");
const SR = 0.01;
// Schema 4: account-level fixed periods (month 19th–19th, week Mon–Mon,
// trailing 5h). Per-model binding was removed 2026-10-26 after the console
// proved caps are account-wide — see sr-calc.mjs header.
const SCHEMA = 4; // must match sr-calc.mjs; older writers' files are ignored
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
    // Atomic write (takes effect on next opencode restart with this file):
    // the bar's timer now writes this file too — rename avoids torn reads.
    const tmp = `${LIVE}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1) + '\n');
    fs.renameSync(tmp, LIVE);
  } catch {
    /* state dir unwritable — stay silent, never break the session */
  }
}
function alertsFor(windows) {
  // Keep in sync with sr-calc.mjs `alertsFor` (exported; tested there): all
  // three windows are formula-calibrated, rolling included (it warns before
  // the 429 wall).
  const a = [];
  for (const w of ["month", "week", "rolling"]) {
    const win = windows?.[w];
    if (!win || win.calibrated === false) continue;
    const p = win.pct ?? 0;
    if (p >= CRIT_PCT) a.push(`${w}_90`);
    else if (p >= WARN_PCT) a.push(`${w}_70`);
  }
  return a;
}

// Core turn handler shared by the V1 `event` hook and the V2 event subscription.
async function createTracker({ shell, toast }) {
  async function fullRecompute() {
    // Primary: import sr-calc in-process (no `node` binary or shell quoting
    // needed — the plugin host itself runs JS). The `?v=` cache-buster
    // defeats Node's process-lifetime ESM cache so sr-calc.mjs edits take
    // effect without an opencode restart (stale cached code used to rewrite
    // the state file with the old model after every fix). Fallback: CLI.
    let state = null;
    let calc = null;
    try {
      let v = 0;
      try { v = fs.statSync(SR_CALC).mtimeMs; } catch { /* keep 0 */ }
      calc = await import(pathToFileURL(SR_CALC).href + `?v=${v}`);
      state = calc.calcSR(DB);
    } catch (e) {
      debug(`recompute import failed: ${(e && e.message) || e}; trying CLI`);
      try {
        if (shell) {
          await shell`node ${SR_CALC} --db ${DB} --json ${LIVE}`.quiet();
        } else {
          // V2 has no Bun `$` helper; run the CLI without a shell.
          await execFileAsync("node", [SR_CALC, "--db", DB, "--json", LIVE]);
        }
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

  // `model` is "providerID/modelID". V1 passes the completed assistant
  // message; V2 passes one completed step (same one-LLM-call granularity as
  // a V1 assistant message — V2's `session.step.ended` carries cost).
  // `tokens` is the event's token payload when present (V2 zero-cost rows
  // carry cost 0 with tokens still flowing — estimate from tokens so the
  // turn and the incremental patch are not blind). `failed` marks a
  // rejected step (V2 `session.step.failed`, e.g. a 429): it must not
  // increment quota counters, but it forces a recompute so a provider block
  // flips the state immediately instead of at the next 60s tick.
  async function onTurn({ model, cost, tokens, failed }) {
    if (failed) {
      try {
        lastFull = 0; // force the recompute below past the throttle
        await fullRecompute();
      } catch { /* never break the session on cost bookkeeping */ }
      return;
    }
    try {
      let turnCost = Number(cost) || 0;
      const isGoTurn = typeof model === "string" && model.startsWith("opencode-go/") && !/-free$/i.test(model);

      let state = readLive();
      let recomputed = false;
      if (!state || Date.now() - lastFull > RECOMPUTE_MS) {
        const before = lastFull;
        state = await fullRecompute();
        recomputed = state != null && lastFull !== before;
        if (!state) return;
      }
      // Incremental patch: a Go turn counts against every account window
      // until the next full recompute corrects for period boundaries. Free /
      // BYOK / trial turns do not consume the Go quota, so they must not
      // increment these counters (sr-calc counts Go-product rows only).
      // Skipped when a recompute just ran in this event: the DB scan may
      // already include this turn, and adding it again double-counts. Worst
      // case the turn lands in the next recompute (≤60s), bounded to one
      // turn instead of unbounded drift. V2 zero-cost rows are priced from
      // the event's token payload so the patch is not blind; window pct
      // moves by estimate/allowance for the turn's own model tier.
      if (!recomputed && isGoTurn) {
        // V2 zero-cost rows are priced from the event's token payload so the
        // patch is not blind; window pct moves by estimate/allowance for the
        // turn's own model tier. (One cached module import; best-effort.)
        let est = null, allowFor = null;
        if (!(turnCost > 0) && tokens) {
          try {
            let v = 0;
            try { v = fs.statSync(SR_CALC).mtimeMs; } catch { /* keep 0 */ }
            const calc = await import(pathToFileURL(SR_CALC).href + `?v=${v}`);
            const shortId = String(model).split("/").pop();
            if (typeof calc.estimateTurnUsd === "function") {
              est = calc.estimateTurnUsd(shortId, tokens);
              if (est != null && est > 0) { turnCost = est; allowFor = calc.allowanceFor; }
            }
          } catch { /* estimation is best-effort; counts still increment */ }
        }
        for (const [name, w] of Object.entries(state.windows || {})) {
          if (w.usedReq == null) continue;
          w.usedReq = w.usedReq + 1;
          if (est != null && est > 0 && typeof allowFor === "function") {
            const allow = allowFor(String(model).split("/").pop(), name);
            if (allow > 0 && w.pct != null) {
              w.usedUsd = +((w.usedUsd || 0) + est).toFixed(4);
              w.pct = +(w.pct + (est / allow) * 100).toFixed(3);
              w.remainingPct = Math.max(0, +(100 - w.pct).toFixed(1));
            } else if (w.usedUsd != null) {
              w.usedUsd = +(w.usedUsd + est).toFixed(4);
            }
          } else if (w.usedUsd != null) {
            w.usedUsd = +(w.usedUsd + turnCost).toFixed(4);
          }
        }
      }
      state.lastTurn = {
        at: new Date().toISOString(),
        model,
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
        } else if (a.endsWith("_90") || a.endsWith("_70")) {
          const w = a.split("_")[0];
          const win = state.windows[w];
          const label = w === "week" ? "Weekly" : w === "rolling" ? "Rolling 5h" : "Monthly";
          await toast("Go cap pressure", `${label} window ${Math.round(win.pct)}% used — ${Math.round(win.remainingPct ?? 0)}% left.`);
        }
      }
    } catch {
      /* never break the session on cost bookkeeping */
    }
  }

  return {
    onTurn,
    async onFailed() {
      // A rejected step (429 block, etc.): refresh ground truth immediately.
      await onTurn({ model: "unknown", failed: true });
    },
    async onAssistantMessage(info) {
      if (!info || info.role !== "assistant" || !info.time?.completed) return;
      await onTurn({ model: `${info.providerID}/${info.modelID}`, cost: info.cost, tokens: info.tokens ?? info.usage ?? null });
    },
  };
}

export default {
  id: "cost-tracker",
  server: async (input) => {
    const tracker = await createTracker({
      shell: input?.$,
      toast: async (title, message) => {
        try {
          await input?.client?.tui?.showToast({ title, message, variant: "warning" });
        } catch {
          /* Desktop / headless: menu-bar companion covers alerting */
        }
      },
    });

    return {
      event: async ({ event }) => {
        if (event?.type !== "message.updated") return;
        await tracker.onAssistantMessage(event.properties?.info);
      },
    };
  },
  async setup(ctx) {
    const tracker = await createTracker({
      shell: null,
      // V2 server plugins have no TUI toast API; the menu-bar companion and
      // the TUI status plugin consume sr-live.json. Log for the server log.
      toast: async (title, message) => debug(`${title}: ${message}`),
    });

    const controller = new AbortController();
    // V2 has no `message.updated`; a completed step is the cost-bearing unit
    // (`session.step.ended` carries cost, `session.step.started` carries the
    // model). Steps map 1:1 to V1 assistant messages, so request counts keep
    // the same meaning.
    const models = new Map(); // assistantMessageID -> "providerID/modelID"
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: ["session.step.started", "session.step.ended", "session.step.failed"],
        signal: controller.signal,
      })) {
        const data = event.data ?? event.properties ?? {};
        const id = data.assistantMessageID;
        if (event.type === "session.step.started") {
          if (id && data.model?.providerID) models.set(id, `${data.model.providerID}/${data.model.id}`);
          continue;
        }
        const model = (id && models.get(id))
          || (data.model?.providerID ? `${data.model.providerID}/${data.model.id}` : "unknown");
        if (id) models.delete(id);
        if (event.type === "session.step.failed") {
          // A 429 lands here, not in step.ended: refresh ground truth now so
          // a provider block flips the state instead of waiting for the tick.
          // The mapping is still cleared (no stale attribution for retries).
          await tracker.onFailed();
        } else if (event.type === "session.step.ended") {
          await tracker.onTurn({ model, cost: data.cost, tokens: data.tokens ?? data.usage ?? null });
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) debug(`event subscription failed: ${(error && error.message) || error}`);
    });
    return () => controller.abort();
  },
};
