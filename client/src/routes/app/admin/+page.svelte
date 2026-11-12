<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import DashboardAnalytics from '$lib/components/DashboardAnalytics.svelte';
  import DateRangeFilter, { type RangeKey } from '$lib/components/DateRangeFilter.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let range = $state<RangeKey>('30d');
  let from = $state('');
  let to = $state('');
  let loading = $state(true);
  let error = $state('');
  let analytics = $state<any>(null);

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
      analytics = await api(`/api/v1/analytics/me?${query()}`);
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
      analytics = null;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function formatMoney(n: number) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'PKR',
        maximumFractionDigits: 0
      }).format(n || 0);
    } catch {
      return `Rs. ${n || 0}`;
    }
  }

  function relativeTime(iso: string | Date) {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return '';
    const diff = Date.now() - ts;
    const mins = Math.round(diff / 60000);
    if (mins < 1) return $t('justNow');
    if (mins < 60) return `${mins} ${$t('minutesAgo')}`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours} ${$t('hoursAgo')}`;
    return new Date(ts).toLocaleString();
  }

  function activityLabel(item: any) {
    const action = String(item.action || '').replaceAll('_', ' ');
    const entity = String(item.entityType || '');
    return `${action}${entity ? ` · ${entity}` : ''}`;
  }

  const firstName = $derived($user?.name?.split(' ')[0] || $t('shop_admin'));

  const hasPriorities = $derived(
    Boolean(
      analytics?.priorities?.overdue?.length ||
        analytics?.priorities?.pendingApprovals?.length ||
        analytics?.priorities?.criticalInventory?.length ||
        analytics?.priorities?.upcomingAppointments?.length
    )
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <header class="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('dashboard')}</p>
      <h1 class="mt-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">
        {$t('welcomeBack')}, {firstName}
      </h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{$t('adminWelcomeSubtitle')}</p>
    </div>
    <div class="w-full min-w-0 sm:w-auto">
      <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
    </div>
  </header>

  {#if loading && !analytics}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading metrics">
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-28" />{/each}
    </div>
    <div class="grid gap-4 lg:grid-cols-3" aria-hidden="true">
      <Skeleton class="h-72 lg:col-span-2" />
      <Skeleton class="h-72" />
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
          label: $t('totalRepairs'),
          value: analytics.summary?.totalRepairs ?? 0,
          icon: 'wrench',
          tone: 'primary',
          trend: analytics.trends?.totalRepairs ?? null,
          sparkline: analytics.sparklines?.totalRepairs || []
        },
        {
          label: $t('completedRepairs'),
          value: analytics.summary?.completed ?? 0,
          icon: 'checkCircle',
          tone: 'green',
          trend: analytics.trends?.completed ?? null,
          sparkline: analytics.sparklines?.completed || []
        },
        {
          label: $t('pendingRepairs'),
          value: analytics.summary?.pending ?? analytics.summary?.active ?? 0,
          icon: 'clock',
          tone: 'amber',
          trend: analytics.trends?.pending ?? null,
          hint:
            analytics.summary?.awaitingParts || analytics.summary?.pendingApprovals
              ? `${$t('awaitingParts')}: ${analytics.summary.awaitingParts || 0} · ${$t('pendingApprovals')}: ${analytics.summary.pendingApprovals || 0}`
              : undefined
        },
        {
          label: $t('totalCustomers'),
          value: analytics.summary?.totalCustomers ?? 0,
          icon: 'users',
          tone: 'blue',
          trend: analytics.trends?.totalCustomers ?? null
        }
      ]}
    />

    <DashboardAnalytics hideRange providedData={analytics} chartStyle="line" />

    <div class="grid gap-4 xl:grid-cols-4">
      <section class="surface-card flex flex-col p-4 xl:col-span-1" aria-labelledby="top-customers-heading">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 id="top-customers-heading" class="text-sm font-semibold text-ink">{$t('topCustomers')}</h2>
          <a class="text-xs font-medium hover:underline" href="/app/admin/customers">{$t('viewAll')}</a>
        </div>
        <ul class="flex-1 space-y-2" role="list">
          {#each analytics.topCustomers || [] as customer}
            <li class="flex items-center gap-3 rounded-[var(--radius-ui)] border border-border px-2.5 py-2">
              <span class="sidebar-avatar !bg-accent-soft !text-accent" aria-hidden="true">
                {String(customer.name || '?')
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((p: string) => p[0]?.toUpperCase() || '')
                  .join('')}
              </span>
              <div class="min-w-0 flex-1">
                <a
                  class="block truncate text-sm font-medium hover:underline"
                  href={`/app/admin/customers?focus=${customer.id}`}
                >
                  {customer.name}
                </a>
                <p class="text-xs text-muted">
                  {customer.repairCount} {$t('repairs')} · {formatMoney(customer.recordedSpend || 0)}
                </p>
              </div>
              {#if customer.repairCount > 0}
                <Icon name="trendingUp" size={14} class="text-success" />
              {/if}
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>
      </section>

      <section class="surface-card flex flex-col p-4 xl:col-span-1" aria-labelledby="inventory-alerts-heading">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 id="inventory-alerts-heading" class="text-sm font-semibold text-ink">{$t('inventoryAlerts')}</h2>
          <a class="text-xs font-medium hover:underline" href="/app/parts/inventory">{$t('inventory')}</a>
        </div>
        <ul class="flex-1 space-y-2" role="list">
          {#each analytics.inventoryAlerts || [] as item}
            <li>
              <a
                class="flex items-start gap-2 rounded-[var(--radius-ui)] border border-border px-2.5 py-2 text-sm hover:bg-surface-muted"
                href={`/app/parts/inventory?focus=${item.id}`}
              >
                <span class={item.severity === 'critical' ? 'text-danger' : 'text-warning'} aria-hidden="true">
                  <Icon name={item.quantityAvailable <= 0 ? 'alertTriangle' : 'package'} size={16} />
                </span>
                <span class="min-w-0">
                  <span class="block font-medium text-ink">{item.name}</span>
                  <span class="text-xs text-muted">
                    {item.sku} ·
                    {item.quantityAvailable <= 0
                      ? $t('outOfStock')
                      : `${$t('lowStock')} — ${item.quantityAvailable} ${$t('left')}`}
                    · {$t('reorderLevel')} {item.reorderLevel}
                  </span>
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

      <section class="surface-card flex flex-col p-4 xl:col-span-1" aria-labelledby="recent-activity-heading">
        <h2 id="recent-activity-heading" class="mb-3 text-sm font-semibold text-ink">{$t('recentActivity')}</h2>
        <ul class="flex-1 space-y-2" role="list">
          {#each analytics.recentActivity || [] as item}
            <li class="flex gap-2.5 rounded-[var(--radius-ui)] px-1 py-1.5">
              <span class="kpi-icon kpi-icon-blue !h-8 !w-8 shrink-0" aria-hidden="true">
                <Icon name="wrench" size={14} />
              </span>
              <div class="min-w-0">
                <p class="text-sm font-medium leading-snug text-ink">{activityLabel(item)}</p>
                <p class="text-xs text-muted">
                  {item.actorName ? `${item.actorName} · ` : ''}{relativeTime(item.createdAt)}
                </p>
              </div>
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>
      </section>

      <section
        class="priorities-panel flex flex-col rounded-[var(--radius-ui)] p-4 xl:col-span-1"
        aria-labelledby="priorities-heading"
      >
        <h2 id="priorities-heading" class="priorities-title mb-1 text-sm font-semibold">{$t('todaysPriorities')}</h2>
        <p class="priorities-hint mb-4 text-xs">{$t('todaysPrioritiesHint')}</p>
        <ul class="flex-1 space-y-3 text-sm" role="list">
          {#each analytics.priorities?.overdue || [] as item}
            <li>
              <a class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]" href={`/app/repairs/${item.id}`}>
                <Icon name="alertTriangle" size={15} class="mt-0.5 shrink-0 text-warning" />
                <span>
                  <span class="font-medium">{$t('overdue')}: {item.referenceNumber}</span>
                  <span class="block text-xs text-muted">{item.label}</span>
                </span>
              </a>
            </li>
          {/each}
          {#each analytics.priorities?.pendingApprovals || [] as item}
            <li>
              <a class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]" href={`/app/repairs/${item.id}`}>
                <Icon name="clock" size={15} class="mt-0.5 shrink-0 text-info" />
                <span>
                  <span class="font-medium">{$t('pendingApprovals')}: {item.referenceNumber}</span>
                  <span class="block text-xs text-muted">{item.label}</span>
                </span>
              </a>
            </li>
          {/each}
          {#each analytics.priorities?.criticalInventory || [] as item}
            <li>
              <a
                class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]"
                href={`/app/parts/inventory?focus=${item.id}`}
              >
                <Icon name="package" size={15} class="mt-0.5 shrink-0 text-danger" />
                <span>
                  <span class="font-medium">{item.name}</span>
                  <span class="block text-xs text-muted">
                    {item.sku} · {item.quantityAvailable} / {$t('reorderLevel')} {item.reorderLevel}
                  </span>
                </span>
              </a>
            </li>
          {/each}
          {#each analytics.priorities?.upcomingAppointments || [] as item}
            <li>
              <a class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]" href="/app/admin/appointments">
                <Icon name="calendar" size={15} class="mt-0.5 shrink-0 text-success" />
                <span>
                  <span class="font-medium">{item.customerName}</span>
                  <span class="block text-xs text-muted">
                    {new Date(item.startsAt).toLocaleString()}
                  </span>
                </span>
              </a>
            </li>
          {/each}
          {#if !hasPriorities}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-muted" role="status">
              {$t('empty')}
            </li>
          {/if}
        </ul>
      </section>
    </div>

    {#if analytics.summary?.recordedRevenue != null}
      <footer class="border-t border-border pt-3 text-xs text-muted">
        {$t('recordedRevenue')}: {formatMoney(analytics.summary.recordedRevenue)}
        · {$t('avgTurnaround')}: {analytics.summary.avgTurnaroundHours || 0}h
      </footer>
    {/if}
  {/if}
</section>
