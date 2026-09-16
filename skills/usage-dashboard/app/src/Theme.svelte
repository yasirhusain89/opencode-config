<script>
  let cur = $state("auto");
  try {
    cur = localStorage.getItem("ocud-theme") || "auto";
  } catch {}
  // svelte-ignore state_referenced_locally -- one-time init validation
  if (cur !== "auto" && cur !== "light" && cur !== "dark") cur = "auto";

  $effect(() => {
    const h = document.documentElement;
    if (cur === "light" || cur === "dark") h.setAttribute("data-theme", cur);
    else h.removeAttribute("data-theme");
    try {
      localStorage.setItem("ocud-theme", cur);
    } catch {}
  });

  const label = $derived(
    cur === "light" ? "Theme: Light" : cur === "dark" ? "Theme: Dark" : "Theme: System"
  );
  function cycle() {
    cur = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
  }
</script>

<button id="theme" type="button" onclick={cycle}>{label}</button>
