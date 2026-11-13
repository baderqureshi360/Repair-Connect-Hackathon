<script lang="ts">
  /**
   * RepairConnect brand mark — geometric wrench + connection nodes.
   * compact: icon only; full: icon + wordmark (optional via slot/prop).
   */
  let {
    size = 32,
    compact = false,
    showWordmark = false,
    class: className = ''
  }: {
    size?: number;
    compact?: boolean;
    showWordmark?: boolean;
    class?: string;
  } = $props();

  const label = $derived(compact || !showWordmark ? undefined : 'RepairConnect');
</script>

<span class={`inline-flex items-center gap-2.5 ${className}`} aria-hidden={label ? undefined : true}>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    class="shrink-0"
    role="img"
    aria-label={label}
  >
    <title>RepairConnect</title>
    <rect width="32" height="32" rx="8" fill="var(--color-primary, #4f46e5)" />
    <circle cx="9" cy="10" r="1.75" fill="var(--color-accent-foreground, #fff)" opacity="0.95" />
    <circle cx="23" cy="10" r="1.75" fill="var(--color-accent-foreground, #fff)" opacity="0.95" />
    <circle cx="16" cy="22" r="1.75" fill="var(--color-accent-foreground, #fff)" opacity="0.95" />
    <path
      d="M9 10h14M9 10l7 12M23 10l-7 12"
      stroke="var(--color-accent-foreground, #fff)"
      stroke-width="1.25"
      stroke-linecap="round"
      opacity="0.55"
    />
    <path
      d="M19.2 8.4a3.2 3.2 0 0 0-4.4 4.4l-5.1 5.1a1.35 1.35 0 0 0 1.9 1.9l5.1-5.1a3.2 3.2 0 0 0 4.4-4.4l-2.05 2.05a1.1 1.1 0 1 1-1.55-1.55L19.2 8.4z"
      fill="var(--color-accent-foreground, #fff)"
    />
  </svg>
  {#if showWordmark && !compact}
    <span class="truncate text-sm font-bold tracking-tight text-current">RepairConnect</span>
  {/if}
</span>
