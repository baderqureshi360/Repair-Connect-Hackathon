<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import DataTable from '$lib/components/DataTable.svelte';

  let suppliers = $state<any[]>([]);
  let restocks = $state<any[]>([]);
  let parts = $state<any[]>([]);
  let form = $state({ name: '', contactName: '', email: '', phone: '', address: '', notes: '' });
  let restock = $state({ partId: '', quantity: 1, supplierId: '', notes: '' });
  let saving = $state(false);

  const shopId = $derived((() => {
    const first = ($user?.shops?.[0] || null) as { id?: string; shop?: { _id?: string } } | null;
    return first?.shop?._id || first?.id || '';
  })());

  async function load() {
    const sid = shopId || undefined;
    const q = sid ? `?shopId=${sid}` : '';
    const [s, r, p] = await Promise.all([
      api<any[]>(`/api/v1/suppliers${q}`),
      api<any[]>(`/api/v1/suppliers/restock-requests${q}`),
      api<{ data: any[] }>(`/api/v1/parts${q}`, { full: true })
    ]);
    suppliers = s || [];
    restocks = r || [];
    parts = p.data || [];
    if (!restock.partId && parts[0]) restock.partId = parts[0]._id;
    if (!restock.supplierId && suppliers[0]) restock.supplierId = suppliers[0]._id;
  }

  onMount(() => {
    load().catch((err) => toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric')));
  });

  async function createSupplier() {
    saving = true;
    try {
      await api('/api/v1/suppliers', {
        method: 'POST',
        body: JSON.stringify({ ...form, shopId: shopId || parts[0]?.shop })
      });
      form = { name: '', contactName: '', email: '', phone: '', address: '', notes: '' };
      toasts.success($t('success'));
      await load();
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    } finally {
      saving = false;
    }
  }

  async function createRestock() {
    saving = true;
    try {
      await api('/api/v1/suppliers/restock-requests', {
        method: 'POST',
        body: JSON.stringify({
          partId: restock.partId,
          quantity: Number(restock.quantity),
          supplierId: restock.supplierId || undefined,
          notes: restock.notes
        })
      });
      toasts.success($t('success'));
      await load();
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    } finally {
      saving = false;
    }
  }

  async function receiveRestock(id: string) {
    try {
      await api(`/api/v1/suppliers/restock-requests/${id}/receive`, { method: 'POST', body: '{}' });
      toasts.success($t('success'));
      await load();
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  const supplierRows = $derived(
    suppliers.map((s) => ({
      name: s.name,
      contact: s.contactName || '—',
      phone: s.phone || '—',
      email: s.email || '—'
    }))
  );
</script>

<section class="space-y-6">
  <PageHeader title={$t('suppliers')} subtitle={$t('restock')} />

  <DataTable
    caption={$t('suppliers')}
    columns={[
      { key: 'name', label: $t('name'), sortable: true },
      { key: 'contact', label: 'Contact', sortable: true },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: $t('email') }
    ]}
    rows={supplierRows}
    empty={$t('empty')}
  />

  <div class="grid gap-4 lg:grid-cols-2">
    <form
      class="surface-card space-y-3 p-4"
      onsubmit={(e) => {
        e.preventDefault();
        createSupplier();
      }}
    >
      <h2 class="font-semibold">{$t('suppliers')}</h2>
      <input class="input-field" placeholder={$t('name')} required bind:value={form.name} />
      <input class="input-field" placeholder="Contact" bind:value={form.contactName} />
      <input class="input-field" placeholder={$t('email')} bind:value={form.email} />
      <input class="input-field" placeholder="Phone" bind:value={form.phone} />
      <Button type="submit" loading={saving}>{$t('save')}</Button>
    </form>

    <form
      class="surface-card space-y-3 p-4"
      onsubmit={(e) => {
        e.preventDefault();
        createRestock();
      }}
    >
      <h2 class="font-semibold">{$t('restock')}</h2>
      <select class="input-field" bind:value={restock.partId} required>
        {#each parts as part}
          <option value={part._id}>{part.sku} · {part.name}</option>
        {/each}
      </select>
      <select class="input-field" bind:value={restock.supplierId}>
        <option value="">—</option>
        {#each suppliers as s}
          <option value={s._id}>{s.name}</option>
        {/each}
      </select>
      <input class="input-field" type="number" min="1" bind:value={restock.quantity} />
      <Button type="submit" loading={saving}>{$t('submit')}</Button>
    </form>
  </div>

  <div class="surface-card p-4">
    <h2 class="mb-3 font-semibold">{$t('restock')}</h2>
    <ul class="space-y-2 text-sm">
      {#each restocks as item}
        <li class="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2">
          <span>{item.part?.sku} × {item.quantity} · {item.status}</span>
          {#if item.status !== 'received' && item.status !== 'cancelled'}
            <Button size="sm" variant="secondary" onclick={() => receiveRestock(item._id)}>
              {$t('stockIn')}
            </Button>
          {/if}
        </li>
      {:else}
        <li class="text-muted">{$t('empty')}</li>
      {/each}
    </ul>
  </div>
</section>
