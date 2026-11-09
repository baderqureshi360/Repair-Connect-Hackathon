<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { SERVICE_CATEGORIES } from '$lib/serviceCategories';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let shops = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let message = $state('');
  let showCreate = $state(false);
  let editing = $state<any>(null);
  let blockers = $state<any>(null);
  let form = $state({
    name: '',
    code: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: '',
    description: '',
    serviceCategories: [] as string[],
    supportedBrandsText: ''
  });

  function toggleCategory(target: { serviceCategories?: string[] }, id: string) {
    const current = new Set(target.serviceCategories || []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    target.serviceCategories = [...current];
  }

  function brandsFromText(text: string) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function load() {
    loading = true;
    error = '';
    try {
      shops = (await api<any[]>('/api/v1/shops/mine?includeArchived=1')) || [];
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function createShop() {
    try {
      const { supportedBrandsText, ...rest } = form;
      await api('/api/v1/shops', {
        method: 'POST',
        body: JSON.stringify({
          ...rest,
          supportedBrands: brandsFromText(supportedBrandsText)
        })
      });
      message = $t('success');
      showCreate = false;
      form = {
        name: '',
        code: '',
        contactPerson: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        region: '',
        description: '',
        serviceCategories: [],
        supportedBrandsText: ''
      };
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api(`/api/v1/shops/${editing._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editing.name,
          contactPerson: editing.contactPerson,
          email: editing.email,
          phone: editing.phone,
          address: editing.address,
          city: editing.city,
          region: editing.region,
          description: editing.description,
          dailyCapacity: Number(editing.dailyCapacity) || 16,
          slotMinutes: Number(editing.slotMinutes) || 60,
          cancelPolicyHours: Number(editing.cancelPolicyHours) || 2,
          serviceCategories: editing.serviceCategories || [],
          supportedBrands: brandsFromText(editing.supportedBrandsText || (editing.supportedBrands || []).join(', '))
        })
      });
      message = $t('success');
      editing = null;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function checkArchive(shop: any) {
    try {
      blockers = await api(`/api/v1/shops/${shop._id}/archive-check`);
      blockers.shopId = shop._id;
      blockers.shopName = shop.name;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function confirmArchive() {
    if (!blockers?.shopId) return;
    try {
      await api(`/api/v1/shops/${blockers.shopId}/archive`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Archived from shop management' })
      });
      blockers = null;
      message = $t('success');
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      if (err instanceof ApiError && err.details) blockers = { ...blockers, ...(err.details as object) };
    }
  }

  async function reactivate(shop: any) {
    try {
      await api(`/api/v1/shops/${shop._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true })
      });
      message = $t('success');
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="space-y-4">
  <PageHeader title={$t('shopManagement')} subtitle="Create, edit, and safely archive authorized repair shops.">
    <Button onclick={() => (showCreate = true)}>{$t('createShop')}</Button>
  </PageHeader>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if message}<Alert type="success" message={message} />{/if}

  {#if loading}
    <Skeleton lines={5} />
  {:else}
    <ul class="space-y-3">
      {#each shops as shop}
        <li class="surface-card p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-lg font-semibold">{shop.name}</h2>
                <StatusPill status={shop.isActive ? 'completed' : 'cancelled'} />
                <span class="text-xs text-muted">{shop.code}</span>
              </div>
              <p class="mt-1 text-sm text-muted">
                {shop.city}{shop.region ? `, ${shop.region}` : ''} · {shop.phone}
                {#if shop.contactPerson} · {shop.contactPerson}{/if}
              </p>
              <p class="text-sm text-muted">{shop.address}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" href={`/app/admin/reports?shopId=${shop._id}`}>{$t('reports')}</Button>
              <Button size="sm" variant="outline" href={`/app/parts/inventory?shopId=${shop._id}`}>{$t('inventory')}</Button>
              <Button
                size="sm"
                variant="secondary"
                onclick={() =>
                  (editing = {
                    ...shop,
                    serviceCategories: [...(shop.serviceCategories || [])],
                    supportedBrandsText: (shop.supportedBrands || []).join(', ')
                  })}>Edit</Button
              >
              {#if shop.isActive}
                <Button size="sm" variant="danger" onclick={() => checkArchive(shop)}>{$t('archiveShop')}</Button>
              {:else}
                <Button size="sm" variant="primary" onclick={() => reactivate(shop)}>{$t('activateShop')}</Button>
              {/if}
            </div>
          </div>
        </li>
      {:else}
        <li class="text-muted">{$t('empty')}</li>
      {/each}
    </ul>
  {/if}
</section>

<Modal open={showCreate} title={$t('createShop')} onclose={() => (showCreate = false)}>
  <form
    class="grid gap-3 sm:grid-cols-2"
    onsubmit={(e) => {
      e.preventDefault();
      createShop();
    }}
  >
    <label class="text-sm">Name<input class="input-field mt-1" required bind:value={form.name} /></label>
    <label class="text-sm">Code<input class="input-field mt-1" required bind:value={form.code} /></label>
    <label class="text-sm">Contact<input class="input-field mt-1" bind:value={form.contactPerson} /></label>
    <label class="text-sm">Email<input class="input-field mt-1" type="email" bind:value={form.email} /></label>
    <label class="text-sm">Phone<input class="input-field mt-1" required bind:value={form.phone} /></label>
    <label class="text-sm">City<input class="input-field mt-1" required bind:value={form.city} /></label>
    <label class="text-sm sm:col-span-2">Address<input class="input-field mt-1" required bind:value={form.address} /></label>
    <label class="text-sm">Region<input class="input-field mt-1" bind:value={form.region} /></label>
    <label class="text-sm sm:col-span-2"
      >Supported brands (comma-separated)<input class="input-field mt-1" bind:value={form.supportedBrandsText} /></label
    >
    <fieldset class="sm:col-span-2">
      <legend class="text-sm font-medium">{$t('serviceCategory')}</legend>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        {#each SERVICE_CATEGORIES as cat}
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.serviceCategories.includes(cat.id)}
              onchange={() => toggleCategory(form, cat.id)}
            />
            {cat.label}
          </label>
        {/each}
      </div>
    </fieldset>
    <div class="sm:col-span-2 flex justify-end gap-2">
      <Button type="button" variant="outline" onclick={() => (showCreate = false)}>{$t('cancel')}</Button>
      <Button type="submit">{$t('createShop')}</Button>
    </div>
  </form>
</Modal>

<Modal open={!!editing} title="Edit shop" onclose={() => (editing = null)}>
  {#if editing}
    <form
      class="grid gap-3 sm:grid-cols-2"
      onsubmit={(e) => {
        e.preventDefault();
        saveEdit();
      }}
    >
      <label class="text-sm">Name<input class="input-field mt-1" bind:value={editing.name} /></label>
      <label class="text-sm">Contact<input class="input-field mt-1" bind:value={editing.contactPerson} /></label>
      <label class="text-sm">Email<input class="input-field mt-1" bind:value={editing.email} /></label>
      <label class="text-sm">Phone<input class="input-field mt-1" bind:value={editing.phone} /></label>
      <label class="text-sm sm:col-span-2">Address<input class="input-field mt-1" bind:value={editing.address} /></label>
      <label class="text-sm">City<input class="input-field mt-1" bind:value={editing.city} /></label>
      <label class="text-sm">Region<input class="input-field mt-1" bind:value={editing.region} /></label>
      <label class="text-sm">Daily capacity<input class="input-field mt-1" type="number" bind:value={editing.dailyCapacity} /></label>
      <label class="text-sm">Slot minutes<input class="input-field mt-1" type="number" bind:value={editing.slotMinutes} /></label>
      <label class="text-sm sm:col-span-2"
        >Supported brands (comma-separated)<input
          class="input-field mt-1"
          bind:value={editing.supportedBrandsText}
        /></label
      >
      <fieldset class="sm:col-span-2">
        <legend class="text-sm font-medium">{$t('serviceCategory')}</legend>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          {#each SERVICE_CATEGORIES as cat}
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(editing.serviceCategories || []).includes(cat.id)}
                onchange={() => toggleCategory(editing, cat.id)}
              />
              {cat.label}
            </label>
          {/each}
        </div>
      </fieldset>
      <div class="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={() => (editing = null)}>{$t('cancel')}</Button>
        <Button type="submit">{$t('save')}</Button>
      </div>
    </form>
  {/if}
</Modal>

<Modal open={!!blockers} title={$t('archiveShop')} onclose={() => (blockers = null)}>
  {#if blockers}
    <p class="text-sm text-muted">Archive checks for <strong>{blockers.shopName}</strong>. Historical records are preserved.</p>
    <ul class="mt-3 space-y-1 text-sm">
      <li>Active repairs: {blockers.activeRepairs}</li>
      <li>Pending appointments: {blockers.pendingAppointments}</li>
      <li>Outstanding estimates: {blockers.outstandingEstimates}</li>
      <li>Reserved inventory SKUs: {blockers.reservedParts}</li>
      <li>Open transfers: {blockers.openTransfers}</li>
      <li>Outstanding balances: {blockers.outstandingBalances}</li>
    </ul>
    {#if blockers.blockers > 0}
      <div class="mt-3">
        <Alert type="warning" message="Resolve or reassign unresolved items before archiving." />
      </div>
    {/if}
    <div class="mt-4 flex justify-end gap-2">
      <Button variant="outline" onclick={() => (blockers = null)}>{$t('cancel')}</Button>
      <Button variant="danger" disabled={blockers.blockers > 0} onclick={confirmArchive}>{$t('archiveShop')}</Button>
    </div>
  {/if}
</Modal>
