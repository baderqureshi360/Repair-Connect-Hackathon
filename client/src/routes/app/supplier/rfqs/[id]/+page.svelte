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
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';

  let detail = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  let okMsg = $state('');
  let lines = $state<any[]>([]);
  let deliveryCharges = $state(0);
  let taxPercent = $state(0);
  let warranty = $state('');
  let validityUntil = $state('');
  let notes = $state('');
  let quoteBaseline = $state('');

  const id = $derived($page.params.id);
  const quoteDirty = $derived(
    !loading &&
      quoteBaseline !== '' &&
      JSON.stringify({ lines, deliveryCharges, taxPercent, warranty, validityUntil, notes }) !==
        quoteBaseline
  );

  async function load() {
    loading = true;
    error = '';
    try {
      detail = await api(`/api/v1/supplier-network/rfqs/${id}`);
      lines = (detail.items || []).map((item: any) => ({
        rfqLineId: item.lineId,
        name: item.name,
        requestedQty: item.quantity,
        specifications: item.specifications || item.notes || '',
        unitPrice: 0,
        availableQuantity: item.quantity,
        quotedQuantity: item.quantity,
        moq: 1,
        unavailable: false,
        isAlternative: false,
        alternativeName: '',
        warranty: ''
      }));
      if (detail.myQuotation) {
        deliveryCharges = detail.myQuotation.deliveryCharges || 0;
        warranty = detail.myQuotation.lines?.[0]?.warranty || '';
        for (const ql of detail.myQuotation.lines || []) {
          const row = lines.find((l) => l.rfqLineId === ql.rfqLineId);
          if (row) {
            row.unitPrice = ql.unitPrice;
            row.availableQuantity = ql.availableQuantity;
            row.quotedQuantity = ql.quotedQuantity;
            row.moq = ql.moq;
            row.unavailable = ql.unavailable;
            row.isAlternative = ql.isAlternative;
            row.alternativeName = ql.alternativeName;
            row.warranty = ql.warranty;
          }
        }
      }
      quoteBaseline = JSON.stringify({
        lines,
        deliveryCharges,
        taxPercent,
        warranty,
        validityUntil,
        notes
      });
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function submit() {
    error = '';
    try {
      await api(`/api/v1/supplier-network/rfqs/${id}/quotations`, {
        method: 'POST',
        body: JSON.stringify({
          lines: lines.map((l) => ({
            rfqLineId: l.rfqLineId,
            unitPrice: Number(l.unitPrice),
            availableQuantity: Number(l.availableQuantity),
            quotedQuantity: Number(l.quotedQuantity),
            moq: Number(l.moq),
            unavailable: Boolean(l.unavailable),
            isAlternative: Boolean(l.isAlternative),
            alternativeName: l.alternativeName,
            warranty: l.warranty
          })),
          deliveryCharges: Number(deliveryCharges),
          taxPercent: Number(taxPercent),
          warranty,
          validityUntil: validityUntil || undefined,
          notes
        })
      });
      okMsg = 'Quotation submitted.';
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function withdraw() {
    const reason = prompt('Withdrawal reason (min 5 chars)') || '';
    if (reason.trim().length < 5 || !detail?.myQuotation?.id) return;
    try {
      await api(`/api/v1/supplier-network/quotations/${detail.myQuotation.id}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      okMsg = 'Quotation withdrawn.';
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <UnsavedChangesGuard dirty={quoteDirty} />
  <Button variant="outline" size="sm" onclick={() => goto('/app/supplier/rfqs')}>← {$t('rfqs')}</Button>
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  {#if loading}
    <div class="space-y-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-20" />{/each}
    </div>
  {:else if detail}
    <PageHeader title={detail.title} subtitle={`${detail.publicId}`}>
      <StatusPill status={detail.status} />
      {#if detail.myQuotation}
        <StatusPill status={detail.myQuotation.status} />
      {/if}
    </PageHeader>

    {#if detail.additionalRequirements}
      <div class="surface-card p-4">
        <h2 class="mb-2 text-sm font-semibold text-ink">Requirements</h2>
        <p class="whitespace-pre-wrap text-sm text-muted">{detail.additionalRequirements}</p>
      </div>
    {/if}

    <div class="space-y-3">
      {#each lines as line}
        <fieldset class="surface-card p-4">
          <legend class="px-1 text-sm font-semibold text-ink">
            {line.name}
            <span class="font-normal text-muted">(req {line.requestedQty})</span>
          </legend>
          {#if line.specifications}
            <p class="mb-2 text-xs text-muted">{line.specifications}</p>
          {/if}
          <div class="grid gap-2 sm:grid-cols-4">
            <label class="text-sm">Unit price<input type="number" min="0" class="input-field mt-1 w-full" bind:value={line.unitPrice} /></label>
            <label class="text-sm">Quoted qty<input type="number" min="0" class="input-field mt-1 w-full" bind:value={line.quotedQuantity} /></label>
            <label class="text-sm">Available<input type="number" min="0" class="input-field mt-1 w-full" bind:value={line.availableQuantity} /></label>
            <label class="text-sm">{$t('minOrderQty')}<input type="number" min="1" class="input-field mt-1 w-full" bind:value={line.moq} /></label>
          </div>
          <div class="mt-2 flex flex-wrap gap-4 text-sm">
            <label class="inline-flex items-center gap-2"><input type="checkbox" bind:checked={line.unavailable} /> Unavailable</label>
            <label class="inline-flex items-center gap-2"><input type="checkbox" bind:checked={line.isAlternative} /> Alternative</label>
          </div>
          {#if line.isAlternative}
            <label class="mt-2 block text-sm">Alternative name<input class="input-field mt-1 w-full" bind:value={line.alternativeName} /></label>
          {/if}
          <label class="mt-2 block text-sm">{$t('warranty')}<input class="input-field mt-1 w-full" bind:value={line.warranty} /></label>
        </fieldset>
      {/each}
    </div>

    <div class="surface-card grid gap-3 p-4 sm:grid-cols-3">
      <label class="text-sm">Delivery charges<input type="number" min="0" class="input-field mt-1 w-full" bind:value={deliveryCharges} /></label>
      <label class="text-sm">Tax %<input type="number" min="0" max="100" class="input-field mt-1 w-full" bind:value={taxPercent} /></label>
      <label class="text-sm">Valid until<input type="date" class="input-field mt-1 w-full" bind:value={validityUntil} /></label>
      <label class="block text-sm sm:col-span-3">Notes<textarea class="input-field mt-1 w-full" rows="2" bind:value={notes}></textarea></label>
    </div>

    <div class="flex flex-wrap gap-2">
      {#if !['completed', 'cancelled', 'expired'].includes(detail.status)}
        <Button variant="primary" onclick={submit}>{$t('submitQuotation')}</Button>
      {/if}
      {#if detail.myQuotation && ['submitted', 'revised'].includes(detail.myQuotation.status)}
        <Button variant="outline" onclick={withdraw}>{$t('withdrawQuotation')}</Button>
      {/if}
      <Button href="/app/supplier/messages" variant="outline">{$t('messages')}</Button>
    </div>

    {#if detail.myQuotation}
      <p class="text-sm text-muted">
        Current quote {detail.myQuotation.publicId}: {detail.myQuotation.currency}
        {detail.myQuotation.totalAmount} ({detail.myQuotation.status})
      </p>
    {/if}
  {/if}
</section>
