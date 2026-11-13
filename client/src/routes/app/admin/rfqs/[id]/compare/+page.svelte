<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

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

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('compareQuotations')}
    subtitle="Review each offer carefully. No quotation is auto-selected by price."
    breadcrumbs={[
      { label: $t('home'), href: '/app/admin' },
      { label: $t('rfqs'), href: '/app/admin/rfqs' },
      { label: id || 'RFQ', href: `/app/admin/rfqs/${id}` },
      { label: $t('compareQuotations') }
    ]}
  />

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 3 }) as _}<Skeleton class="h-12" />{/each}
    </div>
  {:else if data}
    <p class="text-sm text-muted" role="note">{data.note}</p>

    <div class="data-table-shell">
      <table class="min-w-full text-start text-sm">
        <caption class="sr-only">{$t('compareQuotations')}</caption>
        <thead class="border-b border-border text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">Supplier</th>
            <th class="px-3 py-2" scope="col">Subtotal</th>
            <th class="px-3 py-2" scope="col">Delivery</th>
            <th class="px-3 py-2" scope="col">Tax</th>
            <th class="px-3 py-2" scope="col">Total</th>
            <th class="px-3 py-2" scope="col">ETA / Warranty</th>
            <th class="px-3 py-2" scope="col">Select</th>
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

    <h2 class="text-sm font-semibold text-ink">Line comparison</h2>
    <div class="data-table-shell">
      <table class="min-w-full text-start text-sm">
        <caption class="sr-only">Line comparison</caption>
        <thead class="border-b border-border text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">Item</th>
            {#each data.columns || [] as col}
              <th class="px-3 py-2" scope="col">{col.supplier?.businessName || col.publicId}</th>
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
