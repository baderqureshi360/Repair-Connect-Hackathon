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
      const [a, reqs] = await Promise.all([
        api<any>(`/api/v1/analytics/me?${query()}`),
        api<any[]>('/api/v1/parts/requests/incoming')
      ]);
      analytics = a;
      requests = reqs || [];
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const low = $derived(analytics?.lowStockItems || []);
  const outOfStock = $derived(low.filter((p: any) => p.quantityAvailable <= 0));
  const firstName = $derived($user?.name?.split(' ')[0] || $t('parts_coordinator'));
</script>

<section class="space-y-6">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight md:text-3xl">
        {$t('welcomeBack')}, {firstName}!
      </h1>
      <p class="mt-1 text-sm text-muted">{$t('partsWelcomeSubtitle')}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
      <Button href="/app/parts/requests" variant="secondary" size="sm">{$t('partsRequests')}</Button>
    </div>
  </div>

  {#if loading && !analytics}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-28" />{/each}
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else if analytics}
    <StatGrid
      stats={[
        {
          label: $t('available'),
          value: analytics.summary?.available ?? 0,
          icon: 'package',
          tone: 'indigo'
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
          label: $t('partsRequests'),
          value: analytics.summary?.pendingRequests ?? requests.length,
          icon: 'clock',
          tone: 'violet'
        }
      ]}
    />

    <DashboardAnalytics hideRange providedData={analytics} />

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="surface-card p-4 lg:col-span-2">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-semibold">{$t('inventoryAlerts')}</h2>
          <a class="text-xs font-medium text-accent hover:underline" href="/app/parts/inventory">{$t('inventory')}</a>
        </div>
        <ul class="space-y-2">
          {#each low.slice(0, 10) as part}
            <li>
              <a
                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface"
                href={`/app/parts/inventory?focus=${part._id}`}
              >
                <span class="flex items-center gap-2">
                  <Icon
                    name={part.quantityAvailable <= 0 ? 'alertTriangle' : 'package'}
                    size={15}
                    class={part.quantityAvailable <= 0 ? 'text-danger' : 'text-warning'}
                  />
                  <span>{part.sku} · {part.name}</span>
                </span>
                <span class="tabular-nums text-muted">
                  {part.quantityAvailable} / {$t('reorderLevel')} {part.reorderLevel}
                </span>
              </a>
            </li>
          {:else}
            <li class="text-muted">{$t('empty')}</li>
          {/each}
        </ul>
      </div>

      <div class="space-y-4">
        <div class="priorities-panel rounded-xl p-4">
          <h2 class="mb-3 text-base font-semibold text-white">{$t('todaysPriorities')}</h2>
          <ul class="space-y-2 text-sm text-indigo-50">
            {#each outOfStock.slice(0, 4) as part}
              <li>
                <a class="hover:text-white" href={`/app/parts/inventory?focus=${part._id}`}>
                  {$t('outOfStock')}: {part.sku}
                </a>
              </li>
            {/each}
            {#each requests.slice(0, 4) as req}
              <li>
                <a class="hover:text-white" href="/app/parts/requests">
                  {$t('partsRequests')}: {req.part?.sku || req._id}
                </a>
              </li>
            {/each}
            {#if !outOfStock.length && !requests.length}
              <li class="text-indigo-100/70">{$t('empty')}</li>
            {/if}
          </ul>
        </div>

        <div class="surface-card p-4">
          <h2 class="mb-3 text-base font-semibold">{$t('pendingActions')}</h2>
          <ul class="space-y-2 text-sm">
            {#each requests.slice(0, 5) as req}
              <li class="flex items-center justify-between gap-2">
                <a class="text-accent hover:underline" href="/app/parts/requests">{req.part?.sku || req._id}</a>
                <StatusPill status={req.status} />
              </li>
            {:else}
              <li class="text-muted">{$t('empty')}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  {/if}
</section>
