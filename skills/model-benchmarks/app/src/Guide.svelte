<script>
  import { onMount } from 'svelte';
  import Theme from './Theme.svelte';
  import Section from './Section.svelte';

  let { data } = $props();
  let q = $state('');

  // 1-click provider/status filters (P1–P3): set the shared table query to a
  // badge token. Badges are rendered into §2/§6 rows by guide_data.mjs.
  const pills = [
    { label: 'All', q: '' },
    { label: 'On Go', q: 'Go $10' },
    { label: 'Free pool', q: 'OC Free' },
    { label: 'Frontier (OR)', q: 'OR' },
    { label: 'Evaluated', q: 'EVAL' },
    { label: 'New', q: 'NEW' },
    { label: 'Pinned', q: 'PINNED' },
  ];

  onMount(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  });
</script>

<div class="wrap">
  <header class="top">
    <div>
      <h1>{@html data.meta.h1}</h1>
      <div class="meta">{@html data.meta.meta}</div>
    </div>
    <div class="tools">
      <Theme />
      <input
        type="search"
        placeholder="filter tables…"
        title="hide rows not matching this text"
        aria-label="Filter table rows"
        bind:value={q}
      />
    </div>
  </header>

  <nav class="toc">
    {#each data.toc as link (link.id)}
      <a href={'#' + link.id}>{@html link.label}</a>
    {/each}
  </nav>

  <div class="pills" role="group" aria-label="Provider and status filters">
    {#each pills as p (p.label)}
      <button
        class="pill"
        class:on={q === p.q}
        aria-pressed={q === p.q}
        onclick={() => { q = p.q; }}
      >{p.label}</button>
    {/each}
  </div>

  {#each data.sections as section (section.id)}
    <Section s={section} query={q} />
  {/each}
</div>
