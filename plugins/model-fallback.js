// Quota handoff for legacy and modern runners. A legacy retry captures its
// model before backoff: changing session metadata cannot switch that request.
// Instead, arm ONE fallback and apply it when this session is prompted again
// (including a resumed Task). No unauthenticated HTTP, automatic aborts,
// duplicate prompts, or retry chains.
// State is process-local; restart clears it. OPENCODE_MODEL_FALLBACK=off disables.
//
// Dual V1/V2 plugin: V1 receives chat.params/chat.message/event hooks; V2 uses
// session.hook("context"), the retry hook, and experimental.model.resolve.
const GO_FALLBACK = {
  "opencode-go/glm-5.3-flash": "opencode-go/minimax-m3.1-flash",
  "opencode-go/minimax-m3.1-flash": "opencode-go/glm-5.3-flash",
  "opencode-go/muse-spark-1.3-contributor": "opencode-go/glm-5.3-flash",
  "opencode-go/claude-haiku-5-5": "opencode-go/glm-5.3-flash",
  "opencode-go/claude-haiku-5.5": "opencode-go/glm-5.3-flash",
};
const FREE_CHAIN = [
  // Free pool first: outside the Go $10 quota, own tighter (~200/day-class)
  // limits. Prefer opencode/*-free so Go infra stays clear for loop volume.
  "opencode/mimo-v2.6-flash-free",
  // NVIDIA last: poor token rates (usage-dashboard per-model table: p50 ~37s
  // vs ~7s on Go) — latency-poor, use only when the free pool is also capped.
  "nvidia/z-ai/glm-5.3-flash",
];
const FREE_FALLBACK = FREE_CHAIN[0];
const NVIDIA_LAST = FREE_CHAIN[FREE_CHAIN.length - 1];
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

function refFromV2(model) {
  return model?.providerID && model?.id ? `${model.providerID}/${model.id}` : undefined;
}

function splitModel(ref) {
  const slash = ref.indexOf("/");
  return { providerID: ref.slice(0, slash), modelID: ref.slice(slash + 1) };
}

// Shared state machine. Both adapters feed the same session map so behavior
// stays identical across V1 and V2.
function createEngine({ notice, enabled }) {
  const sessions = new Map();

  function track(sessionID, agent, current) {
    if (!sessionID || !current) return;
    const state = sessions.get(sessionID);
    if (state) {
      state.current = current;
      if (!state.handled) state.agent = agent;
    } else {
      sessions.set(sessionID, { current, agent, handled: false });
    }
  }

  async function arm(sessionID, error) {
    const state = sessions.get(sessionID);
    if (!state || !enabled) return;
    const { status, text } = errorInfo(error);
    if (status === 401 || status === 403 || /context.{0,20}(?:length|window)|abort|cancel/i.test(text)) return;
    if (status !== 429 && !QUOTA_RE.test(text)) return;
    if (state.handled) {
      if (state.to && state.current === state.to && !state.exhausted) {
        // Low-stakes free-pool chain: opencode/*-free first, NVIDIA last
        // (slow). Advance one hop instead of giving up.
        const nextIdx = (state.chainIdx ?? 0) + 1;
        if (state.chain && nextIdx < state.chain.length) {
          state.chainIdx = nextIdx;
          state.to = state.chain[nextIdx];
          await notice(sessionID, `Free pool also capped — next fallback: ${state.to} (NVIDIA is slow; prefer waiting for the free reset when you can). Stop the current retry if needed, then resume.`);
          return;
        }
        state.exhausted = true;
        await notice(sessionID, "The fallback also hit a limit. No further automatic handoff; wait or select a model manually.");
      }
      return;
    }
    const from = state.current;
    // Approved Go primaries may fall back to another Go route, and low-stakes
    // roles may additionally fall back through the free pool (outside Go
    // quota, own tighter limits) with NVIDIA as the slow last resort.
    // Private/unknown roles never cross that boundary. Already-on-free rows
    // may still advance down the free chain.
    const inFreeChain = FREE_CHAIN.includes(from);
    if (!GO_FALLBACK[from] && !(LOW_STAKES.has(state.agent) && inFreeChain)) return;
    state.handled = true; // latch before awaits: duplicate events cannot chain
    if (!LOW_STAKES.has(state.agent) && ACCOUNT_RE.test(text)) {
      await notice(sessionID, "Go account quota is shared across models. Wait for reset or choose an approved provider manually; another Go model will not restore quota.");
      return;
    }
    state.from = from;
    if (LOW_STAKES.has(state.agent)) {
      if (inFreeChain) {
        // Already on the free chain: hop to the NEXT link (free → NVIDIA
        // last), not back to self. At the last link there is nowhere to go.
        const idx = FREE_CHAIN.indexOf(from);
        state.chain = FREE_CHAIN.slice(idx + 1);
        state.chainIdx = 0;
        state.to = state.chain[0];
        if (!state.to) {
          state.exhausted = true;
          await notice(sessionID, "The last-resort fallback also hit a limit. No further automatic handoff; wait or select a model manually.");
          return;
        }
      } else {
        state.chain = [...FREE_CHAIN];
        state.chainIdx = 0;
        state.to = state.chain[0];
      }
    } else {
      state.chain = null;
      state.chainIdx = 0;
      state.to = GO_FALLBACK[from];
    }
    await notice(sessionID, `Fallback ready: ${from} → ${state.to} on this session's next prompt. Stop the current retry if needed, then resume${LOW_STAKES.has(state.agent) ? " (free pool: own limits, outside Go quota; NVIDIA last — slow)" : "; Go quota remains shared"}.`);
  }

  // Next-request resolution: explicit user model/agent changes win. Returns
  // the armed fallback ref, or undefined when the request must proceed as-is.
  function resolve(sessionID, agent, current) {
    const state = sessions.get(sessionID);
    if (!state) return undefined;
    if (state.exhausted) {
      state.to = undefined;
      return undefined;
    }
    if (!state.to) return undefined;
    if (agent !== state.agent) {
      state.to = undefined;
      return undefined;
    }
    if (current !== state.from && current !== state.to) {
      state.to = undefined;
      return undefined;
    }
    state.current = state.to;
    return state.to;
  }

  function forget(sessionID) {
    if (sessionID) sessions.delete(sessionID);
  }

  return { sessions, track, arm, resolve, forget };
}

