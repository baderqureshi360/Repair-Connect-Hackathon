<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import DashboardAnalytics from '$lib/components/DashboardAnalytics.svelte';
  import DateRangeFilter, { type RangeKey } from '$lib/components/DateRangeFilter.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Alert from '$lib/components/Alert.svelte';

  let range = $state<RangeKey>('30d');
  let from = $state('');
  let to = $state('');
  let loading = $state(true);
  let error = $state('');
  let analytics = $state<any>(null);
  let requests = $state<any[]>([]);
  let purchaseOrders = $state<any[]>([]);
  let transfers = $state<any[]>([]);

  function query() {
    if (range === 'custom' && from && to) {
      return `range=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    }
    return `range=${range === 'custom' ? '30d' : range}`;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [a, reqs, pos, tr] = await Promise.all([
        api<any>(`/api/v1/analytics/me?${query()}`),
        api<any[]>('/api/v1/parts/requests/incoming').catch(() => []),
        api<any[]>('/api/v1/supplier-network/purchase-orders').catch(() => []),
        api<any[]>('/api/v1/transfers').catch(() => [])
      ]);
      analytics = a;
      requests = reqs || [];
      purchaseOrders = Array.isArray(pos) ? pos : [];
      transfers = Array.isArray(tr) ? tr : [];
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const low = $derived(analytics?.lowStockItems || []);
  const outOfStock = $derived(low.filter((p: any) => (p.quantityAvailable ?? 0) <= 0));
  const pendingRequests = $derived(
    requests.filter((r) => ['pending', 'partially_fulfilled'].includes(r.status))
  );
  const pendingPos = $derived(
    purchaseOrders.filter(
      (p) => !['cancelled', 'closed', 'received', 'completed'].includes(String(p.status || '').toLowerCase())
    )
  );
  const incomingShipments = $derived(
    purchaseOrders.filter((p) =>
      ['shipped', 'partially_shipped', 'in_transit', 'acknowledged'].includes(String(p.status || '').toLowerCase())
    )
  );
  const pendingTransfers = $derived(
    transfers.filter((t) => ['requested', 'approved', 'awaiting_transfer', 'dispatched', 'in_transit'].includes(t.status))
  );

  const priorityItems = $derived(
    [
      ...outOfStock.slice(0, 3).map((p: any) => ({
        href: `/app/parts/inventory?focus=${p._id}`,
        label: `${$t('outOfStock')}: ${p.sku}`,
        icon: 'alertTriangle' as const,
        danger: true
      })),
      ...low
        .filter((p: any) => (p.quantityAvailable ?? 0) > 0)
        .slice(0, 3)
        .map((p: any) => ({
          href: `/app/parts/inventory?focus=${p._id}`,
          label: `${$t('lowStock')}: ${p.sku}`,
          icon: 'package' as const,
          danger: false
        })),
      ...pendingRequests.slice(0, 4).map((r: any) => ({
        href: '/app/parts/requests',
        label: `${$t('partsRequests')}: ${r.part?.sku || r._id}`,
        icon: 'clipboard' as const,
        danger: false
      })),
      ...pendingTransfers.slice(0, 2).map((tr: any) => ({
        href: '/app/parts/transfers',
        label: `${$t('transfers')}: ${tr.partSku || tr._id}`,
        icon: 'truck' as const,
        danger: false
      })),
      ...pendingPos.slice(0, 2).map((po: any) => ({
        href: `/app/admin/purchase-orders/${po.publicId}`,
        label: `${$t('purchaseOrders')}: ${po.publicId}`,
        icon: 'fileText' as const,
        danger: false
      }))
    ].slice(0, 10)
  );

  const firstName = $derived($user?.name?.split(' ')[0] || $t('parts_coordinator'));
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <header class="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('dashboard')}</p>
      <h1 class="mt-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">
        {$t('welcomeBack')}, {firstName}
      </h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{$t('partsWelcomeSubtitle')}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
      <Button href="/app/parts/requests" variant="secondary" size="sm">{$t('partsRequests')}</Button>
      <Button href="/app/parts/inventory" variant="primary" size="sm">{$t('inventory')}</Button>
    </div>
  </header>

  {#if loading && !analytics}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 8 }) as _}<Skeleton class="h-28" />{/each}
    </div>
  {:else if error}
    <div class="space-y-3">
      <Alert type="error" role="alert" message={error} />
      <Button variant="outline" loading={loading} onclick={load}>{$t('retry')}</Button>
    </div>
  {:else if analytics}
    <StatGrid
      stats={[
        {
          label: $t('totalInventoryItems'),
          value: analytics.summary?.activeParts ?? 0,
          icon: 'package',
          tone: 'primary'
        },
        {
          label: $t('available'),
          value: analytics.summary?.available ?? 0,
          icon: 'checkCircle',
          tone: 'green',
          hint: $t('availableVsReserved')
        },
        {
          label: $t('reserved'),
          value: analytics.summary?.reserved ?? 0,
          icon: 'clipboard',
          tone: 'blue'
        },
        {
          label: $t('lowStock'),
          value: analytics.summary?.lowStock ?? low.length,
          icon: 'alertTriangle',
          tone: 'amber'
        },
        {
          label: $t('outOfStock'),
          value: outOfStock.length,
          icon: 'alertTriangle',
          tone: 'red'
        },
        {
          label: $t('partsRequests'),
          value: analytics.summary?.pendingRequests ?? pendingRequests.length,
          icon: 'clock',
          tone: 'violet'
        },
        {
          label: $t('pendingPurchaseOrders'),
          value: pendingPos.length,
          icon: 'fileText',
          tone: 'amber'
        },
        {
          label: $t('incomingShipments'),
          value: incomingShipments.length,
          icon: 'truck',
          tone: 'blue'
        },
        {
          label: $t('pendingTransfers'),
          value: analytics.summary?.outstandingTransfers ?? pendingTransfers.length,
          icon: 'truck',
          tone: 'violet'
        }
      ]}
    />

    <DashboardAnalytics hideRange providedData={analytics} />

    <div class="grid gap-4 xl:grid-cols-3">
      <section class="surface-card flex flex-col p-4 xl:col-span-2" aria-labelledby="inventory-alerts-heading">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 id="inventory-alerts-heading" class="text-sm font-semibold text-ink">{$t('inventoryAlerts')}</h2>
          <a class="text-xs font-medium hover:underline" href="/app/parts/inventory">{$t('viewAll')}</a>
        </div>
        <ul class="space-y-2" role="list">
          {#each low.slice(0, 10) as part}
            <li>
              <a
                class="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ui)] border border-border px-3 py-2 text-sm hover:bg-surface-muted"
                href={`/app/parts/inventory?focus=${part._id}`}
              >
                <span class="flex items-center gap-2">
                  <Icon
                    name={part.quantityAvailable <= 0 ? 'alertTriangle' : 'package'}
                    size={15}
                    class={part.quantityAvailable <= 0 ? 'text-danger' : 'text-warning'}
                  />
                  <span class="font-medium text-ink">{part.sku}</span>
                  <span class="text-muted">· {part.name}</span>
                </span>
                <span class="tabular-nums text-muted">
                  {$t('available')} {part.quantityAvailable} / {$t('reorderLevel')} {part.reorderLevel}
                </span>
              </a>
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>
      </section>

      <section class="priorities-panel flex flex-col rounded-[var(--radius-ui)] p-4" aria-labelledby="parts-priorities">
        <h2 id="parts-priorities" class="priorities-title mb-1 text-sm font-semibold">{$t('todaysPriorities')}</h2>
        <p class="priorities-hint mb-3 text-xs">{$t('pendingActions')}</p>
        <ul class="flex-1 space-y-2 text-sm" role="list">
          {#each priorityItems as item}
            <li>
              <a
                class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]"
                href={item.href}
              >
                <Icon
                  name={item.icon}
                  size={15}
                  class={`mt-0.5 shrink-0 ${item.danger ? 'text-danger' : 'text-accent'}`}
                />
                <span class="font-medium">{item.label}</span>
              </a>
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>

        {#if pendingRequests.length}
          <div class="mt-4 border-t border-border pt-3">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{$t('partsRequests')}</h3>
            <ul class="space-y-2 text-sm" role="list">
              {#each pendingRequests.slice(0, 4) as req}
                <li class="flex items-center justify-between gap-2">
                  <a class="hover:underline" href="/app/parts/requests">{req.part?.sku || req._id}</a>
                  <StatusPill status={req.status} />
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</section>
