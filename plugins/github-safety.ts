// Dual V1/V2 plugin: V1 calls `server()`, V2 calls `setup(ctx)`.
// V2 renamed the bash tool to `shell`.
type GuardInput = { tool: string }
type GuardArgs = Record<string, unknown> | undefined
type ToolHookContext = {
	tool: { hook(name: "execute.before", cb: (event: { tool: string; input?: GuardArgs }) => void): Promise<unknown> }
}

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

function block(input: GuardInput, args: GuardArgs): void {
	if (input.tool !== "bash" && input.tool !== "shell") return
	const command = String(args?.command ?? "")

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
}

export default {
	id: "github-safety",
	server: async () => ({
		"tool.execute.before": async (input: GuardInput, output: { args?: GuardArgs }) => block(input, output.args),
	}),
	async setup(ctx: ToolHookContext) {
		await ctx.tool.hook("execute.before", (event) => block({ tool: event.tool }, event.input))
	},
}
