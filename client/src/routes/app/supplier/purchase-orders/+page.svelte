<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Button from '$lib/components/Button.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let statusFilter = $state('all');

  onMount(async () => {
    try {
      rows = (await api('/api/v1/supplier-network/purchase-orders')) || [];
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  const filtered = $derived(
    rows.filter((p) => {
      const s = String(p.status || '').toLowerCase();
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') {
        return !['cancelled', 'closed', 'fulfilled', 'completed', 'draft'].includes(s);
      }
      if (statusFilter === 'ship') {
        return ['acknowledged', 'partially_shipped', 'issued', 'partially_fulfilled'].includes(s);
      }
      return s === statusFilter;
    })
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('purchaseOrders')} subtitle={$t('supplierPosSubtitle')} />
  <Alert type="info" role="status" message={$t('goodsReceiptNote')} />

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  <div class="flex flex-wrap gap-2" role="group" aria-label={$t('purchaseOrders')}>
    {#each [
      { id: 'all', label: $t('all') },
      { id: 'active', label: $t('activePurchaseOrders') },
      { id: 'ship', label: $t('pendingShipments') },
      { id: 'issued', label: 'Issued' },
      { id: 'fulfilled', label: 'Fulfilled' }
    ] as f}
      <Button
        size="sm"
        variant={statusFilter === f.id ? 'primary' : 'outline'}
        onclick={() => (statusFilter = f.id)}
      >
        {f.label}
      </Button>
    {/each}
  </div>

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-14" />{/each}
    </div>
  {:else if !filtered.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">
      {$t('noPurchaseOrders')}
    </div>
  {:else}
    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">PO</th>
            <th class="px-3 py-2" scope="col">Status</th>
            <th class="px-3 py-2" scope="col">Total</th>
            <th class="px-3 py-2" scope="col">{$t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as po}
            <tr class="border-t border-border">
              <td class="px-3 py-2 font-medium text-ink">{po.publicId}</td>
              <td class="px-3 py-2"><StatusPill status={po.status} /></td>
              <td class="px-3 py-2 tabular-nums">{po.grandTotal} {po.currency}</td>
              <td class="px-3 py-2">
                <a class="text-accent underline" href={`/app/supplier/purchase-orders/${po.publicId}`}>
                  Open
                </a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
