<script lang="ts">
  let {
    class: className = '',
    lines = 0,
    height = '1rem'
  }: {
    class?: string;
    lines?: number;
    height?: string;
  } = $props();
</script>

{#if lines > 0}
  <div class={`space-y-2 ${className}`} aria-hidden="true">
    {#each Array.from({ length: lines }) as _, i}
      <div class="skeleton" style={`height:${height}; width:${i === lines - 1 ? '70%' : '100%'}`}></div>
    {/each}
  </div>
{:else}
  <div class={`skeleton ${className}`} style={`height:${height}`} aria-hidden="true"></div>
{/if}
