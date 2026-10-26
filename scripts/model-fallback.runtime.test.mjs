// Run: node --test scripts/model-fallback.runtime.test.mjs
// macOS only: fail closed unless sandbox-exec enforces loopback-only networking.
// No SDK dependency, credentials, live provider, detached process, or event injection.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const GLM = { providerID: "opencode-go", modelID: "glm-5.3-flash" };
const MINI = { providerID: "opencode-go", modelID: "minimax-m3.1-flash" };
const FREE = { providerID: "nvidia", modelID: "z-ai/glm-5.3-flash" };
const dummyKey = "runtime-fixture-not-a-real-key";
const sandbox = `(version 1)
(allow default)
(deny network*)
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))`;

async function executable() {
  const candidates = process.env.OPENCODE_RUNTIME_BIN
    ? [resolve(process.env.OPENCODE_RUNTIME_BIN)]
    : [...(process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "opencode")),
       join(homedir(), ".opencode/bin/opencode")];
  for (const path of candidates) {
    try { await access(path, 1); return path; } catch {}
  }
  throw new Error("Installed opencode executable not found (OPENCODE_RUNTIME_BIN may select it)");
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 1_000);
  try { await exited; } finally { clearTimeout(force); }
}

test("installed runner: real quota retry, user stop, persisted next-prompt handoff and SSE completion", {
  timeout: 60_000,
  skip: process.platform !== "darwin" ? "Requires macOS sandbox-exec; never run unguarded" : false,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "model-fallback-runtime-"));
  const lifetime = new AbortController();
  const deadline = setTimeout(() => lifetime.abort(new Error("Runtime fixture exceeded 52 seconds")), 52_000);
  const children = new Set();
  let provider;
  let eventReader;
  let eventTask;
  let server;
  let output = "";
  let phase = "isolation";
  const requests = [];
  const fixtureErrors = [];
  const events = [];
  const traceFile = join(root, "trace.jsonl");
  const emergencyStop = () => {
    lifetime.abort(new Error("Fixture interrupted"));
    for (const child of children) child.kill("SIGKILL");
  };
  process.once("SIGINT", emergencyStop);
  process.once("SIGTERM", emergencyStop);
  // The independent watchdog also kills the server if an awaited operation wedges.
  const watchdog = setTimeout(emergencyStop, 55_000);
  const launch = (command, args, env) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: false });
    children.add(child);
    child.on("error", (error) => { output += `\n${error.message}`; });
    child.stdout.on("data", (data) => { output = (output + data).slice(-12_000); });
    child.stderr.on("data", (data) => { output = (output + data).slice(-12_000); });
    return child;
  };
  async function waitFor(check, label, milliseconds = 10_000) {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
      lifetime.signal.throwIfAborted();
      if (server && (server.exitCode !== null || server.signalCode !== null)) {
        throw new Error(`opencode exited during ${label}`);
      }
      const value = await check();
      if (value) return value;
      await delay(40, undefined, { signal: lifetime.signal });
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
  const trace = async () => (await readFile(traceFile, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  try {
    const bin = await executable();
    for (const name of ["home", "config/opencode", "cache", "data", "state", "tmp", "managed"]) {
      await mkdir(join(root, name), { recursive: true });
    }
    const configDir = join(root, "config/opencode");
    // Prevent config dependency installation. This fixture plugin uses no npm imports.
    await mkdir(join(configDir, "node_modules"));
    await writeFile(join(configDir, "package.json"), JSON.stringify({ private: true, type: "module" }));
    await writeFile(join(configDir, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3, packages: { "": { dependencies: { "@opencode-ai/plugin": "fixture" } } },
    }));
    await writeFile(traceFile, "");
    await copyFile(fileURLToPath(new URL("../plugins/model-fallback.js", import.meta.url)), join(root, "subject.mjs"));
    // A transparent observer, not a replacement implementation: only the installed
    // runner invokes these hooks; event() receives only its actual bus events.
    await writeFile(join(root, "observer.mjs"), `
import fallback from "./subject.mjs";
import { appendFileSync } from "node:fs";
const record = (value) => appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify(value) + "\\n");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    record({ type: "blocked-fetch" });
    throw new Error("Runtime fixture blocked a non-loopback fetch");
  }
  return originalFetch(input, { ...init, redirect: "error" });
};
export default async (input) => {
  const hooks = await fallback(input);
  record({ type: "loaded" });
  return {
    ...hooks,
    "chat.params": async (input, output) => {
      await hooks["chat.params"](input, output);
      record({ type: "params", sessionID: input.sessionID, agent: input.agent,
        model: { providerID: input.model.providerID, modelID: input.model.id } });
    },
    "chat.message": async (input, output) => {
      const before = structuredClone(output.message.model);
      await hooks["chat.message"](input, output);
      record({ type: "message", sessionID: input.sessionID, before, after: output.message.model });
    },
    event: async (input) => {
      await hooks.event(input);
      if (input.event.type === "session.status" || input.event.type === "session.error")
        record({ type: "event", event: input.event });
    },
  };
};
`);
    // Deliberately do not spread process.env: no inherited provider credentials,
    // proxy, injected config, preload, console auth, or telemetry configuration.
    const env = {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: join(root, "home"), TMPDIR: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_TEST_HOME: join(root, "home"), OPENCODE_TEST_MANAGED_CONFIG_DIR: join(root, "managed"),
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
      OPENCODE_MODEL_FALLBACK: "on", NO_COLOR: "1",
      npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false",
    };
    // Prove OS enforcement before starting the installed runner. TEST-NET address
    // is denied at connect(), before any packet leaves the machine.
    const probe = launch("/usr/bin/sandbox-exec", ["-p", sandbox, process.execPath, "--input-type=module", "-e", `
import net from 'node:net';
const socket = net.connect({host: '192.0.2.1', port: 9});
socket.on('connect', () => { socket.destroy(); process.exit(2); });
socket.on('error', (e) => process.exit(e.code === 'EPERM' || e.code === 'EACCES' ? 0 : 3));
setTimeout(() => { socket.destroy(); process.exit(4); }, 1500).unref();
`], env);
    const [probeCode] = await once(probe, "exit");
    assert.equal(probeCode, 0, "OS network isolation unavailable; refusing to start provider runs");
    provider = createServer(async (req, res) => {
      try {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || "{}");
        const lane = req.url?.split("/")[1];
        requests.push({ lane, model: body.model, stream: body.stream });
        assert.equal(phase, "prompts", "Provider call before isolated config was proven safe");
        assert.equal(req.headers.authorization, `Bearer ${dummyKey}`);
        assert.equal(req.method, "POST");
        assert.match(req.url, /^\/(go|nvidia)\/v1\/chat\/completions$/);
        assert.ok(lane === "go" ? [GLM.modelID, MINI.modelID].includes(body.model) : body.model === FREE.modelID);
        if (lane === "go" && body.model === GLM.modelID) {
          res.writeHead(429, { "content-type": "application/json", "retry-after": "30" });
          res.end(JSON.stringify({ error: { message: "Too many requests: fixture model capacity", type: "rate_limit_error", code: "rate_limit" } }));
          return;
        }
        assert.equal(body.stream, true);
        const chunk = (delta, finish_reason = null) => ({
          id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1, model: body.model,
          choices: [{ index: 0, delta, finish_reason }],
        });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: "fixture fallback completed" }))}\n\n`);
        res.end(`data: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`);
      } catch (error) {
        fixtureErrors.push(error);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Fixture assertion failed" } }));
      }
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
    const defineProvider = (lane, ids) => ({
      npm: "@ai-sdk/openai-compatible", env: [], whitelist: ids,
      api: `${providerOrigin}/${lane}/v1`,
      options: { apiKey: dummyKey, baseURL: `${providerOrigin}/${lane}/v1`, timeout: 5_000 },
      models: Object.fromEntries(ids.map((id) => [id, {
        id, name: `Fixture ${id}`, reasoning: false, tool_call: false,
        limit: { context: 32_000, output: 1_024 }, cost: { input: 0, output: 0 },
        provider: { npm: "@ai-sdk/openai-compatible", api: `${providerOrigin}/${lane}/v1` },
      }])),
    });
    const agent = { mode: "primary", prompt: "Return a short plain-text answer. Do not call tools.", permission: "deny" };
    const config = {
      $schema: "https://opencode.ai/config.json", model: `${GLM.providerID}/${GLM.modelID}`,
      small_model: `${FREE.providerID}/${FREE.modelID}`, default_agent: "researcher",
      enabled_providers: ["opencode-go", "nvidia"],
      provider: { "opencode-go": defineProvider("go", [GLM.modelID, MINI.modelID]), nvidia: defineProvider("nvidia", [FREE.modelID]) },
      plugin: [pathToFileURL(join(root, "observer.mjs")).href],
      agent: { researcher: agent, "docs-writer": agent, title: { disable: true }, summary: { disable: true } },
      mcp: {}, skills: { paths: [], urls: [] }, instructions: [],
      permission: "deny", share: "disabled", snapshot: false, autoupdate: false,
      compaction: { auto: false }, formatter: false, lsp: false,
    };
    await writeFile(join(configDir, "opencode.json"), JSON.stringify(config));
    phase = "server startup";
    output = "";
    server = launch("/usr/bin/sandbox-exec", ["-p", sandbox, bin, "serve", "--hostname", "127.0.0.1", "--port", "0"], env);
    const origin = await waitFor(() => output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0], "server listen");
    const api = async (path, method = "GET", body) => {
      const response = await fetch(`${origin}${path}`, {
        method, headers: { "content-type": "application/json", "x-opencode-directory": root },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
        redirect: "error",
      });
      assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
      const text = await response.text();
      return text ? JSON.parse(text) : undefined;
    };
    phase = "resolved config safety gate";
    const actual = await api("/config");
    assert.deepEqual(actual.enabled_providers, config.enabled_providers);
    assert.deepEqual(Object.keys(actual.provider).sort(), ["nvidia", "opencode-go"]);
    assert.deepEqual(actual.plugin, config.plugin);
    assert.equal(Object.keys(actual.mcp ?? {}).length, 0);
    assert.deepEqual(actual.instructions ?? [], []);
    assert.deepEqual(actual.skills, config.skills);
    assert.equal(actual.small_model, config.small_model);
    const available = await api("/config/providers");
    assert.deepEqual(available.providers.map((item) => item.id).sort(), ["nvidia", "opencode-go"]);
    for (const item of available.providers) {
      assert.equal(item.options.apiKey, dummyKey);
      assert.equal(item.options.baseURL, config.provider[item.id].options.baseURL);
      assert.deepEqual(Object.keys(item.models).sort(), config.provider[item.id].whitelist.toSorted());
      for (const model of Object.values(item.models)) {
        assert.equal(model.api.npm, "@ai-sdk/openai-compatible");
        assert.equal(model.api.url, item.options.baseURL);
      }
    }
    assert.equal((await trace()).filter((item) => item.type === "loaded").length, 1);
    assert.equal(requests.length, 0);
    t.diagnostic("Isolation verified: resolved providers/models use only the loopback fixture, dummy auth, one observer-wrapped subject plugin, no MCP/skills/instructions; OS blocks remote connect.");
    phase = "prompts";
    const eventResponse = await fetch(`${origin}/event`, {
      headers: { "x-opencode-directory": root }, signal: lifetime.signal,
    });
    assert.ok(eventResponse.ok);
    eventReader = eventResponse.body.getReader();
    eventTask = (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await eventReader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let split;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (data) events.push(JSON.parse(data));
        }
      }
    })();
    // Attach rejection handling immediately; the assertion below checks failures.
    let eventError;
    eventTask.catch((error) => { eventError = error; });
    for (const [role, target] of [["researcher", MINI], ["docs-writer", FREE]]) {
      const session = await api("/session", "POST", { title: `Runtime fixture ${role}` });
      const sessionPath = `/session/${session.id}`;
      const prompt = (text) => ({ agent: role, model: GLM, parts: [{ type: "text", text }] });
      await api(`${sessionPath}/prompt_async`, "POST", prompt("Simulate the initial quota-limited turn."));
      await waitFor(async () => (await trace()).find((item) => item.type === "event" &&
        item.event.type === "session.status" && item.event.properties.sessionID === session.id &&
        item.event.properties.status.type === "retry"), `${role} actual legacy retry reaching plugin`);
      // Explicit user stop: do not pretend a captured in-flight retry switches.
      await api(`${sessionPath}/abort`, "POST");
      await waitFor(async () => !(await api("/session/status"))[session.id] ||
        (await api("/session/status"))[session.id].type === "idle", `${role} user stop`);
      const beforeNext = requests.length;
      const result = await api(`${sessionPath}/message`, "POST", prompt("Resume after the explicit user stop."));
      const messages = await api(`${sessionPath}/message`);
      const users = messages.filter((item) => item.info.role === "user");
      assert.equal(users.length, 2);
      assert.deepEqual(users[0].info.model, GLM);
      assert.deepEqual(users[1].info.model, target, `${role}: hook mutation must be persisted by runner`);
      const hook = (await trace()).filter((item) => item.type === "message" && item.sessionID === session.id).at(-1);
      assert.deepEqual(hook.before, GLM);
      assert.deepEqual(hook.after, target);
      assert.equal(result.info.providerID, target.providerID);
      assert.equal(result.info.modelID, target.modelID);
      assert.equal(result.info.finish, "stop");
      assert.equal(result.info.error, undefined);
      assert.ok(result.info.time.completed);
      assert.ok(result.parts.some((part) => part.type === "text" && part.text.includes("fixture fallback completed")));
      assert.ok(requests.slice(beforeNext).some((item) => item.model === target.modelID &&
        item.lane === (target.providerID === "nvidia" ? "nvidia" : "go") && item.stream === true));
      assert.ok(!requests.slice(beforeNext).some((item) => item.lane === "go" && item.model === GLM.modelID),
        "Stopped primary must not be retried on resumed prompt");
      t.diagnostic(`${role}: real 429 → legacy retry delivered to plugin → explicit abort → persisted ${target.providerID}/${target.modelID} → actual localhost fallback HTTP/SSE → completed assistant text.`);
      await api(sessionPath, "DELETE");
    }
    await waitFor(() => events.some((event) => event.type === "session.status" && event.properties.status.type === "retry"), "retry over public SSE");
    assert.equal(eventError, undefined);
    assert.equal(fixtureErrors.length, 0, fixtureErrors[0]?.message);
    assert.equal((await trace()).filter((item) => item.type === "blocked-fetch").length, 0);
  } catch (error) {
    // Output is only from the credential-free child, never the user's config.
    t.diagnostic(`Runtime fixture failed during ${phase}; isolated child output:\n${output}`);
    throw error;
  } finally {
    lifetime.abort();
    await eventReader?.cancel().catch(() => {});
    await eventTask?.catch(() => {});
    for (const child of children) await stop(child);
    if (provider) {
      provider.closeAllConnections();
      await new Promise((done) => provider.close(done));
    }
    clearTimeout(deadline);
    clearTimeout(watchdog);
    process.removeListener("SIGINT", emergencyStop);
    process.removeListener("SIGTERM", emergencyStop);
    await rm(root, { recursive: true, force: true });
  }
});
