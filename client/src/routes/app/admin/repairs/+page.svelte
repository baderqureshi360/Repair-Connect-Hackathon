<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import StatusPill from '$lib/components/StatusPill.svelte';

  type FilterKey =
    | 'all'
    | 'awaiting_customer'
    | 'in_progress'
    | 'awaiting_parts'
    | 'completed_work'
    | 'ready_for_collection'
    | 'closed'
    | 'unpaid'
    | 'partially_paid'
    | 'paid';

  let repairs = $state<any[]>([]);
  let filter = $state<FilterKey>('all');
  let loading = $state(true);

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'awaiting_customer', label: 'Awaiting customer response' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'awaiting_parts', label: 'Awaiting parts' },
    { key: 'completed_work', label: 'Completed' },
    { key: 'ready_for_collection', label: 'Ready for collection' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'partially_paid', label: 'Partially paid' },
    { key: 'paid', label: 'Paid' },
    { key: 'closed', label: 'Closed' }
  ];

  async function load() {
    loading = true;
    try {
      const statusParam =
        filter === 'awaiting_customer'
          ? 'estimate_pending'
          : filter === 'in_progress'
            ? 'in_progress'
            : filter === 'awaiting_parts'
              ? 'awaiting_parts'
              : filter === 'ready_for_collection' ||
                  filter === 'completed_work' ||
                  filter === 'unpaid' ||
                  filter === 'partially_paid' ||
                  filter === 'paid'
                ? 'ready_for_collection'
                : filter === 'closed'
                  ? 'completed'
                  : undefined;
      const needsPay = ['unpaid', 'partially_paid', 'paid', 'completed_work'].includes(filter);
      const qs = new URLSearchParams({ limit: '50' });
      if (statusParam) qs.set('status', statusParam);
      if (needsPay || filter === 'all') qs.set('includePayments', '1');
      const res = await api<{ data: any[] }>(`/api/v1/repairs?${qs}`, { full: true });
      let rows = res.data || [];

      if (filter === 'unpaid') {
        rows = rows.filter((r) => r.paymentSummary?.status === 'unpaid');
      } else if (filter === 'partially_paid') {
        rows = rows.filter((r) => r.paymentSummary?.status === 'partially_paid');
      } else if (filter === 'paid') {
        rows = rows.filter((r) => r.paymentSummary?.status === 'paid');
      } else if (filter === 'completed_work') {
        rows = rows.filter((r) => r.status === 'ready_for_collection' && r.workCompletedAt);
      }
      repairs = rows;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function setFilter(next: FilterKey) {
    filter = next;
    void load();
  }
</script>

<section class="space-y-4">
  <h1 class="text-2xl font-semibold">{$t('repairs')}</h1>

  <div class="flex flex-wrap gap-2" role="tablist" aria-label="Repair filters">
    {#each filters as f}
      <button
        type="button"
        role="tab"
        aria-selected={filter === f.key}
        class={`rounded-md px-3 py-1.5 text-sm ${filter === f.key ? 'bg-accent text-white' : 'border border-border'}`}
        onclick={() => setFilter(f.key)}
      >
        {f.label}
      </button>
    {/each}
  </div>

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else}
    <ul class="space-y-2">
      {#each repairs as repair}
        <li class="rounded-lg border border-border bg-surface-elevated p-3">
          <div class="flex justify-between gap-3">
            <a class="underline" href={`/app/repairs/${repair._id}`}>{repair.referenceNumber}</a>
            <StatusPill status={repair.status} />
          </div>
          <p class="text-sm text-muted">
            {repair.customer?.name || '—'} · {repair.brand} {repair.model}
            {#if repair.paymentSummary}
              · {String(repair.paymentSummary.status || '').replaceAll('_', ' ')}
              ({repair.paymentSummary.outstanding} PKR due)
            {/if}
          </p>
        </li>
      {:else}
        <li class="text-muted">{$t('empty')}</li>
      {/each}
    </ul>
  {/if}
</section>
