<script>
  import Theme from "./Theme.svelte";
  import { fmt, money, hrs, fmtDT, fmtDay, durShort, catColor } from "./lib/format.js";
  import { userTips, modelTips } from "./lib/tips.js";

  const sid = globalThis.__OCUD_SESSION_ID__ ?? "";
  const s = globalThis.__OCUD_SESSION__ ?? null;
  const loadError = globalThis.__OCUD_SESSION_ERROR__ ?? null;

  const num = (n) => (n || 0).toLocaleString("en-US");

  function finLabel(fin) {
    if (fin === "stop") return "answered";
    if (fin === "interrupted") return "interrupted";
    if (fin === "tool-calls") return "ended mid-flow";
    if (fin === "error") return "error";
    return fin || "n/a";
  }
  function finClass(fin) {
    if (fin === "stop") return "ok-flag";
    if (fin === "interrupted" || fin === "tool-calls" || fin === "error") return "bad-flag";
    return "note";
  }
  function outcomeClass(o) {
    if (o === "edited" || o === "answered") return "ok-flag";
    if (o === "stuck" || o === "cut short") return "bad-flag";
    return "note";
  }

  const utips = $derived(s ? userTips(s) : []);
  const mtips = $derived(s ? modelTips(s) : []);
</script>

<div class="top">
  <div>
    <a class="back" href="dashboard.html">← all sessions</a>
    {#if s}
      <h1>{s.title || `session ${s.id8}`}</h1>
      <div class="sub">
        {s.project} · {fmtDay(s.start_ms)} · {money(s.cost)} Opus-5 equivalent
      </div>
    {:else}
      <h1>Session {sid || "?"}</h1>
      <div class="sub">{loadError || "no data loaded"}</div>
    {/if}
  </div>
  <Theme />
</div>

{#if s}
  {@const mpt = s.msgs_per_turn != null ? `${s.msgs_per_turn.toFixed(1)} asst/turn` : "no prompts"}
  {@const succ = s.calls ? `${Math.round(100 * (s.calls - s.errors) / s.calls)}% (${s.calls - s.errors}/${s.calls} ok)` : "– (no tool calls)"}
  {@const outcome = s.landed === true ? "landed ✓" : s.landed === false ? "no commit ✗" : "n/a"}
  {@const outcomeCls = s.landed === true ? "ok-flag" : s.landed === false ? "bad-flag" : "note"}
  {@const idle = s.idle_pct != null ? `${Math.round(s.idle_pct)}% idle` : "n/a"}
  {@const tok = `${fmt(s.in_cache)} in+cache · ${fmt(s.out_r)} out+reas · cache ${s.cache_hit != null ? Math.round(100 * s.cache_hit) + "%" : "n/a"}`}
  {@const cpm = s.active_min ? `$${(s.cost / s.active_min).toFixed(2)}/active-min` : "n/a"}
  {@const spd = `turn p50 ${s.turn_p50.toFixed(0)}s${s.tps ? ` · ${s.tps.toFixed(0)} tok/s` : ""} · ${(s.variants || []).slice(0, 3).map((v) => `${v.v}×${v.n}`).join(", ") || "?"}`}
  {@const edits = `${s.files_patched} files patched${s.add || s.del ? ` (+${s.add}/−${s.del} lines)` : ""}`}
  <div class="grid2">
    <div class="card">
      <div class="k">Effectiveness</div>
      <table class="rates"><tbody>
        <tr><td>Outcome</td><td class="r"><span class={outcomeCls}>{outcome}</span></td></tr>
        <tr><td>Edits</td><td class="r">{edits}</td></tr>
        <tr><td>Tool success</td><td class="r">{succ}</td></tr>
        <tr>
          <td>Turns</td>
          <td class="r">
            {s.turns} user turns · {mpt}{#if s.interrupted} · {s.interrupted} interrupted{/if} · first prompt {fmt(s.first_prompt)} chars
          </td>
        </tr>
        <tr><td>Final answer</td><td class="r"><span class={finClass(s.last_fin)}>{finLabel(s.last_fin)}</span></td></tr>
      </tbody></table>
    </div>
    <div class="card">
      <div class="k">Efficiency</div>
      <table class="rates"><tbody>
        <tr><td>Wall / active</td><td class="r">wall {hrs(s.wall_min)} · active {s.active_min.toFixed(0)} min ({idle})</td></tr>
        <tr><td>Tokens</td><td class="r">{tok}</td></tr>
        <tr><td>Opus-5 cost</td><td class="r">{money(s.cost)} · {cpm}</td></tr>
        <tr><td>Speed / effort</td><td class="r">{spd}</td></tr>
      </tbody></table>
    </div>
  </div>

  <div class="card" style="margin-top:12px">
    <div class="k">Improve — user side</div>
    <ul class="tips">
      {#each utips as t}<li>{t}</li>{/each}
    </ul>
  </div>
  <div class="card" style="margin-top:12px">
    <div class="k">Improve — model / agent side</div>
    <ul class="tips">
      {#each mtips as t}<li>{t}</li>{/each}
    </ul>
  </div>

  <h2>Tool time by category</h2>
  {#if s.tool_ms > 0}
    <div class="tbar">
      {#each s.tool_cats as c}
        {#if c.ms > 0}
          <span
            title={`${c.cat}: ${(100 * c.ms / s.tool_ms).toFixed(1)}% · ${durShort(c.ms)} · ${c.calls} calls`}
            style={`width:${(100 * c.ms / s.tool_ms).toFixed(2)}%;background:${catColor(c.cat)}`}>
          </span>
        {/if}
      {/each}
    </div>
    <div class="tbar-legend">{num(s.calls)} tool calls · {durShort(s.tool_ms)} active tool time</div>
    <table><tbody>
      <tr><th>Category</th><th style="text-align:right">Share</th><th style="text-align:right">Time</th><th>Calls</th></tr>
      {#each s.tool_cats as c}
        <tr>
          <td><span class="swatch" style={`background:${catColor(c.cat)}`}></span>{c.cat}</td>
          <td class="r">{(100 * c.ms / s.tool_ms).toFixed(1)}%</td>
          <td class="r">{durShort(c.ms)}</td>
          <td>{num(c.calls)}</td>
        </tr>
      {/each}
    </tbody></table>
    <div class="s">Share of active tool-call time (start→end per call), not wall time — parallel/queued calls can overlap. Long <span class="mono">sleep</span> waits surface as Wait/idle: parked, not working.</div>
  {:else}
    <div class="s">No tool calls in this session — nothing to split.</div>
  {/if}

  <details>
    <summary>Turn timeline ({s.tl.length})</summary>
    <table><tbody>
      <tr>
        <th>#</th><th>Start</th><th>Action</th><th>Asst</th><th>Calls</th>
        <th style="text-align:right">Err</th><th>Out+reas</th><th>Act s</th>
        <th style="text-align:right">Outcome</th>
      </tr>
      {#each s.tl as tr, i}
        <tr>
          <td>{i + 1}</td>
          <td class="mono">{fmtDT(tr.start_ms)}</td>
          <td class="act">
            {#if tr.pex}<div>{tr.pex}</div>{/if}
            <div class="s">{tr.sum}</div>
          </td>
          <td>{tr.asst}</td>
          <td>{tr.calls}</td>
          <td class="r">{tr.err}</td>
          <td>{fmt(tr.out)}</td>
          <td>{tr.active_s.toFixed(0)}</td>
          <td class="r"><span class={outcomeClass(tr.outcome)}>{tr.outcome}</span></td>
        </tr>
      {/each}
    </tbody></table>
    {#if s.tl_truncated}<div class="s">showing first 60 of {s.turns} turns</div>{/if}
    <div class="s">
      One row per user prompt: what was asked, what the agent did (tools, files,
      errors), output tokens, active seconds, and the turn's outcome.
    </div>
  </details>
{/if}
