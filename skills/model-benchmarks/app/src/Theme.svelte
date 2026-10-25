<script>
  import { onMount } from 'svelte';

  const KEY = 'msg-theme';
  let theme = $state('light');

  onMount(() => {
    theme = document.documentElement.dataset.theme || 'light';
  });

  $effect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {}
  });

  function toggle() {
    theme = theme === 'dark' ? 'light' : 'dark';
  }
</script>

<button
  class="theme-btn"
  title="toggle theme"
  aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
  aria-pressed={theme === 'dark'}
  onclick={toggle}
>theme</button>
