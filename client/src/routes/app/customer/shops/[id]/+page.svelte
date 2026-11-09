<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { categoryLabel } from '$lib/serviceCategories';
  import { rememberShop } from '$lib/recentShops';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let shop = $state<any>(null);
  let loading = $state(true);
  let error = $state('');

  const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const dayLabels: Record<string, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday'
  };

  async function load() {
    loading = true;
    error = '';
    try {
      const id = $page.params.id;
      shop = await api(`/api/v1/shops/${id}`);
      rememberShop(String(shop._id));
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
      shop = null;
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<section class="space-y-6">
  <PageHeader
    title={shop?.name || $t('shopDetails')}
    breadcrumbs={[
      { label: $t('home'), href: '/app/customer' },
      { label: $t('findRepairShops'), href: '/app/customer/shops' },
      { label: shop?.name || $t('shopDetails') }
    ]}
  />

  {#if loading}
    <Skeleton class="h-64" />
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else if shop}
    <div class="grid gap-6 lg:grid-cols-3">
      <div class="surface-card space-y-4 p-5 lg:col-span-2">
        <div class="flex gap-4">
          {#if shop.logoUrl}
            <img src={shop.logoUrl} alt="" class="h-20 w-20 rounded-xl border border-border object-cover" />
          {:else}
            <div
              class="flex h-20 w-20 items-center justify-center rounded-xl bg-accent/10 text-lg font-semibold text-accent"
              aria-hidden="true"
            >
              {(shop.name || '?').slice(0, 2).toUpperCase()}
            </div>
          {/if}
          <div>
            <h1 class="text-xl font-semibold">{shop.name}</h1>
            <p class="text-sm text-muted">{shop.city} · {shop.address}</p>
            <p class="mt-2 text-xs font-medium uppercase tracking-wide text-muted">
              {shop.status === 'active' ? $t('shopStatusActive') : $t('shopStatusInactive')}
              {#if shop.isOpenNow} · {$t('openNow')}{/if}
            </p>
            {#if shop.rating}
              <p class="mt-1 text-sm">
                {$t('ratingSummary')
                  .replace('{avg}', String(shop.rating.average))
                  .replace('{count}', String(shop.rating.count))}
              </p>
            {/if}
          </div>
        </div>

        {#if shop.description}
          <p class="text-sm leading-relaxed text-muted">{shop.description}</p>
        {/if}

        {#if shop.serviceCategories?.length}
          <div>
            <h2 class="mb-2 text-sm font-semibold">{$t('supportedServices')}</h2>
            <div class="flex flex-wrap gap-1.5">
              {#each shop.serviceCategories as catId}
                <span class="rounded-md bg-surface px-2 py-1 text-xs ring-1 ring-border">{categoryLabel(catId)}</span>
              {/each}
            </div>
          </div>
        {/if}

        {#if shop.supportedBrands?.length || shop.supportedDevices?.length}
          <div class="grid gap-3 sm:grid-cols-2">
            {#if shop.supportedDevices?.length}
              <div>
                <h2 class="mb-1 text-sm font-semibold">{$t('supportedDevices')}</h2>
                <p class="text-sm text-muted">{shop.supportedDevices.join(', ')}</p>
              </div>
            {/if}
            {#if shop.supportedBrands?.length}
              <div>
                <h2 class="mb-1 text-sm font-semibold">{$t('supportedBrands')}</h2>
                <p class="text-sm text-muted">{shop.supportedBrands.join(', ')}</p>
              </div>
            {/if}
          </div>
        {/if}

        <div class="flex flex-wrap gap-2 pt-2">
          <Button href={`/app/customer/new?shopId=${shop._id}`} variant="primary">{$t('bookRepair')}</Button>
          <Button href={`/app/customer/new?shopId=${shop._id}`} variant="secondary">{$t('submitRepairRequest')}</Button>
          <Button href={`/app/customer/appointments?shopId=${shop._id}`} variant="outline">{$t('appointments')}</Button>
        </div>
      </div>

      <aside class="space-y-4">
        <div class="surface-card p-4">
          <h2 class="mb-2 text-sm font-semibold">{$t('contact')}</h2>
          <ul class="space-y-1 text-sm text-muted">
            {#if shop.phone}<li>{shop.phone}</li>{/if}
            {#if shop.email}<li>{shop.email}</li>{/if}
            {#if shop.region}<li>{shop.region}</li>{/if}
            {#if !shop.phone && !shop.email}
              <li>{$t('contactNotPublic')}</li>
            {/if}
          </ul>
        </div>

        <div class="surface-card p-4">
          <h2 class="mb-2 text-sm font-semibold">{$t('operatingHours')}</h2>
          <ul class="space-y-1 text-sm">
            {#each dayOrder as day}
              {@const hours = shop.operatingHours?.[day]}
              <li class="flex justify-between gap-2">
                <span class="text-muted">{dayLabels[day]}</span>
                <span>
                  {#if hours?.closed}
                    {$t('closed')}
                  {:else}
                    {hours?.open || '—'} – {hours?.close || '—'}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      </aside>
    </div>
  {/if}
</section>
