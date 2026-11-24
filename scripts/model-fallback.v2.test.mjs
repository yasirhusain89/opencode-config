// V2 adapter tests: fake plugin context, no server or SDK dependency.
// Run: node --test scripts/model-fallback.v2.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "../plugins/model-fallback.js";

const model = (providerID, id) => ({ providerID, id });

function harness() {
  const hooks = {};
  const ctx = {
    session: {
      hook: async (name, callback) => {
        hooks[name] = callback;
        return { dispose: async () => {} };
      },
      switchModel: async () => {},
    },
    app: { log: async () => ({ data: true }) },
    event: {
      subscribe: async function* () {
        // no server events in this unit harness
      },
    },
  };
  return { ctx, hooks };
}

async function setup() {
  const h = harness();
  const cleanup = await plugin.setup(h.ctx);
  return { ...h, cleanup };
}

function track(hooks, sessionID, agent, providerID, id) {
  hooks.context({ sessionID, agent, model: model(providerID, id) });
}

function resolve(hooks, sessionID, agent, providerID, id, kind = "primary") {
  const event = { kind, sessionID, agent, model: model(providerID, id) };
  hooks["experimental.model.resolve"](event);
  return event.model;
}

test("V2 retry arms a one-hop fallback applied at the next primary request", async () => {
  const { hooks, cleanup } = await setup();
  track(hooks, "s1", "researcher", "opencode-go", "glm-5.3-flash");
  await hooks.retry({
    sessionID: "s1",
    agent: "researcher",
    model: model("opencode-go", "glm-5.3-flash"),
    error: { type: "provider.rate-limit", message: "Too many requests", status: 429 },
    attempt: 1,
    decision: { retry: true, delay: 1000 },
  });
  assert.deepEqual(resolve(hooks, "s1", "researcher", "opencode-go", "glm-5.3-flash"), {
    providerID: "opencode-go",
    modelID: "minimax-m3.1-flash",
  });
  assert.equal(typeof cleanup, "function");
  await cleanup();
});

test("V2 low-stakes roles take the free-pool lane first (NVIDIA only as last resort)", async () => {
  const { hooks } = await setup();
  track(hooks, "s2", "docs-writer", "opencode-go", "glm-5.3-flash");
  await hooks.retry({
    sessionID: "s2",
    agent: "docs-writer",
    model: model("opencode-go", "glm-5.3-flash"),
    error: { type: "provider.rate-limit", message: "Free usage exceeded", status: 429 },
    attempt: 1,
    decision: { retry: true, delay: 1000 },
  });
  assert.deepEqual(resolve(hooks, "s2", "docs-writer", "opencode-go", "glm-5.3-flash"), {
    providerID: "opencode",
    modelID: "mimo-v2.6-flash-free",
  });
});

test("V2 explicit user model or agent change wins over the armed handoff", async () => {
  const { hooks } = await setup();
  track(hooks, "s3", "researcher", "opencode-go", "glm-5.3-flash");
  await hooks.retry({
    sessionID: "s3",
    agent: "researcher",
    model: model("opencode-go", "glm-5.3-flash"),
    error: { type: "provider.rate-limit", message: "Too many requests", status: 429 },
    attempt: 1,
    decision: { retry: true, delay: 1000 },
  });
  assert.deepEqual(resolve(hooks, "s3", "researcher", "opencode-go", "claude-haiku-5-5"), {
    providerID: "opencode-go",
    id: "claude-haiku-5-5",
  });
  // The handoff was cancelled; the original model now proceeds unchanged.
  assert.deepEqual(resolve(hooks, "s3", "researcher", "opencode-go", "glm-5.3-flash"), {
    providerID: "opencode-go",
    id: "glm-5.3-flash",
  });
});

test("V2 auxiliary request kinds never receive the handoff", async () => {
  const { hooks } = await setup();
  track(hooks, "s4", "researcher", "opencode-go", "glm-5.3-flash");
  await hooks.retry({
    sessionID: "s4",
    agent: "researcher",
    model: model("opencode-go", "glm-5.3-flash"),
    error: { type: "provider.rate-limit", message: "Too many requests", status: 429 },
    attempt: 1,
    decision: { retry: true, delay: 1000 },
  });
  assert.deepEqual(resolve(hooks, "s4", "researcher", "opencode-go", "glm-5.3-flash", "title"), {
    providerID: "opencode-go",
    id: "glm-5.3-flash",
  });
});

test("V2 account-wide quota does not bounce a private role between Go models", async () => {
  const { hooks } = await setup();
  track(hooks, "s5", "researcher", "opencode-go", "glm-5.3-flash");
  await hooks.retry({
    sessionID: "s5",
    agent: "researcher",
    model: model("opencode-go", "glm-5.3-flash"),
    error: { type: "provider.rate-limit", message: "Weekly usage limit exceeded; quota resets Monday", status: 429 },
    attempt: 1,
    decision: { retry: true, delay: 1000 },
  });
  assert.deepEqual(resolve(hooks, "s5", "researcher", "opencode-go", "glm-5.3-flash"), {
    providerID: "opencode-go",
    id: "glm-5.3-flash",
  });
});
