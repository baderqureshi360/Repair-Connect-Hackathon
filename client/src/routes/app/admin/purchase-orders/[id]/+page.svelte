<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

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

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-12" />{/each}
    </div>
  {:else if po}
    <PageHeader
      title={po.publicId}
      subtitle={`${po.grandTotal} ${po.currency} · Rev ${po.revision}`}
      breadcrumbs={[
        { label: $t('home'), href: '/app/admin' },
        { label: $t('purchaseOrders'), href: '/app/admin/purchase-orders' },
        { label: po.publicId }
      ]}
    >
      <StatusPill status={po.status} />
      <Button variant="outline" size="sm" href={`/app/admin/purchase-orders/${po.publicId}/print`}>{$t('printPo')}</Button>
      {#if canManage && po.status === 'draft'}
        <Button variant="primary" size="sm" onclick={issue}>{$t('issuePurchaseOrder')}</Button>
      {/if}
      {#if canReceive && ['issued', 'acknowledged', 'partially_fulfilled'].includes(po.status)}
        <Button variant="primary" size="sm" disabled={receiving} onclick={receiveAllAccepted}>
          {receiving ? $t('loading') : $t('receiveGoods')}
        </Button>
      {/if}
      {#if canManage && !['cancelled', 'closed', 'fulfilled', 'partially_fulfilled'].includes(po.status)}
        <Button variant="outline" size="sm" onclick={cancelPo}>{$t('cancel')}</Button>
      {/if}
    </PageHeader>

    <p class="surface-card p-4 text-sm whitespace-pre-wrap text-muted">
      <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink">Deliver to</span>
      {po.deliveryAddress || '—'}
    </p>

    <div class="data-table-shell">
      <table class="min-w-full text-start text-sm">
        <caption class="sr-only">PO lines</caption>
        <thead class="border-b border-border text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">Item</th>
            <th class="px-3 py-2" scope="col">Ordered</th>
            <th class="px-3 py-2" scope="col">Received</th>
            <th class="px-3 py-2" scope="col">Unit</th>
            <th class="px-3 py-2" scope="col">Line</th>
          </tr>
        </thead>
        <tbody>
          {#each po.lines || [] as line}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                {line.name}
                {#if line.isAlternative}<span class="text-xs text-muted"> (alt)</span>{/if}
              </td>
              <td class="px-3 py-2 tabular-nums">{line.quantityOrdered}</td>
              <td class="px-3 py-2 tabular-nums">{line.quantityReceivedAccepted || 0}</td>
              <td class="px-3 py-2 tabular-nums">{line.unitPrice}</td>
              <td class="px-3 py-2 tabular-nums">{line.lineSubtotal}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <section class="surface-card space-y-2 p-4">
      <h2 class="text-sm font-semibold text-ink">Shipments</h2>
      {#if !shipments.length}
        <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
          No shipments yet.
        </p>
      {:else}
        <ul class="space-y-2 text-sm" role="list">
          {#each shipments as s}
            <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2.5">
              <span class="font-medium">{s.publicId}</span>
              <span class="text-muted"> · {s.status} · {s.carrier || '—'} {s.trackingNumber || ''}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if canReceive}
      <section class="surface-card space-y-2 p-4">
        <h2 class="text-sm font-semibold text-ink">Goods receipts</h2>
        {#if !receipts.length}
          <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
            No GRNs posted.
          </p>
        {:else}
          <ul class="space-y-2 text-sm" role="list">
            {#each receipts as g}
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ui)] border border-border px-3 py-2.5">
                <span>{g.publicId} · accepted value {g.totalAcceptedValue}</span>
                <a class="font-medium hover:underline" href={`/app/admin/goods-receipts/${g.publicId}/print`}>{$t('printGrn')}</a>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
</section>
