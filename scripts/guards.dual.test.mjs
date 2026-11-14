// Dual-entrypoint guard tests: one logic core must behave the same when V1
// calls server() and when V2 calls setup(ctx).
// Run: node --test scripts/guards.dual.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import diskGuard from "../plugins/disk-guard.ts";
import execGuard from "../plugins/exec-guard.ts";
import githubSafety from "../plugins/github-safety.ts";
import pathGuard from "../plugins/path-guard.ts";
import secretGuard from "../plugins/secret-guard.ts";

const directory = process.cwd();

async function v1(plugin) {
  const hooks = await plugin.server({ directory, client: {} });
  return (tool, input) => hooks["tool.execute.before"]({ tool }, { args: input });
}

async function v2(plugin) {
  const hooks = {};
  const ctx = {
    location: { directory },
    tool: {
      hook: async (name, callback) => {
        hooks[name] = callback;
        return { dispose: async () => {} };
      },
    },
  };
  await plugin.setup(ctx);
  return async (tool, input) => hooks["execute.before"]({ tool, input });
}

const cases = [
  {
    name: "exec-guard blocks unbounded sleeps and accepts bounded ones",
    plugin: execGuard,
    blocked: ["bash", "shell"],
    check: async (run) => {
      await assert.rejects(run("bash", { command: "sleep 300" }), /exec-guard/);
      await assert.rejects(run("shell", { command: "sleep 300" }), /exec-guard/);
      await assert.doesNotReject(run("shell", { command: "sleep 30" }));
      await assert.doesNotReject(run("shell", { command: "ls -la" }));
    },
  },
  {
    name: "secret-guard blocks secret paths for both read arg shapes",
    plugin: secretGuard,
    check: async (run) => {
      await assert.rejects(run("read", { path: ".env" }), /secret-guard/);
      await assert.rejects(run("read", { filePath: ".env" }), /secret-guard/);
      await assert.rejects(run("shell", { command: "git push --force origin main" }), /secret-guard/);
      await assert.doesNotReject(run("read", { path: "README.md" }));
    },
  },
  {
    name: "github-safety blocks destructive commands on shell and bash",
    plugin: githubSafety,
    check: async (run) => {
      await assert.rejects(run("shell", { command: "git push origin main --force" }), /github-safety/);
      await assert.rejects(run("bash", { command: "gh repo delete acme/x" }), /github-safety/);
      await assert.doesNotReject(run("shell", { command: "git status --short" }));
    },
  },
  {
    name: "path-guard blocks protected roots through both tool names",
    plugin: pathGuard,
    check: async (run) => {
      await assert.rejects(run("read", { path: "~/Downloads/report.pdf" }), /path-guard/);
      await assert.rejects(run("read", { filePath: "~/Documents/notes.md" }), /path-guard/);
      await assert.rejects(run("shell", { command: "cat ~/Downloads/report.pdf" }), /path-guard/);
      await assert.doesNotReject(run("read", { path: "src/index.ts" }));
      await assert.doesNotReject(run("shell", { command: "ls src" }));
    },
  },
  {
    name: "disk-guard leaves ordinary commands alone",
    plugin: diskGuard,
    check: async (run) => {
      await assert.doesNotReject(run("shell", { command: "ls -la" }));
      await assert.doesNotReject(run("bash", { command: "git status" }));
    },
  },
];

for (const entry of cases) {
  test(`V1 ${entry.name}`, async () => entry.check(await v1(entry.plugin)));
  test(`V2 ${entry.name}`, async () => entry.check(await v2(entry.plugin)));
}
