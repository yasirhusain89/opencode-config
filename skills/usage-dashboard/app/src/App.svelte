<script>
  import Index from "./Index.svelte";
  import Session from "./Session.svelte";

  const page = globalThis.__OCUD_PAGE__ ?? "index";
  const data = globalThis.__OCUD__ ?? null;
</script>

{#if page === "session"}
  <Session />
{:else if data}
  <Index {data} />
{:else}
  <div class="card">
    <div class="k">No data</div>
    <div class="s">data.js not found next to dashboard.html — run the generator.</div>
  </div>
{/if}
