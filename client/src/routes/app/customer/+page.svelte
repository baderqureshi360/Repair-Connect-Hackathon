<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { categoryLabel, SERVICE_CATEGORIES } from '$lib/serviceCategories';
  import { getRecentShopIds } from '$lib/recentShops';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Alert from '$lib/components/Alert.svelte';

  let loading = $state(true);
  let error = $state('');
  let searchQ = $state('');
  let repairs = $state<any[]>([]);
  let appointments = $state<any[]>([]);
  let categories = $state<{ id: string; label: string; shopCount: number }[]>([]);
  let recentShops = $state<any[]>([]);

  async function load() {
    loading = true;
    error = '';
    try {
      const recentIds = getRecentShopIds();
      const [list, appts, cats, recent] = await Promise.all([
        api<{ data: any[] }>('/api/v1/repairs?limit=12', { full: true }),
        api<any[]>('/api/v1/appointments').catch(() => []),
        api<{ id: string; label: string; shopCount: number }[]>('/api/v1/shops/categories').catch(() => []),
        recentIds.length
          ? api<{ data: any[] }>(`/api/v1/shops?ids=${encodeURIComponent(recentIds.join(','))}&limit=6`, {
              full: true
            }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] })
      ]);
      repairs = list.data || [];
      appointments = (appts || [])
        .filter((x) => x.status === 'booked' && new Date(x.startsAt) >= new Date())
        .slice(0, 5);
      categories = cats?.length ? cats : SERVICE_CATEGORIES.map((c) => ({ ...c, shopCount: 0 }));
      // Preserve recent order from localStorage.
      const byId = new Map((recent.data || []).map((s: any) => [String(s._id), s]));
      recentShops = recentIds.map((id) => byId.get(id)).filter(Boolean);
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  function searchShops(e: Event) {
    e.preventDefault();
    const q = searchQ.trim();
    goto(q ? `/app/customer/shops?q=${encodeURIComponent(q)}` : '/app/customer/shops');
  }

  onMount(load);

  const pendingEstimates = $derived(repairs.filter((r) => r.status === 'estimate_pending'));
  const active = $derived(repairs.filter((r) => !['completed', 'cancelled'].includes(r.status)).slice(0, 6));
  const firstName = $derived($user?.name?.split(' ')[0] || $t('customer'));
</script>

<section class="space-y-8">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight md:text-3xl">
        {$t('welcomeBack')}, {firstName}
      </h1>
      <p class="mt-1 text-sm text-muted">{$t('customerHomeSubtitle')}</p>
    </div>
    <Button href="/app/customer/shops" variant="primary" size="sm">{$t('findRepairShops')}</Button>
  </div>

  <form class="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end" onsubmit={searchShops}>
    <div class="flex-1">
      <label class="mb-1 block text-sm font-medium" for="shop-search">{$t('searchRepairShops')}</label>
      <input
        id="shop-search"
        class="input-field"
        placeholder={$t('searchRepairShopsPlaceholder')}
        bind:value={searchQ}
      />
    </div>
    <Button type="submit" variant="primary">{$t('search')}</Button>
  </form>

  {#if loading}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {#each Array.from({ length: 6 }) as _}<Skeleton class="h-24" />{/each}
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else}
    <div>
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold">{$t('browseByCategory')}</h2>
        <a class="text-sm font-medium text-accent hover:underline" href="/app/customer/shops">{$t('viewAll')}</a>
      </div>
      <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {#each categories as cat}
          <li>
            <a
              class="surface-card surface-card-interactive flex h-full flex-col gap-1 p-4"
              href={`/app/customer/shops?category=${encodeURIComponent(cat.id)}`}
            >
              <span class="font-medium">{cat.label || categoryLabel(cat.id)}</span>
              <span class="text-sm text-muted">
                {cat.shopCount
                  ? $t('shopsOfferingCount').replace('{count}', String(cat.shopCount))
                  : $t('noShopsInCategoryYet')}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </div>

    {#if recentShops.length}
      <div>
        <h2 class="mb-3 text-base font-semibold">{$t('recentlyViewedShops')}</h2>
        <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#each recentShops as shop}
            <li class="surface-card p-4">
              <a class="font-medium text-accent hover:underline" href={`/app/customer/shops/${shop._id}`}>
                {shop.name}
              </a>
              <p class="mt-1 text-sm text-muted">{shop.city} · {shop.address}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="surface-card p-4 lg:col-span-2">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-base font-semibold">{$t('activeRepairs')}</h2>
          <a class="text-sm font-medium text-accent hover:underline" href="/app/customer/repairs">{$t('viewAll')}</a>
        </div>
        <ul class="space-y-2">
          {#each active as repair}
            <li class="surface-card surface-card-interactive p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <a class="font-medium text-accent hover:underline" href={`/app/repairs/${repair._id}`}>
                  {repair.referenceNumber}
                </a>
                <StatusPill status={repair.status} />
              </div>
              <p class="mt-1 text-sm text-muted">{repair.brand} {repair.model} — {repair.deviceType}</p>
            </li>
          {:else}
            <li class="text-muted">{$t('empty')}</li>
          {/each}
        </ul>
      </div>

      <div class="space-y-4">
        <div class="surface-card p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-base font-semibold">{$t('upcomingAppointments')}</h2>
            <a class="text-sm font-medium text-accent hover:underline" href="/app/customer/appointments">{$t('viewAll')}</a>
          </div>
          <ul class="space-y-2 text-sm">
            {#each appointments as appt}
              <li class="flex items-start gap-2">
                <Icon name="calendar" size={15} class="mt-0.5 text-accent" />
                <span>
                  <span class="font-medium">{new Date(appt.startsAt).toLocaleString()}</span>
                  <span class="block text-muted">{appt.shop?.name || ''}</span>
                </span>
              </li>
            {:else}
              <li class="text-muted">{$t('empty')}</li>
            {/each}
          </ul>
        </div>

        <div class="priorities-panel rounded-xl p-4">
          <h2 class="mb-3 text-base font-semibold text-white">{$t('pendingApprovals')}</h2>
          <ul class="space-y-2 text-sm text-indigo-50">
            {#each pendingEstimates as repair}
              <li>
                <a class="hover:text-white" href={`/app/repairs/${repair._id}`}>
                  {$t('reviewEstimates')}: {repair.referenceNumber}
                </a>
              </li>
            {:else}
              <li class="text-indigo-100/70">{$t('empty')}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  {/if}
</section>
