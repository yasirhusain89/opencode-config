// V2 adapter test: the server plugin must consume real V2 session events
// (`session.step.started` / `session.step.ended`), not V1's `message.updated`.
// Run: node --test scripts/cost-tracker.v2.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Module paths are resolved from HOME at import time, so isolate before import.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cost-tracker-v2-"));
process.env.HOME = tmp;
const liveDir = path.join(tmp, ".local/share/opencode");
const liveFile = path.join(liveDir, "sr-live.json");
fs.mkdirSync(liveDir, { recursive: true });

const seed = () => ({
  schema: 4,
  generated_at: new Date().toISOString(),
  fullRecomputeAt: new Date().toISOString(),
  windows: {
    month: { usedReq: 10, usedUsd: 1, capReq: 100, allowedReq: 90, pct: 10, remainingPct: 90 },
    week: { usedReq: 5, usedUsd: 0.5, capReq: 100, allowedReq: 95, pct: 5, remainingPct: 95 },
    rolling: { usedReq: 2, usedUsd: 0.2, capReq: null, allowedReq: null, pct: null, remainingPct: null },
  },
  alerts: [],
});
fs.writeFileSync(liveFile, JSON.stringify(seed()));

const { default: plugin } = await import("../plugins/cost-tracker.js");

async function harness(events) {
  fs.writeFileSync(liveFile, JSON.stringify(seed()));
  const seen = [];
  const ctx = {
    event: {
      subscribe: async function* (options) {
        seen.push(options);
        for (const event of events) yield event;
      },
    },
  };

  async function readAfterIdle(predicate) {
    for (let i = 0; i < 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      try {
        const state = JSON.parse(fs.readFileSync(liveFile, "utf8"));
        if (predicate(state)) return state;
      } catch {
        // file mid-rename; retry
      }
    }
    throw new Error("timed out waiting for sr-live.json update");
  }

  return { ctx, seen, readAfterIdle };
}

test("V2 setup subscribes to step events, not message.updated", async () => {
  const { ctx, seen } = await harness([]);
  const cleanup = await plugin.setup(ctx);
  assert.deepEqual(seen[0].types, ["session.step.started", "session.step.ended", "session.step.failed"]);
  assert.equal(typeof cleanup, "function");
  await cleanup();
});

test("V2 completed step records model from step.started and increments windows", async () => {
  const { ctx, readAfterIdle } = await harness([
    { type: "session.step.started", data: { sessionID: "s1", assistantMessageID: "a1", model: { providerID: "opencode-go", id: "glm-5.3-flash" } } },
    { type: "session.step.ended", data: { sessionID: "s1", assistantMessageID: "a1", cost: 0.03 } },
  ]);
  const cleanup = await plugin.setup(ctx);
  const state = await readAfterIdle((s) => s.lastTurn != null);
  assert.equal(state.lastTurn.model, "opencode-go/glm-5.3-flash");
  assert.equal(state.lastTurn.usd, 0.03);
  assert.equal(state.windows.month.usedReq, 11);
  assert.equal(state.windows.week.usedReq, 6);
  await cleanup();
});

test("V2 non-Go completed step does not consume Go windows", async () => {
  const { ctx, readAfterIdle } = await harness([
    { type: "session.step.started", data: { sessionID: "s3", assistantMessageID: "a3", model: { providerID: "opencode", id: "deepseek-v4.1-flash-free" } } },
    { type: "session.step.ended", data: { sessionID: "s3", assistantMessageID: "a3", cost: 0 } },
  ]);
  const cleanup = await plugin.setup(ctx);
  const state = await readAfterIdle((s) => s.lastTurn != null);
  assert.equal(state.lastTurn.model, "opencode/deepseek-v4.1-flash-free");
  assert.equal(state.windows.month.usedReq, 10, "free turn must not increment month");
  assert.equal(state.windows.week.usedReq, 5, "free turn must not increment week");
  assert.equal(state.windows.rolling.usedReq, 2, "free turn must not increment rolling");
  await cleanup();
});

test("V2 failed step clears the model mapping (no stale attribution)", async () => {
  const { ctx, readAfterIdle } = await harness([
    { type: "session.step.started", data: { sessionID: "s2", assistantMessageID: "a2", model: { providerID: "nvidia", id: "z-ai/glm-5.3-flash" } } },
    { type: "session.step.failed", data: { sessionID: "s2", assistantMessageID: "a2", error: { message: "boom" } } },
    { type: "session.step.ended", data: { sessionID: "s2", assistantMessageID: "a2", cost: 0.01 } },
  ]);
  const cleanup = await plugin.setup(ctx);
  const state = await readAfterIdle((s) => s.lastTurn != null);
  assert.equal(state.lastTurn.model, "unknown");
  await cleanup();
});
