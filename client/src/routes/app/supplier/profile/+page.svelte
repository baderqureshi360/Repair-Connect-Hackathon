<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { PART_CATEGORIES } from '$lib/partCategories';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';

  let form = $state({
    contactPerson: '',
    businessPhone: '',
    address: '',
    description: '',
    supportedBrandsText: '',
    deliveryCitiesText: '',
    partCategories: [] as string[],
    availability: 'available' as 'available' | 'limited' | 'unavailable'
  });
  let savedJson = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let okMsg = $state('');

  const dirty = $derived(!loading && savedJson !== '' && JSON.stringify(form) !== savedJson);

  onMount(async () => {
    try {
      const biz = await api<any>('/api/v1/supplier/me');
      form = {
        contactPerson: biz.contactPerson || '',
        businessPhone: biz.businessPhone || '',
        address: biz.address || '',
        description: biz.description || '',
        supportedBrandsText: (biz.supportedBrands || []).join(', '),
        deliveryCitiesText: (biz.deliveryCities || []).join(', '),
        partCategories: biz.partCategories || [],
        availability: biz.availability || 'available'
      };
      savedJson = JSON.stringify(form);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  function toggleCategory(id: string) {
    form.partCategories = form.partCategories.includes(id)
      ? form.partCategories.filter((c) => c !== id)
      : [...form.partCategories, id];
  }

  async function save() {
    saving = true;
    error = '';
    okMsg = '';
    try {
      await api('/api/v1/supplier/me', {
        method: 'PATCH',
        body: JSON.stringify({
          contactPerson: form.contactPerson,
          businessPhone: form.businessPhone,
          address: form.address,
          description: form.description,
          supportedBrands: form.supportedBrandsText.split(',').map((s) => s.trim()).filter(Boolean),
          deliveryCities: form.deliveryCitiesText.split(',').map((s) => s.trim()).filter(Boolean),
          partCategories: form.partCategories,
          availability: form.availability
        })
      });
      okMsg = $t('success');
      savedJson = JSON.stringify(form);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      saving = false;
    }
  }
</script>

<section class="mx-auto min-w-0 max-w-2xl space-y-5 overflow-x-clip md:space-y-6">
  <UnsavedChangesGuard dirty={dirty} />
  <PageHeader title={$t('profile')} subtitle={$t('supplierProfileSubtitle')} />

  {#if loading}
    <div class="space-y-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 5 }) as _}<Skeleton class="h-12" />{/each}
    </div>
  {:else}
    {#if error}<Alert type="error" role="alert" message={error} />{/if}
    {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}
    <div class="surface-card space-y-4 p-4 sm:p-5">
      <label class="block text-sm">{$t('contactPerson')}<input class="input-field mt-1 w-full" bind:value={form.contactPerson} /></label>
      <label class="block text-sm">{$t('phone')}<input class="input-field mt-1 w-full" bind:value={form.businessPhone} /></label>
      <label class="block text-sm">{$t('address')}<input class="input-field mt-1 w-full" bind:value={form.address} /></label>
      <label class="block text-sm"
        >{$t('businessDescription')}<textarea class="input-field mt-1 w-full" rows="4" bind:value={form.description}></textarea></label
      >
      <label class="block text-sm">{$t('supportedBrands')}<input class="input-field mt-1 w-full" bind:value={form.supportedBrandsText} /></label>
      <label class="block text-sm">{$t('deliveryCoverage')}<input class="input-field mt-1 w-full" bind:value={form.deliveryCitiesText} /></label>
      <label class="block text-sm"
        >{$t('availability')}
        <select class="input-field mt-1 w-full" bind:value={form.availability}>
          <option value="available">{$t('available')}</option>
          <option value="limited">{$t('limited')}</option>
          <option value="unavailable">{$t('unavailable')}</option>
        </select>
      </label>
      <div>
        <p class="text-sm font-medium text-ink">{$t('partCategories')}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each PART_CATEGORIES as cat}
            <label class="inline-flex items-center gap-2 rounded-[var(--radius-ui)] border border-border px-2 py-1 text-sm">
              <input type="checkbox" checked={form.partCategories.includes(cat.id)} onchange={() => toggleCategory(cat.id)} />
              {cat.label}
            </label>
          {/each}
        </div>
      </div>
      <Button variant="primary" disabled={saving} onclick={save}>{saving ? $t('loading') : $t('save')}</Button>
    </div>
  {/if}
</section>
