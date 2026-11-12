<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

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

{#if loading}
  <p>Loading…</p>
{:else if error}
  <Alert type="error" role="alert" message={error} />
{:else if doc}
  <div class="no-print mb-4 flex flex-wrap gap-2">
    <label for="fmt">Format</label>
    <select id="fmt" class="input-field w-auto" bind:value={format}>
      <option value="a4">A4</option>
      <option value="thermal80">80mm</option>
      <option value="thermal58">58mm</option>
    </select>
    <Button type="button" onclick={() => window.print()}>Print</Button>
  </div>

  <article
    class={`print-doc bg-white text-black ${format === 'a4' ? 'print-a4' : format === 'thermal80' ? 'print-receipt' : 'print-58'}`}
  >
    <h1 class="text-lg font-bold">{doc.shop?.name}</h1>
    <h2 class="mb-2 font-semibold">Goods Received Note {doc.publicId}</h2>
    <p class="text-sm">PO: {doc.purchaseOrderPublicId}</p>
    <p class="text-sm">Supplier: {doc.supplier?.businessName}</p>
    <p class="text-sm mb-3">Received: {doc.receivedAt ? new Date(doc.receivedAt).toLocaleString() : '—'}</p>

    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b text-left">
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

<style>
  @media print {
    :global(.no-print) {
      display: none !important;
    }
  }
  .print-a4 {
    max-width: 210mm;
    margin: 0 auto;
    padding: 12mm;
  }
  .print-receipt {
    max-width: 80mm;
    margin: 0 auto;
    padding: 8px;
    font-size: 12px;
  }
  .print-58 {
    max-width: 58mm;
    margin: 0 auto;
    padding: 6px;
    font-size: 11px;
  }
</style>
