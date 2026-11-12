<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { getCsrfToken, user } from '$lib/stores/auth';
  import { t } from '$lib/i18n';
  import { selectedShopId } from '$lib/stores/shopContext';
  import { PART_CATEGORIES, partCategoryLabel } from '$lib/partCategories';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import DateRangeFilter, { type RangeKey } from '$lib/components/DateRangeFilter.svelte';
  import AnalyticsChart from '$lib/components/AnalyticsChart.svelte';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import type { KpiStat } from '$lib/components/StatGrid.svelte';

  let range = $state<RangeKey>('30d');
  let from = $state('');
  let to = $state('');
  let supplierBusinessId = $state('');
  let status = $state('');
  let productQ = $state('');
  let category = $state('');
  let data = $state<any>(null);
  let suppliers = $state<{ id: string; businessName: string }[]>([]);
  let loading = $state(true);
  let error = $state('');
  let exportMsg = $state('');

  function resolveDates() {
    const now = new Date();
    if (range === 'custom') return { from, to };
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now);
    if (range === '1d') start.setUTCDate(start.getUTCDate());
    else if (range === '7d') start.setUTCDate(start.getUTCDate() - 6);
    else if (range === '90d') start.setUTCDate(start.getUTCDate() - 89);
    else start.setUTCDate(start.getUTCDate() - 29);
    return { from: start.toISOString().slice(0, 10), to: end };
  }

  async function loadMeta() {
    try {
      const market = await api<{ items: any[] }>('/api/v1/marketplace/suppliers?limit=100');
      suppliers = (market.items || []).map((s: any) => ({
        id: s.id || s.publicId,
        businessName: s.businessName
      }));
    } catch {
      suppliers = [];
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      if (!$selectedShopId) {
        error = 'Select a shop first.';
        data = null;
        return;
      }
      const dates = resolveDates();
      const params = new URLSearchParams();
      params.set('shopId', $selectedShopId);
      if (dates.from) params.set('from', dates.from);
      if (dates.to) params.set('to', dates.to);
      if (supplierBusinessId) params.set('supplierBusinessId', supplierBusinessId);
      if (status) params.set('status', status);
      if (productQ.trim()) params.set('productQ', productQ.trim());
      if (category) params.set('category', category);
      data = await api(`/api/v1/supplier-network/purchasing-analytics?${params.toString()}`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      data = null;
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    if ($user && $user.role !== 'shop_admin') {
      const dest =
        $user.role === 'mechanic'
          ? '/app/mechanic'
          : $user.role === 'supplier'
            ? '/app/supplier'
            : '/app/customer';
      await goto(dest);
      return;
    }
    await loadMeta();
    await load();
  });

  function kpiStats(): KpiStat[] {
    if (!data?.kpis) return [];
    const k = data.kpis;
    return [
      {
        label: $t('totalPurchasingValue'),
        value: `PKR ${Number(k.totalPurchasingValue || 0).toLocaleString()}`,
        hint: `${k.totalPurchaseOrders} POs`,
        icon: 'chart',
        tone: 'indigo'
      },
      {
        label: $t('goodsReceivedValue'),
        value: `PKR ${Number(k.goodsReceivedValue || 0).toLocaleString()}`,
        hint: `${k.goodsReceiptCount} GRNs`,
        icon: 'package',
        tone: 'green'
      },
      {
        label: $t('outstandingPayables'),
        value: `PKR ${Number(k.outstandingSupplierPayables || 0).toLocaleString()}`,
        icon: 'fileText',
        tone: 'amber'
      },
      {
        label: $t('cashPaymentsInPeriod'),
        value: `PKR ${Number(k.cashPaymentsInPeriod ?? k.paidValueInPeriod ?? 0).toLocaleString()}`,
        hint: $t('cashPaymentsHint'),
        icon: 'fileText',
        tone: 'blue'
      },
      {
        label: $t('creditNotesInPeriod'),
        value: `PKR ${Number(k.creditNotesInPeriod || 0).toLocaleString()}`,
        hint: $t('creditNotesHint'),
        icon: 'fileText',
        tone: 'violet'
      },
      {
        label: $t('pendingPurchaseOrders'),
        value: k.pendingPurchaseOrders,
        hint: `Overdue shipments: ${k.pendingOverdueShipments}`,
        icon: 'truck',
        tone: 'violet'
      },
      {
        label: $t('fulfilmentRate'),
        value: k.averageSupplierFulfilmentRate?.label || $t('notEnoughData'),
        hint: `n=${k.averageSupplierFulfilmentRate?.sampleCount ?? 0}`,
        icon: 'chart',
        tone: 'blue'
      },
      {
        label: $t('onTimeDelivery'),
        value: k.averageSupplierOnTimeRate?.label || $t('notEnoughData'),
        hint: `n=${k.averageSupplierOnTimeRate?.sampleCount ?? 0}`,
        icon: 'calendar',
        tone: 'green'
      }
    ];
  }

  async function downloadReport(report: string) {
    exportMsg = '';
    try {
      if (!$selectedShopId) throw new Error('Select a shop first.');
      const dates = resolveDates();
      const params = new URLSearchParams();
      params.set('shopId', $selectedShopId);
      params.set('report', report);
      if (dates.from) params.set('from', dates.from);
      if (dates.to) params.set('to', dates.to);
      if (supplierBusinessId) params.set('supplierBusinessId', supplierBusinessId);
      if (status) params.set('status', status);
      if (productQ.trim()) params.set('productQ', productQ.trim());
      if (category) params.set('category', category);

      const base = import.meta.env.VITE_API_URL || '';
      const headers = new Headers();
      const csrf = getCsrfToken();
      if (csrf) headers.set('X-CSRF-Token', csrf);
      const res = await fetch(
        `${base}/api/v1/supplier-network/purchasing-analytics/export.csv?${params.toString()}`,
        { credentials: 'include', headers }
      );
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repairconnect-${report}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      exportMsg = $t('success');
    } catch (err) {
      exportMsg = err instanceof Error ? err.message : $t('errorGeneric');
    }
  }

  function printReport() {
    window.print();
  }
</script>

<section class="space-y-6 print:space-y-3">
  <header class="flex flex-wrap items-start justify-between gap-3 no-print">
    <div>
      <h1 class="text-2xl font-semibold">{$t('purchasingAnalytics')}</h1>
      <p class="mt-1 text-sm text-muted">{$t('purchasingAnalyticsHint')}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" onclick={printReport}>{$t('printReport')}</Button>
      <Button variant="outline" href="/app/admin/supplier-finance">{$t('supplierFinance')}</Button>
    </div>
  </header>

  <div class="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 no-print">
    <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
    <label class="text-sm" for="pa-supplier"
      >{$t('supplier')}
      <select id="pa-supplier" class="input-field mt-1" bind:value={supplierBusinessId} onchange={load}>
        <option value="">{$t('allSuppliers')}</option>
        {#each suppliers as s}
          <option value={s.id}>{s.businessName}</option>
        {/each}
      </select>
    </label>
    <label class="text-sm" for="pa-status"
      >Status
      <select id="pa-status" class="input-field mt-1" bind:value={status} onchange={load}>
        <option value="">All (excl. cancelled)</option>
        <option value="issued">issued</option>
        <option value="acknowledged">acknowledged</option>
        <option value="partially_fulfilled">partially_fulfilled</option>
        <option value="fulfilled">fulfilled</option>
        <option value="closed">closed</option>
        <option value="cancelled">cancelled</option>
      </select>
    </label>
    <label class="text-sm" for="pa-cat"
      >{$t('partCategories')}
      <select id="pa-cat" class="input-field mt-1" bind:value={category} onchange={load}>
        <option value="">All</option>
        {#each PART_CATEGORIES as c}
          <option value={c.id}>{partCategoryLabel(c.id)}</option>
        {/each}
      </select>
    </label>
    <label class="text-sm grow" for="pa-product"
      >Product
      <input
        id="pa-product"
        class="input-field mt-1 w-full min-w-[10rem]"
        bind:value={productQ}
        placeholder="Name or SKU"
        onkeydown={(e) => e.key === 'Enter' && load()}
      />
    </label>
    <Button variant="primary" onclick={load}>{$t('applyFilters')}</Button>
  </div>

  {#if exportMsg}<Alert type="success" role="status" message={exportMsg} />{/if}
  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
    <Button variant="outline" onclick={load}>{$t('retry')}</Button>
  {:else if data}
    <StatGrid stats={kpiStats()} />

    <div class="grid gap-4 lg:grid-cols-2">
      <AnalyticsChart
        title={$t('monthlyPurchasingTrends')}
        type="line"
        points={(data.monthlyPurchasingTrends || []).map((p: any) => ({
          label: p.month,
          value: p.value
        }))}
        empty={$t('noAnalyticsData')}
      />
      <AnalyticsChart
        title={$t('supplierPurchasingComparison')}
        type="bar"
        points={(data.supplierComparison || []).slice(0, 8).map((s: any) => ({
          label: s.businessName,
          value: s.purchasingValue
        }))}
        empty={$t('noAnalyticsData')}
      />
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="rounded-lg border border-border p-4 space-y-2">
        <h2 class="font-semibold">{$t('orderedVersusReceived')}</h2>
        <p class="text-sm">
          Ordered qty: {data.orderedVersusReceived?.orderedQuantity ?? 0} · Received qty:
          {data.orderedVersusReceived?.receivedQuantity ?? 0}
          {#if data.orderedVersusReceived?.fillRatio != null}
            · Fill {data.orderedVersusReceived.fillRatio}%
          {/if}
        </p>
        <p class="text-sm text-muted">
          Expenditure — ordered PKR {data.expenditureBreakdown?.orderedValue}, received PKR
          {data.expenditureBreakdown?.receivedValue}, cash payments PKR
          {data.expenditureBreakdown?.cashPayments ?? data.expenditureBreakdown?.paidValue}, credit
          notes PKR {data.expenditureBreakdown?.creditNotes ?? 0}, outstanding PKR
          {data.expenditureBreakdown?.outstandingPayables}
        </p>
      </section>
      <section class="rounded-lg border border-border p-4 space-y-2">
        <h2 class="font-semibold">{$t('downloadReports')}</h2>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onclick={() => downloadReport('supplier_purchasing')}
            >Supplier purchasing</Button
          >
          <Button size="sm" variant="outline" onclick={() => downloadReport('purchase_order_summary')}
            >PO summary</Button
          >
          <Button size="sm" variant="outline" onclick={() => downloadReport('goods_receiving')}
            >Goods receiving</Button
          >
          <Button size="sm" variant="outline" onclick={() => downloadReport('supplier_payables')}
            >Payables</Button
          >
          <Button size="sm" variant="outline" onclick={() => downloadReport('supplier_performance')}
            >Performance</Button
          >
          <Button
            size="sm"
            variant="outline"
            onclick={() => downloadReport('product_purchasing_history')}>Product history</Button
          >
        </div>
      </section>
    </div>

    <section class="space-y-2 overflow-x-auto">
      <h2 class="font-semibold">{$t('topPurchasedProducts')}</h2>
      {#if !(data.topPurchasedProducts || []).length}
        <p class="text-sm text-muted">{$t('noAnalyticsData')}</p>
      {:else}
        <table class="min-w-full text-left text-sm">
          <thead class="text-muted">
            <tr>
              <th class="px-2 py-1">Name</th>
              <th class="px-2 py-1">SKU</th>
              <th class="px-2 py-1">Ordered</th>
              <th class="px-2 py-1">Received</th>
              <th class="px-2 py-1">Value</th>
            </tr>
          </thead>
          <tbody>
            {#each data.topPurchasedProducts as p}
              <tr class="border-t border-border">
                <td class="px-2 py-1">{p.name}</td>
                <td class="px-2 py-1">{p.sku || '—'}</td>
                <td class="px-2 py-1">{p.orderedQty}</td>
                <td class="px-2 py-1">{p.receivedQty}</td>
                <td class="px-2 py-1">{p.orderedValue}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="space-y-2 overflow-x-auto">
      <h2 class="font-semibold">{$t('supplierPerformanceComparison')}</h2>
      {#if !(data.supplierPerformanceComparison || []).length}
        <p class="text-sm text-muted">{$t('noAnalyticsData')}</p>
      {:else}
        <table class="min-w-full text-left text-sm">
          <thead class="text-muted">
            <tr>
              <th class="px-2 py-1">Supplier</th>
              <th class="px-2 py-1">Verified</th>
              <th class="px-2 py-1">Fulfilment</th>
              <th class="px-2 py-1">On-time</th>
              <th class="px-2 py-1">Reviews</th>
              <th class="px-2 py-1">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {#each data.supplierPerformanceComparison as s}
              <tr class="border-t border-border">
                <td class="px-2 py-1">{s.businessName}</td>
                <td class="px-2 py-1">{s.verified ? $t('verified') : '—'}</td>
                <td class="px-2 py-1">{s.fulfilmentRate?.label} (n={s.fulfilmentRate?.sampleCount})</td>
                <td class="px-2 py-1">{s.onTimeDelivery?.label} (n={s.onTimeDelivery?.sampleCount})</td>
                <td class="px-2 py-1">{s.verifiedReviews?.label}</td>
                <td class="px-2 py-1">{s.pendingOverdue?.count ?? 0}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <details class="text-xs text-muted print:hidden">
      <summary>Metric definitions</summary>
      <ul class="mt-2 list-disc ps-5 space-y-1">
        {#each Object.entries(data.definitions || {}) as [k, v]}
          <li><strong>{k}</strong>: {v}</li>
        {/each}
      </ul>
    </details>
  {:else}
    <p class="text-muted">{$t('noAnalyticsData')}</p>
  {/if}
</section>

<style>
  @media print {
    :global(.no-print) {
      display: none !important;
    }
  }
</style>
