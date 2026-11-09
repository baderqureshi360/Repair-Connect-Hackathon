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
</script>

<section class="space-y-6">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight md:text-3xl">
        {$t('welcomeBack')}, {firstName}!
      </h1>
      <p class="mt-1 text-sm text-muted">{$t('adminWelcomeSubtitle')}</p>
    </div>
    <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
  </div>

  {#if loading && !analytics}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-28" />{/each}
    </div>
    <div class="grid gap-4 lg:grid-cols-3">
      <Skeleton class="h-72 lg:col-span-2" />
      <Skeleton class="h-72" />
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else if analytics}
    <StatGrid
      stats={[
        {
          label: $t('totalRepairs'),
          value: analytics.summary?.totalRepairs ?? 0,
          icon: 'wrench',
          tone: 'indigo',
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
          tone: 'violet',
          trend: analytics.trends?.totalCustomers ?? null
        }
      ]}
    />

    <DashboardAnalytics hideRange providedData={analytics} chartStyle="line" />

    <div class="grid gap-4 xl:grid-cols-4">
      <div class="surface-card p-4 xl:col-span-1">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-base font-semibold">{$t('topCustomers')}</h2>
          <a class="text-xs font-medium text-accent hover:underline" href="/app/admin/customers">{$t('viewAll')}</a>
        </div>
        <ul class="space-y-2" role="list">
          {#each analytics.topCustomers || [] as customer}
            <li class="flex items-center gap-3 rounded-lg border border-border/80 px-2.5 py-2">
              <span class="sidebar-avatar !bg-accent-soft !text-accent" aria-hidden="true">
                {String(customer.name || '?')
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((p: string) => p[0]?.toUpperCase() || '')
                  .join('')}
              </span>
              <div class="min-w-0 flex-1">
                <a class="block truncate text-sm font-medium text-accent hover:underline" href={`/app/admin/customers?focus=${customer.id}`}>
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
            <li class="text-sm text-muted">{$t('empty')}</li>
          {/each}
        </ul>
      </div>

      <div class="surface-card p-4 xl:col-span-1">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-base font-semibold">{$t('inventoryAlerts')}</h2>
          <a class="text-xs font-medium text-accent hover:underline" href="/app/parts/inventory">{$t('inventory')}</a>
        </div>
        <ul class="space-y-2" role="list">
          {#each analytics.inventoryAlerts || [] as item}
            <li>
              <a
                class="flex items-start gap-2 rounded-lg border border-border/80 px-2.5 py-2 text-sm hover:bg-surface"
                href={`/app/parts/inventory?focus=${item.id}`}
              >
                <span class={item.severity === 'critical' ? 'text-danger' : 'text-warning'} aria-hidden="true">
                  <Icon name={item.quantityAvailable <= 0 ? 'alertTriangle' : 'package'} size={16} />
                </span>
                <span class="min-w-0">
                  <span class="block font-medium">{item.name}</span>
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
            <li class="text-sm text-muted">{$t('empty')}</li>
          {/each}
        </ul>
      </div>

      <div class="surface-card p-4 xl:col-span-1">
        <h2 class="mb-3 text-base font-semibold">{$t('recentActivity')}</h2>
        <ul class="space-y-2" role="list">
          {#each analytics.recentActivity || [] as item}
            <li class="flex gap-2.5 rounded-lg px-1 py-1.5">
              <span class="kpi-icon kpi-icon-blue !h-8 !w-8 shrink-0" aria-hidden="true">
                <Icon name="wrench" size={14} />
              </span>
              <div class="min-w-0">
                <p class="text-sm font-medium leading-snug">{activityLabel(item)}</p>
                <p class="text-xs text-muted">
                  {item.actorName ? `${item.actorName} · ` : ''}{relativeTime(item.createdAt)}
                </p>
              </div>
            </li>
          {:else}
            <li class="text-sm text-muted">{$t('empty')}</li>
          {/each}
        </ul>
      </div>

      <div class="priorities-panel rounded-xl p-4 xl:col-span-1">
        <h2 class="mb-1 text-base font-semibold text-white">{$t('todaysPriorities')}</h2>
        <p class="mb-4 text-xs text-indigo-100/80">{$t('todaysPrioritiesHint')}</p>
        <ul class="space-y-3 text-sm">
          {#each analytics.priorities?.overdue || [] as item}
            <li>
              <a class="flex items-start gap-2 text-indigo-50 hover:text-white" href={`/app/repairs/${item.id}`}>
                <Icon name="alertTriangle" size={15} class="mt-0.5 shrink-0 text-amber-300" />
                <span>
                  <span class="font-medium">{$t('overdue')}: {item.referenceNumber}</span>
                  <span class="block text-xs text-indigo-200/80">{item.label}</span>
                </span>
              </a>
            </li>
          {/each}
          {#each analytics.priorities?.pendingApprovals || [] as item}
            <li>
              <a class="flex items-start gap-2 text-indigo-50 hover:text-white" href={`/app/repairs/${item.id}`}>
                <Icon name="clock" size={15} class="mt-0.5 shrink-0 text-sky-300" />
                <span>
                  <span class="font-medium">{$t('pendingApprovals')}: {item.referenceNumber}</span>
                  <span class="block text-xs text-indigo-200/80">{item.label}</span>
                </span>
              </a>
            </li>
          {/each}
          {#each analytics.priorities?.criticalInventory || [] as item}
            <li>
              <a class="flex items-start gap-2 text-indigo-50 hover:text-white" href={`/app/parts/inventory?focus=${item.id}`}>
                <Icon name="package" size={15} class="mt-0.5 shrink-0 text-rose-300" />
                <span>
                  <span class="font-medium">{item.name}</span>
                  <span class="block text-xs text-indigo-200/80">
                    {item.sku} · {item.quantityAvailable} / {$t('reorderLevel')} {item.reorderLevel}
                  </span>
                </span>
              </a>
            </li>
          {/each}
          {#each analytics.priorities?.upcomingAppointments || [] as item}
            <li>
              <a class="flex items-start gap-2 text-indigo-50 hover:text-white" href="/app/admin/appointments">
                <Icon name="calendar" size={15} class="mt-0.5 shrink-0 text-emerald-300" />
                <span>
                  <span class="font-medium">{item.customerName}</span>
                  <span class="block text-xs text-indigo-200/80">
                    {new Date(item.startsAt).toLocaleString()}
                  </span>
                </span>
              </a>
            </li>
          {/each}
          {#if !(analytics.priorities?.overdue?.length || analytics.priorities?.pendingApprovals?.length || analytics.priorities?.criticalInventory?.length || analytics.priorities?.upcomingAppointments?.length)}
            <li class="text-indigo-100/70">{$t('empty')}</li>
          {/if}
        </ul>
      </div>
    </div>

    {#if analytics.summary?.recordedRevenue != null}
      <p class="text-xs text-muted">
        {$t('recordedRevenue')}: {formatMoney(analytics.summary.recordedRevenue)}
        · {$t('avgTurnaround')}: {analytics.summary.avgTurnaroundHours || 0}h
      </p>
    {/if}
  {/if}
</section>
