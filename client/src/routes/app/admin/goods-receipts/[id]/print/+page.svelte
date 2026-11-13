<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let doc = $state<any>(null);
  let error = $state('');
  let loading = $state(true);
  let format = $state<'a4' | 'thermal80' | 'thermal58'>('a4');

  onMount(async () => {
    try {
      doc = await api(`/api/v1/supplier-network/goods-receipts/${$page.params.id}/print`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to load GRN';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{doc?.publicId || 'GRN'} — RepairConnect</title>
</svelte:head>

{#if loading}
  <Skeleton class="h-64 w-full" />
{:else if error}
  <Alert type="error" role="alert" message={error} />
{:else if doc}
  <div class="no-print mb-4 flex flex-wrap items-center gap-2">
    <label class="text-sm" for="fmt">Format</label>
    <select id="fmt" class="input-field w-auto" bind:value={format}>
      <option value="a4">A4</option>
      <option value="thermal80">80mm</option>
      <option value="thermal58">58mm</option>
    </select>
    <Button type="button" onclick={() => window.print()}>Print</Button>
    {#if doc.purchaseOrderPublicId}
      <Button href={`/app/admin/purchase-orders/${doc.purchaseOrderPublicId}`} variant="outline">Back to PO</Button>
    {/if}
  </div>

  <article
    class={`print-doc ${format === 'a4' ? 'print-a4' : format === 'thermal80' ? 'print-80' : 'print-58'}`}
  >
    <header class="mb-3 border-b border-slate-300 pb-2">
      <h1 class="text-lg font-bold">{doc.shop?.name || 'RepairConnect Shop'}</h1>
      {#if doc.shop?.address || doc.shop?.city}
        <p class="text-sm">{doc.shop?.address}{doc.shop?.city ? `, ${doc.shop.city}` : ''}</p>
      {/if}
      {#if doc.shop?.phone}
        <p class="text-sm">{doc.shop.phone}</p>
      {/if}
    </header>
    <h2 class="mb-2 font-semibold">Goods Received Note {doc.publicId}</h2>
    <div class="print-meta">
      <p>PO: {doc.purchaseOrderPublicId}</p>
      <p>Supplier: {doc.supplier?.businessName}</p>
      <p>Received: {doc.receivedAt ? new Date(doc.receivedAt).toLocaleString() : '—'}</p>
    </div>

    <table class="text-sm">
      <thead>
        <tr class="border-b border-slate-400 text-left">
          <th class="py-1">Line</th>
          <th class="py-1">Accepted</th>
          <th class="py-1">Rejected</th>
          <th class="py-1">Damaged</th>
          <th class="py-1">Value</th>
        </tr>
      </thead>
      <tbody>
        {#each doc.lines || [] as line}
          <tr class="border-b border-slate-200">
            <td class="py-1">{line.poLineId}</td>
            <td class="py-1">{line.quantityAccepted}</td>
            <td class="py-1">{line.quantityRejected}</td>
            <td class="py-1">{line.quantityDamaged}</td>
            <td class="py-1">{line.lineValueAccepted}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="mt-3 font-semibold">Accepted value: {doc.totalAcceptedValue}</p>
  </article>
{/if}
