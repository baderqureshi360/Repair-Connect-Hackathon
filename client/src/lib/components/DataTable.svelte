<script lang="ts">
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
    searchPlaceholder
  }: {
    caption: string;
    columns: Column[];
    rows: Record<string, unknown>[];
    empty: string;
    searchable?: boolean;
    pageSize?: number;
    searchPlaceholder?: string;
  } = $props();

  let query = $state('');
  let sortKey = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');
  let page = $state(0);

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
</script>

<div class="space-y-3">
  {#if searchable}
    <div class="flex flex-wrap items-center gap-2">
      <label class="sr-only" for="table-search">{searchPlaceholder || $t('search')}</label>
      <input
        id="table-search"
        class="input-field max-w-sm"
        type="search"
        placeholder={searchPlaceholder || $t('search')}
        bind:value={query}
      />
      <p class="text-xs text-muted" aria-live="polite">{filtered.length} {$t('results')}</p>
    </div>
  {/if}

  <div class="overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-ui">
    <table class="min-w-full text-sm">
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
            <tr class="border-b border-border last:border-0" class:bg-surface={i % 2 === 1}>
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
