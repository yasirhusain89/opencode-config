import type { Plugin } from "@opencode-ai/plugin"
import { statSync } from "node:fs"

// Blocks bash tool calls that hold the agent loop hostage or detach unsupervised
// work from it. Rationale: in Oct 2026 a pileup of `sleep 55/90/240` waits,
// `while pgrep …; do sleep 25; done` polls, and `nohup … &` background encodes
// across four concurrent sessions (one session alone: 607 bash calls, 51 sleeps)
// forced two hard mac reboots — load avg 90 two minutes after boot, a video
// engine binary crashing twice underneath a nohup+sleep retry loop, and an
// `rm -rf` stalled on an external volume.
//
// Design: target UNBOUNDED + UNSUPERVISED, permit BOUNDED + CHECKPOINTED.
// - Waits are fine up to 120s per sleep; sleep/poll commands get a 5min tool
//   timeout ceiling so every wait returns and the agent re-checks next turn.
// - Plain work (builds, installs, eval runners) gets a 30min ceiling.
// - Detaching (`nohup`/`setsid`/trailing `&`) stays off by default — detached
//   work is what piled up — with a per-session opt-in for dev-server work.
// - `open` of local files stays allowed (report previews); GUI app/URL launches
//   do not. `kill -9 <pid>` (exact target) stays allowed; pattern SIGKILLs do
//   not. `rm -rf` on `/Volumes/…` stays blocked except allowlisted volumes.
//
// Replacement pattern: one foreground check per tool call, end the turn,
// re-check next turn. Split long builds into steps instead of sleeping on them.
//
// Tunables (per-session env):
//   OPENCODE_EXEC_GUARD=off       disable all checks
//   OPENCODE_MAX_SLEEP_SECS=N     longest single `sleep` allowed (default 120)
//   OPENCODE_MAX_WAIT_MS=N        timeout ceiling for wait-class commands —
//                                 anything containing sleep/poll (default 300000)
//   OPENCODE_MAX_TIMEOUT_MS=N     timeout ceiling for everything else
//                                 (default 1800000)
//   OPENCODE_ALLOW_BG=1           permit nohup/setsid/trailing & this session
//                                 (dev-server work — kill what you start)
//   OPENCODE_RM_VOLUMES=a:b       colon-separated /Volumes prefixes `rm -rf`
//                                 may touch (default: none)

const NEVER_POLL = [
	/\bwatch\s+(-n\s*[\d.]+\s+)?\S/,
	/\btail\s+(?:-[a-zA-Z]*f[a-zA-Z]*|--follow(?:=\S*)?)(?:\s|$)/,
];

const DETACH_PATTERNS = [/\bnohup\b/, /\bsetsid\b/, /\bdisown\b/, /\bcaffeinate\b/];

