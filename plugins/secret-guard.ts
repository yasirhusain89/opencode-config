// Dual V1/V2 plugin: V1 calls `server()`, V2 calls `setup(ctx)`.
// V2 renamed the bash tool to `shell` and read/edit take `path`.
type GuardInput = { tool: string }
type GuardArgs = Record<string, unknown> | undefined
type ToolHookContext = {
	tool: { hook(name: "execute.before", cb: (event: { tool: string; input?: GuardArgs }) => void): Promise<unknown> }
}

const SECRET_FILE_PATTERNS = [
	/\.env\b/i,
	/\.env\./i,
	/\.pem$/i,
	/\.key$/i,
	/\.p12$/i,
	/id_rsa/i,
	/id_ed25519/i,
	/credentials(\.json)?$/i,
	/\.keystore$/i,
	/\.jks$/i,
	/\.mobileprovision$/i,
	/google-services\.json$/i,
	/GoogleService-Info\.plist$/i,
	/\.ssh\//,
	/\.aws\//,
	/\.gnupg\//,
]

const TOKEN_NAME_PATTERN = /token|secret|password|apikey|api_key|private_key/i

function isSecretPath(filePath: string | undefined): boolean {
	if (!filePath) return false
	if (SECRET_FILE_PATTERNS.some((re) => re.test(filePath))) return true
	const base = filePath.split("/").pop() ?? ""
	return TOKEN_NAME_PATTERN.test(base) && !/\.(md|ts|js|py|rs|svelte|jsonc|toml|ya?ml|example)$/i.test(filePath)
}

const DANGEROUS_BASH = [
	/git\s+push\s+.*--force/,
	/git\s+reset\s+--hard/,
	/git\s+clean\s+-fd/,
	/gh\s+pr\s+merge\s+.*--auto/,
	/gh\s+variable\s+delete/,
	/gh\s+release\s+delete/,
	/gh\s+api\s+.*-X\s*DELETE/,
	/gh\s+secret\s+delete/,
	/sudo\s+/,
	/mkfs\s+/,
	/dd\s+if=/,
	/chmod\s+-R\s+777/,
	/curl\s+[^|]*\|\s*(ba)?sh/,
	/wget\s+[^|]*\|\s*(ba)?sh/,
	/git\s+config\s+.*--global/,
]

function block(input: GuardInput, args: GuardArgs): void {
	if (input.tool === "read" || input.tool === "edit" || input.tool === "write") {
		const filePath =
			(typeof args?.path === "string" ? args.path : undefined) ??
			(typeof args?.filePath === "string" ? args.filePath : undefined) ??
			(typeof args?.pattern === "string" ? args.pattern : undefined)
		if (isSecretPath(filePath)) {
			throw new Error(
				`[secret-guard] Blocked ${input.tool} on "${filePath}" — matches a secret/credential pattern. If this is a non-secret file that was misidentified, rename it or ask the user to allow it explicitly.`,
			)
		}
	}

	if (input.tool === "bash" || input.tool === "shell") {
		const command = String(args?.command ?? "")
		for (const re of DANGEROUS_BASH) {
			if (re.test(command)) {
				throw new Error(
					`[secret-guard] Blocked bash command matching "${re.source}" — destructive or secret-exposing. Ask the user to run it manually if it is genuinely needed.`,
				)
			}
		}
	}
}

export default {
	id: "secret-guard",
	server: async () => ({
		"tool.execute.before": async (input: GuardInput, output: { args?: GuardArgs }) => block(input, output.args),
	}),
	async setup(ctx: ToolHookContext) {
		await ctx.tool.hook("execute.before", (event) => block({ tool: event.tool }, event.input))
	},
}
