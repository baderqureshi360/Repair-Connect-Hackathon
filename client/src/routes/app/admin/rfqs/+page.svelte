<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { selectedShopId } from '$lib/stores/shopContext';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

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
      const market = await api<{ items: any[] }>(
        `/api/v1/marketplace/suppliers?city=&limit=100`.replace('city=&', '')
      ).catch(() => ({ items: [] }));
      // Prefer marketplace list with shop default city
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

<section class="space-y-4">
  <header class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h1 class="text-2xl font-semibold">{$t('rfqs')}</h1>
      <p class="text-sm text-muted">Request quotations from approved suppliers</p>
    </div>
    <Button variant="primary" onclick={() => (showCreate = !showCreate)}>New RFQ</Button>
  </header>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if showCreate}
    <form class="space-y-3 rounded-lg border border-border p-4" onsubmit={createRfq}>
      <label class="block text-sm">Title<input class="input-field mt-1 w-full" required bind:value={form.title} /></label>
      <label class="block text-sm">Requirements<textarea class="input-field mt-1 w-full" rows="2" bind:value={form.additionalRequirements}></textarea></label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-sm">Required delivery<input type="date" class="input-field mt-1 w-full" bind:value={form.requiredDeliveryDate} /></label>
        <label class="text-sm">Expires<input type="date" class="input-field mt-1 w-full" bind:value={form.expiresAt} /></label>
      </div>
      <fieldset>
        <legend class="text-sm font-medium">Suppliers</legend>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each suppliers as s}
            <label class="inline-flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
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
        <label class="text-sm sm:col-span-2">Item name<input class="input-field mt-1 w-full" required bind:value={form.itemName} /></label>
        <label class="text-sm">Qty<input type="number" min="1" class="input-field mt-1 w-full" bind:value={form.itemQty} /></label>
      </div>
      <label class="block text-sm">Specifications<textarea class="input-field mt-1 w-full" rows="2" bind:value={form.itemSpecs}></textarea></label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.send} /> Send immediately</label>
      <Button type="submit" variant="primary">{$t('requestQuote')}</Button>
    </form>
  {/if}

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if !rfqs.length}
    <p class="text-muted">{$t('noRfqs')}</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-elevated text-muted">
          <tr>
            <th class="px-3 py-2">{$t('rfqReference')}</th>
            <th class="px-3 py-2">Title</th>
            <th class="px-3 py-2">Status</th>
            <th class="px-3 py-2">Suppliers</th>
          </tr>
        </thead>
        <tbody>
          {#each rfqs as rfq}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                <a class="text-accent underline" href={`/app/admin/rfqs/${rfq.publicId}`}>{rfq.publicId}</a>
              </td>
              <td class="px-3 py-2">{rfq.title}</td>
              <td class="px-3 py-2 capitalize">{rfq.status.replaceAll('_', ' ')}</td>
              <td class="px-3 py-2">{(rfq.supplierBusinessIds || []).length}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
