<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Button from '$lib/components/Button.svelte';

  let shops = $state<any[]>([]);
  let shopTotal = $state(0);
  let suppliers = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let tab = $state<'shops' | 'suppliers'>('shops');
  let supplierFilter = $state<'approved' | 'suspended' | 'all'>('all');

  async function load() {
    loading = true;
    error = '';
    try {
      const [shopRes, supRes] = await Promise.all([
        api<{ data: any[]; meta?: { total?: number } }>('/api/v1/shops?limit=50&sort=name', {
          full: true
        }),
        api<{ items: any[]; total: number }>(
          `/api/v1/platform/supplier-applications?status=${supplierFilter === 'all' ? 'all' : supplierFilter}`
        )
      ]);
      shops = shopRes.data || [];
      shopTotal = shopRes.meta?.total ?? shops.length;
      suppliers = (supRes.items || []).filter((s) =>
        supplierFilter === 'all' ? ['approved', 'suspended'].includes(s.status) : true
      );
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const filteredShops = $derived(
    shops.filter((s) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return [s.name, s.code, s.city, s.email].join(' ').toLowerCase().includes(needle);
    })
  );

  const filteredSuppliers = $derived(
    suppliers.filter((s) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return [s.businessName, s.ownerName, s.businessEmail, s.city].join(' ').toLowerCase().includes(needle);
    })
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('platformBusinesses')} subtitle={$t('platformBusinessesHint')} />
  <Alert type="info" role="status" message={`${$t('platformScopeNote')} ${$t('suspendedShopsNote')}`} />

  <div class="flex flex-wrap gap-2">
    <Button size="sm" variant={tab === 'shops' ? 'primary' : 'outline'} onclick={() => (tab = 'shops')}>
      {$t('publicShopDirectory')}
    </Button>
    <Button
      size="sm"
      variant={tab === 'suppliers' ? 'primary' : 'outline'}
      onclick={() => (tab = 'suppliers')}
    >
      {$t('supplierStatusDirectory')}
    </Button>
  </div>

  <label class="block max-w-md text-sm" for="biz-q"
    >{$t('search')}
    <input id="biz-q" class="input-field mt-1 w-full" bind:value={q} />
  </label>

  {#if tab === 'suppliers'}
    <div class="flex flex-wrap gap-2">
      {#each [
        ['all', $t('filterAll')],
        ['approved', $t('filterApproved')],
        ['suspended', $t('filterSuspended')]
      ] as [key, label]}
        <Button
          size="sm"
          variant={supplierFilter === key ? 'primary' : 'outline'}
          onclick={() => {
            supplierFilter = key as typeof supplierFilter;
            void load();
          }}
        >
          {label}
        </Button>
      {/each}
    </div>
  {/if}

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-14" />{/each}
    </div>
  {:else if tab === 'shops'}
    {#if !filteredShops.length}
      <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">{$t('empty')}</div>
    {:else}
      <p class="text-sm text-muted">{filteredShops.length} / {shopTotal}</p>
      <div class="surface-card overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead class="bg-surface-muted text-muted">
            <tr>
              <th class="px-3 py-2" scope="col">{$t('shopName')}</th>
              <th class="px-3 py-2" scope="col">{$t('city')}</th>
              <th class="px-3 py-2" scope="col">{$t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredShops as shop}
              <tr class="border-t border-border">
                <td class="px-3 py-2 font-medium text-ink">{shop.name}</td>
                <td class="px-3 py-2">{shop.city || '—'}</td>
                <td class="px-3 py-2"><StatusPill status={shop.isActive === false ? 'inactive' : 'active'} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if !filteredSuppliers.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">{$t('empty')}</div>
  {:else}
    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">{$t('businessName')}</th>
            <th class="px-3 py-2" scope="col">{$t('city')}</th>
            <th class="px-3 py-2" scope="col">{$t('status')}</th>
            <th class="px-3 py-2" scope="col">{$t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredSuppliers as row}
            <tr class="border-t border-border">
              <td class="px-3 py-2 font-medium text-ink">{row.businessName}</td>
              <td class="px-3 py-2">{row.location || row.city}</td>
              <td class="px-3 py-2"><StatusPill status={row.status} /></td>
              <td class="px-3 py-2">
                <a class="text-accent underline" href={`/app/platform/supplier-applications/${row.id}`}>Open</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
