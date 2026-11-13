<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { getCsrfToken, user } from '$lib/stores/auth';
  import { selectedShopId } from '$lib/stores/shopContext';
  import PageHeader from './PageHeader.svelte';
  import Button from './Button.svelte';
  import StatGrid from './StatGrid.svelte';
  import Skeleton from './Skeleton.svelte';
  import Alert from './Alert.svelte';
  import AnalyticsChart from './AnalyticsChart.svelte';

  let {
    allowedCategories = ['repairs', 'financial', 'inventory', 'mechanics', 'customers'],
    showHeader = true
  }: { allowedCategories?: string[]; showHeader?: boolean } = $props();

  let category = $state('repairs');
  let from = $state(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  let to = $state(new Date().toISOString().slice(0, 10));
  let report = $state<any>(null);
  let loading = $state(true);
  let error = $state('');

  onMount(() => {
    const q = $page.url.searchParams.get('category');
    if (q && allowedCategories.includes(q)) category = q;
    else if (allowedCategories[0]) category = allowedCategories[0];
    const shop = $page.url.searchParams.get('shopId');
    if (shop) selectedShopId.set(shop);
    void load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const shopQ = $selectedShopId ? `&shopId=${encodeURIComponent($selectedShopId)}` : '';
      report = await api(
        `/api/v1/reports/center?category=${category}&from=${from}&to=${to}${shopQ}`
      );
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      report = null;
    } finally {
      loading = false;
    }
  }

  async function exportCsv() {
    try {
      const shopQ = $selectedShopId ? `&shopId=${encodeURIComponent($selectedShopId)}` : '';
      const base = import.meta.env.VITE_API_URL || '';
      const headers = new Headers();
      const csrf = getCsrfToken();
      if (csrf) headers.set('X-CSRF-Token', csrf);
      const res = await fetch(
        `${base}/api/v1/reports/center.csv?category=${category}&from=${from}&to=${to}${shopQ}`,
        { credentials: 'include', headers }
      );
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repairconnect-${category}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      error = $t('errorGeneric');
    }
  }

  function printReport() {
    window.print();
  }

  const summaryStats = $derived.by(() => {
    const s = report?.summary || {};
    return Object.entries(s).map(([label, value]) => ({
      label: label.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      value: typeof value === 'number' ? value : String(value)
    }));
  });

  const chartPoints = $derived.by(() => {
    if (report?.trend) {
      return report.trend.map((r: any) => ({ label: r.label, value: r.received ?? r.value ?? 0 }));
    }
    if (report?.revenueTrend) return report.revenueTrend;
    return [];
  });

  const rowKeys = $derived(report?.rows?.length ? Object.keys(report.rows[0]) : []);
</script>

<section class="min-w-0 space-y-5 overflow-x-clip print:space-y-3 md:space-y-6">
  {#if showHeader}
    <PageHeader title={$t('reportsCenter')} subtitle={$t('shopPerformance')}>
      <Button variant="outline" size="sm" onclick={exportCsv}>{$t('exportCsv')}</Button>
      <Button variant="secondary" size="sm" onclick={printReport}>{$t('printReport')}</Button>
    </PageHeader>
  {:else}
    <div class="no-print flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onclick={exportCsv}>{$t('exportCsv')}</Button>
      <Button variant="secondary" size="sm" onclick={printReport}>Print</Button>
    </div>
  {/if}

  <form
    class="surface-card no-print flex flex-wrap items-end gap-3 p-3 md:p-4"
    onsubmit={(e) => {
      e.preventDefault();
      load();
    }}
  >
    <div>
      <label class="field-label" for="report-category">Category</label>
      <select id="report-category" class="input-field w-auto" bind:value={category} onchange={load}>
        {#each allowedCategories as c}
          <option value={c}>{c}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="field-label" for="from">{$t('from')}</label>
      <input id="from" type="date" class="input-field" bind:value={from} />
    </div>
    <div>
      <label class="field-label" for="to">{$t('to')}</label>
      <input id="to" type="date" class="input-field" bind:value={to} />
    </div>
    <Button type="submit" size="sm">{$t('refresh')}</Button>
    {#if $user?.role === 'shop_admin' || $user?.role === 'parts_coordinator'}
      <p class="text-xs text-muted">Shop filter follows the header shop selector.</p>
    {/if}
  </form>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if loading}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-24" />{/each}
    </div>
  {:else if report}
    <StatGrid stats={summaryStats.slice(0, 8)} />

    {#if chartPoints.length}
      <div class="surface-card p-4">
        <AnalyticsChart title="Trend" type="line" points={chartPoints} />
      </div>
    {/if}

    <div class="data-table-shell">
      <table class="min-w-full text-sm">
        <caption class="sr-only">{category} report</caption>
        <thead>
          <tr class="border-b border-border text-start text-muted">
            {#each rowKeys as key}
              <th class="px-3 py-2 font-medium" scope="col">{key}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each report.rows || [] as row}
            <tr class="border-b border-border last:border-0">
              {#each rowKeys as key}
                <td class="px-3 py-2 tabular-nums">{row[key] ?? '—'}</td>
              {/each}
            </tr>
          {:else}
            <tr><td class="px-3 py-6 text-muted" colspan={Math.max(rowKeys.length, 1)}>{$t('empty')}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
