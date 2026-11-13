<script lang="ts">
  let {
    title,
    subtitle,
    breadcrumbs = [],
    children
  }: {
    title: string;
    subtitle?: string;
    breadcrumbs?: { label: string; href?: string }[];
    children?: import('svelte').Snippet;
  } = $props();
</script>

<header class="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
  <div class="min-w-0">
    {#if breadcrumbs.length}
      <nav class="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
        {#each breadcrumbs as crumb, i}
          {#if crumb.href}
            <a class="hover:text-[color:var(--color-primary)]" href={crumb.href}>{crumb.label}</a>
          {:else}
            <span aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
          {/if}
          {#if i < breadcrumbs.length - 1}
            <span aria-hidden="true">/</span>
          {/if}
        {/each}
      </nav>
    {/if}
    <h1 class="text-xl font-semibold tracking-tight text-ink md:text-2xl">{title}</h1>
    {#if subtitle}
      <p class="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>
    {/if}
  </div>
  {#if children}
    <div class="flex flex-wrap items-center gap-2">
      {@render children()}
    </div>
  {/if}
</header>
