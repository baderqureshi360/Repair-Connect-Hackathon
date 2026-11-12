<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let data = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  let okMsg = $state('');
  let selectedQuoteId = $state('');

  const id = $derived($page.params.id);

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api(`/api/v1/supplier-network/rfqs/${id}/compare`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function accept() {
    if (!selectedQuoteId) {
      error = 'Select a quotation first. Lowest price is not auto-selected.';
      return;
    }
    if (!confirm('Accept the selected quotation? This cannot be undone.')) return;
    try {
      await api(`/api/v1/supplier-network/rfqs/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ quotationId: selectedQuoteId })
      });
      okMsg = 'Quotation accepted.';
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="space-y-4">
  <button type="button" class="text-sm text-accent underline" onclick={() => goto(`/app/admin/rfqs/${id}`)}>
    ← RFQ
  </button>
  <h1 class="text-2xl font-semibold">{$t('compareQuotations')}</h1>
  <p class="text-sm text-muted">Review each offer carefully. No quotation is auto-selected by price.</p>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if data}
    <p class="text-sm text-muted" role="note">{data.note}</p>

    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-elevated text-muted">
          <tr>
            <th class="px-3 py-2">Supplier</th>
            <th class="px-3 py-2">Subtotal</th>
            <th class="px-3 py-2">Delivery</th>
            <th class="px-3 py-2">Tax</th>
            <th class="px-3 py-2">Total</th>
            <th class="px-3 py-2">ETA / Warranty</th>
            <th class="px-3 py-2">Select</th>
          </tr>
        </thead>
        <tbody>
          {#each data.columns || [] as col}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                {col.supplier?.businessName || '—'}
                <div class="text-xs text-muted">{col.publicId} · rev {col.revision}</div>
              </td>
              <td class="px-3 py-2">{col.currency} {col.subtotal}</td>
              <td class="px-3 py-2">{col.deliveryCharges}</td>
              <td class="px-3 py-2">{col.taxAmount}</td>
              <td class="px-3 py-2 font-medium">{col.currency} {col.totalAmount}</td>
              <td class="px-3 py-2 text-xs">
                {col.estimatedDeliveryDate ? new Date(col.estimatedDeliveryDate).toLocaleDateString() : '—'}
                <br />{col.lines?.[0]?.warranty || '—'}
              </td>
              <td class="px-3 py-2">
                <input
                  type="radio"
                  name="selectedQuote"
                  value={col.id}
                  checked={selectedQuoteId === col.id}
                  onchange={() => (selectedQuoteId = col.id)}
                  aria-label={`Select ${col.supplier?.businessName || col.publicId}`}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <h2 class="text-lg font-semibold">Line comparison</h2>
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-elevated text-muted">
          <tr>
            <th class="px-3 py-2">Item</th>
            {#each data.columns || [] as col}
              <th class="px-3 py-2">{col.supplier?.businessName || col.publicId}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each data.itemMatrix || [] as row}
            <tr class="border-t border-border">
              <td class="px-3 py-2">{row.name} × {row.requestedQuantity}</td>
              {#each row.quotes as q}
                <td class="px-3 py-2 {q.unavailable || q.missing ? 'text-danger' : ''}">
                  {#if q.missing || q.unavailable}
                    Unavailable
                  {:else}
                    {q.unitPrice} × {q.quotedQuantity} = {q.lineTotal}
                    {#if q.isAlternative}
                      <div class="text-xs">Alt: {q.alternativeName}</div>
                    {/if}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if data.rfq?.status !== 'completed'}
      <Button variant="primary" onclick={accept}>{$t('acceptQuotation')}</Button>
    {/if}
  {/if}
</section>