// Pattern-mode SIGKILLs risk the wrong target and skip cleanup. Exact-PID
// `kill -9 <pid>` stays allowed; `kill -9 $(…)` / backticks are pattern-mode
// in disguise.
const SIGKILL_PATTERNS = [/\bpkill\b[^\n|;&]*-9\b/, /\bkillall\b/, /\bkill\s+-9\s+[`$]/];

const OPEN_APP_RE = /\bopen\b[^|;&]*(-a\b|:\/\/|\.app(?:\s|$|"))/;

function unboundedPing(command: string): boolean {
	if (!/\bping\b/.test(command)) return false;
	return !/\bping\b[\s\S]{0,200}?\s-[a-zA-Z]*[cto]/.test(command);
}

function maxSleepSecs(command: string): number {
	let max = 0;
	const re = /\bsleep\s+(\d+(?:\.\d+)?)\s*([smh])?/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(command)) !== null) {
		const mult = m[2] === "m" ? 60 : m[2] === "h" ? 3600 : 1;
		const secs = Number.parseFloat(m[1]) * mult;
		if (secs > max) max = secs;
	}
	return max;
}

// Wait-class commands: anything that sits and waits (sleep, retry loops,
// literal-infinite `while true` / `for ((;;))`). These get the short timeout
// ceiling so every wait returns and the agent re-checks next turn.
export function isWaitClass(command: string): boolean {
	return (
		/\bsleep\b/.test(command) ||
		/\b(while|until)\b[\s\S]{0,600}?\bsleep\b/.test(command) ||
		/\bfor\b[\s\S]{0,600}?\bsleep\b/.test(command) ||
		/\bwhile\s+(true|:)\b/.test(command) ||
		/\bfor\s*\(\(\s*;\s*;\s*\)\)/.test(command)
	);
}

// A lone `&` backgrounds the process. `&&`, `||`, `|&` (pipe stderr), `>&`
// redirects (`2>&1`), and `&>` are not backgrounding, and quoted `&` (e.g.
// `echo "a & b"`) is just text — strip all of those first.
function backgroundToken(command: string): boolean {
	const stripped = command
		.replace(/"[^"]*"/g, '""')
		.replace(/'[^']*'/g, "''")
		.replace(/&&|\|\||\|&/g, " ")
		.replace(/\d*>&\d*-?/g, " ")
		.replace(/&>/g, " ");
	return /(^|[\s;(`])&/.test(stripped) || /&([\s;`)"]|$)/.test(stripped);
}

// Flags `rm -rf` (or `-fr`, long forms) aimed at `/`, $HOME itself, or any
// `/Volumes/…` path outside OPENCODE_RM_VOLUMES. Variable-indirect targets
// (`rm -rf "$C/…"`) are invisible to static checks by design — those rely on
// agent discipline (AGENTS.md).
function badRmTarget(command: string): string | undefined {
	const m = command.match(/\brm\s+((?:-[^\s"']+\s+)+)([\s\S]*)/);
	if (!m) return undefined;
	const flags = m[1];
	const recursive = /(^|\s)--recursive\b|-[a-zA-Z]*[rR]/.test(flags);
	const force = /(^|\s)--force\b|-[a-zA-Z]*f/.test(flags);
	if (!recursive || !force) return undefined;
	const home = process.env.HOME ?? "";
	const allowedVolumes = (process.env.OPENCODE_RM_VOLUMES ?? "")
		.split(":")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	const tokens = m[2].match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
	for (let raw of tokens) {
		if (raw === "--" || /^-[^-]/.test(raw)) continue;
		raw = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
		if (!raw || raw === "--") continue;
		let p = raw;
		if (p === "~" || p.startsWith("~/")) p = home + p.slice(1);
		p = p.replace(/^\$HOME(?=\/|$)/, home).replace(/^\$\{HOME\}(?=\/|$)/, home);
		if (p === "/" || (home !== "" && p === home)) return raw;
		if (p === "/Volumes" || p.startsWith("/Volumes/")) {
			if (!allowedVolumes.some((v) => p === v || p.startsWith(v.endsWith("/") ? v : v + "/"))) {
				return raw;
			}
		}
	}
	return undefined;
}

function openBlocked(command: string): boolean {
	const m = command.match(/\bopen\b\s*(-R(?:\s+[^|;&]*)?|[^|;&]*)/);
	if (!m) return false;
	const args = (m[1] ?? "").trim();
	if (args === "") return true; // bare `open` launches Finder
	if (/^-R(\s|$)/.test(args)) return false; // reveal in Finder — harmless
	if (OPEN_APP_RE.test(command)) return true; // -a, :// URLs, .app bundles
	// Existing directories open in Finder — block; plain files (report
	// previews) stay allowed. Unresolvable targets are allowed: the agent may
	// be opening something it just built.
	try {
		const target = args.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").split(/\s+/)[0];
		if (target) {
			if (statSync(target).isDirectory()) return true;
		}
	} catch {
		// target does not exist (yet) — allow
	}
	return false;
}

export function execBlocked(command: string, maxSleepSecsAllowed = 120): string | undefined {
	if (!command.trim()) return undefined;

	const secs = maxSleepSecs(command);
	if (secs > maxSleepSecsAllowed) {
		return (
			`Refusing "sleep" of ${secs}s (max ${maxSleepSecsAllowed}s, OPENCODE_MAX_SLEEP_SECS). ` +
			`Marathon sleeps hold the agent loop hostage across sessions. ` +
			`Sleep ≤${maxSleepSecsAllowed}s, end the turn, and re-check next turn — or wait in ≤5min chunks (wait-class timeout).`
		);
	}

	for (const re of NEVER_POLL) {
		if (re.test(command)) {
			return (
				`Refusing "${re.source}" — it never returns on its own. ` +
				`Run ONE foreground check (plain "tail", "ps", …) instead, end the turn, and re-check next turn.`
			);
		}
	}

	const bgAllowed = process.env.OPENCODE_ALLOW_BG === "1";
	if (!bgAllowed) {
		for (const re of DETACH_PATTERNS) {
			if (re.test(command)) {
				const verb = re.source.replace(/\\b/g, "");
				return (
					`Refusing detached execution ("${verb}"). ` +
					`Detached work survives the tool call and piles up across sessions — this pattern forced hard reboots. ` +
					`Run in the foreground with a bounded timeout instead. ` +
					`Dev-server session? Relaunch with OPENCODE_ALLOW_BG=1 — then kill what you start.`
				);
			}
		}

		if (backgroundToken(command)) {
			return (
				`Refusing background "&" in "${command.slice(0, 120)}". ` +
				`Backgrounded work survives the tool call and piles up across sessions. ` +
				`Run in the foreground with a bounded timeout instead (OPENCODE_ALLOW_BG=1 opts out for the session).`
			);
		}
	}

	if (unboundedPing(command)) {
		return (
			`Refusing unbounded "ping" (no -c/-t/-o bound). ` +
			`It runs until killed and burns the whole tool call. Use "ping -c 3 <host>" instead.`
		);
	}

	if (openBlocked(command)) {
		return (
			`Refusing GUI "open" in "${command.slice(0, 120)}". ` +
			`Agent turns must not launch apps/URLs/Finder windows — each one stacks a process the session never reaps. ` +
			`"open <file>" (report previews) and "open -R" stay allowed; print app/URL paths and let the user open them.`
		);
	}

	for (const re of SIGKILL_PATTERNS) {
		if (re.test(command)) {
			return (
				`Refusing pattern SIGKILL matching "${re.source}". ` +
				`Pattern SIGKILLs risk the wrong target and skip cleanup — use plain "pkill"/"kill" (SIGTERM) on an exact match, or "kill -9 <pid>" for one known PID.`
			);
		}
	}

	const badRm = badRmTarget(command);
	if (badRm) {
		return (
			`Refusing "rm -rf" on "${badRm}" — filesystem root, home, or an external volume. ` +
			`External-drive surgery stalls in uninterruptible I/O and hangs the machine. ` +
			`Allowlist a trusted volume with OPENCODE_RM_VOLUMES=/Volumes/<name>, or ask the user to run it manually.`
		);
	}

	return undefined;
}

function intEnv(name: string, fallback: number): number {
	const v = Number.parseInt(process.env[name] ?? String(fallback), 10);
	return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const ExecGuard: Plugin = async () => ({
	"tool.execute.before": async (input, output) => {
		if (process.env.OPENCODE_EXEC_GUARD === "off") return;
		if (input.tool !== "bash") return;

		const command = String(output.args?.command ?? "");
		const reason = execBlocked(command, intEnv("OPENCODE_MAX_SLEEP_SECS", 120));
		if (reason) throw new Error(`[exec-guard] ${reason}`);

		// Two-tier timeout ceiling: waits must return quickly so the agent
		// re-checks next turn; plain work (builds, installs, eval runners)
		// gets a longer leash.
		const waitMax = intEnv("OPENCODE_MAX_WAIT_MS", 300000);
		const workMax = intEnv("OPENCODE_MAX_TIMEOUT_MS", 1800000);
		const timeout = (output.args as { timeout?: unknown } | undefined)?.timeout;
		if (typeof timeout === "number") {
			if (isWaitClass(command) && timeout > waitMax) {
				throw new Error(
					`[exec-guard] Refusing wait-class timeout ${timeout}ms (max ${waitMax}ms, OPENCODE_MAX_WAIT_MS). ` +
					`Waits must return so the agent re-checks next turn — poll in ≤5min chunks instead of one marathon call.`,
				);
			}
			if (!isWaitClass(command) && timeout > workMax) {
				throw new Error(
					`[exec-guard] Refusing bash timeout ${timeout}ms (max ${workMax}ms, OPENCODE_MAX_TIMEOUT_MS). ` +
					`Split the work into bounded foreground steps instead of one long call.`,
				);
			}
		}
	},
});
