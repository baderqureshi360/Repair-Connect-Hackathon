<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Button from '$lib/components/Button.svelte';

  let rfqs = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let statusFilter = $state('all');

  onMount(async () => {
    try {
      rfqs = (await api('/api/v1/supplier-network/rfqs')) || [];
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  function quoteStatus(rfq: any) {
    return rfq.myQuotation?.status || rfq.quotation?.status || '';
  }

  const filtered = $derived(
    rfqs.filter((r) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'pending_quote') return !quoteStatus(r) && !['completed', 'cancelled', 'expired'].includes(r.status);
      if (statusFilter === 'awaiting') return ['submitted', 'revised', 'pending', 'sent'].includes(String(quoteStatus(r)).toLowerCase());
      if (statusFilter === 'accepted') return String(quoteStatus(r)).toLowerCase() === 'accepted';
      if (statusFilter === 'expired') return r.status === 'expired' || String(quoteStatus(r)).toLowerCase() === 'expired';
      return true;
    })
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('rfqs')} subtitle={$t('supplierRfqsSubtitle')} />

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  <div class="flex flex-wrap gap-2" role="group" aria-label={$t('rfqs')}>
    {#each [
      { id: 'all', label: $t('all') },
      { id: 'pending_quote', label: $t('pendingRfqs') },
      { id: 'awaiting', label: $t('quotationsAwaiting') },
      { id: 'accepted', label: $t('acceptedQuotations') },
      { id: 'expired', label: 'Expired' }
    ] as f}
      <Button
        size="sm"
        variant={statusFilter === f.id ? 'primary' : 'outline'}
        onclick={() => (statusFilter = f.id)}
      >
        {f.label}
      </Button>
    {/each}
  </div>

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-14" />{/each}
    </div>
  {:else if !filtered.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">{$t('noRfqs')}</div>
  {:else}
    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">{$t('rfqReference')}</th>
            <th class="px-3 py-2" scope="col">Title</th>
            <th class="px-3 py-2" scope="col">Status</th>
            <th class="px-3 py-2" scope="col">{$t('quotationStatus')}</th>
            <th class="px-3 py-2" scope="col">Items</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as rfq}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                <a class="font-medium text-accent underline" href={`/app/supplier/rfqs/${rfq.publicId}`}>
                  {rfq.publicId}
                </a>
              </td>
              <td class="px-3 py-2 text-ink">{rfq.title}</td>
              <td class="px-3 py-2"><StatusPill status={rfq.status} /></td>
              <td class="px-3 py-2">
                {#if quoteStatus(rfq)}
                  <StatusPill status={quoteStatus(rfq)} />
                {:else}
                  <span class="text-muted">—</span>
                {/if}
              </td>
              <td class="px-3 py-2 tabular-nums">{(rfq.items || []).length}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
