<script lang="ts">
  import '../app.css';
  /* Hydrate cached accent/theme on first paint (side effect in preferences module). */
  import '$lib/stores/preferences';
  let { children } = $props();
</script>

<svelte:head>
  <title>RepairConnect</title>
  <meta name="theme-color" content="#4f46e5" />
</svelte:head>

{@render children()}
