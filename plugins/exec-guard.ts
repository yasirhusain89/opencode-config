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
//   OPENCODE_ALLOW_WINE=1        permit Wine / Game Porting Toolkit and
//                                 app-bundle executable launches this session
//                                 (explicit user-approved use case only)
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

// Process-spawning runtimes: executing Wine / Game Porting Toolkit binaries
// (or macOS app-bundle executables) directly — instead of via the owning UI —
// spawns unsupervised process trees (wineservers, services, helpers, Dock
// icons) the agent never reaps, and killing the shared runtime can take down
// the user's own work (2026-10-24: direct `wine64 --version` probes piled up
// Dock icons; `wineserver -k` on the shared SteamHeroic prefix killed a live
// game session). Diagnose read-only (pgrep/ps, log greps, Read/Glob/Grep);
// launch and quit through the owning UI. Explicit per-use-case opt-in:
// OPENCODE_ALLOW_WINE=1 (host env, or inline prefix gated by opencode.jsonc
// `"*OPENCODE_ALLOW_WINE=1*": "ask"` so the user is always prompted).
const WINE_BIN_NAMES = new Set([
	"wine",
	"wine32",
	"wine64",
	"wine-preloader",
	"wine32-preloader",
	"wine64-preloader",
	"wineserver",
	"wineboot",
	"winetricks",
	"winecfg",
	"winedbg",
	"wineconsole",
	"winepath",
	"winedump",
	"winefile",
	"winemine",
	"regedit",
	"regsvr32",
	"msiexec",
	"gameportingtoolkit",
	"gameportingtoolkit-no-esync",
	"gameportingtoolkit-no-hud",
	"proton",
]);

const WINE_RUNTIME_BIN_RE =
	/(?:^|\/)(?:game-porting-toolkit|wine-staging|wine-crossover|crossover|proton)[^/]*\/.*\/bin\/[^/\s]+$/i;
const WINE_SUBDIR_BIN_RE = /\/wine\/bin\/[^/\s]+$/i;
const APP_MACOS_BIN_RE = /\/Contents\/MacOS\/[^/\s]+$/;

const SHELL_KEYWORDS = new Set([
	"do",
	"then",
	"else",
	"elif",
	"while",
	"until",
	"if",
	"!",
	"time",
	"{",
]);

const CMD_WRAPPERS = new Set([
	"env",
	"command",
	"exec",
	"builtin",
	"nice",
	"nohup",
	"setsid",
	"arch",
	"xargs",
	"timeout",
]);

const WRAPPER_ARG_FLAGS = new Set(["-n", "-L", "-P", "-I", "-s", "-k", "-u", "-C", "-arch"]);
const SHELL_INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

// Quote-aware tokenizer that splits a shell command into segments at control
// boundaries (`;`, `|`, `||`, `&`, `&&`, `|&`, `\n`, `(`, `)`, `` ` ``, `$(`)
// while keeping quoted paths with spaces (`"$HOME/Library/Application Support/..."`)
// intact as single tokens. Subshells inside double quotes (`"$(cmd)"`) also
// emit their inner segments.
function shellSegments(command: string): string[][] {
	const segs: string[][] = [];
	let curSeg: string[] = [];
	let curTok = "";
	let tokStarted = false;

	const pushTok = () => {
		if (tokStarted || curTok.length > 0) {
			curSeg.push(curTok);
			curTok = "";
			tokStarted = false;
		}
	};
	const pushSeg = () => {
		pushTok();
		if (curSeg.length > 0) {
			segs.push(curSeg);
			curSeg = [];
		}
	};

	let i = 0;
	const n = command.length;
	while (i < n) {
		const ch = command[i];

		if (!tokStarted && curTok.length === 0 && ch === "#") {
			while (i < n && command[i] !== "\n") i++;
			continue;
		}
		if (ch === "\\" && i + 1 < n) {
			curTok += command[i + 1];
			tokStarted = true;
			i += 2;
			continue;
		}
		if (ch === "'") {
			tokStarted = true;
			i++;
			while (i < n && command[i] !== "'") {
				curTok += command[i++];
			}
			if (i < n) i++;
			continue;
		}
		if (ch === '"') {
			tokStarted = true;
			i++;
			while (i < n && command[i] !== '"') {
				if (command[i] === "\\" && i + 1 < n) {
					curTok += command[i + 1];
					i += 2;
					continue;
				}
				if (command.startsWith("$(", i)) {
					i += 2;
					let depth = 1;
					let inner = "";
					while (i < n && depth > 0) {
						if (command[i] === "(") depth++;
						else if (command[i] === ")") depth--;
						if (depth > 0) inner += command[i];
						i++;
					}
					for (const s of shellSegments(inner)) segs.push(s);
					continue;
				}
				if (command[i] === "`") {
					i++;
					let inner = "";
					while (i < n && command[i] !== "`") inner += command[i++];
					if (i < n) i++;
					for (const s of shellSegments(inner)) segs.push(s);
					continue;
				}
				curTok += command[i++];
			}
			if (i < n) i++;
			continue;
		}

		// Redirections (`2>&1`, `>/dev/null`, `0<&-`) are not command splits.
		const redir = command.slice(i).match(/^\d*(?:>>?|<<?)[&]?\d*-?/);
		if (redir && !command.startsWith("|&", i) && !command.startsWith("&&", i)) {
			pushTok();
			i += redir[0].length;
			continue;
		}

		if (command.startsWith("$(", i) || command.startsWith("&&", i) || command.startsWith("||", i) || command.startsWith("|&", i)) {
			pushSeg();
			i += 2;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "(" || ch === ")" || ch === "`") {
			pushSeg();
			i++;
			continue;
		}
		if (ch === " " || ch === "\t" || ch === "\r") {
			pushTok();
			i++;
			continue;
		}

		curTok += ch;
		tokStarted = true;
		i++;
	}
	pushSeg();
	return segs;
}

