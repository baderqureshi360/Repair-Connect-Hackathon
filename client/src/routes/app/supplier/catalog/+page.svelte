<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { PART_CATEGORIES, partCategoryLabel, type PartCategoryId } from '$lib/partCategories';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';

  type CatalogItem = {
    id: string;
    name: string;
    sku: string;
    manufacturerPartNumber?: string;
    category: string;
    brand: string;
    description: string;
    condition: string;
    warranty: string;
    compatibleModels: string[];
    unitPrice: number;
    currency: string;
    quantityAvailable: number;
    minOrderQuantity: number;
    leadTimeDays: number;
    lowStockThreshold: number;
    stockStatus: string;
    isActive: boolean;
    isArchived: boolean;
    stockVersion: number;
  };

  let items = $state<CatalogItem[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let okMsg = $state('');
  let q = $state('');
  let category = $state('');
  let stockStatus = $state('');
  let includeArchived = $state(false);
  let sort = $state('name');
  let page = $state(0);
  const pageSize = 20;

  let editingId = $state<string | null>(null);
  let stockItemId = $state<string | null>(null);
  let stockAction = $state<'set' | 'receive' | 'write_off'>('receive');
  let stockQty = $state(0);
  let stockExpected = $state(0);
  let stockVersion = $state(0);
  let movements = $state<any[]>([]);

  let form = $state(emptyForm());
  let formBaseline = $state(JSON.stringify(emptyForm()));

  const catalogDirty = $derived(
    JSON.stringify(form) !== formBaseline || Boolean(stockItemId && Number(stockQty) > 0)
  );

  function emptyForm(): {
    name: string;
    sku: string;
    manufacturerPartNumber: string;
    category: PartCategoryId;
    brand: string;
    compatibleModelsText: string;
    description: string;
    condition: string;
    warranty: string;
    unitPrice: number;
    quantityAvailable: number;
    minOrderQuantity: number;
    leadTimeDays: number;
    lowStockThreshold: number;
    discontinued: boolean;
    isActive: boolean;
  } {
    return {
      name: '',
      sku: '',
      manufacturerPartNumber: '',
      category: PART_CATEGORIES[0].id,
      brand: '',
      compatibleModelsText: '',
      description: '',
      condition: 'new',
      warranty: '',
      unitPrice: 0,
      quantityAvailable: 0,
      minOrderQuantity: 1,
      leadTimeDays: 0,
      lowStockThreshold: 5,
      discontinued: false,
      isActive: true
    };
  }

  function asPartCategory(value: string): PartCategoryId {
    const match = PART_CATEGORIES.find((c) => c.id === value);
    return match ? match.id : PART_CATEGORIES[0].id;
  }

  function statusLabel(status: string) {
    return status.replaceAll('_', ' ');
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        skip: String(page * pageSize),
        sort
      });
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (stockStatus) params.set('stockStatus', stockStatus);
      if (includeArchived) params.set('includeArchived', 'true');
      const data = await api<{ items: CatalogItem[]; total: number }>(
        `/api/v1/supplier/catalog?${params.toString()}`
      );
      items = data.items || [];
      total = data.total || 0;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      items = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function startEdit(item: CatalogItem) {
    editingId = item.id;
    form = {
      name: item.name,
      sku: item.sku || '',
      manufacturerPartNumber: item.manufacturerPartNumber || '',
      category: asPartCategory(item.category),
      brand: item.brand || '',
      compatibleModelsText: (item.compatibleModels || []).join(', '),
      description: item.description || '',
      condition: item.condition || 'new',
      warranty: item.warranty || '',
      unitPrice: item.unitPrice,
      quantityAvailable: item.quantityAvailable,
      minOrderQuantity: item.minOrderQuantity,
      leadTimeDays: item.leadTimeDays,
      lowStockThreshold: item.lowStockThreshold,
      discontinued: item.stockStatus === 'discontinued',
      isActive: item.isActive
    };
    okMsg = '';
    error = '';
  }

  function cancelEdit() {
    editingId = null;
    form = emptyForm();
    formBaseline = JSON.stringify(form);
  }

  function payloadFromForm(includeQty: boolean) {
    return {
      name: form.name.trim(),
      sku: form.sku.trim() || undefined,
      manufacturerPartNumber: form.manufacturerPartNumber.trim() || undefined,
      category: form.category,
      brand: form.brand.trim() || undefined,
      compatibleModels: form.compatibleModelsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      description: form.description.trim() || undefined,
      condition: form.condition,
      warranty: form.warranty.trim() || undefined,
      unitPrice: Number(form.unitPrice),
      ...(includeQty ? { quantityAvailable: Number(form.quantityAvailable) } : {}),
      minOrderQuantity: Number(form.minOrderQuantity),
      leadTimeDays: Number(form.leadTimeDays),
      lowStockThreshold: Number(form.lowStockThreshold),
      discontinued: form.discontinued,
      isActive: form.isActive
    };
  }

  async function saveItem(e: Event) {
    e.preventDefault();
    error = '';
    okMsg = '';
    try {
      if (editingId) {
        await api(`/api/v1/supplier/catalog/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payloadFromForm(false))
        });
        okMsg = 'Product updated.';
      } else {
        await api('/api/v1/supplier/catalog', {
          method: 'POST',
          body: JSON.stringify(payloadFromForm(true))
        });
        okMsg = 'Product created.';
      }
      cancelEdit();
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function toggleActive(item: CatalogItem) {
    error = '';
    try {
      await api(`/api/v1/supplier/catalog/${item.id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ isActive: !item.isActive })
      });
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function archiveItem(item: CatalogItem) {
    if (!confirm(`Archive "${item.name}"? It will be hidden from the marketplace.`)) return;
    error = '';
    try {
      await api(`/api/v1/supplier/catalog/${item.id}/archive`, { method: 'POST' });
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function deleteItem(item: CatalogItem) {
    if (!confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) return;
    error = '';
    try {
      await api(`/api/v1/supplier/catalog/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function openStock(item: CatalogItem) {
    stockItemId = item.id;
    stockExpected = item.quantityAvailable;
    stockVersion = item.stockVersion;
    stockQty = 0;
    stockAction = 'receive';
    try {
      movements = (await api(`/api/v1/supplier/catalog/${item.id}/stock-movements`)) || [];
    } catch {
      movements = [];
    }
  }

  async function submitStock(e: Event) {
    e.preventDefault();
    if (!stockItemId) return;
    error = '';
    okMsg = '';
    try {
      const result = await api<{ item: CatalogItem }>(`/api/v1/supplier/catalog/${stockItemId}/stock`, {
        method: 'POST',
        body: JSON.stringify({
          action: stockAction,
          quantity: Number(stockQty),
          expectedQuantity: stockExpected,
          expectedVersion: stockVersion
        })
      });
      okMsg = `Stock updated to ${result.item.quantityAvailable} (${statusLabel(result.item.stockStatus)}).`;
      stockItemId = null;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <UnsavedChangesGuard dirty={catalogDirty} />
  <PageHeader title={$t('catalog')} subtitle={$t('supplierCatalogSubtitle')} />

  <Alert type="info" role="status" message={$t('supplierStockNote')} />
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  <div class="surface-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" role="search">
    <label class="text-sm" for="cat-q"
      >{$t('search')}
      <input id="cat-q" class="input-field mt-1 w-full" bind:value={q} onkeydown={(e) => e.key === 'Enter' && load()} />
    </label>
    <label class="text-sm" for="cat-category"
      >{$t('partCategories')}
      <select id="cat-category" class="input-field mt-1 w-full" bind:value={category} onchange={load}>
        <option value="">{$t('all')}</option>
        {#each PART_CATEGORIES as cat}
          <option value={cat.id}>{cat.label}</option>
        {/each}
      </select>
    </label>
    <label class="text-sm" for="cat-status"
      >{$t('availability')}
      <select id="cat-status" class="input-field mt-1 w-full" bind:value={stockStatus} onchange={load}>
        <option value="">{$t('all')}</option>
        <option value="in_stock">{$t('inStock')}</option>
        <option value="low_stock">{$t('lowStock')}</option>
        <option value="out_of_stock">{$t('outOfStock')}</option>
        <option value="discontinued">Discontinued</option>
      </select>
    </label>
    <label class="text-sm" for="cat-sort"
      >Sort
      <select id="cat-sort" class="input-field mt-1 w-full" bind:value={sort} onchange={load}>
        <option value="name">Name</option>
        <option value="price_asc">Price ↑</option>
        <option value="price_desc">Price ↓</option>
        <option value="qty">Quantity</option>
        <option value="updated">Updated</option>
      </select>
    </label>
    <label class="flex items-end gap-2 pb-2 text-sm">
      <input type="checkbox" bind:checked={includeArchived} onchange={() => { page = 0; load(); }} />
      {$t('includeArchived')}
    </label>
  </div>
  <Button variant="outline" size="sm" onclick={() => { page = 0; load(); }}>{$t('search')}</Button>

  <form class="surface-card grid gap-3 p-4 sm:grid-cols-2" data-rc-save data-rc-submit onsubmit={saveItem} aria-label="Product form">
    <h2 class="text-lg font-semibold text-ink sm:col-span-2">{editingId ? $t('editProduct') : $t('addProduct')}</h2>
    <label class="text-sm" for="name">Name<span class="text-danger"> *</span><input id="name" class="input-field mt-1 w-full" required bind:value={form.name} /></label>
    <label class="text-sm" for="sku">{$t('sku')}<input id="sku" class="input-field mt-1 w-full" bind:value={form.sku} /></label>
    <label class="text-sm" for="mpn">{$t('manufacturerPartNumber')}<input id="mpn" class="input-field mt-1 w-full" bind:value={form.manufacturerPartNumber} /></label>
    <label class="text-sm" for="brand">Brand<input id="brand" class="input-field mt-1 w-full" bind:value={form.brand} /></label>
    <label class="text-sm" for="category"
      >{$t('partCategories')}<span class="text-danger"> *</span>
      <select id="category" class="input-field mt-1 w-full" bind:value={form.category}>
        {#each PART_CATEGORIES as cat}<option value={cat.id}>{cat.label}</option>{/each}
      </select>
    </label>
    <label class="text-sm" for="condition"
      >{$t('condition')}
      <select id="condition" class="input-field mt-1 w-full" bind:value={form.condition}>
        <option value="new">New</option>
        <option value="oem">OEM</option>
        <option value="aftermarket">Aftermarket</option>
        <option value="refurbished">Refurbished</option>
        <option value="used">Used</option>
      </select>
    </label>
    <label class="text-sm sm:col-span-2" for="compat">{$t('compatibleModels')}<input id="compat" class="input-field mt-1 w-full" bind:value={form.compatibleModelsText} /></label>
    <label class="text-sm sm:col-span-2" for="desc">{$t('businessDescription')}<textarea id="desc" class="input-field mt-1 w-full" rows="3" bind:value={form.description}></textarea></label>
    <label class="text-sm" for="warranty">{$t('warranty')}<input id="warranty" class="input-field mt-1 w-full" bind:value={form.warranty} /></label>
    <label class="text-sm" for="price">Price<span class="text-danger"> *</span><input id="price" type="number" min="0" step="0.01" class="input-field mt-1 w-full" bind:value={form.unitPrice} /></label>
    {#if !editingId}
      <label class="text-sm" for="qty">Initial quantity<input id="qty" type="number" min="0" class="input-field mt-1 w-full" bind:value={form.quantityAvailable} /></label>
    {/if}
    <label class="text-sm" for="moq">{$t('minOrderQty')}<input id="moq" type="number" min="1" class="input-field mt-1 w-full" bind:value={form.minOrderQuantity} /></label>
    <label class="text-sm" for="lead">{$t('leadTimeDays')}<input id="lead" type="number" min="0" class="input-field mt-1 w-full" bind:value={form.leadTimeDays} /></label>
    <label class="text-sm" for="low">{$t('lowStock')}<input id="low" type="number" min="0" class="input-field mt-1 w-full" bind:value={form.lowStockThreshold} /></label>
    <label class="flex items-center gap-2 self-end text-sm"><input type="checkbox" bind:checked={form.discontinued} /> Discontinued</label>
    <label class="flex items-center gap-2 self-end text-sm"><input type="checkbox" bind:checked={form.isActive} /> Active listing</label>
    <div class="flex flex-wrap gap-2 sm:col-span-2">
      <Button type="submit" variant="primary">{editingId ? $t('save') : $t('addProduct')}</Button>
      {#if editingId}<Button type="button" variant="outline" onclick={cancelEdit}>{$t('cancel')}</Button>{/if}
    </div>
  </form>

  {#if stockItemId}
    <form class="surface-card space-y-3 p-4" data-rc-save data-rc-submit onsubmit={submitStock} aria-label="Stock adjustment">
      <h2 class="text-lg font-semibold text-ink">{$t('adjustStock')}</h2>
      <p class="text-sm text-muted">Current quantity: {stockExpected} (version {stockVersion})</p>
      <label class="block text-sm" for="stock-action"
        >Action
        <select id="stock-action" class="input-field mt-1 w-full max-w-xs" bind:value={stockAction}>
          <option value="receive">{$t('receiveStock')}</option>
          <option value="set">{$t('setAbsolute')}</option>
          <option value="write_off">{$t('writeOff')}</option>
        </select>
      </label>
      <label class="block text-sm" for="stock-qty"
        >Quantity
        <input id="stock-qty" type="number" min="0" class="input-field mt-1 w-full max-w-xs" bind:value={stockQty} required />
      </label>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">{$t('adjustStock')}</Button>
        <Button type="button" variant="outline" onclick={() => (stockItemId = null)}>{$t('cancel')}</Button>
      </div>
      {#if movements.length}
        <div>
          <h3 class="text-sm font-semibold">{$t('stockMovements')}</h3>
          <ul class="mt-2 space-y-1 text-sm" role="list">
            {#each movements.slice(0, 8) as m}
              <li class="rounded-[var(--radius-ui)] border border-border px-2 py-1">
                {m.action}: {m.quantityBefore} → {m.quantityAfter}
                <span class="text-muted"> · {m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </form>
  {/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-14" />{/each}
    </div>
  {:else if !items.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">{$t('empty')}</div>
  {:else}
    <p class="text-sm text-muted">{total} {$t('catalogProducts').toLowerCase()}</p>
    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">Name</th>
            <th class="px-3 py-2" scope="col">{$t('sku')} / MPN</th>
            <th class="px-3 py-2" scope="col">{$t('condition')}</th>
            <th class="px-3 py-2" scope="col">{$t('minOrderQty')}</th>
            <th class="px-3 py-2" scope="col">{$t('supplierStock')}</th>
            <th class="px-3 py-2" scope="col">{$t('availability')}</th>
            <th class="px-3 py-2" scope="col">{$t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each items as item}
            <tr class="border-t border-border {item.isArchived ? 'opacity-60' : ''}">
              <td class="px-3 py-2">
                <p class="font-medium text-ink">{item.name}</p>
                <p class="text-xs text-muted">{partCategoryLabel(item.category)} · {item.currency} {item.unitPrice}</p>
                {#if item.compatibleModels?.length}
                  <p class="text-xs text-muted">{$t('compatibleModels')}: {item.compatibleModels.join(', ')}</p>
                {/if}
              </td>
              <td class="px-3 py-2">
                <p>{item.sku || '—'}</p>
                <p class="text-xs text-muted">{item.manufacturerPartNumber || '—'}</p>
              </td>
              <td class="px-3 py-2 capitalize">
                {item.condition || '—'}
                {#if item.warranty}<p class="text-xs text-muted">{$t('warranty')}: {item.warranty}</p>{/if}
              </td>
              <td class="px-3 py-2">
                {item.minOrderQuantity}
                <p class="text-xs text-muted">{$t('leadTimeDays')}: {item.leadTimeDays}</p>
              </td>
              <td class="px-3 py-2 tabular-nums">{item.quantityAvailable}</td>
              <td class="px-3 py-2">
                <StatusPill status={item.stockStatus} />
                {#if !item.isActive}<span class="mt-1 block text-xs text-muted">inactive</span>{/if}
                {#if item.isArchived}<span class="mt-1 block text-xs text-muted">archived</span>{/if}
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-2">
                  {#if !item.isArchived}
                    <button type="button" class="text-accent underline" onclick={() => startEdit(item)}>{$t('editProduct')}</button>
                    <button type="button" class="text-accent underline" onclick={() => openStock(item)}>{$t('adjustStock')}</button>
                    <button type="button" class="text-accent underline" onclick={() => toggleActive(item)}>
                      {item.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" class="text-danger underline" onclick={() => archiveItem(item)}>Archive</button>
                  {:else}
                    <button type="button" class="text-danger underline" onclick={() => deleteItem(item)}>Delete</button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="flex items-center gap-3">
      <Button variant="outline" size="sm" disabled={page <= 0} onclick={() => { page -= 1; load(); }}>Previous</Button>
      <span class="text-sm text-muted">Page {page + 1} / {totalPages}</span>
      <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onclick={() => { page += 1; load(); }}>Next</Button>
    </div>
  {/if}
</section>
