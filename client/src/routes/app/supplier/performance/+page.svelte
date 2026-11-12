<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import DateRangeFilter, { type RangeKey } from '$lib/components/DateRangeFilter.svelte';
  import AnalyticsChart from '$lib/components/AnalyticsChart.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let data = $state<any>(null);
  let reviews = $state<any[]>([]);
  let ledger = $state<any[]>([]);
  let ledgerBalance = $state(0);
  let loading = $state(true);
  let error = $state('');
  let responseDraft = $state<Record<string, string>>({});
  let msg = $state('');
  let range = $state<RangeKey>('90d');
  let from = $state('');
  let to = $state('');

  function resolveDates() {
    const now = new Date();
    if (range === 'custom') return { from, to };
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now);
    if (range === '1d') start.setUTCDate(start.getUTCDate());
    else if (range === '7d') start.setUTCDate(start.getUTCDate() - 6);
    else if (range === '30d') start.setUTCDate(start.getUTCDate() - 29);
    else start.setUTCDate(start.getUTCDate() - 89);
    return { from: start.toISOString().slice(0, 10), to: end };
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const dates = resolveDates();
      const params = new URLSearchParams();
      if (dates.from) params.set('from', dates.from);
      if (dates.to) params.set('to', dates.to);
      const [analytics, rev, ledgerRows] = await Promise.all([
        api(`/api/v1/supplier/analytics?${params.toString()}`),
        api<{ items: any[] }>('/api/v1/supplier/reviews'),
        api<any[]>('/api/v1/supplier-network/ledger').catch(() => [])
      ]);
      data = analytics;
      reviews = rev.items || [];
      ledger = Array.isArray(ledgerRows) ? ledgerRows : [];
      const payableKinds = new Set([
        'goods_received',
        'supplier_invoice',
        'payment',
        'credit_note',
        'adjustment'
      ]);
      ledgerBalance =
        Math.round(
          ledger
            .filter((e) => ['posted', 'reversed'].includes(e.status) && payableKinds.has(e.kind))
            .reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100
        ) / 100;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function respond(reviewId: string) {
    msg = '';
    try {
      await api(`/api/v1/supplier/reviews/${reviewId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ body: responseDraft[reviewId] || '' })
      });
      msg = $t('success');
      await load();
    } catch (err) {
      msg = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  function metricLabel(m: { label?: string; value?: number | null; sampleCount?: number } | null | undefined) {
    if (!m) return $t('notEnoughData');
    return `${m.label || $t('notEnoughData')} (n=${m.sampleCount ?? 0})`;
  }
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('performance')} subtitle={$t('supplierAnalyticsHint')}>
    <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
  </PageHeader>

  {#if loading}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 8 }) as _}<Skeleton class="h-28" />{/each}
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
    <Button variant="outline" onclick={load}>{$t('retry')}</Button>
  {:else if data}
    {#if msg}<Alert type="success" role="status" message={msg} />{/if}

    <StatGrid
      stats={[
        {
          label: $t('receivedPurchaseOrders'),
          value: data.kpis?.totalReceivedPurchaseOrders ?? 0,
          hint: `PKR ${data.kpis?.totalOrderValue ?? 0}`,
          icon: 'fileText',
          tone: 'primary'
        },
        {
          label: $t('quotedRfqs'),
          value: data.kpis?.totalQuotedRfqs ?? 0,
          hint: metricLabel(data.kpis?.quotationAcceptanceRate),
          icon: 'clipboard',
          tone: 'violet'
        },
        {
          label: $t('fulfilledOrders'),
          value: data.kpis?.totalFulfilledOrders ?? 0,
          hint: metricLabel(data.kpis?.fulfilmentRate),
          icon: 'checkCircle',
          tone: 'green'
        },
        {
          label: $t('onTimeDelivery'),
          value: data.kpis?.onTimeDelivery?.label || '—',
          hint: `${$t('pendingOverdue')}: ${data.kpis?.pendingOverdueShipments?.label || '—'}`,
          icon: 'truck',
          tone: 'amber'
        },
        {
          label: $t('verifiedReviews'),
          value: data.kpis?.verifiedReviews?.overallAverage ?? '—',
          hint: data.kpis?.verifiedReviews?.label,
          icon: 'checkCircle',
          tone: 'green'
        },
        {
          label: 'Product quality',
          value: data.kpis?.verifiedReviews?.categoryAverages?.productQuality ?? $t('notEnoughData'),
          icon: 'package',
          tone: 'blue'
        },
        {
          label: $t('quotationResponse'),
          value: metricLabel(data.kpis?.quotationResponseTime),
          icon: 'clock',
          tone: 'violet'
        },
        {
          label: $t('outstandingBalance'),
          value: `PKR ${ledgerBalance}`,
          hint: $t('supplierLedgerHint'),
          icon: 'chart',
          tone: 'amber'
        }
      ]}
    />

    <div class="grid gap-4 lg:grid-cols-2">
      <AnalyticsChart
        title={$t('monthlyOrderTrends')}
        type="line"
        series={[
          {
            label: 'Orders',
            points: (data.monthlyOrderTrends || []).map((p: any) => ({
              label: p.month,
              value: p.orders
            }))
          },
          {
            label: 'Sales value',
            points: (data.monthlyOrderTrends || []).map((p: any) => ({
              label: p.month,
              value: p.salesValue
            }))
          }
        ]}
        empty={$t('noAnalyticsData')}
      />
      <section class="surface-card space-y-2 p-4" aria-labelledby="top-products">
        <h2 id="top-products" class="font-semibold text-ink">{$t('topSellingProducts')}</h2>
        {#if !(data.topSellingCatalogProducts || []).length}
          <p class="text-sm text-muted">{$t('noAnalyticsData')}</p>
        {:else}
          <ul class="space-y-1 text-sm" role="list">
            {#each data.topSellingCatalogProducts as p}
              <li class="flex justify-between gap-2 border-b border-border py-1">
                <span>{p.name} {#if p.sku}<span class="text-muted">({p.sku})</span>{/if}</span>
                <span class="text-muted">qty {p.orderedQty} · PKR {p.orderedValue}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>

    <section class="surface-card space-y-3 p-4" aria-labelledby="supplier-ledger">
      <h2 id="supplier-ledger" class="text-lg font-semibold text-ink">{$t('supplierLedger')}</h2>
      <p class="text-sm text-muted">{$t('outstandingBalance')}: PKR {ledgerBalance}</p>
      {#if !ledger.length}
        <p class="text-sm text-muted" role="status">{$t('empty')}</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-surface-muted text-muted">
              <tr>
                <th class="px-3 py-2" scope="col">Ref</th>
                <th class="px-3 py-2" scope="col">Kind</th>
                <th class="px-3 py-2" scope="col">Amount</th>
                <th class="px-3 py-2" scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each ledger.slice(0, 20) as e}
                <tr class="border-t border-border">
                  <td class="px-3 py-2">{e.publicId || e.id}</td>
                  <td class="px-3 py-2 capitalize">{String(e.kind).replaceAll('_', ' ')}</td>
                  <td class="px-3 py-2 tabular-nums">{e.amount} {e.currency || 'PKR'}</td>
                  <td class="px-3 py-2"><StatusPill status={e.status} /></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="space-y-3" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" class="text-lg font-semibold text-ink">Published reviews</h2>
      {#if !reviews.length}
        <div class="surface-card px-4 py-8 text-center text-sm text-muted" role="status">
          No published verified reviews yet.
        </div>
      {:else}
        {#each reviews as review}
          <article class="surface-card space-y-2 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="font-medium text-ink">{review.rating}★ · PO {review.purchaseOrderPublicId}</p>
              <p class="text-xs text-muted">{review.status} · verified</p>
            </div>
            {#if review.comment}<p class="whitespace-pre-wrap text-sm">{review.comment}</p>{/if}
            {#if review.supplierResponse}
              <p class="text-sm text-muted">Your response: {review.supplierResponse.body}</p>
            {:else}
              <label class="block text-sm"
                >Respond
                <textarea class="input-field mt-1 w-full" rows="2" bind:value={responseDraft[review.id]}></textarea>
              </label>
              <Button size="sm" variant="outline" onclick={() => respond(review.id)}>Post response</Button>
            {/if}
          </article>
        {/each}
      {/if}
    </section>
  {/if}
</section>
