<script>
  let { table, query } = $props();

  // Clamp tooltips on the first/last column that actually has a tip, not the
  // first/last <th> (trailing columns such as Verdict have no tooltip).
  const tipIdxs = $derived(table.head.map((h, i) => (h.tip ? i : -1)).filter((i) => i >= 0));
  const firstTip = $derived(tipIdxs.length ? tipIdxs[0] : -1);
  const lastTip = $derived(tipIdxs.length ? tipIdxs[tipIdxs.length - 1] : -1);

  const strip = (h) =>
    h
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();

  // Numeric cell value. Returns null for missing/unpublished cells so the
  // comparator can pin them to the bottom regardless of sort direction.
  // Handles guide conventions: — / ? (unpublished), ∞ (unlimited),
  // <N / &lt;N (capped below N — sorts at half N).
  function num(cell) {
    const t = cell.v !== undefined ? cell.v : strip(cell.h);
    const m = t.replace(/[$,~]/g, '').replace(/,/g, '').trim();
    if (m === '' || m === '—' || m === '-' || m === '?') return null;
    if (m === '∞') return Infinity;
    const lt = m.match(/^<(.+)$/);
    if (lt) {
      const f = parseFloat(lt[1]);
      return isNaN(f) ? null : f * 0.5;
    }
    const f = parseFloat(m);
    return isNaN(f) ? null : f;
  }

  function text(cell) {
    const t = cell.v !== undefined ? cell.v : strip(cell.h);
    return t.toLowerCase();
  }

  let sortIdx = $state(-1);
  let asc = $state(true);

  const rows = $derived.by(() => {
    let out = table.rows;
    const needle = query.trim().toLowerCase();
    if (needle) out = out.filter((r) => r.some((c) => strip(c.h).toLowerCase().includes(needle)));
    if (sortIdx >= 0) {
      const type = table.head[sortIdx].s || 't';
      out = [...out].sort((a, b) => {
        if (type === 'n') {
          const x = num(a[sortIdx]);
          const y = num(b[sortIdx]);
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        }
        const x = text(a[sortIdx]);
        const y = text(b[sortIdx]);
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    return out;
  });

  // First click direction: head.dir === 'desc' for higher-is-better columns
  // (Value, Eng, Intel, tok/s, Days); cost/latency columns default to asc.
  function sort(i) {
    if (!table.head[i].s) return;
    if (sortIdx === i) asc = !asc;
    else {
      sortIdx = i;
      asc = table.head[i].dir !== 'desc';
    }
  }
</script>

<table class:scrollx={table.scroll}>
  <thead>
    <tr>
      {#each table.head as h, i (i)}
        <th
          class:num={h.n}
          data-sort={h.s}
          data-tip={h.tip}
          data-tippos={h.tp}
          data-tipfirst={h.tip && i === firstTip ? '1' : undefined}
          data-tiplast={h.tip && i === lastTip ? '1' : undefined}
          tabindex={h.s || h.tip ? 0 : undefined}
          onclick={() => sort(i)}
          onkeydown={(e) => {
            if (!h.s) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              sort(i);
            }
          }}
          aria-sort={sortIdx === i ? (asc ? 'ascending' : 'descending') : h.s ? 'none' : undefined}
        >
          {@html h.h.replace(/\s*⇅\s*$/, '')}{#if sortIdx === i}{asc ? ' ↑' : ' ↓'}{:else if h.s} ⇅{/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as r, i (i)}
      <tr>
        {#each r as c, j (j)}
          <td class:num={c.n} class:warn={c.c === 'warn'}>{@html c.h}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
