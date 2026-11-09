<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Alert from '$lib/components/Alert.svelte';

  let loading = $state(true);
  let error = $state('');
  let customers = $state<any[]>([]);

  onMount(async () => {
    try {
      const data = await api<any>('/api/v1/analytics/me?range=90d');
      customers = data.topCustomers || [];
      // Enrich with a fuller list via repairs if available
      const repairs = await api<{ data: any[] }>('/api/v1/repairs?limit=100', { full: true });
      const map = new Map<string, any>();
      for (const c of customers) map.set(c.id, { ...c });
      for (const r of repairs.data || []) {
        const id = String(r.customer?._id || r.customer || '');
        if (!id) continue;
        const existing = map.get(id) || {
          id,
          name: r.customer?.name || 'Customer',
          email: r.customer?.email || '',
          repairCount: 0,
          recordedSpend: 0
        };
        if (!customers.find((c) => c.id === id)) {
          existing.repairCount += 1;
        }
        map.set(id, existing);
      }
      customers = [...map.values()].sort((a, b) => (b.repairCount || 0) - (a.repairCount || 0));
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  const focus = $derived($page.url.searchParams.get('focus'));
</script>

<section>
  <PageHeader title={$t('customers')} subtitle={$t('customersSubtitle')} />

  {#if loading}
    <Skeleton lines={6} />
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else}
    <div class="overflow-x-auto rounded-xl border border-border bg-surface-elevated">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="border-b border-border text-start text-muted">
            <th scope="col" class="px-4 py-3 font-medium">{$t('name')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('email')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('repairs')}</th>
            <th scope="col" class="px-4 py-3 font-medium">{$t('recordedRevenue')}</th>
          </tr>
        </thead>
        <tbody>
          {#each customers as customer}
            <tr
              class={`border-b border-border last:border-0 ${focus === customer.id ? 'bg-accent-soft' : ''}`}
              id={`customer-${customer.id}`}
            >
              <td class="px-4 py-3 font-medium">{customer.name}</td>
              <td class="px-4 py-3 text-muted">{customer.email || '—'}</td>
              <td class="px-4 py-3 tabular-nums">{customer.repairCount || 0}</td>
              <td class="px-4 py-3 tabular-nums">{customer.recordedSpend || 0}</td>
            </tr>
          {:else}
            <tr>
              <td class="px-4 py-6 text-muted" colspan="4">{$t('empty')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
