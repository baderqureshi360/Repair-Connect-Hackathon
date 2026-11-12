<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let po = $state<any>(null);
  let shipments = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let okMsg = $state('');
  let carrier = $state('');
  let tracking = $state('');

  const id = $derived($page.params.id);

  async function load() {
    loading = true;
    try {
      po = await api(`/api/v1/supplier-network/purchase-orders/${id}`);
      shipments = Array.isArray(po?.shipments) ? po.shipments : [];
      if (!shipments.length) {
        const list = await api<any[]>(
          `/api/v1/supplier-network/shipments?purchaseOrderId=${encodeURIComponent(String(id || ''))}`
        ).catch(() => []);
        shipments = Array.isArray(list) ? list : [];
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function acknowledge() {
    try {
      po = await api(`/api/v1/supplier-network/purchase-orders/${id}/acknowledge`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      okMsg = 'PO acknowledged.';
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function reject() {
    const reason = prompt('Rejection reason (min 5 chars)') || '';
    if (reason.trim().length < 5) return;
    try {
      po = await api(`/api/v1/supplier-network/purchase-orders/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      okMsg = 'PO rejected.';
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function dispatchAll() {
    if (!po?.lines?.length) return;
    try {
      await api('/api/v1/supplier-network/shipments', {
        method: 'POST',
        body: JSON.stringify({
          purchaseOrderId: po.publicId,
          carrier,
          trackingNumber: tracking,
          dispatch: true,
          lines: po.lines
            .map((l: any) => ({
              poLineId: l.lineId,
              quantity: Math.max(1, l.quantityOrdered - (l.quantityShipped || 0))
            }))
            .filter((l: any) => l.quantity > 0)
        })
      });
      okMsg = 'Shipment dispatched. PO is not fulfilled until the shop receives goods.';
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <Button variant="outline" size="sm" onclick={() => goto('/app/supplier/purchase-orders')}>
    ← {$t('purchaseOrders')}
  </Button>
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  {#if loading}
    <div class="space-y-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 3 }) as _}<Skeleton class="h-16" />{/each}
    </div>
  {:else if po}
    <PageHeader title={po.publicId} subtitle={`${po.grandTotal} ${po.currency}`}>
      <StatusPill status={po.status} />
      {#if po.status === 'issued'}
        <Button variant="primary" size="sm" onclick={acknowledge}>{$t('acknowledgePo')}</Button>
        <Button variant="outline" size="sm" onclick={reject}>{$t('rejectPo')}</Button>
      {/if}
    </PageHeader>

    <Alert type="info" role="status" message={$t('goodsReceiptNote')} />

    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">Item</th>
            <th class="px-3 py-2" scope="col">Ordered</th>
            <th class="px-3 py-2" scope="col">Shipped</th>
            <th class="px-3 py-2" scope="col">Received</th>
            <th class="px-3 py-2" scope="col">Unit</th>
          </tr>
        </thead>
        <tbody>
          {#each po.lines || [] as line}
            <tr class="border-t border-border">
              <td class="px-3 py-2 font-medium text-ink">{line.name}</td>
              <td class="px-3 py-2 tabular-nums">{line.quantityOrdered}</td>
              <td class="px-3 py-2 tabular-nums">{line.quantityShipped || 0}</td>
              <td class="px-3 py-2 tabular-nums">{line.quantityReceived || 0}</td>
              <td class="px-3 py-2 tabular-nums">{line.unitPrice}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if ['acknowledged', 'partially_fulfilled', 'issued', 'partially_shipped'].includes(po.status)}
      <section class="surface-card space-y-3 p-4" aria-labelledby="dispatch-heading">
        <h2 id="dispatch-heading" class="font-semibold text-ink">{$t('dispatchAndTracking')}</h2>
        <label class="block text-sm" for="carrier">Carrier</label>
        <input id="carrier" class="input-field w-full max-w-md" bind:value={carrier} />
        <label class="block text-sm" for="tracking">Tracking</label>
        <input id="tracking" class="input-field w-full max-w-md" bind:value={tracking} />
        <Button variant="primary" onclick={dispatchAll}>{$t('dispatchShipment')}</Button>
      </section>
    {/if}

    {#if shipments.length}
      <section class="surface-card space-y-2 p-4" aria-labelledby="shipments-heading">
        <h2 id="shipments-heading" class="font-semibold text-ink">{$t('pendingShipments')}</h2>
        <ul class="space-y-2 text-sm" role="list">
          {#each shipments as s}
            <li class="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2">
              <span>{s.publicId || s.id} · {s.carrier || '—'} · {s.trackingNumber || '—'}</span>
              <StatusPill status={s.status || 'dispatched'} />
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</section>
