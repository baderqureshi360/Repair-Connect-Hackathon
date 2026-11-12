<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '$lib/i18n';
  import { shortcutManager } from '$lib/keyboard/manager';
  import type { ShortcutCategory } from '$lib/keyboard/types';
  import Icon from './Icon.svelte';

  let {
    open = false,
    onclose
  }: {
    open: boolean;
    onclose: () => void;
  } = $props();

  let query = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let previouslyFocused: HTMLElement | null = null;

  const categoryOrder: ShortcutCategory[] = [
    'global',
    'navigation',
    'forms',
    'overlays',
    'tables',
    'actions'
  ];

  const categoryLabel: Record<ShortcutCategory, string> = {
    global: 'Global',
    navigation: 'Navigation',
    forms: 'Forms',
    overlays: 'Overlays',
    tables: 'Tables',
    actions: 'Actions'
  };

  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return shortcutManager
      .availableShortcuts()
      .filter((s) => {
        if (!q) return true;
        return [s.title, s.description, s.display, s.category, s.id].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));
  });

  const byCategory = $derived.by(() => {
    const map = new Map<ShortcutCategory, typeof rows>();
    for (const row of rows) {
      const list = map.get(row.category) || [];
      list.push(row);
      map.set(row.category, list);
    }
    return categoryOrder
      .map((cat) => ({ cat, label: categoryLabel[cat], items: map.get(cat) || [] }))
      .filter((g) => g.items.length);
  });

  $effect(() => {
    if (!open) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    query = '';
    shortcutManager.pushOverlay({ id: 'shortcuts-help', close: onclose });
    tick().then(() => inputEl?.focus());
    return () => {
      shortcutManager.removeOverlay('shortcuts-help');
      previouslyFocused?.focus();
      previouslyFocused = null;
    };
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

{#if open}
  <div
    class="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && onclose()}
  >
    <div
      class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-help-title"
      data-testid="shortcuts-help"
      tabindex="-1"
      onkeydown={onKey}
    >
      <div class="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="shortcuts-help-title" class="text-lg font-semibold">{$t('keyboardShortcuts')}</h2>
          <p class="mt-0.5 text-sm text-muted">{$t('keyboardShortcutsHint')}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick={onclose} aria-label={$t('closeDialog')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="border-b border-border px-4 py-2">
        <label class="sr-only" for="shortcuts-filter">{$t('search')}</label>
        <input
          id="shortcuts-filter"
          bind:this={inputEl}
          class="input-field w-full"
          type="search"
          placeholder={$t('searchShortcuts')}
          bind:value={query}
        />
      </div>

      <div class="flex-1 overflow-auto p-4">
        {#if !byCategory.length}
          <p class="py-8 text-center text-sm text-muted">{$t('searchNoResults')}</p>
        {:else}
          {#each byCategory as group}
            <section class="mb-5">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</h3>
              <ul class="divide-y divide-border rounded-lg border border-border">
                {#each group.items as item}
                  <li class="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div class="min-w-0">
                      <p class="text-sm font-medium">{item.title}</p>
                      <p class="text-xs text-muted">{item.description}</p>
                      <p class="mt-0.5 text-[11px] text-muted">
                        {$t('shortcutAvailability')}:
                        {item.enabled ? $t('shortcutAvailable') : $t('shortcutUnavailable')}
                      </p>
                    </div>
                    <kbd
                      class="shrink-0 rounded border border-border bg-surface px-2 py-1 text-xs font-semibold text-ink"
                    >
                      {item.display}
                    </kbd>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
