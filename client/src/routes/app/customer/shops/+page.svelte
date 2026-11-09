<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { categoryLabel, SERVICE_CATEGORIES } from '$lib/serviceCategories';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let shops = $state<any[]>([]);
  let cities = $state<string[]>([]);
  let categories = $state<{ id: string; label: string; shopCount: number }[]>([]);
  let loading = $state(true);
  let error = $state('');
  let total = $state(0);

  let q = $state('');
  let city = $state('');
  let category = $state('');
  let brand = $state('');
  let openNow = $state(false);
  let sort = $state<'name' | 'city' | 'rating'>('name');

  function syncFromUrl() {
    const sp = $page.url.searchParams;
    q = sp.get('q') || '';
    city = sp.get('city') || '';
    category = sp.get('category') || '';
    brand = sp.get('brand') || '';
    openNow = sp.get('openNow') === '1';
    sort = (sp.get('sort') as 'name' | 'city' | 'rating') || 'name';
  }

  function buildQuery() {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (city.trim()) params.set('city', city.trim());
    if (category) params.set('category', category);
    if (brand.trim()) params.set('brand', brand.trim());
    if (openNow) params.set('openNow', '1');
    if (sort && sort !== 'name') params.set('sort', sort);
    params.set('limit', '50');
    return params.toString();
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const qs = buildQuery();
      const [res, cityList, cats] = await Promise.all([
        api<{ data: any[]; meta?: { total?: number } }>(`/api/v1/shops?${qs}`, { full: true }),
        api<string[]>('/api/v1/shops/cities').catch(() => []),
        api<{ id: string; label: string; shopCount: number }[]>('/api/v1/shops/categories').catch(() => [])
      ]);
      shops = res.data || [];
      total = res.meta?.total ?? shops.length;
      cities = cityList || [];
      categories = cats?.length ? cats : SERVICE_CATEGORIES.map((c) => ({ ...c, shopCount: 0 }));
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  function applyFilters(e?: Event) {
    e?.preventDefault();
    const qs = buildQuery().replace(/limit=50&?/, '').replace(/&$/, '');
    goto(qs ? `/app/customer/shops?${qs}` : '/app/customer/shops');
    void load();
  }

  let lastSearch = $state('');

  onMount(() => {
    syncFromUrl();
    lastSearch = $page.url.search;
    void load();
  });

  $effect(() => {
    const search = $page.url.search;
    if (search === lastSearch) return;
    lastSearch = search;
    syncFromUrl();
    void load();
  });
</script>

<section class="space-y-6">
  <PageHeader
    title={$t('findRepairShops')}
    subtitle={$t('shopDirectorySubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/customer' }, { label: $t('findRepairShops') }]}
  />

  <form class="surface-card grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6" onsubmit={applyFilters}>
    <div class="xl:col-span-2">
      <label class="mb-1 block text-sm font-medium" for="q">{$t('search')}</label>
      <input id="q" class="input-field" bind:value={q} placeholder={$t('searchRepairShopsPlaceholder')} />
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="city">{$t('city')}</label>
      <select id="city" class="input-field" bind:value={city}>
        <option value="">{$t('allCities')}</option>
        {#each cities as c}
          <option value={c}>{c}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="category">{$t('serviceCategory')}</label>
      <select id="category" class="input-field" bind:value={category}>
        <option value="">{$t('allCategories')}</option>
        {#each categories as cat}
          <option value={cat.id}>{cat.label || categoryLabel(cat.id)}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="brand">{$t('brand')}</label>
      <input id="brand" class="input-field" bind:value={brand} placeholder={$t('brandFilterPlaceholder')} />
    </div>
    <div class="flex flex-col justify-end gap-2">
      <label class="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={openNow} />
        {$t('openNow')}
      </label>
      <select class="input-field" bind:value={sort} aria-label={$t('sortBy')}>
        <option value="name">{$t('sortName')}</option>
        <option value="city">{$t('sortCity')}</option>
        <option value="rating">{$t('sortRating')}</option>
      </select>
    </div>
    <div class="flex items-end gap-2 md:col-span-2 xl:col-span-6">
      <Button type="submit" variant="primary">{$t('applyFilters')}</Button>
      <Button
        type="button"
        variant="secondary"
        onclick={() => {
          q = '';
          city = '';
          category = '';
          brand = '';
          openNow = false;
          sort = 'name';
          applyFilters();
        }}>{$t('clearFilters')}</Button>
    </div>
  </form>

  {#if loading}
    <div class="grid gap-3 md:grid-cols-2" aria-busy="true">
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-40" />{/each}
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else}
    <p class="text-sm text-muted">{$t('shopsFoundCount').replace('{count}', String(total))}</p>
    <ul class="grid gap-4 md:grid-cols-2">
      {#each shops as shop}
        <li class="surface-card flex flex-col gap-3 p-4">
          <div class="flex gap-3">
            {#if shop.logoUrl}
              <img src={shop.logoUrl} alt="" class="h-14 w-14 rounded-lg border border-border object-cover" />
            {:else}
              <div
                class="flex h-14 w-14 items-center justify-center rounded-lg bg-accent/10 text-sm font-semibold text-accent"
                aria-hidden="true"
              >
                {(shop.name || '?').slice(0, 2).toUpperCase()}
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <a class="font-semibold text-accent hover:underline" href={`/app/customer/shops/${shop._id}`}>
                {shop.name}
              </a>
              <p class="text-sm text-muted">{shop.city} · {shop.address}</p>
              <p class="mt-1 text-xs font-medium uppercase tracking-wide text-muted">
                {shop.status === 'active' ? $t('shopStatusActive') : $t('shopStatusInactive')}
                {#if shop.isOpenNow}
                  · {$t('openNow')}
                {/if}
              </p>
            </div>
          </div>

          {#if shop.serviceCategories?.length}
            <div class="flex flex-wrap gap-1.5">
              {#each shop.serviceCategories as catId}
                <span class="rounded-md bg-surface px-2 py-0.5 text-xs text-muted ring-1 ring-border">
                  {categoryLabel(catId)}
                </span>
              {/each}
            </div>
          {/if}

          <div class="text-sm text-muted">
            {#if shop.phone}<p>{$t('contact')}: {shop.phone}</p>{/if}
            {#if shop.rating}
              <p>
                {$t('ratingSummary')
                  .replace('{avg}', String(shop.rating.average))
                  .replace('{count}', String(shop.rating.count))}
              </p>
            {/if}
          </div>

          <div class="mt-auto flex flex-wrap gap-2">
            <Button href={`/app/customer/shops/${shop._id}`} size="sm" variant="secondary">{$t('viewShop')}</Button>
            <Button href={`/app/customer/new?shopId=${shop._id}`} size="sm" variant="primary">{$t('bookRepair')}</Button>
          </div>
        </li>
      {:else}
        <li class="text-muted md:col-span-2">{$t('noShopsMatchFilters')}</li>
      {/each}
    </ul>
  {/if}
</section>
