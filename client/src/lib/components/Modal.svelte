<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '$lib/i18n';
  import { shortcutManager } from '$lib/keyboard/manager';

  let {
    open = false,
    title,
    onclose,
    children
  }: {
    open: boolean;
    title: string;
    onclose: () => void;
    children: import('svelte').Snippet;
  } = $props();

  let panelEl: HTMLDivElement | undefined = $state();
  let previouslyFocused: HTMLElement | null = null;
  const overlayId = `modal-${Math.random().toString(36).slice(2, 9)}`;

  $effect(() => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      shortcutManager.pushOverlay({ id: overlayId, close: onclose });
      tick().then(() => {
        const focusable = panelEl?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        (focusable || panelEl)?.focus();
      });
      return () => {
        shortcutManager.removeOverlay(overlayId);
      };
    }
    if (previouslyFocused) {
      previouslyFocused.focus();
      previouslyFocused = null;
    }
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key !== 'Tab' || !panelEl) return;
    const nodes = Array.from(
      panelEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <div
    class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && onclose()}
  >
    <div
      bind:this={panelEl}
      class="modal-panel max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-border bg-surface-elevated p-4 shadow-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      onkeydown={onKey}
    >
      <div class="mb-3 flex items-start justify-between gap-3">
        <h2 id="modal-title" class="text-lg font-semibold">{title}</h2>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick={onclose} aria-label={$t('closeDialog')}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {@render children()}
    </div>
  </div>
{/if}
