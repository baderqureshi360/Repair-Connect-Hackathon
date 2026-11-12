<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let po = $state<any>(null);
  let shipments = $state<any[]>([]);
  let receipts = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let okMsg = $state('');
  let receiving = $state(false);

  const id = $derived($page.params.id);
  const canManage = $derived($user?.role === 'shop_admin');
  const canReceive = $derived($user?.role === 'shop_admin' || $user?.role === 'parts_coordinator');

  async function load() {
    loading = true;
    error = '';
    try {
      po = await api(`/api/v1/supplier-network/purchase-orders/${id}`);
      shipments = await api(`/api/v1/supplier-network/purchase-orders/${id}/shipments`);
      if (canReceive) {
        receipts = await api(`/api/v1/supplier-network/purchase-orders/${id}/goods-receipts`);
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    if ($user && $user.role !== 'shop_admin' && $user.role !== 'parts_coordinator') {
      const dest =
        $user.role === 'mechanic'
          ? '/app/mechanic'
          : $user.role === 'supplier'
            ? '/app/supplier'
            : '/app/customer';
      await goto(dest);
      return;
    }
    await load();
  });


  async function issue() {
    try {
      po = await api(`/api/v1/supplier-network/purchase-orders/${id}/issue`, { method: 'POST' });
      okMsg = 'Purchase order issued.';
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function cancelPo() {
    const reason = prompt('Cancellation reason (min 5 chars)') || '';
    if (reason.trim().length < 5) return;
    try {
      po = await api(`/api/v1/supplier-network/purchase-orders/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      okMsg = 'PO cancelled.';
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function receiveAllAccepted() {
    if (!po?.lines?.length) return;
    receiving = true;
    error = '';
    try {
      const key = `grn-${po.publicId}-${Date.now()}`;
      const grn = await api<{ publicId: string }>('/api/v1/supplier-network/goods-receipts', {
        method: 'POST',
        body: JSON.stringify({
          purchaseOrderId: po.publicId,
          idempotencyKey: key,
          lines: po.lines.map((l: any) => ({
            poLineId: l.lineId,
            quantityAccepted: Math.max(0, l.quantityOrdered - (l.quantityReceivedAccepted || 0)),
            quantityRejected: 0,
            quantityDamaged: 0,
            quantityShort: 0
          })).filter((l: any) => l.quantityAccepted > 0)
        })
      });
      okMsg = `GRN ${grn.publicId} posted. Stock updated for accepted quantities only.`;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      receiving = false;
    }
  }
</script>

<section class="space-y-4">
  <button type="button" class="text-sm text-accent underline" onclick={() => goto('/app/admin/purchase-orders')}>
    ← {$t('purchaseOrders')}
  </button>
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if po}
    <header class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">{po.publicId}</h1>
        <p class="text-sm text-muted capitalize">{String(po.status).replaceAll('_', ' ')} · Rev {po.revision}</p>
        <p class="text-sm">{po.grandTotal} {po.currency}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" href={`/app/admin/purchase-orders/${po.publicId}/print`}>{$t('printPo')}</Button>
        {#if canManage && po.status === 'draft'}
          <Button variant="primary" onclick={issue}>{$t('issuePurchaseOrder')}</Button>
        {/if}
        {#if canReceive && ['issued', 'acknowledged', 'partially_fulfilled'].includes(po.status)}
          <Button variant="primary" disabled={receiving} onclick={receiveAllAccepted}>
            {receiving ? $t('loading') : $t('receiveGoods')}
          </Button>
        {/if}
        {#if canManage && !['cancelled', 'closed', 'fulfilled', 'partially_fulfilled'].includes(po.status)}
          <Button variant="outline" onclick={cancelPo}>Cancel</Button>
        {/if}
      </div>
    </header>

    <p class="text-sm whitespace-pre-wrap">{po.deliveryAddress || '—'}</p>

    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-elevated text-muted">
          <tr>
            <th class="px-3 py-2">Item</th>
            <th class="px-3 py-2">Ordered</th>
            <th class="px-3 py-2">Received</th>
            <th class="px-3 py-2">Unit</th>
            <th class="px-3 py-2">Line</th>
          </tr>
        </thead>
        <tbody>
          {#each po.lines || [] as line}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                {line.name}
                {#if line.isAlternative}<span class="text-xs text-muted"> (alt)</span>{/if}
              </td>
              <td class="px-3 py-2">{line.quantityOrdered}</td>
              <td class="px-3 py-2">{line.quantityReceivedAccepted || 0}</td>
              <td class="px-3 py-2">{line.unitPrice}</td>
              <td class="px-3 py-2">{line.lineSubtotal}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <section class="space-y-2">
      <h2 class="text-lg font-semibold">Shipments</h2>
      {#if !shipments.length}
        <p class="text-sm text-muted">No shipments yet.</p>
      {:else}
        <ul class="space-y-1 text-sm">
          {#each shipments as s}
            <li class="rounded border border-border px-3 py-2">
              {s.publicId} · {s.status} · {s.carrier || '—'} {s.trackingNumber || ''}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if canReceive}
      <section class="space-y-2">
        <h2 class="text-lg font-semibold">Goods receipts</h2>
        {#if !receipts.length}
          <p class="text-sm text-muted">No GRNs posted.</p>
        {:else}
          <ul class="space-y-1 text-sm">
            {#each receipts as g}
              <li class="rounded border border-border px-3 py-2 flex justify-between gap-2">
                <span>{g.publicId} · accepted value {g.totalAcceptedValue}</span>
                <a class="text-accent underline" href={`/app/admin/goods-receipts/${g.publicId}/print`}>{$t('printGrn')}</a>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
</section>
