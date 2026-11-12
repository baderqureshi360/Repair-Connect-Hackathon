<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, ApiError, clearDraft, loadDraft, saveDraft } from '$lib/api';
  import { t } from '$lib/i18n';
  import { announce, online } from '$lib/stores/ui';
  import { toasts } from '$lib/stores/toast';
  import { rememberShop } from '$lib/recentShops';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  type Draft = {
    shopId: string;
    deviceType: string;
    brand: string;
    model: string;
    serialNumber: string;
    accessories: string;
    problemDescription: string;
    appointmentAt: string;
  };

  let shops = $state<any[]>([]);
  let form = $state<Draft>({
    shopId: '',
    deviceType: 'Laptop',
    brand: '',
    model: '',
    serialNumber: '',
    accessories: '',
    problemDescription: '',
    appointmentAt: ''
  });
  let photos = $state<{ url: string; kind: string }[]>([]);
  let error = $state('');
  let info = $state('');
  let loading = $state(false);

  onMount(async () => {
    const draft = loadDraft<Draft>('repair');
    if (draft) {
      form = { ...form, ...draft };
      info = $t('draftSaved');
    }
    const preferredShopId = $page.url.searchParams.get('shopId') || '';
    if (preferredShopId) form.shopId = preferredShopId;
    const res = await api<{ data: any[] }>('/api/v1/shops?limit=50', { full: true });
    shops = res.data || [];
    if (preferredShopId && shops.some((s) => s._id === preferredShopId)) {
      form.shopId = preferredShopId;
      rememberShop(preferredShopId);
    } else if (!form.shopId && shops[0]) {
      form.shopId = shops[0]._id;
    }
  });

  function persistDraft() {
    saveDraft('repair', form);
    info = $t('draftSaved');
  }

  async function onPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 350_000) {
      error = 'Photo must be under 350KB';
      return;
    }
    if (photos.length >= 5) {
      error = 'Maximum 5 photos';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      photos = [...photos, { url: String(reader.result), kind: 'device' }];
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = '';
    if (!$online) {
      persistDraft();
      error = $t('offline');
      return;
    }
    loading = true;
    const idempotencyKey = crypto.randomUUID();
    try {
      let appointmentAt: string | undefined;
      if (form.appointmentAt?.trim()) {
        const when = new Date(form.appointmentAt);
        if (Number.isNaN(when.getTime())) {
          error = 'Appointment time is invalid. Pick a valid date and time.';
          toasts.error(error);
          loading = false;
          return;
        }
        appointmentAt = when.toISOString();
      }
      const payload = {
        shopId: form.shopId,
        deviceType: form.deviceType.trim(),
        brand: form.brand.trim(),
        model: form.model.trim(),
        serialNumber: form.serialNumber.trim() || undefined,
        accessories: form.accessories.trim() || undefined,
        problemDescription: form.problemDescription.trim(),
        appointmentAt,
        photos: photos.length ? photos : undefined,
        idempotencyKey
      };
      if (!payload.shopId) {
        error = 'Please select a repair shop.';
        toasts.error(error);
        loading = false;
        return;
      }
      if (payload.problemDescription.length < 5) {
        error = 'Describe the problem in at least 5 characters.';
        toasts.error(error);
        loading = false;
        return;
      }
      const repair = await api<any>('/api/v1/repairs', {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify(payload)
      });
      clearDraft('repair');
      announce.set($t('success'));
      toasts.success($t('success'));
      goto(`/app/repairs/${repair._id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OFFLINE') {
        persistDraft();
      }
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      toasts.error(error);
    } finally {
      loading = false;
    }
  }
</script>

<section class="mx-auto max-w-xl">
  <PageHeader title={$t('newRepair')} breadcrumbs={[{ label: $t('dashboard'), href: '/app/customer' }, { label: $t('newRepair') }]} />
  <form class="surface-card mt-2 space-y-4 p-4" onsubmit={onSubmit} oninput={persistDraft}>
    {#if error}<Alert type="error" role="alert" message={error} />{/if}
    {#if info}<Alert type="info" message={info} />{/if}

    <div>
      <label class="mb-1 block text-sm font-medium" for="shop">{$t('preferredShop')} <span class="text-danger">*</span></label>
      <select id="shop" required class="input-field" bind:value={form.shopId}>
        {#each shops as shop}
          <option value={shop._id}>{shop.name} — {shop.city}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="deviceType">{$t('device')} <span class="text-danger">*</span></label>
      <input id="deviceType" required class="input-field" bind:value={form.deviceType} />
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-sm font-medium" for="brand">{$t('brand')} <span class="text-danger">*</span></label>
        <input id="brand" required class="input-field" bind:value={form.brand} />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="model">{$t('model')} <span class="text-danger">*</span></label>
        <input id="model" required class="input-field" bind:value={form.model} />
      </div>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-sm font-medium" for="serial">{$t('serialNumber')}</label>
        <input id="serial" class="input-field" bind:value={form.serialNumber} />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="appt">{$t('appointments')}</label>
        <input id="appt" type="datetime-local" class="input-field" bind:value={form.appointmentAt} />
      </div>
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="accessories">{$t('accessories')}</label>
      <input id="accessories" class="input-field" placeholder="Charger, case…" bind:value={form.accessories} />
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="problem">{$t('problem')} <span class="text-danger">*</span></label>
      <textarea id="problem" required rows="4" class="input-field" bind:value={form.problemDescription}></textarea>
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="photos">{$t('photos')}</label>
      <input id="photos" type="file" accept="image/*" class="input-field" onchange={onPhoto} />
      {#if photos.length}
        <div class="mt-2 flex flex-wrap gap-2">
          {#each photos as photo, i}
            <img src={photo.url} alt={`Device ${i + 1}`} class="h-16 w-16 rounded border border-border object-cover" />
          {/each}
        </div>
      {/if}
    </div>
    <Button type="submit" loading={loading}>{loading ? $t('loading') : $t('submit')}</Button>
  </form>
</section>
