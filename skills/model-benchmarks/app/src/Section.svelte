<script>
  import DataTable from './DataTable.svelte';

  let { s, query } = $props();
</script>

<h2 id={s.id}>{@html s.title}</h2>

{#each s.blocks as b, i (i)}
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
  {/if}
{/each}
