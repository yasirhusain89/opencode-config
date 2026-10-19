import type { Plugin } from "@opencode-ai/plugin"
import { execSync } from "node:child_process"
import { statSync } from "node:fs"
import { dirname } from "node:path"

// Blocks bash tool blobs that would download or extract large data when the
// target volume is low on space. Rationale: a multi-GB download/extract with
// <10GiB free previously poisoned /tmp mid-extraction (Swift toolchain,
// Oct 2026) and truncated cpio payloads silently.
//
// Tunables (per-session env):
//   OPENCODE_DISK_GUARD=off    disable all checks
//   OPENCODE_MIN_FREE_GB=N     threshold override (default 10)

const DOWNLOAD_PATTERNS = [
	/\bpnpm\s+(create|dlx|add|install|i)\b/,
	/\bnpm\s+(create|exec|install|add|ci|i)\b/,
	/\byarn\s+(add|install|create|dlx)\b/,
	/\bbun\s+(add|install|create|dlx|x)\b/,
	/\bnpx\b/,
	/\bpip3?\s+install\b/,
	/\bpipx\b/,
	/\buv\s+(add|pip|sync|install)\b/,
	/\bconda\s+(install|create|env\s+create)\b/,
	/\bgem\s+install\b/,
	/\bgo\s+install\b/,
	/\bbrew\s+(install|fetch|reinstall)\b/,
	/\bcargo\s+(add|install|fetch)\b/,
	/\bswiftly\s+(--\S+\s+)*(install|update)\b/,
	/\bgit\s+(clone|lfs\s+pull)\b/,
	/\bgh\s+(release\s+download|repo\s+clone)\b/,
	/\bdocker\s+pull\b/,
	/\bsoftwareupdate\s+(-i|--install)/,
	/\bmas\s+install\b/,
	/\binstaller\s+-pkg\b/,
	/\bcurl\b/,
	/\bwget\b/,
	/\baria2c\b/,
]

const EXTRACT_PATTERNS = [
	/\btar\s+(-|x)/,
	/\bgunzip\b/,
	/\bgzip\s+-d\b/,
	/\bunzstd\b/,
	/\bzstd\s+-d\b/,
	/\bxz\s+-d\b/,
	/\bunxz\b/,
	/\bbunzip2\b/,
	/\bunzip\b/,
	/\bunrar\b/,
	/\b7z\b/,
	/\bcpio\s+-i?\b/,
	/\bxar\s+-[a-z]*x/,
	/\bditto\s+-[a-z]*x/,
	/\bpax\s+-r\b/,
	/\bhdiutil\s+(attach|convert)\b/,
]

// Read-only introspection / local builds never need the space check. `node`
// and `python3 -c` are deliberately NOT safe: interpreters can download
// arbitrary data, so their segments are scanned for download/extract verbs.
// Residual: in-interpreter network APIs (https.get, urllib.request.urlretrieve)
// are invisible to shell-verb patterns and stay uncovered by design.
const SAFE_PREFIX_RE =
	/^\s*(df|pwd|which|ls|cat|stat|du|gitnexus|echo|printf|true|false|swiftc|swift|rustc|grep|rg|find|head|tail|cargo\s+(build|test|check))\b/

// Pure env-assignment segments (FOO=bar) are not operations.
const ENV_ASSIGN_RE = /^\s*[A-Za-z_]\w*=[^\s]*\s*$/

const VAR_SUB_RE = /\$\{?\w+\}?/g

function segments(command: string): string[] {
	return command
		.split(/&&|\|\||\||;|\$|`/g)
		.map((seg) => seg.replace(VAR_SUB_RE, "$VAR").trim())
		.filter((seg) => seg.length > 0)
}

function heavySegment(command: string): string | undefined {
	for (const seg of segments(command)) {
		if (ENV_ASSIGN_RE.test(seg)) continue
		if (SAFE_PREFIX_RE.test(seg)) continue
		if (DOWNLOAD_PATTERNS.some((re) => re.test(seg))) return seg
		if (EXTRACT_PATTERNS.some((re) => re.test(seg))) return seg
	}
	return undefined
}

function freeKiB(path: string): number {
	const out = execSync(`df -k -P ${JSON.stringify(path)}`).toString().trim()
	const lines = out.split("\n")
	const cols = lines[lines.length - 1].trim().split(/\s+/)
	// POSIX df: Filesystem 1024-blocks Used Available Capacity Mounted-on
	return Number.parseInt(cols[3], 10)
}

function targetPath(chain: string): string {
	// Prefer an absolute/home path named in the command; walk up to the closest
	// existing ancestor (target may not exist yet), else the data volume.
	const tokens = chain.split(/\s+/).map((t) => t.replace(/^[(&|;'"]+|[-&|;'")]+$/g, ""))
	for (const raw of tokens) {
		if (!/^(\/|~|\$HOME)/.test(raw)) continue
		// Device nodes (smartctl /dev/disk4, hdiutil, dd) live on devfs with
		// ~0 available — probing them false-blocks the whole command.
		if (/^\/dev(\/|$)/.test(raw)) continue
		let p = raw.replace(/^\$HOME/, process.env.HOME ?? "").replace(/^~/, process.env.HOME ?? "")
		if (p.length < 2) continue
		for (let i = 0; i < 6; i++) {
			try {
				statSync(p)
				return dirname(p)
			} catch {
				const up = dirname(p)
				if (up === p) break
				p = up
			}
		}
	}
	return process.platform === "darwin" ? "/System/Volumes/Data" : "/"
}

export const DiskGuard: Plugin = async () => ({
	"tool.execute.before": async (input, output) => {
		if (input.tool !== "bash") return
		if (process.env.OPENCODE_DISK_GUARD === "off") return

		const command = String(output.args?.command ?? "")
		const heavy = heavySegment(command)
		if (!heavy) return

		let minFreeGiB = Number.parseInt(process.env.OPENCODE_MIN_FREE_GB ?? "10", 10)
		if (!Number.isFinite(minFreeGiB) || minFreeGiB <= 0) minFreeGiB = 10

		let freeK: number
		try {
			freeK = freeKiB(targetPath(command))
		} catch {
			return // probe failed — fail open rather than block everything
		}

		const freeGiB = freeK / 1024 / 1024
		if (freeGiB >= minFreeGiB) return

		throw new Error(
			`[disk-guard] Refusing "${heavy.slice(0, 120)}" — only ${freeGiB.toFixed(1)}GiB free on the target volume, ` +
				`need ≥${minFreeGiB}GiB for downloads/extracts to finish safely. ` +
				`Run a cleanup pass first (check purgeable space, du -sh /tmp ~/Library/Caches ~/.cache, rm stale toolchains) and retry. ` +
				`One-off bypass: OPENCODE_DISK_GUARD=off.`,
		)
	},
})
