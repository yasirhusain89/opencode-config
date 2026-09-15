import type { Plugin } from "@opencode-ai/plugin"

const GITHUB_DESTRUCTIVE = [
	/git\s+push\s+.*--force/,
	/git\s+push\s+-f\s+/,
	/git\s+reset\s+--hard/,
	/git\s+clean\s+-fd/,
	/git\s+branch\s+-D\s+main/,
	/git\s+checkout\s+.*--\s+\.?$/,
	/gh\s+pr\s+merge\s+.*--auto/,
	/gh\s+pr\s+close\s+/,
	/gh\s+repo\s+delete/,
	/gh\s+release\s+delete/,
	/gh\s+release\s+upload\s+.*--clobber/,
	/gh\s+variable\s+delete/,
	/gh\s+secret\s+delete/,
	/gh\s+api\s+.*-X\s*DELETE/,
]

const CI_BRAKE_PATTERN = /gh\s+variable\s+set\s+CI_MODE\s+.*\boff\b/

export const GithubSafety: Plugin = async () => ({
	"tool.execute.before": async (input, output) => {
		if (input.tool !== "bash") return
		const command = String(output.args?.command ?? "")

		for (const re of GITHUB_DESTRUCTIVE) {
			if (re.test(command)) {
				throw new Error(
					`[github-safety] Blocked destructive git/GitHub command matching "${re.source}". Confirm with the user, run it manually, or scope it to a non-main branch.`,
				)
			}
		}

		if (CI_BRAKE_PATTERN.test(command)) {
			throw new Error(
				"[github-safety] CI_MODE=off silently disables CI. Per repo convention: set CI_MODE=quick instead, and ALWAYS delete CI_MODE when done (gh variable delete CI_MODE). Confirm with the user before using the off brake.",
			)
		}
	},
})
