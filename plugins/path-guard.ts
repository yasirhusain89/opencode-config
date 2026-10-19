import type { Plugin } from "@opencode-ai/plugin"
import { realpathSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

// Blocks tool access to protected directories (default: ~/Documents and
// ~/Downloads). Rationale: those trees hold user data that is trivially swept
// up by a model following a stray instruction or a poisoned repo — no reason
// an agent session should read, write, list, or glob them.
//
// Unlike `permission.external_directory`, which only gates the "outside the
// project" boundary and still lets bash through, this hook intercepts the
// path arguments of every path-bearing tool and scans bash commands, so a
// relative path, a `..` traversal, or a `$HOME/Downloads` expansion is caught
// too.
//
// Env (per-session):
//   OPENCODE_PATH_GUARD=off          disable the guard entirely
//   OPENCODE_PATH_GUARD_BLOCK=a:b    override the protected roots (colon-separated)

const DEFAULT_BLOCKED_ROOTS = [
	"~/Documents",
	"~/Downloads",
	// Proven-bad extents: Oct 2026 testing showed reads on files in this
	// folder wedge forever at the OS level (stat fine, reads hang — videos +
	// JPGs, all Apr-2026 mtimes, SMART Verified, metadata healthy: localized
	// media defect). Agents must never touch it; copy test media to internal
	// SSD first. Override per-session via OPENCODE_PATH_GUARD_BLOCK.
	"/Volumes/YH-SanP2TB/Photos/Moab 2026",
];

// Tools whose args carry a filesystem path, and the arg keys that hold it.
const PATH_TOOLS = new Set(["read", "edit", "write", "multiedit", "patch", "list", "glob", "grep"])
const PATH_ARG_KEYS = ["filePath", "path", "directory", "file", "pattern"]

function homeDir(): string {
	return process.env.HOME ?? "/Users/unknown"
}

function blockedRoots(): string[] {
	const raw = process.env.OPENCODE_PATH_GUARD_BLOCK ?? DEFAULT_BLOCKED_ROOTS.join(":")
	return raw
		.split(":")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => canon(entry))
}

function expand(p: string): string {
	let out = p.replace(/\$\{?HOME\}?/g, homeDir())
	if (out === "~" || out.startsWith("~/")) out = homeDir() + out.slice(1)
	return out
}

// Resolve to an absolute, `..`-free, symlink-free path. The target may not
// exist yet, so walk up to the closest existing ancestor, realpath that, and
// re-attach the remainder — otherwise `ln -s ~/Documents /tmp/docs` or the
// macOS `/tmp` -> `/private/tmp` rewrite would slip past a string compare.
function canon(p: string, cwd: string): string {
	let abs = expand(p)
	abs = isAbsolute(abs) ? resolve(abs) : resolve(cwd, abs)

	const tail: string[] = []
	let head = abs
	for (;;) {
		try {
			return tail.length ? join(realpathSync(head), ...tail.reverse()) : realpathSync(head)
		} catch {
			const parent = resolve(head, "..")
			if (parent === head) return abs
			const base = head.slice(parent === "/" ? 1 : parent.length + 1)
			tail.push(base)
			head = parent
		}
	}
}

export function pathBlocked(target: string, cwd: string): boolean {
	if (!target) return false
	const abs = canon(target, cwd)
	for (const root of blockedRoots()) {
		if (abs === root || abs.startsWith(root.endsWith("/") ? root : root + "/")) return true
	}
	return false
}

// Pull path-ish tokens out of a shell command. Absolute (`/x`, `~/x`,
// `$HOME/x`) are the obvious case; a bare leading segment matching a
// protected basename (`cat Documents/a.txt`) is resolved against the shell's
// cwd so relative access is covered without flagging an unrelated
// project-local dir that happens to share the name.
export function blockedByCommand(command: string, cwd: string): string | undefined {
	const names = blockedRoots().map((root) => root.split("/").pop() ?? "")
	// Backslash-escaped spaces (`Moab\ 2026`) would be shredded by the split
	// below the same way quoted spaces were — fold them to NUL first and
	// restore per-candidate before testing.
	const flat = command.replace(/\\ /g, "\u0000")
	const restore = (s: string) => s.replace(/\u0000/g, " ")
	// Quoted spans may contain spaces (e.g. "Moab 2026") — test them whole
	// before tokenizing below, or the split would shred them into fragments
	// that never match a blocked root.
	const quotedSpans = flat.match(/"[^"]*"|'[^']*'/g) ?? []
	for (const span of quotedSpans) {
		const inner = restore(span.slice(1, -1))
		if (inner.length < 2) continue
		const cleaned = inner.replace(/^[a-z]+:/i, "")
		if (/^(\/|~|\$)/.test(cleaned)) {
			if (pathBlocked(cleaned, cwd)) return cleaned
			continue
		}
		const first = cleaned.split("/")[0]
		if (names.includes(first) && pathBlocked(join(cwd, cleaned), cwd)) return cleaned
	}
	const tokens = flat.split(/[\s'"();|&<>,]+/).filter(Boolean)

	for (const token of tokens) {
		if (token.length < 2) continue
		const quoted = restore(token).replace(/^[a-z]+:/i, "")
		if (/^(\/|~|\$)/.test(quoted)) {
			if (pathBlocked(quoted, cwd)) return quoted
			continue
		}
		const first = quoted.split("/")[0]
		if (names.includes(first) && pathBlocked(join(cwd, quoted), cwd)) return quoted
	}
	return undefined
}

function argPaths(args: Record<string, unknown> | undefined): string[] {
	if (!args) return []
	const found: string[] = []
	for (const key of PATH_ARG_KEYS) {
		const value = args[key]
		if (typeof value === "string" && value.length > 0) found.push(value)
	}
	return found
}

export const PathGuard: Plugin = async ({ directory }) => {
	const cwd = directory

	return {
		"tool.execute.before": async (input, output) => {
			if (process.env.OPENCODE_PATH_GUARD === "off") return

			if (input.tool === "bash") {
				const args = output.args as { command?: unknown; workdir?: unknown; cwd?: unknown } | undefined
				// Relative paths in a shell command resolve against the shell's
				// cwd, not the plugin's project directory — use the tool's own
				// workdir override when it sets one.
				const workdir = [args?.workdir, args?.cwd].find((v): v is string => typeof v === "string" && v.length > 0)
				const command = String(args?.command ?? "")
				const hit = blockedByCommand(command, workdir ?? cwd)
				if (hit) {
					throw new Error(
						`[path-guard] Blocked bash command — it references protected path "${hit}". ` +
							`Protected roots: ${blockedRoots().join(", ")}. Ask the user to run it manually if it is genuinely needed.`,
					)
				}
				return
			}

			if (!PATH_TOOLS.has(input.tool)) return
			for (const candidate of argPaths(output.args)) {
				if (pathBlocked(candidate, cwd)) {
					throw new Error(
						`[path-guard] Blocked ${input.tool} on "${candidate}" — resolves inside a protected directory. ` +
							`Protected roots: ${blockedRoots().join(", ")}. Copy the file into the project (or ask the user) if you need its contents.`,
					)
				}
			}
		},
	}
}
