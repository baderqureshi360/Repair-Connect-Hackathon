<script lang="ts">
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { t, type MessageKey } from '$lib/i18n';
  import { api } from '$lib/api';
  import { user } from '$lib/stores/auth';
  import { announce } from '$lib/stores/ui';
  import { shortcutManager } from '$lib/keyboard/manager';
  import {
    buildStaticCommands,
    filterCommands,
    groupCommands,
    recordsToCommands,
    type SearchApiResult
  } from '$lib/keyboard/commands';
  import type { CommandItem } from '$lib/keyboard/types';
  import Icon from './Icon.svelte';

  let {
    open = false,
    pendingOnboarding = false,
    onclose,
    onopenHelp,
    onlogout
  }: {
    open: boolean;
    pendingOnboarding?: boolean;
    onclose: () => void;
    onopenHelp: () => void;
    onlogout?: () => void;
  } = $props();

  let query = $state('');
  let loading = $state(false);
  let selected = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let recordItems = $state<CommandItem[]>([]);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let previouslyFocused: HTMLElement | null = null;

  const staticItems = $derived(
    buildStaticCommands({
      role: $user?.role ?? null,
      pendingOnboarding,
      t: (k) => $t(k as MessageKey),
      openShortcutsHelp: () => {
        onclose();
        onopenHelp();
      },
      logout: onlogout
    })
  );

  const filteredStatic = $derived(filterCommands(staticItems, query));
  const flat = $derived([...filteredStatic, ...recordItems]);
  const groups = $derived(groupCommands(flat));

  $effect(() => {
    if (!open) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    query = '';
    recordItems = [];
    selected = 0;
    shortcutManager.pushOverlay({ id: 'command-palette', close: onclose });
    tick().then(() => inputEl?.focus());
    return () => {
      shortcutManager.removeOverlay('command-palette');
      previouslyFocused?.focus();
      previouslyFocused = null;
    };
  });

  $effect(() => {
    // Keep selection in range when results change
    void flat.length;
    if (selected >= flat.length) selected = Math.max(0, flat.length - 1);
  });

  function onQueryInput() {
    selected = 0;
    clearTimeout(searchTimer);
    const q = query.trim();
    if (!q || !$user) {
      recordItems = [];
      loading = false;
      return;
    }
    loading = true;
    searchTimer = setTimeout(() => void fetchRecords(q), 280);
  }

  async function fetchRecords(q: string) {
    try {
      const res = await api<SearchApiResult>(`/api/v1/search?q=${encodeURIComponent(q)}&limit=6`);
      // Only keep results if query still matches (avoid stale overwrite)
      if (query.trim() !== q) return;
      recordItems = recordsToCommands(res);
    } catch {
      if (query.trim() === q) {
        recordItems = [];
        announce.set($t('errorGeneric'));
      }
    } finally {
      if (query.trim() === q) loading = false;
    }
  }

  async function execute(item: CommandItem | undefined) {
    if (!item) return;
    onclose();
    if (item.run) {
      await item.run();
      return;
    }
    if (item.href) {
      await goto(item.href);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!flat.length) return;
      selected = (selected + 1) % flat.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      selected = (selected - 1 + flat.length) % flat.length;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void execute(flat[selected]);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      selected = 0;
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      selected = Math.max(0, flat.length - 1);
    }
  }

  const shortcutsPreview = $derived(
    shortcutManager
      .availableShortcuts()
      .filter((s) => s.enabled && (s.category === 'global' || s.category === 'navigation'))
      .slice(0, 6)
  );

  const empty = $derived(!loading && query.trim().length > 0 && flat.length === 0);
</script>

{#if open}
  <div
    class="modal-backdrop fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/45 p-4 pt-[10vh]"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && onclose()}
  >
    <div
      bind:this={panelEl}
      class="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-panel"
      role="dialog"
      aria-modal="true"
      aria-label={$t('commandPalette')}
      data-testid="command-palette"
      tabindex="-1"
      onkeydown={onKey}
    >
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon name="search" size={16} class="text-muted" />
        <label class="sr-only" for="command-palette-input">{$t('commandPalette')}</label>
        <input
          id="command-palette-input"
          bind:this={inputEl}
          class="input-field flex-1 border-0 bg-transparent shadow-none focus:ring-0"
          type="search"
          placeholder={$t('commandPalettePlaceholder')}
          bind:value={query}
          oninput={onQueryInput}
          autocomplete="off"
          aria-controls="command-palette-results"
          aria-activedescendant={flat[selected] ? `cmd-${flat[selected].id}` : undefined}
        />
        <kbd class="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
      </div>

      <div
        id="command-palette-results"
        class="max-h-[min(24rem,50vh)] overflow-auto p-2"
        role="listbox"
        aria-label={$t('searchResults')}
      >
        {#if loading}
          <p class="px-2 py-3 text-sm text-muted" aria-live="polite">{$t('loading')}</p>
        {/if}

        {#if empty}
          <p class="px-2 py-6 text-center text-sm text-muted" aria-live="polite">{$t('searchNoResults')}</p>
        {:else}
          {#each [
            { key: 'navigation' as const, label: $t('commandGroupNavigation'), items: groups.navigation },
            { key: 'records' as const, label: $t('commandGroupRecords'), items: groups.records },
            { key: 'actions' as const, label: $t('commandGroupActions'), items: groups.actions }
          ] as group}
            {#if group.items.length}
              <p class="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </p>
              {#each group.items as item}
                {@const idx = flat.findIndex((f) => f.id === item.id)}
                <button
                  type="button"
                  id={`cmd-${item.id}`}
                  role="option"
                  aria-selected={idx === selected}
                  class={`flex w-full flex-col rounded-lg px-2 py-2 text-start text-sm ${
                    idx === selected ? 'bg-accent-soft text-ink' : 'hover:bg-surface'
                  }`}
                  onmouseenter={() => (selected = idx)}
                  onclick={() => void execute(item)}
                >
                  <span class="font-medium">{item.label}</span>
                  {#if item.description}
                    <span class="text-xs text-muted">{item.description}</span>
                  {/if}
                </button>
              {/each}
            {/if}
          {/each}
        {/if}

        {#if !query.trim() && !flat.length}
          <p class="px-2 py-4 text-sm text-muted">{$t('commandPaletteEmptyHint')}</p>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted">
        <span>{$t('keyboardShortcuts')}:</span>
        {#each shortcutsPreview as s}
          <span class="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
            <kbd class="font-medium text-ink">{s.display}</kbd>
            <span>{s.title}</span>
          </span>
        {/each}
        <button type="button" class="ms-auto text-accent hover:underline" onclick={() => { onclose(); onopenHelp(); }}>
          {$t('viewAllShortcuts')}
        </button>
      </div>
    </div>
  </div>
{/if}
