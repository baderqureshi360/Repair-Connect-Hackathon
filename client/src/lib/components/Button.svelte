<script lang="ts">
  type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  type Size = 'md' | 'sm' | 'icon';

  let {
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    error = false,
    href = undefined,
    class: className = '',
    onclick,
    children,
    ariaLabel,
    'data-testid': dataTestId = undefined
  }: {
    variant?: Variant;
    size?: Size;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    error?: boolean;
    href?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: import('svelte').Snippet;
    ariaLabel?: string;
    'data-testid'?: string;
  } = $props();

  const classes = $derived(
    [
      'btn',
      `btn-${variant}`,
      size === 'sm' ? 'btn-sm' : '',
      size === 'icon' ? 'btn-icon' : '',
      error ? 'btn-error' : '',
      className
    ]
      .filter(Boolean)
      .join(' ')
  );

  const isDisabled = $derived(disabled || loading);

  function handleClick(e: MouseEvent) {
    if (isDisabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onclick?.(e);
  }
</script>

{#if href && !isDisabled}
  <a
    {href}
    class={classes}
    aria-label={ariaLabel}
    aria-busy={loading || undefined}
    data-state={error ? 'error' : undefined}
    data-testid={dataTestId}
  >
    {#if loading}
      <span
        class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        aria-hidden="true"
      ></span>
      <span class="sr-only">Loading</span>
    {/if}
    {#if children}{@render children()}{/if}
  </a>
{:else}
  <button
    {type}
    class={classes}
    disabled={isDisabled}
    aria-label={ariaLabel}
    aria-busy={loading || undefined}
    aria-disabled={isDisabled || undefined}
    data-state={error ? 'error' : undefined}
    data-testid={dataTestId}
    onclick={handleClick}
  >
    {#if loading}
      <span
        class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        aria-hidden="true"
      ></span>
      <span class="sr-only">Loading</span>
    {/if}
    {#if children}{@render children()}{/if}
  </button>
{/if}
