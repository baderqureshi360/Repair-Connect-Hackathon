<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let doc = $state<any>(null);
  let error = $state('');
  let loading = $state(true);

  onMount(async () => {
    try {
      doc = await api(`/api/v1/supplier-network/purchase-orders/${$page.params.id}/print`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to load PO';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{doc?.publicId || 'PO'} — RepairConnect</title>
</svelte:head>

{#if loading}
  <Skeleton class="h-64 w-full" />
{:else if error}
  <Alert type="error" role="alert" message={error} />
{:else if doc}
  <div class="no-print mb-4 flex flex-wrap gap-2">
    <Button type="button" onclick={() => window.print()}>Print / Save PDF</Button>
    <Button href={`/app/admin/purchase-orders/${doc.publicId}`} variant="outline">Back</Button>
  </div>

  <article class="print-doc print-a4">
    <header class="mb-4 flex items-start justify-between gap-3 border-b border-slate-300 pb-3">
      <div>
        <h1 class="text-xl font-bold">{doc.shop?.name || 'RepairConnect Shop'}</h1>
        <p class="text-sm">{doc.shop?.address}, {doc.shop?.city}</p>
        <p class="text-sm">{doc.shop?.phone}</p>
      </div>
      <BrandMark size={40} compact class="no-print shrink-0 opacity-90 print:!hidden" />
    </header>

    <h2 class="mb-2 text-lg font-semibold">Purchase Order {doc.publicId}</h2>
    <div class="print-meta">
      <p><strong>Status:</strong> {doc.status}</p>
      <p><strong>Supplier:</strong> {doc.supplier?.businessName}</p>
      <p><strong>Supplier address:</strong> {doc.supplier?.address}, {doc.supplier?.city}</p>
      <p><strong>Deliver to:</strong> {doc.deliveryAddress}</p>
      <p>
        <strong>Expected delivery:</strong>
        {doc.expectedDeliveryDate ? new Date(doc.expectedDeliveryDate).toLocaleDateString() : '—'}
      </p>
    </div>

    <table class="mb-4 text-sm">
      <thead>
        <tr class="border-b border-slate-400 text-left">
          <th class="py-1">Item</th>
          <th class="py-1">SKU</th>
          <th class="py-1">Qty</th>
          <th class="py-1">Unit</th>
          <th class="py-1">Line</th>
        </tr>
      </thead>
      <tbody>
        {#each doc.lines || [] as line}
          <tr class="border-b border-slate-200">
            <td class="py-1">{line.name}</td>
            <td class="py-1">{line.sku || '—'}</td>
            <td class="py-1">{line.quantityOrdered}</td>
            <td class="py-1">{line.unitPrice}</td>
            <td class="py-1">{line.lineSubtotal}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="print-totals">
      <p class="flex justify-between"><span>Subtotal</span><span>{doc.subtotal}</span></p>
      <p class="flex justify-between"><span>Tax</span><span>{doc.taxAmount}</span></p>
      <p class="flex justify-between"><span>Delivery</span><span>{doc.deliveryCharges}</span></p>
      <p class="flex justify-between border-t border-slate-300 pt-1 font-semibold">
        <span>Grand total</span><span>{doc.grandTotal} {doc.currency}</span>
      </p>
    </div>

    {#if doc.terms}
      <p class="mt-4 text-sm whitespace-pre-wrap"><strong>Terms:</strong> {doc.terms}</p>
    {/if}
  </article>
{/if}
