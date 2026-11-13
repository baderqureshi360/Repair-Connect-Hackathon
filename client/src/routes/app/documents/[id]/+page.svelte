<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Alert from '$lib/components/Alert.svelte';

  let doc = $state<any>(null);
  let error = $state('');
  let format = $state<'a4' | 'thermal80' | 'thermal58'>('a4');
  let loading = $state(true);

  onMount(async () => {
    try {
      doc = await api(`/api/v1/documents/${$page.params.id}`);
      format = doc.snapshot?.settings?.defaultPrintFormat || 'a4';
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to load document';
    } finally {
      loading = false;
    }
  });

  function printDoc() {
    window.print();
  }
</script>

<svelte:head>
  <title>{doc?.documentNumber || 'Document'} — RepairConnect</title>
</svelte:head>

{#if loading}
  <Skeleton class="h-64 w-full" />
{:else if error}
  <Alert type="error" role="alert" message={error} />
{:else if doc}
  <div class="no-print mb-4 flex flex-wrap items-center gap-2">
    <label class="text-sm" for="print-format">Format</label>
    <select id="print-format" class="input-field w-auto" bind:value={format}>
      <option value="a4">A4</option>
      <option value="thermal80">80mm thermal</option>
      <option value="thermal58">58mm thermal</option>
    </select>
    <Button type="button" onclick={printDoc}>Print / Save PDF</Button>
    <Button type="button" variant="secondary" onclick={printDoc}>Print Again</Button>
    <Button href={`/app/repairs/${doc.repairRequest}`} variant="outline">Back to repair</Button>
  </div>

  <article
    class={`print-doc ${format === 'a4' ? 'print-a4' : format === 'thermal80' ? 'print-80' : 'print-58'}`}
    lang={doc.snapshot?.settings?.printLanguage || 'en'}
    dir={doc.snapshot?.settings?.printLanguage === 'ur' ? 'rtl' : 'ltr'}
  >
    <header class="mb-4 border-b border-slate-300 pb-3">
      {#if doc.snapshot?.shop?.logoUrl}
        <img src={doc.snapshot.shop.logoUrl} alt="" class="mb-2 max-h-16 object-contain" />
      {/if}
      <h1 class="text-xl font-bold">{doc.snapshot?.shop?.name}</h1>
      <p class="text-sm">{doc.snapshot?.shop?.address}, {doc.snapshot?.shop?.city}</p>
      <p class="text-sm">{doc.snapshot?.shop?.phone}</p>
      {#if doc.snapshot?.shop?.header}
        <p class="mt-2 text-sm">{doc.snapshot.shop.header}</p>
      {/if}
    </header>

    <div class="mb-4 grid gap-1 text-sm">
      <p><strong>Document:</strong> {doc.docType.replace('_', ' ')}</p>
      <p><strong>Number:</strong> {doc.documentNumber}</p>
      <p><strong>Issued:</strong> {new Date(doc.issuedAt).toLocaleString()}</p>
      <p><strong>Repair:</strong> {doc.snapshot?.repair?.referenceNumber}</p>
      {#if doc.snapshot?.repair?.createdAt}
        <p><strong>Repair date:</strong> {new Date(doc.snapshot.repair.createdAt).toLocaleDateString()}</p>
      {/if}
      {#if doc.snapshot?.repair?.completedAt}
        <p><strong>Completed:</strong> {new Date(doc.snapshot.repair.completedAt).toLocaleDateString()}</p>
      {/if}
      <p><strong>Customer:</strong> {doc.snapshot?.customer?.name}</p>
      <p>
        <strong>Device:</strong>
        {doc.snapshot?.repair?.brand}
        {doc.snapshot?.repair?.model}
        ({doc.snapshot?.repair?.deviceType})
      </p>
      {#if doc.snapshot?.repair?.serialNumber}
        <p><strong>Serial:</strong> {doc.snapshot.repair.serialNumber}</p>
      {/if}
      {#if doc.snapshot?.repair?.problemDescription}
        <p><strong>Description:</strong> {doc.snapshot.repair.problemDescription}</p>
      {/if}
    </div>

    {#if doc.lineItems?.length}
      <table class="mb-4 w-full text-sm">
        <thead>
          <tr class="border-b border-slate-300 text-start">
            <th class="py-1">Description</th>
            <th class="py-1 text-end">Qty</th>
            <th class="py-1 text-end">Unit</th>
            <th class="py-1 text-end">Total</th>
          </tr>
        </thead>
        <tbody>
          {#each doc.lineItems as line}
            <tr class="border-b border-slate-200">
              <td class="py-1">{line.description}</td>
              <td class="py-1 text-end">{line.quantity ?? 1}</td>
              <td class="py-1 text-end">{doc.currency} {line.unitAmount ?? line.amount}</td>
              <td class="py-1 text-end">{doc.currency} {line.amount}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="text-sm">Subtotal: {doc.currency} {doc.subtotal}</p>
      {#if doc.discountAmount > 0}
        <p class="text-sm">Discount: {doc.currency} {doc.discountAmount}</p>
      {/if}
      <p class="text-sm">{doc.snapshot?.settings?.taxLabel || 'Tax'} ({doc.taxRatePercent}%): {doc.currency} {doc.taxAmount}</p>
      <p class="text-base font-bold">Final repair cost: {doc.currency} {doc.totalAmount}</p>
      {#if doc.paymentStatus !== 'not_applicable'}
        <p class="text-sm">Confirmed paid: {doc.currency} {doc.amountPaid}</p>
        <p class="text-sm">Outstanding balance: {doc.currency} {doc.balanceDue}</p>
        <p class="text-sm font-semibold uppercase">
          Payment status: {doc.paymentStatus === 'paid' ? 'PAID' : doc.paymentStatus === 'partial' ? 'PARTIAL' : 'UNPAID'}
        </p>
        {#if doc.snapshot?.payments?.length}
          <div class="mt-2 space-y-1 text-sm">
            <p class="font-medium">Payment records</p>
            {#each doc.snapshot.payments as pay}
              <p>
                {doc.currency} {pay.amount}
                · {pay.method || '—'}
                {#if pay.reference}· ref {pay.reference}{/if}
                · {pay.paidAt ? new Date(pay.paidAt).toLocaleString() : '—'}
              </p>
            {/each}
          </div>
        {/if}
      {/if}
    {/if}

    {#if doc.docType === 'warranty'}
      <p class="mt-3 text-sm whitespace-pre-wrap">{doc.snapshot?.settings?.warrantyTerms}</p>
      {#if doc.snapshot?.repair?.warrantyExpiresAt}
        <p class="text-sm">Expires: {new Date(doc.snapshot.repair.warrantyExpiresAt).toLocaleDateString()}</p>
      {/if}
    {/if}

    {#if doc.snapshot?.repair?.trackingToken}
      <p class="mt-4 text-xs">Track: /track/{doc.snapshot.repair.trackingToken}</p>
    {/if}

    {#if doc.snapshot?.shop?.footer}
      <footer class="mt-6 border-t border-slate-300 pt-3 text-xs">{doc.snapshot.shop.footer}</footer>
    {/if}
  </article>
{/if}

<style>
  /* Isolation so only the document prints (shell still in DOM). */
  @media print {
    @page {
      margin: 12mm;
    }
    :global(body *) {
      visibility: hidden !important;
    }
    .print-doc,
    .print-doc * {
      visibility: visible !important;
    }
    .print-doc {
      position: absolute;
      inset: 0;
      width: 100%;
      max-width: none !important;
      margin: 0;
      padding: 0;
    }
    .print-doc.print-80 {
      max-width: 80mm !important;
    }
    .print-doc.print-58 {
      max-width: 58mm !important;
    }
  }
</style>
