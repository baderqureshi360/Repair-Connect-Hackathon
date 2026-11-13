<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      rows = await api('/api/v1/supplier-network/purchase-orders');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    if ($user && $user.role !== 'shop_admin' && $user.role !== 'parts_coordinator') {
      const dest =
        $user.role === 'mechanic'
          ? '/app/mechanic'
          : $user.role === 'supplier'
            ? '/app/supplier'
            : '/app/customer';
      await goto(dest);
      return;
    }
    await load();
  });

  const homeHref = $derived($user?.role === 'parts_coordinator' ? '/app/parts' : '/app/admin');
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('purchaseOrders')}
    subtitle={$t('purchaseOrdersSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: homeHref }, { label: $t('purchaseOrders') }]}
  >
    {#if $user?.role === 'shop_admin'}
      <Button href="/app/admin/rfqs" variant="outline" size="sm">{$t('rfqs')}</Button>
    {:else}
      <Button href="/app/parts/suppliers" variant="outline" size="sm">{$t('suppliers')}</Button>
    {/if}
  </PageHeader>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-12" />{/each}
    </div>
  {:else if !rows.length}
    <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-8 text-center text-sm text-muted" role="status">
      {$t('noPurchaseOrders')}
    </p>
  {:else}
    <div class="data-table-shell">
      <table class="min-w-full text-start text-sm">
        <caption class="sr-only">{$t('purchaseOrders')}</caption>
        <thead class="border-b border-border text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">PO</th>
            <th class="px-3 py-2" scope="col">Status</th>
            <th class="px-3 py-2" scope="col">Total</th>
            <th class="px-3 py-2" scope="col">Expected</th>
            <th class="px-3 py-2" scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as po}
            <tr class="border-t border-border">
              <td class="px-3 py-2 font-medium text-ink">{po.publicId}</td>
              <td class="px-3 py-2"><StatusPill status={po.status} /></td>
              <td class="px-3 py-2 tabular-nums">{po.grandTotal} {po.currency}</td>
              <td class="px-3 py-2 text-muted">
                {po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : '—'}
              </td>
              <td class="px-3 py-2">
                <Button size="sm" variant="outline" href={`/app/admin/purchase-orders/${po.publicId}`}>
                  Open
                </Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