const createFallback = async ({ client }) => {
  const enabled = (process.env.OPENCODE_MODEL_FALLBACK || "").toLowerCase() !== "off";

  async function notice(sessionID, message) {
    // Session IDs in logs make child-session handoffs diagnosable without
    // recording error bodies, prompts, or credentials.
    try { await client.app.log({ body: { service: "model-fallback", level: "warn", message, extra: { sessionID } } }); } catch {}
    try { await client.tui.showToast({ body: { title: "Model quota handoff", message, variant: "warning" } }); } catch {}
  }

  const engine = createEngine({ notice, enabled });

  return {
    "chat.params": async (input) => {
      // Title/summary calls share session IDs but must not overwrite the
      // task's routing/privacy identity.
      if (["title", "summary", "compaction"].includes(input?.agent)) return;
      engine.track(input?.sessionID, input?.agent, modelRef(input?.model));
    },

    "chat.message": async (input, output) => {
      const message = output?.message;
      if (!enabled || !message) return;
      const requested = modelRef(message.model);
      const target = engine.resolve(input?.sessionID, message.agent, requested);
      if (target) message.model = splitModel(target); // drops provider-specific variants
    },

    event: async ({ event }) => {
      try {
        const props = event?.properties ?? {};
        if (event?.type === "session.deleted") {
          engine.forget(props.info?.id ?? props.sessionID);
        } else if (event?.type === "session.status" && props.status?.type === "retry") {
          await engine.arm(props.sessionID, props.status);
        } else if (["session.next.retried", "session.next.step.failed", "session.error"].includes(event?.type)) {
          await engine.arm(props.sessionID, props.error);
        }
      } catch {
        // Observability/routing bookkeeping must never break an active turn.
      }
    },
  };
};

export default {
  id: "model-fallback",
  server: createFallback,
  async setup(ctx) {
    const enabled = (process.env.OPENCODE_MODEL_FALLBACK || "").toLowerCase() !== "off";
    const engine = createEngine({
      enabled,
      notice: async (sessionID, message) => {
        try {
          console.warn(`[model-fallback] ${message} (session ${sessionID})`);
        } catch {}
        try {
          await ctx.app?.log?.({ level: "warn", service: "model-fallback", message, extra: { sessionID } });
        } catch {}
      },
    });

    // Track the model/agent actually used for each primary request. These
    // request kinds have separate hooks and must not overwrite routing state.
    await ctx.session.hook("context", (event) => {
      engine.track(event.sessionID, event.agent, refFromV2(event.model));
    });

    // Retry classification is the V2 equivalent of session.next.retried.
    try {
      await ctx.session.hook("retry", async (event) => {
        const { type, message, status } = event.error ?? {};
        await engine.arm(event.sessionID, { message: [message, type].filter(Boolean).join(" "), statusCode: status });
      });
    } catch {
      // Older builds may not expose the retry hook; the event stream below
      // still reports terminal errors.
    }

    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const data = event?.data ?? event?.properties ?? {};
        if (event?.type === "session.error") await engine.arm(data.sessionID, data.error);
      }
    })().catch(() => {});

    // Apply the armed handoff to the next primary model request. This is the
    // V2 replacement for rewriting chat.message.model: no persistence and no
    // effect on title/summary/compaction requests.
    try {
      await ctx.session.hook("experimental.model.resolve", (event) => {
        if (event.kind !== "primary") return;
        const target = engine.resolve(event.sessionID, event.agent, refFromV2(event.model));
        if (target) event.model = splitModel(target);
      });
    } catch {
      // Fallback: switch the session model at the next prompt admission.
      await ctx.session.hook("prompt", async (event) => {
        const target = engine.resolve(event.sessionID, undefined, undefined);
        if (target) {
          const { providerID, modelID } = splitModel(target);
          await ctx.session.switchModel({ sessionID: event.sessionID, model: { providerID, id: modelID } });
        }
      });
    }

    return () => controller.abort();
  },
};
