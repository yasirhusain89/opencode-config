<script>
  import DataTable from './DataTable.svelte';

  let { s, query } = $props();

  // Reference sections collapse into drawers (P4 declutter); decision
  // tables (§1, §2, §6, §9 pins) stay expanded. h2 count is unchanged.
  const COLLAPSED = new Set(['caveats', 'sites', 'cost', 'capability', 'ops', 'compliance', 'harness']);
  const collapsed = $derived(COLLAPSED.has(s.id));

  // §9b personality matrix: h3 "9b…" opens a drawer holding the following
  // tables until the next h3. Group blocks once per section render.
  const groups = $derived.by(() => {
    const out = [];
    let drawer = null;
    for (const b of s.blocks) {
      if (b.t === 'h3' && /9b\./.test(b.h.replace(/<[^>]*>/g, ''))) {
        drawer = { h3: b, blocks: [] };
        out.push({ t: 'drawer', drawer });
        continue;
      }
      if (drawer && b.t === 'h3') drawer = null;
      if (drawer) drawer.blocks.push(b);
      else out.push(b);
    }
    return out;
  });
</script>

{#if collapsed}
  <details class="ref">
    <summary><h2 id={s.id}>{@html s.title}</h2></summary>
    {#each groups as b, i (i)}
      {#if b.t === 'table'}
        <DataTable table={b} {query} />
      {:else if b.t === 'p'}
        <p class:note={b.note}>{@html b.h}</p>
      {:else if b.t === 'ul'}
        <ul>
          {#each b.items as item, j (j)}
            <li>{@html item}</li>
          {/each}
        </ul>
      {:else if b.t === 'pre'}
        <pre>{@html b.h}</pre>
      {:else if b.t === 'h3'}
        <h3>{@html b.h}</h3>
      {:else if b.t === 'drawer'}
        <details class="ref">
          <summary><h3>{@html b.drawer.h3.h}</h3></summary>
          {#each b.drawer.blocks as db, k (k)}
            {#if db.t === 'table'}
              <DataTable table={db} {query} />
            {:else if db.t === 'p'}
              <p class:note={db.note}>{@html db.h}</p>
            {:else if db.t === 'ul'}
              <ul>
                {#each db.items as item, j (j)}
                  <li>{@html item}</li>
                {/each}
              </ul>
            {:else if db.t === 'pre'}
              <pre>{@html db.h}</pre>
            {/if}
          {/each}
        </details>
      {/if}
    {/each}
  </details>
{:else}
  <h2 id={s.id}>{@html s.title}</h2>

  {#each groups as b, i (i)}
    {#if b.t === 'table'}
      <DataTable table={b} {query} />
    {:else if b.t === 'p'}
      <p class:note={b.note}>{@html b.h}</p>
    {:else if b.t === 'ul'}
      <ul>
        {#each b.items as item, j (j)}
          <li>{@html item}</li>
        {/each}
      </ul>
    {:else if b.t === 'pre'}
      <pre>{@html b.h}</pre>
    {:else if b.t === 'h3'}
      <h3>{@html b.h}</h3>
    {:else if b.t === 'drawer'}
      <details class="ref">
        <summary><h3>{@html b.drawer.h3.h}</h3></summary>
        {#each b.drawer.blocks as db, k (k)}
          {#if db.t === 'table'}
            <DataTable table={db} {query} />
          {:else if db.t === 'p'}
            <p class:note={db.note}>{@html db.h}</p>
          {:else if db.t === 'ul'}
            <ul>
              {#each db.items as item, j (j)}
                <li>{@html item}</li>
              {/each}
            </ul>
          {:else if db.t === 'pre'}
            <pre>{@html db.h}</pre>
          {/if}
        {/each}
      </details>
    {/if}
  {/each}
{/if}
