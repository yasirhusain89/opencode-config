import { mount } from 'svelte';
import Guide from './Guide.svelte';

mount(Guide, {
  target: document.getElementById('app'),
  props: { data: window.__MB__ },
});