function expandTokenVars(tok: string, vars: Map<string, string[]>): string[] {
	let out = [tok];
	const varRe = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;
	let m: RegExpExecArray | null;
	const seen = new Set<string>();
	while ((m = varRe.exec(tok)) !== null) {
		const name = m[1] ?? m[2];
		if (!name || seen.has(name)) continue;
		seen.add(name);
		const vals = vars.get(name);
		if (!vals || vals.length === 0) continue;
		const pat = new RegExp(`\\$\\{${name}\\}|\\$${name}(?![A-Za-z0-9_])`, "g");
		const next: string[] = [];
		for (const cur of out) {
			for (const v of vals) next.push(cur.replace(pat, v));
		}
		out = next;
	}
	return out;
}

function checkExecutableCandidate(exe: string, args: string[]): string | undefined {
	if (!exe) return undefined;
	const base = (exe.split("/").pop() ?? exe).replace(/\.exe$/i, "").toLowerCase();
	if (WINE_BIN_NAMES.has(base)) {
		return (
			`Refusing wine-family execution ("${exe}"). ` +
			`Direct Wine / Game Porting Toolkit / wineserver execution spawns unsupervised processes (wineservers, services, Dock icons) the session never reaps, ` +
			`and killing the shared runtime takes down the user's own work. ` +
			`Diagnose read-only (pgrep/ps, log greps, Read/Glob/Grep tools) and launch/quit through the owning UI. ` +
			`User-approved use case? Prefix with OPENCODE_ALLOW_WINE=1 (prompts for approval) or set it for the session.`
		);
	}
	if (WINE_RUNTIME_BIN_RE.test(exe) || WINE_SUBDIR_BIN_RE.test(exe)) {
		return (
			`Refusing process-spawning runtime binary ("${exe}"). ` +
			`Same rule as above: no direct Wine / Game Porting Toolkit / Proton binary launches. ` +
			`Prefix with OPENCODE_ALLOW_WINE=1 if the user approved this run.`
		);
	}
	if (APP_MACOS_BIN_RE.test(exe)) {
		const safeSelfTest =
			args.includes("--self-test") && !/wine|game-porting-toolkit|heroic|steam|crossover/i.test(exe);
		if (!safeSelfTest) {
			return (
				`Refusing direct app-bundle binary execution ("${exe}"). ` +
				`Executing Contents/MacOS binaries directly spawns unsupervised GUI/helper processes. ` +
				`Inspect read-only (ls/otool/codesign/file/pgrep) or launch/quit via the owning UI (OPENCODE_ALLOW_WINE=1 opts in).`
			);
		}
	}
	return undefined;
}

