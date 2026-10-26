// Quota handoff for legacy and modern runners. A legacy retry captures its
// model before backoff: changing session metadata cannot switch that request.
// Instead, arm ONE fallback and apply it through the supported chat.message
// hook when this session is prompted again (including a resumed Task).
// No unauthenticated HTTP, automatic aborts, duplicate prompts, or retry chains.
// State is process-local; restart clears it. OPENCODE_MODEL_FALLBACK=off disables.
const GO_FALLBACK = {
  "opencode-go/glm-5.3-flash": "opencode-go/minimax-m3.1-flash",
  "opencode-go/minimax-m3.1-flash": "opencode-go/glm-5.3-flash",
  "opencode-go/muse-spark-1.3-contributor": "opencode-go/glm-5.3-flash",
  "opencode-go/claude-haiku-5-5": "opencode-go/glm-5.3-flash",
  "opencode-go/claude-haiku-5.5": "opencode-go/glm-5.3-flash",
};
const FREE_FALLBACK = "nvidia/z-ai/glm-5.3-flash";
const LOW_STAKES = new Set(["brainstorm", "docs-writer", "domain-companion"]);
const QUOTA_RE = /rate.?limit|quota|too many requests|\b429\b|free usage exceeded|usage limit|capacity|overloaded/i;
const ACCOUNT_RE = /(?:weekly|monthly|daily|five.hour|5.hour|account.wide|shared).*(?:quota|limit|usage)|(?:quota|usage).*(?:reset|exhaust|exceed)|insufficient.*(?:balance|credit)|free usage exceeded/i;

function errorInfo(error) {
  if (!error || typeof error !== "object") return { status: undefined, text: "" };
  const data = error.data && typeof error.data === "object" ? error.data : error;
  return {
    status: Number(data.statusCode ?? error.statusCode) || undefined,
    text: [data.message, error.message, data.responseBody, error.responseBody, error.action?.reason]
      .filter((value) => typeof value === "string").join(" | "),
  };
}

function modelRef(model) {
  const id = model?.modelID ?? model?.id;
  return model?.providerID && id ? `${model.providerID}/${id}` : undefined;
}

function splitModel(ref) {
  const slash = ref.indexOf("/");
  return { providerID: ref.slice(0, slash), modelID: ref.slice(slash + 1) };
}

export default async ({ client }) => {
  const sessions = new Map();
  const enabled = (process.env.OPENCODE_MODEL_FALLBACK || "").toLowerCase() !== "off";

  async function notice(sessionID, message) {
    // Session IDs in logs make child-session handoffs diagnosable without
    // recording error bodies, prompts, or credentials.
    try { await client.app.log({ body: { service: "model-fallback", level: "warn", message, extra: { sessionID } } }); } catch {}
    try { await client.tui.showToast({ body: { title: "Model quota handoff", message, variant: "warning" } }); } catch {}
  }

  async function arm(sessionID, error) {
    const state = sessions.get(sessionID);
    if (!state || !enabled) return;
    const { status, text } = errorInfo(error);
    if (status === 401 || status === 403 || /context.{0,20}(?:length|window)|abort|cancel/i.test(text)) return;
    if (status !== 429 && !QUOTA_RE.test(text)) return;
    if (state.handled) {
      if (state.to && state.current === state.to && !state.exhausted) {
        state.exhausted = true;
        await notice(sessionID, "The fallback also hit a limit. No further automatic handoff; wait or select a model manually.");
      }
      return;
    }
    const from = state.current;
    // Only approved Go primaries may cross to NVIDIA, and only for these
    // low-stakes roles. Private/unknown roles never cross that boundary.
    if (!GO_FALLBACK[from]) return;
    state.handled = true; // latch before awaits: duplicate events cannot chain
    if (!LOW_STAKES.has(state.agent) && ACCOUNT_RE.test(text)) {
      await notice(sessionID, "Go account quota is shared across models. Wait for reset or choose an approved provider manually; another Go model will not restore quota.");
      return;
    }
    state.from = from;
    state.to = LOW_STAKES.has(state.agent) ? FREE_FALLBACK : GO_FALLBACK[from];
    await notice(sessionID, `Fallback ready: ${from} → ${state.to} on this session's next prompt. Stop the current retry if needed, then resume${LOW_STAKES.has(state.agent) ? "" : "; Go quota remains shared"}.`);
  }

  return {
    "chat.params": async (input) => {
      // Title/summary calls share session IDs but must not overwrite the
      // task's routing/privacy identity.
      if (["title", "summary", "compaction"].includes(input?.agent)) return;
      const current = modelRef(input?.model);
      if (!input?.sessionID || !current) return;
      const state = sessions.get(input.sessionID);
      if (state) {
        state.current = current;
        if (!state.handled) state.agent = input.agent;
      } else {
        sessions.set(input.sessionID, { current, agent: input.agent, handled: false });
      }
    },

    "chat.message": async (input, output) => {
      const state = sessions.get(input?.sessionID);
      const message = output?.message;
      if (!enabled || !state?.to || !message) return;
      if (state.exhausted) {
        state.to = undefined;
        return;
      }
      const requested = modelRef(message.model);
      // Explicit user model changes and agent changes always win. In
      // particular, a brainstorm -> security switch must not reuse NVIDIA.
      if (message.agent !== state.agent || (requested !== state.from && requested !== state.to)) {
        state.to = undefined;
        return;
      }
      message.model = splitModel(state.to); // drops provider-specific variants
      state.current = state.to;
    },

    event: async ({ event }) => {
      try {
        const props = event?.properties ?? {};
        if (event?.type === "session.deleted") {
          sessions.delete(props.info?.id ?? props.sessionID);
        } else if (event?.type === "session.status" && props.status?.type === "retry") {
          await arm(props.sessionID, props.status);
        } else if (["session.next.retried", "session.next.step.failed", "session.error"].includes(event?.type)) {
          await arm(props.sessionID, props.error);
        }
      } catch {
        // Observability/routing bookkeeping must never break an active turn.
      }
    },
  };
};
