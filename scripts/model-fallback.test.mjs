import assert from "node:assert/strict";
import { test } from "node:test";
import fallback from "../plugins/model-fallback.js";

const GLM = "opencode-go/glm-5.3-flash";
const MINI = "opencode-go/minimax-m3.1-flash";
const FREE = "nvidia/z-ai/glm-5.3-flash";
const model = (ref) => {
  const [providerID, ...rest] = ref.split("/");
  return { providerID, modelID: rest.join("/") };
};
async function harness(agent = "researcher", ref = GLM, sessionID = "test") {
  const notices = [];
  const hooks = await fallback({
    directory: process.cwd(),
    client: {
      app: { log: async () => ({ data: true }) },
      tui: { showToast: async (input) => { notices.push(input.body ?? input); } },
    },
  });
  await hooks["chat.params"]({ sessionID, agent, model: { providerID: model(ref).providerID, id: model(ref).modelID } });
  return {
    hooks, notices,
    retry: async (error = { message: "Too many requests", statusCode: 429 }) =>
      hooks.event({ event: { type: "session.status", properties: { sessionID, status: { type: "retry", attempt: 1, ...error } } } }),
    terminal: async (error) => hooks.event({ event: { type: "session.error", properties: { sessionID, error } } }),
    next: async (requested = ref, requestedAgent = agent) => {
      const output = { message: { sessionID, role: "user", agent: requestedAgent, model: model(requested) }, parts: [] };
      await hooks["chat.message"]?.({ sessionID, agent: requestedAgent, model: model(requested) }, output);
      return output.message.model;
    },
  };
}

test("legacy retry arms a fallback for the next prompt, without claiming an in-flight switch", async () => {
  const h = await harness();
  await h.retry();
  assert.deepEqual(await h.next(), model(MINI));
  assert.match(h.notices[0].message, /next.*prompt|resume/i);
  assert.doesNotMatch(h.notices[0].message, /in-flight retry continues|switched/i);
});

test("legacy free-usage text arms the approved NVIDIA lane", async () => {
  const h = await harness("docs-writer");
  await h.retry({ message: "Free usage exceeded, subscribe to Go", action: { reason: "free_tier_limit" } });
  assert.deepEqual(await h.next(), model(FREE));
});

test("account-wide Go quota does not bounce a private role between Go models", async () => {
  const h = await harness();
  await h.retry({ message: "Weekly usage limit exceeded; quota resets Monday" });
  assert.deepEqual(await h.next(), model(GLM));
  assert.match(h.notices[0].message, /account|shared/i);
});

test("terminal nested quota errors and modern retry events use the same handoff", async () => {
  for (const type of ["session.error", "session.next.retried", "session.next.step.failed"]) {
    const h = await harness("brainstorm");
    await h.hooks.event({ event: { type, properties: { sessionID: "test", error: { name: "APIError", data: { statusCode: 429, message: "quota exceeded" } } } } });
    assert.deepEqual(await h.next(), model(FREE), type);
    assert.equal(h.notices.length, 1, type);
  }
});

test("auth/context/cancellation/ordinary service failures do not trigger routing", async () => {
  for (const error of [
    { statusCode: 401, message: "Invalid API key; quota unknown" },
    { statusCode: 403, message: "Access denied" },
    { message: "Context window exceeded" },
    { message: "User aborted the request" },
    { statusCode: 503, message: "temporarily unavailable" },
  ]) {
    const h = await harness();
    await h.terminal({ data: error });
    assert.deepEqual(await h.next(), model(GLM));
    assert.equal(h.notices.length, 0);
  }
});

test("single-hop routing stays on fallback across turns and never chains to NVIDIA", async () => {
  const h = await harness();
  await Promise.all([h.retry(), h.retry()]);
  assert.equal(h.notices.length, 1);
  assert.deepEqual(await h.next(), model(MINI));
  await h.hooks["chat.params"]({ sessionID: "test", agent: "researcher", model: { providerID: "opencode-go", id: "minimax-m3.1-flash" } });
  await h.retry();
  assert.deepEqual(await h.next(), model(GLM));
  assert.ok(h.notices.length <= 2);
});

test("model-specific rate limit exceeded is not classified as account-wide quota", async () => {
  const h = await harness();
  await h.retry({ statusCode: 429, message: "Rate limit exceeded" });
  assert.deepEqual(await h.next(), model(MINI));
});

test("title/summary/compaction bookkeeping cannot replace the task routing identity", async () => {
  const h = await harness("researcher");
  for (const agent of ["title", "summary", "compaction"]) {
    await h.hooks["chat.params"]({ sessionID: "test", agent, model: { providerID: "other", id: "small-model" } });
  }
  await h.retry();
  assert.deepEqual(await h.next(), model(MINI));
});

test("manual model or role change cancels the pending handoff", async () => {
  const h = await harness("brainstorm");
  await h.retry();
  assert.deepEqual(await h.next(GLM, "security-reviewer"), model(GLM));
  assert.deepEqual(await h.next(GLM, "brainstorm"), model(GLM));
  const other = await harness();
  await other.retry();
  const manual = "opencode-go/claude-haiku-5-5";
  assert.deepEqual(await other.next(manual), model(manual));
  assert.deepEqual(await other.next(), model(GLM));
});

test("unknown models, existing NVIDIA and missing session state remain unchanged", async () => {
  for (const ref of ["other/unknown", FREE]) {
    const h = await harness("docs-writer", ref);
    await h.retry();
    assert.deepEqual(await h.next(), model(ref));
    assert.equal(h.notices.length, 0);
  }
});

test("kill switch disables handoff; session deletion clears state", async () => {
  const previous = process.env.OPENCODE_MODEL_FALLBACK;
  try {
    process.env.OPENCODE_MODEL_FALLBACK = "off";
    const h = await harness();
    await h.retry();
    assert.deepEqual(await h.next(), model(GLM));
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_MODEL_FALLBACK;
    else process.env.OPENCODE_MODEL_FALLBACK = previous;
  }
  const h = await harness();
  await h.retry();
  await h.hooks.event({ event: { type: "session.deleted", properties: { info: { id: "test" } } } });
  assert.deepEqual(await h.next(), model(GLM));
});

test("missing UI/log services never throw or prevent handoff", async () => {
  const hooks = await fallback({ client: {}, directory: process.cwd() });
  await hooks["chat.params"]({ sessionID: "silent", agent: "brainstorm", model: { providerID: "opencode-go", id: "glm-5.3-flash" } });
  await hooks.event({ event: { type: "session.status", properties: { sessionID: "silent", status: { type: "retry", message: "Too many requests" } } } });
  const output = { message: { agent: "brainstorm", model: model(GLM) }, parts: [] };
  await hooks["chat.message"]?.({ sessionID: "silent" }, output);
  assert.deepEqual(output.message.model, model(FREE));
});