function wineBlockedReason(command: string, depth = 0): string | undefined {
	if (depth > 3) return undefined;
	const inlineAllow = /(^|[;&|(\n]\s*)OPENCODE_ALLOW_WINE=1(?=\s|$)/.test(command);
	if (process.env.OPENCODE_ALLOW_WINE === "1" || inlineAllow) return undefined;

	const vars = new Map<string, string[]>();
	for (const seg of shellSegments(command)) {
		let idx = 0;
		while (idx < seg.length && SHELL_KEYWORDS.has(seg[idx])) idx++;
		if (idx >= seg.length) continue;

		// `for <var> in <items...>` binds candidate values for later `"$var"` calls.
		if (seg[idx] === "for" && idx + 2 < seg.length && seg[idx + 2] === "in") {
			const varName = seg[idx + 1];
			const items: string[] = [];
			for (const raw of seg.slice(idx + 3)) {
				items.push(...expandTokenVars(raw, vars));
			}
			vars.set(varName, items);
			continue;
		}

		// Leading `VAR=val` assignments.
		while (idx < seg.length && /^[A-Za-z_]\w*=/.test(seg[idx])) {
			const tok = seg[idx];
			const eq = tok.indexOf("=");
			const name = tok.slice(0, eq);
			const rhs = tok.slice(eq + 1);
			vars.set(name, expandTokenVars(rhs, vars));
			idx++;
		}
		if (idx >= seg.length) continue;

		// Peel command wrappers (`env`, `arch -x86_64`, `nice -n 10`, `xargs`, `timeout 5`, ...).
		while (idx < seg.length) {
			const headBase = (seg[idx].split("/").pop() ?? seg[idx]).toLowerCase();
			if (!CMD_WRAPPERS.has(headBase)) break;
			idx++;
			while (idx < seg.length) {
				const t = seg[idx];
				if (/^[A-Za-z_]\w*=/.test(t)) {
					idx++;
					continue;
				}
				if (WRAPPER_ARG_FLAGS.has(t)) {
					idx += 2;
					continue;
				}
				if (t.startsWith("-")) {
					idx++;
					continue;
				}
				break;
			}
			if (headBase === "timeout" && idx < seg.length && /^\d+(\.\d+)?[smhd]?$/.test(seg[idx])) {
				idx++;
			}
		}
		if (idx >= seg.length) continue;

		const rawExe = seg[idx];
		const args = seg.slice(idx + 1);
		for (const exe of expandTokenVars(rawExe, vars)) {
			const hit = checkExecutableCandidate(exe, args);
			if (hit) return hit;

			const base = (exe.split("/").pop() ?? exe).toLowerCase();
			// Subshell `sh -c "..."` / `bash -lc "..."`: inspect the inner command string.
			if (SHELL_INTERPRETERS.has(base)) {
				for (let a = 0; a < args.length; a++) {
					if (/^-[a-zA-Z]*c$/.test(args[a]) && a + 1 < args.length) {
						const sub = wineBlockedReason(args[a + 1], depth + 1);
						if (sub) return sub;
					}
				}
			}
			// `find ... -exec <bin> ...`: inspect `<bin>` (and block `{}` when find targets wine/app bundles).
			if (base === "find") {
				for (let a = 0; a < args.length; a++) {
					if ((args[a] === "-exec" || args[a] === "-execdir") && a + 1 < args.length) {
						const target = args[a + 1];
						const execArgs = args.slice(a + 2);
						if (target === "{}") {
							if (args.some((x) => /wine|game-porting-toolkit|\.app\b|Contents\/MacOS/i.test(x))) {
								return (
									`Refusing "find ${args[a]} {}" over Wine / app-bundle paths. ` +
									`Use find without -exec to list paths read-only.`
								);
							}
						} else {
							for (const expanded of expandTokenVars(target, vars)) {
								const subHit = checkExecutableCandidate(expanded, execArgs);
								if (subHit) return subHit;
							}
						}
					}
				}
			}
		}
	}
	return undefined;
}

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
function isWaitClass(command: string): boolean {
	return (
		/\bsleep\b/.test(command) ||
		/\b(while|until)\b[\s\S]{0,600}?\bsleep\b/.test(command) ||
		/\bfor\b[\s\S]{0,600}?\bsleep\b/.test(command) ||
		/\bwhile\s+(true|:)\b/.test(command) ||
		/\bfor\s*\(\(\s*;\s*;\s*\)\)/.test(command)
	);
}

// A lone `&` backgrounds the process. `&&`, `||`, `|&` (pipe stderr), `>&`
// / `<&` redirects (`2>&1`, `0<&-`), `&>`, and `${...}` parameter substitutions
// are not backgrounding, and quoted `&` (e.g. `echo "a & b"`) is just text —
// strip all of those first, then any remaining `&` is a background operator
// (including tight `cmd1&cmd2`).
function backgroundToken(command: string): boolean {
	const stripped = command
		.replace(/"[^"]*"/g, '""')
		.replace(/'[^']*'/g, "''")
		.replace(/\$\{[^}]*\}/g, " ")
		.replace(/&&|\|\||\|&/g, " ")
		.replace(/\d*[<>]&\d*-?/g, " ")
		.replace(/&>>?/g, " ");
	return /&/.test(stripped);
}

