<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let business = $state<any>(null);
  let analytics = $state<any>(null);
  let catalog = $state<{ items: any[]; total: number }>({ items: [], total: 0 });
  let rfqs = $state<any[]>([]);
  let purchaseOrders = $state<any[]>([]);
  let ledgerBalance = $state<number | null>(null);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      const [biz, cat, analyticsRes, rfqList, pos, ledger] = await Promise.all([
        api('/api/v1/supplier/me'),
        api<{ items: any[]; total: number }>('/api/v1/supplier/catalog?limit=100&sort=updated'),
        api('/api/v1/supplier/analytics').catch(() => null),
        api<any[]>('/api/v1/supplier-network/rfqs').catch(() => []),
        api<any[]>('/api/v1/supplier-network/purchase-orders').catch(() => []),
        api<any[]>('/api/v1/supplier-network/ledger').catch(() => [])
      ]);
      business = biz;
      catalog = { items: cat?.items || [], total: cat?.total ?? cat?.items?.length ?? 0 };
      analytics = analyticsRes;
      rfqs = Array.isArray(rfqList) ? rfqList : [];
      purchaseOrders = Array.isArray(pos) ? pos : [];
      const payableKinds = new Set([
        'goods_received',
        'supplier_invoice',
        'payment',
        'credit_note',
        'adjustment'
      ]);
      const entries = Array.isArray(ledger) ? ledger : [];
      ledgerBalance = Math.round(
        entries
          .filter((e) => ['posted', 'reversed'].includes(e.status) && payableKinds.has(e.kind))
          .reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100
      ) / 100;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  const activeProducts = $derived(
    catalog.items.filter((i) => i.isActive && !i.isArchived).length
  );
  const supplierStock = $derived(
    catalog.items.reduce((s, i) => s + (Number(i.quantityAvailable) || 0), 0)
  );
  const pendingRfqs = $derived(
    rfqs.filter((r) => ['open', 'quoted', 'pending', 'sent'].includes(String(r.status || '').toLowerCase()))
  );
  const quotationsAwaiting = $derived(
    rfqs.filter((r) => {
      const q = r.myQuotation || r.quotation;
      return q && ['submitted', 'pending', 'sent'].includes(String(q.status || '').toLowerCase());
    }).length
  );
  const acceptedQuotations = $derived(
    rfqs.filter((r) => {
      const q = r.myQuotation || r.quotation;
      return q && String(q.status || '').toLowerCase() === 'accepted';
    }).length
  );
  const activePos = $derived(
    purchaseOrders.filter(
      (p) => !['cancelled', 'closed', 'fulfilled', 'completed', 'draft'].includes(String(p.status || '').toLowerCase())
    )
  );
  const pendingShipments = $derived(
    analytics?.kpis?.pendingOverdueShipments?.sampleCount ??
      activePos.filter((p) =>
        ['acknowledged', 'partially_shipped', 'issued'].includes(String(p.status || '').toLowerCase())
      ).length
  );

  const priorities = $derived(
    [
      ...pendingRfqs.slice(0, 4).map((r) => ({
        href: `/app/supplier/rfqs/${r.publicId}`,
        label: `${$t('pendingRfqs')}: ${r.publicId}`,
        icon: 'clipboard' as const
      })),
      ...activePos.slice(0, 4).map((p) => ({
        href: `/app/supplier/purchase-orders/${p.publicId}`,
        label: `${$t('purchaseOrders')}: ${p.publicId}`,
        icon: 'fileText' as const
      })),
      ...catalog.items
        .filter((i) => ['low_stock', 'out_of_stock'].includes(i.stockStatus))
        .slice(0, 3)
        .map((i) => ({
          href: '/app/supplier/catalog',
          label: `${i.stockStatus === 'out_of_stock' ? $t('outOfStock') : $t('lowStock')}: ${i.sku || i.name}`,
          icon: 'package' as const
        }))
    ].slice(0, 10)
  );

  const firstName = $derived(
    business?.businessName?.split(' ')[0] || $user?.name?.split(' ')[0] || $t('supplier')
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <header class="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('dashboard')}</p>
      <h1 class="mt-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">
        {$t('welcomeBack')}, {firstName}
      </h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{$t('supplierDashboardHint')}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href="/app/supplier/catalog" variant="primary" size="sm">{$t('catalog')}</Button>
      <Button href="/app/supplier/rfqs" variant="outline" size="sm">{$t('rfqs')}</Button>
      <Button href="/app/supplier/performance" variant="outline" size="sm">{$t('performance')}</Button>
    </div>
  </header>

  {#if loading}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 8 }) as _}<Skeleton class="h-28" />{/each}
    </div>
  {:else if error}
    <div class="space-y-3">
      <Alert type="error" role="alert" message={error} />
    </div>
  {:else if business}
    {#if business.status === 'suspended' || !business.isActive}
      <Alert
        type="warning"
        role="status"
        message="Your supplier account is suspended and hidden from marketplace search."
      />
    {/if}

    <StatGrid
      stats={[
        {
          label: $t('catalogProducts'),
          value: catalog.total,
          icon: 'package',
          tone: 'primary',
          hint: $t('supplierStockNote')
        },
        {
          label: $t('activeProducts'),
          value: activeProducts,
          icon: 'checkCircle',
          tone: 'green'
        },
        {
          label: $t('supplierStock'),
          value: supplierStock,
          icon: 'package',
          tone: 'blue'
        },
        {
          label: $t('pendingRfqs'),
          value: pendingRfqs.length,
          icon: 'clipboard',
          tone: 'amber'
        },
        {
          label: $t('quotationsAwaiting'),
          value: quotationsAwaiting,
          icon: 'clock',
          tone: 'violet'
        },
        {
          label: $t('acceptedQuotations'),
          value: acceptedQuotations || analytics?.kpis?.totalQuotedRfqs || 0,
          icon: 'checkCircle',
          tone: 'green'
        },
        {
          label: $t('activePurchaseOrders'),
          value: activePos.length || analytics?.kpis?.totalReceivedPurchaseOrders || 0,
          icon: 'fileText',
          tone: 'amber'
        },
        {
          label: $t('pendingShipments'),
          value: pendingShipments,
          icon: 'truck',
          tone: 'red'
        },
        {
          label: $t('orderValue'),
          value: `PKR ${analytics?.kpis?.totalOrderValue ?? 0}`,
          icon: 'chart',
          tone: 'violet'
        },
        {
          label: $t('outstandingBalance'),
          value: ledgerBalance == null ? '—' : `PKR ${ledgerBalance}`,
          icon: 'chart',
          tone: 'amber',
          hint: $t('supplierLedgerHint')
        },
        {
          label: $t('verifiedReviews'),
          value: analytics?.kpis?.verifiedReviews?.overallAverage ?? '—',
          icon: 'checkCircle',
          tone: 'green',
          hint: analytics?.kpis?.verifiedReviews?.label
        }
      ]}
    />

    <div class="grid gap-4 xl:grid-cols-3">
      <section class="surface-card p-4 xl:col-span-2" aria-labelledby="supplier-business">
        <h2 id="supplier-business" class="mb-3 text-sm font-semibold text-ink">{$t('businessName')}</h2>
        <div class="grid gap-3 sm:grid-cols-3">
          <div>
            <p class="text-xs uppercase tracking-wide text-muted">{$t('businessName')}</p>
            <p class="mt-1 font-semibold text-ink">{business.businessName}</p>
            {#if business.verified}<p class="mt-1 text-xs text-accent">{$t('verified')}</p>{/if}
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted">{$t('availability')}</p>
            <p class="mt-1 font-semibold capitalize text-ink">{business.availability}</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted">{$t('performance')}</p>
            <p class="mt-1 text-sm text-muted">
              {$t('onTimeDelivery')}: {analytics?.kpis?.onTimeDelivery?.label || '—'}
            </p>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button href="/app/supplier/profile" variant="outline" size="sm">{$t('viewProfile')}</Button>
          <Button href="/app/supplier/purchase-orders" variant="outline" size="sm">{$t('purchaseOrders')}</Button>
          <Button href="/app/supplier/messages" variant="outline" size="sm">{$t('messages')}</Button>
        </div>

        {#if activePos.length}
          <h3 class="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
            {$t('activePurchaseOrders')}
          </h3>
          <ul class="space-y-2" role="list">
            {#each activePos.slice(0, 5) as po}
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ui)] border border-border px-3 py-2 text-sm">
                <a class="font-medium hover:underline" href={`/app/supplier/purchase-orders/${po.publicId}`}>
                  {po.publicId}
                </a>
                <StatusPill status={po.status} />
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="priorities-panel flex flex-col rounded-[var(--radius-ui)] p-4" aria-labelledby="supplier-priorities">
        <h2 id="supplier-priorities" class="priorities-title mb-1 text-sm font-semibold">{$t('todaysPriorities')}</h2>
        <p class="priorities-hint mb-3 text-xs">{$t('pendingActions')}</p>
        <ul class="flex-1 space-y-2 text-sm" role="list">
          {#each priorities as item}
            <li>
              <a
                class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]"
                href={item.href}
              >
                <Icon name={item.icon} size={15} class="mt-0.5 shrink-0 text-accent" />
                <span class="font-medium">{item.label}</span>
              </a>
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</section>
