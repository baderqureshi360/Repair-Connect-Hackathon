<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { selectedShopId } from '$lib/stores/shopContext';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let rfqs = $state<any[]>([]);
  let suppliers = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let showCreate = $state(false);
  let form = $state({
    title: '',
    additionalRequirements: '',
    requiredDeliveryDate: '',
    expiresAt: '',
    supplierBusinessIds: [] as string[],
    itemName: '',
    itemQty: 1,
    itemSpecs: '',
    send: true
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const shopId = $selectedShopId || '';
      rfqs = (await api(`/api/v1/supplier-network/rfqs?shopId=${shopId}`)) || [];
      const meta = await api<{ defaultCity?: string }>('/api/v1/marketplace/suppliers/meta').catch(() => ({}));
      const city = (meta as any).defaultCity || '';
      const list = await api<{ items: any[] }>(
        `/api/v1/marketplace/suppliers?${city ? `city=${encodeURIComponent(city)}` : ''}`
      );
      suppliers = list.items || [];
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  function toggleSupplier(id: string) {
    form.supplierBusinessIds = form.supplierBusinessIds.includes(id)
      ? form.supplierBusinessIds.filter((x) => x !== id)
      : [...form.supplierBusinessIds, id];
  }

  async function createRfq(e: Event) {
    e.preventDefault();
    error = '';
    try {
      const created = await api<any>('/api/v1/supplier-network/rfqs', {
        method: 'POST',
        body: JSON.stringify({
          shopId: $selectedShopId,
          title: form.title,
          additionalRequirements: form.additionalRequirements,
          requiredDeliveryDate: form.requiredDeliveryDate || undefined,
          expiresAt: form.expiresAt || undefined,
          supplierBusinessIds: form.supplierBusinessIds,
          items: [
            {
              name: form.itemName,
              quantity: Number(form.itemQty),
              specifications: form.itemSpecs
            }
          ],
          send: form.send
        })
      });
      showCreate = false;
      await goto(`/app/admin/rfqs/${created.publicId || created.id}`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  onMount(load);
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('rfqs')}
    subtitle="Request quotations from approved suppliers"
    breadcrumbs={[{ label: $t('home'), href: '/app/admin' }, { label: $t('rfqs') }]}
  >
    <Button variant="primary" size="sm" onclick={() => (showCreate = !showCreate)}>
      {showCreate ? $t('cancel') : $t('requestQuote')}
    </Button>
  </PageHeader>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if showCreate}
    <form class="surface-card space-y-4 p-4 md:p-5" onsubmit={createRfq}>
      <div>
        <label class="field-label" for="rfq-title">Title</label>
        <input id="rfq-title" class="input-field" required bind:value={form.title} />
      </div>
      <div>
        <label class="field-label" for="rfq-req">Requirements</label>
        <textarea id="rfq-req" class="input-field min-h-[4.5rem]" rows="2" bind:value={form.additionalRequirements}></textarea>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="field-label" for="rfq-delivery">Required delivery</label>
          <input id="rfq-delivery" type="date" class="input-field" bind:value={form.requiredDeliveryDate} />
        </div>
        <div>
          <label class="field-label" for="rfq-expires">Expires</label>
          <input id="rfq-expires" type="date" class="input-field" bind:value={form.expiresAt} />
        </div>
      </div>
      <fieldset>
        <legend class="field-label">Suppliers</legend>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each suppliers as s}
            <label class="inline-flex items-center gap-2 rounded-[var(--radius-ui)] border border-border bg-surface px-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.supplierBusinessIds.includes(s.id)}
                onchange={() => toggleSupplier(s.id)}
              />
              {s.businessName}
            </label>
          {/each}
        </div>
      </fieldset>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="sm:col-span-2">
          <label class="field-label" for="rfq-item">Item name</label>
          <input id="rfq-item" class="input-field" required bind:value={form.itemName} />
        </div>
        <div>
          <label class="field-label" for="rfq-qty">Qty</label>
          <input id="rfq-qty" type="number" min="1" class="input-field" bind:value={form.itemQty} />
        </div>
      </div>
      <div>
        <label class="field-label" for="rfq-specs">Specifications</label>
        <textarea id="rfq-specs" class="input-field min-h-[4.5rem]" rows="2" bind:value={form.itemSpecs}></textarea>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={form.send} />
        Send immediately
      </label>
      <Button type="submit" variant="primary">{$t('requestQuote')}</Button>
    </form>
  {/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-12" />{/each}
    </div>
  {:else if !rfqs.length}
    <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-8 text-center text-sm text-muted" role="status">
      {$t('noRfqs')}
    </p>
  {:else}
    <div class="data-table-shell">
      <table class="min-w-full text-start text-sm">
        <caption class="sr-only">{$t('rfqs')}</caption>
        <thead class="border-b border-border text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">{$t('rfqReference')}</th>
            <th class="px-3 py-2" scope="col">Title</th>
            <th class="px-3 py-2" scope="col">Status</th>
            <th class="px-3 py-2" scope="col">Suppliers</th>
          </tr>
        </thead>
        <tbody>
          {#each rfqs as rfq}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                <a class="font-medium hover:underline" href={`/app/admin/rfqs/${rfq.publicId}`}>{rfq.publicId}</a>
              </td>
              <td class="px-3 py-2">{rfq.title}</td>
              <td class="px-3 py-2"><StatusPill status={rfq.status} /></td>
              <td class="px-3 py-2 tabular-nums">{(rfq.supplierBusinessIds || []).length}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