// Flags `rm -rf` (or `-fr`, long forms) aimed at `/`, $HOME itself, or any
// `/Volumes/…` path outside OPENCODE_RM_VOLUMES. Variable-indirect targets
// (`rm -rf "$C/…"`) are invisible to static checks by design — those rely on
// agent discipline (AGENTS.md).
//
// Scanned per `rm` SEGMENT, not across the whole command string: a script that
// cleans a temp dir early (`rm -rf "$TMP"`) and merely reads a /Volumes path
// later must not be blamed for the /Volumes path (2026-10-25 false positive
// blocked an approved RB2 Wine test).
function badRmTarget(command: string): string | undefined {
	const home = process.env.HOME ?? "";
	const allowedVolumes = (process.env.OPENCODE_RM_VOLUMES ?? "")
		.split(":")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	// Queue token arrays so find's quoted shell payloads retain their boundaries.
	const segments = shellSegments(command);
	for (const seg of segments) {
		let idx = 0;
		while (idx < seg.length && (SHELL_KEYWORDS.has(seg[idx]) || /^[A-Za-z_]\w*=/.test(seg[idx]))) idx++;
		while (idx < seg.length) {
			const wrapper = seg[idx].split("/").pop() ?? seg[idx];
			if (!CMD_WRAPPERS.has(wrapper)) break;
			idx++;
			while (idx < seg.length) {
				const token = seg[idx];
				if (wrapper === "env" && (token === "-S" || token === "--split-string" || token.startsWith("--split-string="))) {
					const inline = token.startsWith("--split-string=");
					const payload = inline ? token.slice("--split-string=".length) : seg[idx + 1];
					// env splits arguments without shell control operators; keep a
					// single command, including any arguments after the split string.
					if (payload) segments.push([...shellSegments(payload).flat(), ...seg.slice(idx + (inline ? 1 : 2))]);
					idx = seg.length;
					break;
				}
				if (token === "--") {
					idx++;
					break;
				}
				if (WRAPPER_ARG_FLAGS.has(token) || /^--(?:unset|chdir|max-args|max-lines|max-procs|max-chars|replace|eof|kill-after|signal)$/.test(token)) {
					idx += 2;
				} else if (token.startsWith("-") || /^[A-Za-z_]\w*=/.test(token)) {
					idx++;
				} else {
					break;
				}
			}
			if (wrapper === "timeout" && idx < seg.length && /^\d+(\.\d+)?[smhd]?$/.test(seg[idx])) idx++;
		}
		if (idx >= seg.length) continue;
		const executable = seg[idx].split("/").pop() ?? seg[idx];
		if (SHELL_INTERPRETERS.has(executable)) {
			for (let i = idx + 1; i < seg.length; i++) {
				if (!seg[i].startsWith("-") || seg[i] === "--") break;
				if (["-o", "-O", "--rcfile", "--init-file"].includes(seg[i])) {
					i++;
					continue;
				}
				if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(seg[i]) && i + 1 < seg.length) {
					segments.push(...shellSegments(seg[i + 1]));
					break;
				}
			}
		} else if (executable === "find") {
			for (let i = idx + 1; i < seg.length; i++) {
				if (!["-exec", "-execdir", "-ok", "-okdir"].includes(seg[i])) continue;
				let end = i + 1;
				while (end < seg.length && seg[end] !== ";" && seg[end] !== "+") end++;
				segments.push(seg.slice(i + 1, end));
				i = end;
			}
		}
		if (executable !== "rm") continue;

		let recursive = false;
		let force = false;
		const targets: string[] = [];
		for (let i = idx + 1; i < seg.length; i++) {
			const t = seg[i];
			if (!t || t === "--") continue;
			if (t.startsWith("-") && t.length > 1) {
				if (t === "--recursive" || /^-[a-zA-Z]*[rR]/.test(t)) recursive = true;
				if (t === "--force" || /^-[a-zA-Z]*f/.test(t)) force = true;
				continue;
			}
			targets.push(t);
		}
		if (!recursive || !force) continue;

		for (const raw of targets) {
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

function osascriptAppLaunch(command: string): boolean {
	if (!/\bosascript\b/.test(command)) return false;
	return (
		/\btell\s+application\b[\s\S]{0,200}?\bto\s+(activate|launch|open|run)\b/i.test(command) ||
		/\b(activate|launch)\s+application\b/i.test(command)
	);
}

function execBlocked(command: string, maxSleepSecsAllowed = 120): string | undefined {
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

	if (openBlocked(command) || osascriptAppLaunch(command)) {
		return (
			`Refusing GUI app/URL launch in "${command.slice(0, 120)}". ` +
			`Agent turns must not launch apps/URLs/Finder windows — each one stacks a process the session never reaps. ` +
			`"open <file>" (report previews), "open -R", and osascript "quit"/"display alert" stay allowed; print app/URL paths and let the user open them.`
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

	const wineReason = wineBlockedReason(command);
	if (wineReason) return wineReason;

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
