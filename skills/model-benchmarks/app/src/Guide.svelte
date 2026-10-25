<script>
  import { onMount } from 'svelte';
  import Theme from './Theme.svelte';
  import Section from './Section.svelte';

  let { data } = $props();
  let q = $state('');

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

  {#each data.sections as section (section.id)}
    <Section s={section} query={q} />
  {/each}
</div>
