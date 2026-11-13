<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';

  type Column = {
    key: string;
    label: string;
    sortable?: boolean;
    class?: string;
  };

  let {
    caption,
    columns,
    rows,
    empty,
    searchable = true,
    pageSize = 10,
    searchPlaceholder,
    getRowHref,
    getRowLabel
  }: {
    caption: string;
    columns: Column[];
    rows: Record<string, unknown>[];
    empty: string;
    searchable?: boolean;
    pageSize?: number;
    searchPlaceholder?: string;
    getRowHref?: (row: Record<string, unknown>) => string | undefined;
    getRowLabel?: (row: Record<string, unknown>) => string;
  } = $props();

  let query = $state('');
  let sortKey = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');
  let page = $state(0);
  let activeRow = $state(-1);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((row) =>
        columns.some((col) => String(row[col.key] ?? '').toLowerCase().includes(q))
      );
    }
    if (sortKey) {
      const key = sortKey;
      const dir = sortDir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
      });
    }
    return list;
  });

  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = $derived(filtered.slice(page * pageSize, page * pageSize + pageSize));

  $effect(() => {
    query;
    sortKey;
    sortDir;
    page = 0;
    activeRow = -1;
  });

  function toggleSort(key: string, sortable?: boolean) {
    if (!sortable) return;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function activateRow(row: Record<string, unknown>) {
    const href = getRowHref?.(row);
    if (href) {
      void goto(href);
      return;
    }
  }

  function onTableKeydown(e: KeyboardEvent) {
    if (!pageRows.length) return;
    const target = e.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, button')) {
      // Allow space on checkboxes inside table
      if (!(target instanceof HTMLInputElement && target.type === 'checkbox')) return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeRow = Math.min(pageRows.length - 1, activeRow < 0 ? 0 : activeRow + 1);
      focusActiveRow();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeRow = Math.max(0, activeRow < 0 ? 0 : activeRow - 1);
      focusActiveRow();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      activeRow = 0;
      focusActiveRow();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      activeRow = pageRows.length - 1;
      focusActiveRow();
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      if (page < pageCount - 1) {
        page += 1;
        activeRow = 0;
        queueMicrotask(focusActiveRow);
      }
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      if (page > 0) {
        page -= 1;
        activeRow = 0;
        queueMicrotask(focusActiveRow);
      }
      return;
    }
    if (e.key === 'Enter' && activeRow >= 0) {
      const row = pageRows[activeRow];
      if (!row) return;
      e.preventDefault();
      const href = getRowHref?.(row);
      if (href) {
        void goto(href);
        return;
      }
      const tr = document.getElementById(`dt-row-${page}-${activeRow}`);
      const link = tr?.querySelector<HTMLElement>('a[href], button:not([disabled])');
      link?.click();
      return;
    }
    if (e.key === ' ' && activeRow >= 0) {
      const tr = document.getElementById(`dt-row-${page}-${activeRow}`);
      const checkbox = tr?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (checkbox) {
        e.preventDefault();
        checkbox.click();
      }
    }
  }

  function focusActiveRow() {
    const tr = document.getElementById(`dt-row-${page}-${activeRow}`);
    tr?.focus();
  }

  function rowLabel(row: Record<string, unknown>, index: number) {
    return getRowLabel?.(row) || `${caption} row ${page * pageSize + index + 1}`;
  }
</script>

<div class="space-y-3">
  {#if searchable}
    <div class="flex flex-wrap items-center gap-2">
      <label class="sr-only" for="table-search">{searchPlaceholder || $t('search')}</label>
      <input
        id="table-search"
        data-page-search
        class="input-field max-w-sm"
        type="search"
        placeholder={searchPlaceholder || $t('search')}
        bind:value={query}
      />
      <p class="text-xs text-muted" aria-live="polite">{filtered.length} {$t('results')}</p>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="data-table-shell">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <table
      class="min-w-full text-sm"
      aria-rowcount={filtered.length}
      tabindex="-1"
      onkeydown={onTableKeydown}
    >
      <caption class="sr-only">{caption}</caption>
      <thead class="border-b border-border bg-surface text-start">
        <tr>
          {#each columns as col}
            <th
              scope="col"
              class={`px-3 py-2 font-semibold ${col.class || ''}`}
              aria-sort={col.sortable
                ? sortKey === col.key
                  ? sortDir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
                : undefined}
            >
              {#if col.sortable}
                <button
                  type="button"
                  class="inline-flex items-center gap-1 hover:text-accent"
                  onclick={() => toggleSort(col.key, true)}
                  aria-label={`${col.label}, sortable`}
                >
                  {col.label}
                  {#if sortKey === col.key}
                    <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  {/if}
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if pageRows.length === 0}
          <tr>
            <td class="px-3 py-8 text-center text-muted" colspan={columns.length}>{empty}</td>
          </tr>
        {:else}
          {#each pageRows as row, i}
            <tr
              id={`dt-row-${page}-${i}`}
              class="border-b border-border last:border-0 outline-none focus-visible:bg-accent-soft focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
              class:bg-surface={i % 2 === 1}
              class:bg-accent-soft={activeRow === i}
              tabindex="0"
              aria-selected={activeRow === i}
              aria-label={rowLabel(row, i)}
              onfocus={() => (activeRow = i)}
              ondblclick={() => activateRow(row)}
            >
              {#each columns as col}
                <td class={`px-3 py-2 align-top ${col.class || ''}`}>{row[col.key]}</td>
              {/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  {#if filtered.length > pageSize}
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p class="text-muted">{$t('page')} {page + 1} / {pageCount}</p>
      <div class="flex gap-2">
        <button type="button" class="btn btn-outline btn-sm" disabled={page === 0} onclick={() => (page -= 1)}>
          {$t('previous')}
        </button>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          disabled={page >= pageCount - 1}
          onclick={() => (page += 1)}
        >
          {$t('next')}
        </button>
      </div>
    </div>
  {/if}
</div>
