<script>
  import Theme from "./Theme.svelte";
  import { fmt, money, hrs, catColor } from "./lib/format.js";

  let { data } = $props();

  // svelte-ignore state_referenced_locally -- static payload, read once
  const h = data.hero;
  const num = (n) => (n || 0).toLocaleString("en-US");

  // compare-model dropdown (persisted)
  let sel = $state(0);
  try {
    sel = parseInt(localStorage.getItem("ocud-cmp") || "0", 10) || 0;
  } catch {}
  // svelte-ignore state_referenced_locally -- one-time init clamp
  if (!data.compare_opts[sel]) sel = 0;
  $effect(() => {
    try {
      localStorage.setItem("ocud-cmp", String(sel));
    } catch {}
  });
  const opt = $derived(data.compare_opts[sel] ?? data.compare_opts[0]);
  const shortName = (n) => (n || "?").replace(/\s*\(.*$/, "");
  const cw = (v) => (v ? `$${v.toFixed(2)} / 1M` : "n/a");

  const perday = $derived([...data.perday].reverse());
  const hist = $derived(data.hist.slice(-30));
  const clamp = (p) => Math.max(0, Math.min(100, p));

  const maxCat = $derived(Math.max(...data.cats.map((c) => c.n), 1));
  const maxProj = $derived(Math.max(...data.projects.map((p) => p.cost), 1));
  const totalVar = $derived(data.variants.reduce((a, v) => a + v.msgs, 0) || 1);
  const maxHour = $derived(Math.max(...data.hours.map((x) => x.tokens), 1));
</script>

<div class="top">
  <div>
    <h1>Usage — Opus 5 equivalent</h1>
    <div class="sub">Generated {data.generated} · opencode · refreshes daily 08:00</div>
  </div>
  <Theme />
</div>

<div class="hero">
  <div class="card big">
    <div class="k">Would cost on Opus 5</div>
    <div class="v">{money(h.opus5)}</div>
    <div class="s">{h.sessions} sessions · {num(h.messages)} messages</div>
  </div>
  <div class="card big">
    <div class="k">Actually paid</div>
    <div class="v ok">{money(h.actual)}</div>
    <div class="s">{h.prov} / {h.model}</div>
  </div>
  <div class="card">
    <div class="k">Avoided</div>
    <div class="v ok">{money(h.avoided)}</div>
    <div class="s">vs Opus 5 list price</div>
  </div>
  <div class="card">
    <div class="k">Cache hit</div>
    <div class="v ok">{h.cache_hit.toFixed(1)}%</div>
    <div class="s">{fmt(h.cache_read)} of {fmt(h.cache_in)} input</div>
  </div>
  <div class="card">
    <div class="k">Tool errors</div>
    <div class="v ok">{h.err_rate.toFixed(1)}%</div>
    <div class="s">{h.calls_err} of {h.calls_total} calls</div>
  </div>
  <div class="card">
    <div class="k">Time with opencode</div>
    <div class="v">{hrs(h.overall_min)}</div>
    <div class="s">wall-clock union · {hrs(h.sum_min)} summed</div>
  </div>
</div>

<h2>Pricing — your usage on each model</h2>
<div class="grid2">
  <div class="card">
    <div class="k">Compare model</div>
    {#if opt}
      <select class="cmpsel" bind:value={sel}>
        {#each data.compare_opts as o, i}
          <option value={i}>{shortName(o.name)} — {money(o.cost)}</option>
        {/each}
      </select>
      <div class="v">{money(opt.cost)}</div>
      <table class="rates"><tbody>
        <tr><td>Input</td><td class="r">${opt.pin.toFixed(2)} / 1M</td></tr>
        <tr><td>Output</td><td class="r">${opt.pout.toFixed(2)} / 1M</td></tr>
        <tr><td>Cache read</td><td class="r">${opt.pcr.toFixed(2)} / 1M</td></tr>
        <tr><td>Cache write</td><td class="r">{cw(opt.pcw)}</td></tr>
      </tbody></table>
      <div class="s">
        Your token mix priced at these rates.
        {#if opt.aa}AA #{opt.aa} · ${opt.cpt.toFixed(2)}/task{/if}
        {#if opt.in_use} · <span class="ok-flag">in use (free)</span>{/if}
      </div>
    {:else}
      <div class="s">no comparison models</div>
    {/if}
  </div>
  <div class="card">
    <div class="k">In use · {h.model}</div>
    <div class="v ok">{money(h.actual)}</div>
    <table class="rates"><tbody>
      <tr><td>Input</td><td class="r">$0.00</td></tr>
      <tr><td>Output</td><td class="r">$0.00</td></tr>
      <tr><td>Cache</td><td class="r">n/a</td></tr>
    </tbody></table>
    <div class="s">
      Free contributor tier · recorded spend across {num(h.messages)} messages.
      Rates not published; cost as recorded by opencode.
    </div>
  </div>
</div>

<details>
  <summary><b>Top-20 comparison</b> (AA intelligence index; your usage priced on each)</summary>
  <div class="s">
    Top 20 by Artificial Analysis Intelligence Index (scraped 2026-09-14) + the paid
    equivalents of the free models in use (✓). Cost/task is AA's weighted cost per
    Intelligence Index task; the last column prices YOUR token mix at that model's rates.
  </div>
  <table><tbody>
    <tr>
      <th>Model</th><th>Creator</th>
      <th style="text-align:right">AA idx</th>
      <th style="text-align:right">Cost/task</th>
      <th style="text-align:right">In $/1M</th>
      <th style="text-align:right">Out $/1M</th>
      <th style="text-align:right">Cache r</th>
      <th style="text-align:right">Cache w</th>
      <th style="text-align:right">Your usage</th>
    </tr>
    {#each data.top20 as e}
      <tr>
        <td>{e.name}{#if e.in_use} <span class="ok-flag">✓</span>{/if}</td>
        <td>{e.creator}</td>
        <td class="r">{e.aa}</td>
        <td class="r">${e.cpt.toFixed(2)}</td>
        <td class="r">${e.pin.toFixed(2)}</td>
        <td class="r">${e.pout.toFixed(2)}</td>
        <td class="r">${e.pcr.toFixed(2)}</td>
        <td class="r">{e.pcw ? `$${e.pcw.toFixed(2)}` : "n/a"}</td>
        <td class="r"><b>{money(e.cost)}</b></td>
      </tr>
    {/each}
  </tbody></table>
</details>

<h2>
  Daily Opus-5 trend
  {#if data.peak}<span class="pill">peak {data.peak.day} · {money(data.peak.cost)}</span>{/if}
</h2>
<div class="hist">
  {#each hist as b}
    <div class="hcol" title={`${b.date}: ${money(b.opus5)}`}>
      <div class="hval">{money(b.opus5)}</div>
      <div class="htrack">
        <div class="hfill" style={`height:${(100 * b.opus5 / data.max_hist).toFixed(1)}%`}></div>
      </div>
      <div class="hdate">{b.date.slice(5)}</div>
    </div>
  {:else}
    <span class="note">no snapshots yet</span>
  {/each}
</div>
<div class="s">
  Each bar is that day's Opus-5-equivalent usage. Past days freeze once snapshotted;
  today's bar refreshes on every run. Days before the first snapshot are backfilled
  from the sessions DB.
</div>

<h2>Cost per day</h2>
<table><tbody>
  <tr><th>Day</th><th>Sessions</th><th>Tokens</th><th style="text-align:right">Opus 5</th></tr>
  {#each perday as d}
    <tr>
      <td class="mono">{d.day}</td>
      <td>{d.sessions}</td>
      <td>{fmt(d.tokens)}</td>
      <td class="r">{money(d.cost)}</td>
    </tr>
  {/each}
</tbody></table>

<h2>Tool use by category</h2>
<div class="s">
  Share of {num(data.total_calls)} tool calls. Tokens are billed per message, not per
  call, so this shows where effort goes, not cost.
</div>
<table><tbody>
  <tr><th>Category</th><th>Calls</th><th style="text-align:right">Share</th><th></th></tr>
  {#each data.cats as c}
    {@const pct = 100 * c.n / Math.max(data.total_calls, 1)}
    <tr>
      <td>{c.cat}</td>
      <td>{num(c.n)}</td>
      <td class="r">{pct.toFixed(1)}%</td>
      <td>
        <span class="bar">
          <span class="fill" style={`width:${clamp(pct).toFixed(1)}%;background:${catColor(c.cat)}`}></span>
        </span>
      </td>
    </tr>
  {/each}
</tbody></table>
<details>
  <summary>Tool → category mapping ({data.mapping.length})</summary>
  <table><tbody>
    <tr><th>Tool / bash intent</th><th>Category</th><th>Calls</th></tr>
    {#each data.mapping as m}
      <tr><td class="mono">{m.tool}</td><td>{m.cat}</td><td>{num(m.n)}</td></tr>
    {/each}
  </tbody></table>
  <div class="s">
    bash intents classified by command keywords (DB &gt; versioning &gt; container &gt;
    build &gt; net &gt; structural &gt; lexical &gt; read, else meta).
    zvec hybrid search counted under lexical search.
  </div>
</details>

<details>
  <summary><b>Cost per project directory</b></summary>
  <table><tbody>
    <tr>
      <th>Directory</th><th>Sessions</th><th>Time</th><th>Input</th>
      <th>Out+reas</th><th>CacheRead</th><th style="text-align:right">Opus 5</th><th></th>
    </tr>
    {#each data.projects as p}
      <tr>
        <td class="mono">{p.dir}</td>
        <td>{p.sessions}</td>
        <td class="mono">{hrs(p.mins)}</td>
        <td>{fmt(p.input)}</td>
        <td>{fmt(p.out_r)}</td>
        <td>{fmt(p.cache_read)}</td>
        <td class="r">{money(p.cost)}</td>
        <td>
          <span class="bar">
            <span class="fill" style={`width:${clamp(100 * p.cost / maxProj).toFixed(1)}%;background:#7c5cff`}></span>
          </span>
        </td>
      </tr>
    {/each}
  </tbody></table>
</details>

<details>
  <summary><b>Cost per model</b> (Opus-5 equivalent vs actually recorded)</summary>
  <table><tbody>
    <tr>
      <th>Model</th><th>Msgs</th><th>Input</th><th>Out+reas</th><th>CacheRead</th>
      <th style="text-align:right">Opus 5</th><th style="text-align:right">Paid</th>
    </tr>
    {#each data.models as m}
      <tr>
        <td class="mono">{m.name}</td>
        <td>{m.msgs}</td>
        <td>{fmt(m.input)}</td>
        <td>{fmt(m.out_r)}</td>
        <td>{fmt(m.cache_read)}</td>
        <td class="r">{money(m.cost)}</td>
        <td class="r">{money(m.actual)}</td>
      </tr>
    {/each}
  </tbody></table>
</details>

<details>
  <summary><b>Cost per provider</b> (all message traffic rolled up by provider)</summary>
  <table><tbody>
    <tr>
      <th>Provider</th><th>Models</th><th>Msgs</th><th>Input</th><th>Out+reas</th>
      <th>CacheRead</th><th style="text-align:right">Opus 5</th><th style="text-align:right">Paid</th>
    </tr>
    {#each data.providers as p}
      <tr>
        <td class="mono">{p.provider}</td>
        <td>{p.models.join(", ")}</td>
        <td>{p.msgs}</td>
        <td>{fmt(p.input)}</td>
        <td>{fmt(p.out_r)}</td>
        <td>{fmt(p.cache_read)}</td>
        <td class="r">{money(p.cost)}</td>
        <td class="r">{money(p.actual)}</td>
      </tr>
    {/each}
  </tbody></table>
  <div class="s">
    Costs priced at Opus-5 rates on each provider's traffic; Paid is what the provider
    recorded (free tiers = $0). The nvidia/z-ai GLM-5.3-Flash traffic is the
    post-free-quota switch.
  </div>
</details>

<h2>Reliability &amp; efficiency — per provider</h2>
<table><tbody>
  <tr>
    <th>Provider</th><th>Turns</th><th>Tool calls</th>
    <th style="text-align:right">Err</th>
    <th style="text-align:right">Err rate</th>
    <th style="text-align:right">p50 turn</th>
    <th style="text-align:right">p95 turn</th>
    <th style="text-align:right">tok/s p50</th>
  </tr>
  {#each data.prov_rel as e}
    <tr>
      <td class="mono">{e.provider}</td>
      <td>{num(e.msgs)}</td>
      <td>{num(e.calls)}</td>
      <td class="r">{e.errors}</td>
      <td class="r">{e.calls ? (100 * e.errors / e.calls).toFixed(1) + "%" : "0.0%"}</td>
      <td class="r">{e.p50.toFixed(1)}s</td>
      <td class="r">{e.p95.toFixed(0)}s</td>
      <td class="r">{e.tps.toFixed(0)}</td>
    </tr>
  {/each}
</tbody></table>
{#if data.latency}
  <div class="s">
    All providers: turn p50 {data.latency.p50.toFixed(0)}s · p95
    {data.latency.p95.toFixed(0)}s · {data.latency.tps.toFixed(0)} tok/s p50 ·
    {data.latency.total_min.toFixed(0)} min total across {num(data.latency.msgs)} turns
  </div>
{/if}
<details>
  <summary>
    Tool errors · by tool ({data.calls_err} of {num(data.total_calls)} calls,
    {h.err_rate.toFixed(1)}%)
  </summary>
  <table class="rates"><tbody>
    <tr><th>Tool</th><th>Errors</th></tr>
    {#each data.errors_by_tool as t}
      <tr><td class="mono">{t.tool}</td><td>{t.n}</td></tr>
    {/each}
  </tbody></table>
  <div class="s">
    Spikes usually mean a broken environment, not a bad model. Tool calls join to
    their message's provider, so a session that switched providers splits across rows.
  </div>
</details>

<details>
  <summary><b>Per session</b> (top 20 by Opus-5 cost; ✓ = commit within 24h after, ✗ = none)</summary>
  <table><tbody>
    <tr>
      <th>Session</th><th>Project</th><th>Started</th><th>Ended</th><th>Min</th>
      <th>Msgs</th><th>In+Cache</th><th>Out+reas</th>
      <th style="text-align:right">Opus 5</th><th>Calls</th>
      <th style="text-align:right">Err</th><th></th>
    </tr>
    {#each data.sessions as s}
      <tr>
        <td class="mono"><a href={`session.html#${s.id8}`}>{s.id8}</a></td>
        <td class="mono">{s.project}</td>
        <td class="mono">{s.start}</td>
        <td class="mono">{s.end}</td>
        <td>{s.dur_min.toFixed(0)}</td>
        <td>{s.msgs}</td>
        <td>{fmt(s.in_cache)}</td>
        <td>{fmt(s.out_r)}</td>
        <td class="r">{money(s.cost)}</td>
        {#if s.calls}
          <td>{s.calls}</td><td class="r">{s.errors}</td>
        {:else}
          <td>–</td><td>–</td>
        {/if}
        <td>
          {#if s.landed === true}<span class="ok-flag">✓</span>
          {:else if s.landed === false}<span class="bad-flag">✗</span>{/if}
        </td>
      </tr>
    {/each}
  </tbody></table>
  <div class="s">
    Times are local. Landing check matches git log in the session's project dir.
    Click a session id for its own page (effectiveness / efficiency detail).
  </div>
</details>

<details>
  <summary><b>Effort-level mix</b> (thinking variants; the cost lever)</summary>
  <table><tbody>
    <tr><th>Variant</th><th>Msgs</th><th style="text-align:right">Share</th><th></th><th>Out+reas tokens</th></tr>
    {#each data.variants as v}
      {@const pct = 100 * v.msgs / totalVar}
      <tr>
        <td class="mono">{v.name}</td>
        <td>{num(v.msgs)}</td>
        <td class="r">{pct.toFixed(1)}%</td>
        <td>
          <span class="bar">
            <span class="fill" style={`width:${clamp(pct).toFixed(1)}%;background:#ffab00`}></span>
          </span>
        </td>
        <td>{fmt(v.out)}</td>
      </tr>
    {/each}
  </tbody></table>
  <div class="s">
    Reasoning effort per assistant message. Routine turns at high/medium instead of
    max/xhigh cut thinking tokens billed at the output rate.
  </div>
</details>

<details>
  <summary><b>Hour-of-day activity</b> (UTC tokens; when sessions start)</summary>
  <div class="heatstrip">
    {#each data.hours as c}
      {@const pct = Math.max(100 * c.tokens / maxHour, 4)}
      {@const alpha = 0.15 + 0.85 * (c.tokens / maxHour)}
      <div class="hcell2" title={`${String(c.h).padStart(2, "0")}:00 UTC · ${fmt(c.tokens)} tokens · ${c.sessions} sessions`}>
        <div class="hfill2" style={`height:${pct.toFixed(1)}%;opacity:${alpha.toFixed(2)}`}></div>
        <div class="hlab">{String(c.h).padStart(2, "0")}</div>
      </div>
    {/each}
  </div>
  <div class="s">
    Peak hours are when expensive sessions happen and when the daily 08:00 regen lands
    relative to your overnight block.
  </div>
</details>

{#if data.landing}
  {@const landPct = 100 * data.landing.landed / data.landing.checkable}
  <details>
    <summary><b>Commit-landing ratio</b> (did the work land in git?)</summary>
    <div class="grid2">
      <div class="card">
        <div class="k">Sessions landed</div>
        <div class="v ok">{data.landing.landed} / {data.landing.checkable}</div>
        <div class="s">
          {landPct.toFixed(0)}% of git-backed sessions had a commit within 24h after
          their last message
        </div>
      </div>
      <div class="card">
        <div class="k">Not checkable</div>
        <div class="v">{data.landing.total - data.landing.checkable}</div>
        <div class="s">sessions in non-git or missing directories</div>
      </div>
    </div>
    <div class="s">
      Matching: git log --all in each session's project dir; a commit timestamped
      within 24h after the session's last message counts as landed. Solo/personal
      sessions can legitimately end without commits (exploration, questions).
    </div>
  </details>
{/if}

<details>
  <summary><b>Methodology</b></summary>
  <p class="note">
    Source: <span class="mono">~/.local/share/opencode/opencode.db</span> (session
    counters; message token JSON; part tool calls), read-only. Rates (Sep 2026): Opus 5
    standard $5/$25 + $0.50 cache read, $6.25 cache write; GPT-5.6 Sol promo $4/$20 +
    $0.40 read, $5.00 write (list $5/$30 + $0.50/$6.25, promo ~Nov 21); GLM-5.3
    $1.40/$4.40 + $0.26 read via Z.ai (cache-write unpublished). Top-20 comparison +
    pricing scraped from artificialanalysis.ai on 2026-09-14 (refresh via the
    usage-dashboard skill). Reasoning billed as output everywhere. This page is
    rendered by Svelte templates
    (<span class="mono">skills/usage-dashboard/app/src</span>) from
    <span class="mono">data.js</span> (JSON data, no fetch — works offline from
    file://). Regenerates daily 08:00 via launchd
    (<span class="mono">ai.opencode.usage-dashboard</span>) and on login; manual:
    <span class="mono">python3 ~/.opencode/usage-dashboard/generate.py</span>;
    rebuild templates: <span class="mono">npm run build</span> in the app dir.
  </p>
</details>
