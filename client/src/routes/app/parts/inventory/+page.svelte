<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { selectedShopId, shopQuery } from '$lib/stores/shopContext';
  import Alert from '$lib/components/Alert.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let parts = $state<any[]>([]);
  let movements = $state<any[]>([]);
  let pendingRequests = $state(0);
  let error = $state('');
  let message = $state('');
  let loading = $state(true);
  let showCreate = $state(false);
  let showStock = $state(false);
  let showAdjust = $state(false);
  let showEdit = $state(false);
  let showMovements = $state(false);
  let selectedId = $state('');
  let stockQty = $state(1);
  let adjustDelta = $state(0);
  let adjustReason = $state('');
  let search = $state('');
  let stockFilter = $state<'all' | 'low' | 'out' | 'ok'>('all');
  let category = $state('');

  let form = $state({
    sku: '',
    name: '',
    category: 'general',
    unitCost: 0,
    quantityAvailable: 0,
    reorderLevel: 2,
    supplier: ''
  });

  let editForm = $state<any>({});

  async function load() {
    loading = true;
    error = '';
    try {
      const qShop = $page.url.searchParams.get('shopId');
      if (qShop) selectedShopId.set(qShop);
      const q = shopQuery('limit=200');
      const [res, mov, reqs] = await Promise.all([
        api<{ data: any[] }>(`/api/v1/parts${q}`, { full: true }),
        api<any[]>(`/api/v1/parts/movements${shopQuery('limit=40')}`).catch(() => []),
        api<any[]>('/api/v1/parts/requests/incoming').catch(() => [])
      ]);
      parts = res.data || [];
      movements = Array.isArray(mov) ? mov : (mov as any)?.data || [];
      pendingRequests = (reqs || []).filter((r: any) =>
        ['pending', 'partially_fulfilled'].includes(r.status)
      ).length;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const filtered = $derived(
    parts.filter((p) => {
      const q = search.trim().toLowerCase();
      if (q && !`${p.sku} ${p.name}`.toLowerCase().includes(q)) return false;
      if (category && p.category !== category) return false;
      if (stockFilter === 'low' && !(p.quantityAvailable <= p.reorderLevel && p.quantityAvailable > 0))
        return false;
      if (stockFilter === 'out' && p.quantityAvailable > 0) return false;
      if (stockFilter === 'ok' && p.quantityAvailable <= p.reorderLevel) return false;
      return true;
    })
  );

  const stats = $derived({
    active: parts.filter((p) => p.isActive !== false).length,
    available: parts.reduce((s, p) => s + (p.quantityAvailable || 0), 0),
    reserved: parts.reduce((s, p) => s + (p.quantityReserved || 0), 0),
    low: parts.filter((p) => p.quantityAvailable <= p.reorderLevel && p.quantityAvailable > 0).length,
    out: parts.filter((p) => p.quantityAvailable <= 0).length
  });

  const categories = $derived([...new Set(parts.map((p) => p.category || 'general'))]);

  async function createPart() {
    try {
      const me = await api<any>('/api/v1/auth/me');
      const sid = $selectedShopId || me.shops?.[0]?.shop?._id || me.shops?.[0]?.shop || me.shops?.[0]?.id;
      await api('/api/v1/parts', {
        method: 'POST',
        body: JSON.stringify({ ...form, shopId: sid, unitCost: Number(form.unitCost) })
      });
      message = $t('success');
      showCreate = false;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function doStockIn() {
    try {
      await api(`/api/v1/parts/${selectedId}/stock-in`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Number(stockQty) })
      });
      message = $t('success');
      showStock = false;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function doAdjust() {
    try {
      await api(`/api/v1/parts/${selectedId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ quantityDelta: Number(adjustDelta), reason: adjustReason })
      });
      message = $t('success');
      showAdjust = false;
      adjustReason = '';
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function saveEdit() {
    try {
      await api(`/api/v1/parts/${editForm._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name,
          category: editForm.category,
          reorderLevel: Number(editForm.reorderLevel),
          unitCost: Number(editForm.unitCost),
          supplier: editForm.supplier
        })
      });
      message = $t('success');
      showEdit = false;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function deactivate(part: any) {
    try {
      await api(`/api/v1/parts/${part._id}`, { method: 'DELETE' });
      message = $t('success');
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="space-y-4">
  <PageHeader title={$t('inventory')} subtitle="Shop-scoped parts, stock operations, and movement history.">
    <Button variant="outline" href="/app/parts/transfers">{$t('transfers')}</Button>
    <Button variant="outline" onclick={() => (showMovements = true)}>{$t('movements')}</Button>
    <Button onclick={() => (showCreate = true)}>{$t('createPart')}</Button>
  </PageHeader>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if message}<Alert type="success" message={message} />{/if}

  {#if loading}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {#each Array.from({ length: 5 }) as _}<Skeleton class="h-24" />{/each}
    </div>
  {:else}
    <StatGrid
      stats={[
        { label: 'Active parts', value: stats.active, icon: 'package', tone: 'indigo' },
        { label: $t('available'), value: stats.available, icon: 'checkCircle', tone: 'green' },
        { label: $t('reserved'), value: stats.reserved, icon: 'clipboard', tone: 'blue' },
        { label: $t('lowStock'), value: stats.low, icon: 'alertTriangle', tone: 'amber' },
        { label: $t('outOfStock'), value: stats.out, icon: 'alertTriangle', tone: 'red' },
        { label: $t('partsRequests'), value: pendingRequests, icon: 'clock', tone: 'violet' }
      ]}
    />

    <div class="flex flex-wrap gap-2">
      <input
        class="input-field max-w-xs"
        type="search"
        placeholder="Search SKU or name"
        aria-label="Search inventory by SKU or name"
        bind:value={search}
      />
      <select class="input-field w-auto" aria-label="Filter by stock status" bind:value={stockFilter}>
        <option value="all">All stock</option>
        <option value="ok">In stock</option>
        <option value="low">Low stock</option>
        <option value="out">Out of stock</option>
      </select>
      <select class="input-field w-auto" aria-label="Filter by category" bind:value={category}>
        <option value="">All categories</option>
        {#each categories as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>

    <div class="overflow-x-auto rounded-xl border border-border bg-surface-elevated">
      <table class="min-w-full text-sm">
        <caption class="sr-only">{$t('inventory')}</caption>
        <thead class="border-b border-border text-start">
          <tr>
            <th class="px-3 py-2" scope="col">{$t('sku')}</th>
            <th class="px-3 py-2" scope="col">{$t('name')}</th>
            <th class="px-3 py-2" scope="col">Category</th>
            <th class="px-3 py-2" scope="col">{$t('available')}</th>
            <th class="px-3 py-2" scope="col">{$t('reserved')}</th>
            <th class="px-3 py-2" scope="col">{$t('reorderLevel')}</th>
            <th class="px-3 py-2" scope="col">{$t('unitCost')}</th>
            <th class="px-3 py-2" scope="col">{$t('supplier')}</th>
            <th class="px-3 py-2" scope="col">{$t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as p}
            <tr class="border-b border-border" id={`part-${p._id}`}>
              <td class="px-3 py-2 font-mono text-xs">{p.sku}</td>
              <td class="px-3 py-2">
                {p.name}
                {#if p.quantityAvailable <= 0}
                  <span class="ms-2 text-xs font-semibold text-danger">{$t('outOfStock')}</span>
                {:else if p.quantityAvailable <= p.reorderLevel}
                  <span class="ms-2 text-xs font-semibold text-warning">{$t('lowStock')}</span>
                {/if}
              </td>
              <td class="px-3 py-2">{p.category || 'general'}</td>
              <td class="px-3 py-2 tabular-nums">{p.quantityAvailable}</td>
              <td class="px-3 py-2 tabular-nums">{p.quantityReserved}</td>
              <td class="px-3 py-2 tabular-nums">{p.reorderLevel}</td>
              <td class="px-3 py-2 tabular-nums">{p.unitCost}</td>
              <td class="px-3 py-2">{p.supplier || '—'}</td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="text-accent underline" onclick={() => { selectedId = p._id; showStock = true; }}>{$t('stockIn')}</button>
                  <button type="button" class="text-accent underline" onclick={() => { selectedId = p._id; showAdjust = true; }}>{$t('adjustStock')}</button>
                  <button type="button" class="text-accent underline" onclick={() => { editForm = { ...p }; showEdit = true; }}>Edit</button>
                  {#if p.isActive !== false}
                    <button type="button" class="text-danger underline" onclick={() => deactivate(p)}>Archive</button>
                  {/if}
                </div>
              </td>
            </tr>
          {:else}
            <tr><td class="px-3 py-4 text-muted" colspan="9">{$t('empty')}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<Modal open={showCreate} title={$t('createPart')} onclose={() => (showCreate = false)}>
  <div class="space-y-3">
    <input class="input-field" placeholder={$t('sku')} bind:value={form.sku} />
    <input class="input-field" placeholder={$t('name')} bind:value={form.name} />
    <input class="input-field" placeholder="Category" bind:value={form.category} />
    <input class="input-field" type="number" placeholder={$t('unitCost')} bind:value={form.unitCost} />
    <input class="input-field" type="number" placeholder={$t('reorderLevel')} bind:value={form.reorderLevel} />
    <input class="input-field" placeholder={$t('supplier')} bind:value={form.supplier} />
    <Button onclick={createPart}>{$t('save')}</Button>
  </div>
</Modal>

<Modal open={showEdit} title="Edit part" onclose={() => (showEdit = false)}>
  <div class="space-y-3">
    <input class="input-field" bind:value={editForm.name} />
    <input class="input-field" bind:value={editForm.category} />
    <input class="input-field" type="number" bind:value={editForm.reorderLevel} />
    <input class="input-field" type="number" bind:value={editForm.unitCost} />
    <input class="input-field" bind:value={editForm.supplier} />
    <Button onclick={saveEdit}>{$t('save')}</Button>
  </div>
</Modal>

<Modal open={showStock} title={$t('stockIn')} onclose={() => (showStock = false)}>
  <label class="mb-1 block text-sm" for="sq">{$t('quantity')}</label>
  <input id="sq" type="number" min="1" class="input-field mb-3" bind:value={stockQty} />
  <Button onclick={doStockIn}>{$t('save')}</Button>
</Modal>

<Modal open={showAdjust} title={$t('adjustStock')} onclose={() => (showAdjust = false)}>
  <label class="mb-1 block text-sm" for="ad">Delta (+/−)</label>
  <input id="ad" type="number" class="input-field mb-3" bind:value={adjustDelta} />
  <label class="mb-1 block text-sm" for="ar">{$t('reason')} *</label>
  <input id="ar" required class="input-field mb-3" bind:value={adjustReason} />
  <Button onclick={doAdjust}>{$t('save')}</Button>
</Modal>

<Modal open={showMovements} title={$t('movements')} onclose={() => (showMovements = false)}>
  <ul class="max-h-80 space-y-2 overflow-auto text-sm">
    {#each movements as m}
      <li class="rounded border border-border px-3 py-2">
        <span class="font-medium">{m.type}</span>
        · qty {m.quantityDelta}
        · {m.part?.sku || m.part || 'part'}
        <span class="block text-xs text-muted">{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
      </li>
    {:else}
      <li class="text-muted">{$t('empty')}</li>
    {/each}
  </ul>
</Modal>
