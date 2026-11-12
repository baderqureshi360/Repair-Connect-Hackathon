<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let detail = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  let okMsg = $state('');

  const id = $derived($page.params.id);

  async function load() {
    loading = true;
    error = '';
    try {
      detail = await api(`/api/v1/supplier-network/rfqs/${id}`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function send() {
    if (!confirm('Send this RFQ to selected suppliers?')) return;
    try {
      detail = await api(`/api/v1/supplier-network/rfqs/${id}/send`, { method: 'POST' });
      okMsg = 'RFQ sent.';
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function cancel() {
    const reason = prompt('Cancellation reason (min 5 chars)') || '';
    if (reason.trim().length < 5) return;
    try {
      await api(`/api/v1/supplier-network/rfqs/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="space-y-4">
  <button type="button" class="text-sm text-accent underline" onclick={() => goto('/app/admin/rfqs')}>← {$t('rfqs')}</button>
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}
  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if detail}
    <header class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">{detail.title}</h1>
        <p class="text-sm text-muted">{detail.publicId} · <span class="capitalize">{detail.status.replaceAll('_', ' ')}</span></p>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if detail.status === 'draft'}
          <Button variant="primary" onclick={send}>Send RFQ</Button>
        {/if}
        {#if ['sent', 'partially_responded'].includes(detail.status)}
          <Button variant="primary" href={`/app/admin/rfqs/${detail.publicId}/compare`}>{$t('compareQuotations')}</Button>
        {/if}
        {#if detail.status === 'completed'}
          <Button
            variant="primary"
            onclick={async () => {
              try {
                const po = await api<{ publicId: string }>('/api/v1/supplier-network/purchase-orders', {
                  method: 'POST',
                  body: JSON.stringify({ rfqId: detail.publicId, issue: true })
                });
                goto(`/app/admin/purchase-orders/${po.publicId}`);
              } catch (err) {
                error = err instanceof ApiError ? err.message : $t('errorGeneric');
              }
            }}
          >
            {$t('createPurchaseOrder')}
          </Button>
        {/if}
        {#if !['completed', 'cancelled', 'expired'].includes(detail.status)}
          <Button variant="outline" onclick={cancel}>Cancel</Button>
        {/if}
      </div>
    </header>

    <p class="text-sm whitespace-pre-wrap">{detail.additionalRequirements || '—'}</p>

    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-elevated text-muted">
          <tr>
            <th class="px-3 py-2">Item</th>
            <th class="px-3 py-2">Qty</th>
            <th class="px-3 py-2">Specs</th>
          </tr>
        </thead>
        <tbody>
          {#each detail.items || [] as item}
            <tr class="border-t border-border">
              <td class="px-3 py-2">{item.name}</td>
              <td class="px-3 py-2">{item.quantity}</td>
              <td class="px-3 py-2">{item.specifications || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <section>
      <h2 class="text-lg font-semibold">Quotations</h2>
      {#if !(detail.quotations || []).length}
        <p class="text-sm text-muted">No quotations yet.</p>
      {:else}
        <ul class="mt-2 space-y-2">
          {#each detail.quotations as q}
            <li class="rounded border border-border px-3 py-2 text-sm">
              {q.publicId} · {q.status} · {q.currency} {q.totalAmount}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>
