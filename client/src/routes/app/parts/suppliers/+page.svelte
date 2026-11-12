<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';

  let suppliers = $state<any[]>([]);
  let restocks = $state<any[]>([]);
  let parts = $state<any[]>([]);
  let form = $state({ name: '', contactName: '', email: '', phone: '', address: '', notes: '' });
  let restock = $state({ partId: '', quantity: 1, supplierId: '', notes: '' });
  let saving = $state(false);
  let loading = $state(true);
  let error = $state('');

  const supplierFormDirty = $derived(
    Boolean(form.name.trim() || form.contactName.trim() || form.email.trim() || form.phone.trim())
  );

  const shopId = $derived((() => {
    const first = ($user?.shops?.[0] || null) as { id?: string; shop?: { _id?: string } } | null;
    return first?.shop?._id || first?.id || '';
  })());

  async function load() {
    loading = true;
    error = '';
    try {
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
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
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
      id: String(s._id || s.id || ''),
      name: s.name,
      contact: s.contactName || '—',
      phone: s.phone || '—',
      email: s.email || '—'
    }))
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <UnsavedChangesGuard dirty={supplierFormDirty} />
  <PageHeader
    title={$t('suppliers')}
    subtitle={$t('suppliersSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/parts' }, { label: $t('suppliers') }]}
  >
    <Button href="/app/admin/purchase-orders" size="sm" variant="outline">{$t('purchaseOrders')}</Button>
  </PageHeader>

  {#if loading}
    <div class="space-y-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      <Skeleton class="h-40" />
      <Skeleton class="h-48" />
    </div>
  {:else}
    {#if error}<Alert type="error" role="alert" message={error} />{/if}

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
      getRowLabel={(row) => String(row.name || 'Supplier')}
    />

    <div class="grid gap-4 lg:grid-cols-2">
      <form
        class="surface-card space-y-3 p-4"
        data-rc-save
        data-rc-submit
        onsubmit={(e) => {
          e.preventDefault();
          createSupplier();
        }}
      >
        <h2 class="text-sm font-semibold text-ink">{$t('suppliers')}</h2>
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
        <h2 class="text-sm font-semibold text-ink">{$t('restock')}</h2>
        <label class="block text-sm">
          <span class="mb-1 block text-muted">{$t('inventory')}</span>
          <select class="input-field" bind:value={restock.partId} required>
            {#each parts as part}
              <option value={part._id}>
                {part.sku} · {part.name} · {$t('available')} {part.quantityAvailable}
              </option>
            {/each}
          </select>
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-muted">{$t('supplier')}</span>
          <select class="input-field" bind:value={restock.supplierId}>
            <option value="">—</option>
            {#each suppliers as s}
              <option value={s._id}>{s.name}</option>
            {/each}
          </select>
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-muted">{$t('quantity')}</span>
          <input class="input-field" type="number" min="1" bind:value={restock.quantity} />
        </label>
        <Button type="submit" loading={saving} disabled={!parts.length}>{$t('submit')}</Button>
      </form>
    </div>

    <div class="surface-card p-4">
      <h2 class="mb-3 text-sm font-semibold text-ink">{$t('restock')}</h2>
      <ul class="space-y-2 text-sm" role="list">
        {#each restocks as item}
          <li class="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ui)] border border-border px-3 py-2">
            <span class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{item.part?.sku} × {item.quantity}</span>
              <StatusPill status={item.status} />
            </span>
            {#if item.status !== 'received' && item.status !== 'cancelled'}
              <Button size="sm" variant="secondary" onclick={() => receiveRestock(item._id)}>
                {$t('stockIn')}
              </Button>
            {/if}
          </li>
        {:else}
          <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-muted" role="status">
            {$t('empty')}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
