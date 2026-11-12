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

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <header class="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('dashboard')}</p>
      <h1 class="mt-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">
        {$t('welcomeBack')}, {firstName}
      </h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{$t('customerHomeSubtitle')}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href="/app/customer/new" variant="outline" size="sm">{$t('submitRepairRequest')}</Button>
      <Button href="/app/customer/shops" variant="primary" size="sm">{$t('findRepairShops')}</Button>
    </div>
  </header>

  <form class="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end" onsubmit={searchShops}>
    <div class="min-w-0 flex-1">
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
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 6 }) as _}<Skeleton class="h-24" />{/each}
    </div>
  {:else if error}
    <div class="space-y-3">
      <Alert type="error" role="alert" message={error} />
      <Button variant="outline" onclick={load}>{$t('retry')}</Button>
    </div>
  {:else}
    {#if pendingEstimates.length}
      <section class="priorities-panel rounded-[var(--radius-ui)] p-4" aria-labelledby="action-needed-heading">
        <h2 id="action-needed-heading" class="priorities-title mb-1 text-sm font-semibold">
          {$t('nextAction')}
        </h2>
        <p class="priorities-hint mb-3 text-xs">{$t('pendingApprovals')}</p>
        <ul class="space-y-2 text-sm" role="list">
          {#each pendingEstimates as repair}
            <li>
              <a
                class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]"
                href={`/app/repairs/${repair._id}`}
              >
                <Icon name="alertTriangle" size={15} class="mt-0.5 shrink-0 text-warning" />
                <span>
                  <span class="font-medium">{$t('reviewEstimates')}: {repair.referenceNumber}</span>
                  <span class="block text-xs text-muted">{repair.brand} {repair.model}</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div>
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-ink">{$t('browseByCategory')}</h2>
        <a class="text-xs font-medium hover:underline" href="/app/customer/shops">{$t('viewAll')}</a>
      </div>
      <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="list">
        {#each categories as cat}
          <li>
            <a
              class="surface-card surface-card-interactive flex h-full flex-col gap-1 p-4"
              href={`/app/customer/shops?category=${encodeURIComponent(cat.id)}`}
            >
              <span class="font-medium text-ink">{cat.label || categoryLabel(cat.id)}</span>
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
        <h2 class="mb-3 text-sm font-semibold text-ink">{$t('recentlyViewedShops')}</h2>
        <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3" role="list">
          {#each recentShops as shop}
            <li class="surface-card p-4">
              <a class="font-medium hover:underline" href={`/app/customer/shops/${shop._id}`}>
                {shop.name}
              </a>
              <p class="mt-1 text-sm text-muted">{shop.city} · {shop.address}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="grid gap-4 xl:grid-cols-3">
      <section class="surface-card flex flex-col p-4 xl:col-span-2" aria-labelledby="active-repairs-heading">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 id="active-repairs-heading" class="text-sm font-semibold text-ink">{$t('activeRepairs')}</h2>
          <a class="text-xs font-medium hover:underline" href="/app/customer/repairs">{$t('viewAll')}</a>
        </div>
        <ul class="flex-1 space-y-2" role="list">
          {#each active as repair}
            <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <a class="font-medium hover:underline" href={`/app/repairs/${repair._id}`}>
                  {repair.referenceNumber}
                </a>
                <StatusPill status={repair.status} />
              </div>
              <p class="mt-1 text-sm text-muted">{repair.brand} {repair.model} — {repair.deviceType}</p>
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>
      </section>

      <section class="surface-card flex flex-col p-4" aria-labelledby="upcoming-appts-heading">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 id="upcoming-appts-heading" class="text-sm font-semibold text-ink">{$t('upcomingAppointments')}</h2>
          <a class="text-xs font-medium hover:underline" href="/app/customer/appointments">{$t('viewAll')}</a>
        </div>
        <ul class="flex-1 space-y-2 text-sm" role="list">
          {#each appointments as appt}
            <li class="flex items-start gap-2 rounded-[var(--radius-ui)] border border-border px-2.5 py-2">
              <Icon name="calendar" size={15} class="mt-0.5 shrink-0 text-accent" />
              <span class="min-w-0">
                <span class="block font-medium text-ink">{new Date(appt.startsAt).toLocaleString()}</span>
                <span class="block text-xs text-muted">{appt.shop?.name || ''}</span>
              </span>
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
