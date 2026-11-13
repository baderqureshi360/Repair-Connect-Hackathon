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

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}
  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 3 }) as _}<Skeleton class="h-12" />{/each}
    </div>
  {:else if detail}
    <PageHeader
      title={detail.title}
      subtitle={detail.publicId}
      breadcrumbs={[
        { label: $t('home'), href: '/app/admin' },
        { label: $t('rfqs'), href: '/app/admin/rfqs' },
        { label: detail.publicId }
      ]}
    >
      <StatusPill status={detail.status} />
      {#if detail.status === 'draft'}
        <Button variant="primary" size="sm" onclick={send}>Send RFQ</Button>
      {/if}
      {#if ['sent', 'partially_responded'].includes(detail.status)}
        <Button variant="primary" size="sm" href={`/app/admin/rfqs/${detail.publicId}/compare`}>{$t('compareQuotations')}</Button>
      {/if}
      {#if detail.status === 'completed'}
        <Button
          variant="primary"
          size="sm"
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
        <Button variant="outline" size="sm" onclick={cancel}>{$t('cancel')}</Button>
      {/if}
    </PageHeader>

    <p class="surface-card p-4 text-sm whitespace-pre-wrap text-muted">{detail.additionalRequirements || '—'}</p>

    <div class="data-table-shell">
      <table class="min-w-full text-start text-sm">
        <caption class="sr-only">RFQ items</caption>
        <thead class="border-b border-border text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">Item</th>
            <th class="px-3 py-2" scope="col">Qty</th>
            <th class="px-3 py-2" scope="col">Specs</th>
          </tr>
        </thead>
        <tbody>
          {#each detail.items || [] as item}
            <tr class="border-t border-border">
              <td class="px-3 py-2">{item.name}</td>
              <td class="px-3 py-2 tabular-nums">{item.quantity}</td>
              <td class="px-3 py-2">{item.specifications || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <section class="surface-card space-y-2 p-4">
      <h2 class="text-sm font-semibold text-ink">Quotations</h2>
      {#if !(detail.quotations || []).length}
        <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
          No quotations yet.
        </p>
      {:else}
        <ul class="space-y-2" role="list">
          {#each detail.quotations as q}
            <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2.5 text-sm">
              {q.publicId} · {q.status} · {q.currency} {q.totalAmount}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>
