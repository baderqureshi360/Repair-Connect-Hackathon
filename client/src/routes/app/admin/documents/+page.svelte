<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let shopId = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let form = $state({
    receiptHeader: '',
    receiptFooter: '',
    currency: 'PKR',
    taxLabel: 'Tax',
    taxRatePercent: 0,
    warrantyTerms: '',
    defaultPrintFormat: 'a4' as 'a4' | 'thermal80' | 'thermal58',
    printLanguage: 'en' as 'en' | 'ur',
    businessLegalName: '',
    contactExtra: ''
  });

  onMount(async () => {
    try {
      const me = await api<any>('/api/v1/auth/me');
      shopId = me.shops?.[0]?.shop?._id || me.shops?.[0]?.shop || me.shops?.[0]?._id || '';
      if (!shopId) throw new Error('No shop membership');
      const settings = await api<any>(`/api/v1/documents/settings/${shopId}`);
      form = {
        receiptHeader: settings.receiptHeader || '',
        receiptFooter: settings.receiptFooter || '',
        currency: settings.currency || 'PKR',
        taxLabel: settings.taxLabel || 'Tax',
        taxRatePercent: settings.taxRatePercent || 0,
        warrantyTerms: settings.warrantyTerms || '',
        defaultPrintFormat: settings.defaultPrintFormat || 'a4',
        printLanguage: settings.printLanguage || 'en',
        businessLegalName: settings.businessLegalName || '',
        contactExtra: settings.contactExtra || ''
      };
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  async function save(e: Event) {
    e.preventDefault();
    saving = true;
    error = '';
    try {
      await api(`/api/v1/documents/settings/${shopId}`, {
        method: 'PATCH',
        body: JSON.stringify(form)
      });
      toasts.success($t('saved'));
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      saving = false;
    }
  }
</script>

<section class="mx-auto max-w-2xl space-y-6">
  <PageHeader title="Document & receipt settings" subtitle="Shop branding and print defaults" />
  {#if loading}
    <Skeleton class="h-48 w-full" />
  {:else}
    {#if error}
      <Alert type="error" role="alert" message={error} />
    {/if}
    <form class="space-y-4 rounded-lg border border-border bg-surface-elevated p-4" onsubmit={save}>
      <div>
        <label class="mb-1 block text-sm font-medium" for="legal">Business name</label>
        <input id="legal" class="input-field w-full" bind:value={form.businessLegalName} />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="header">Receipt header</label>
        <textarea id="header" class="input-field w-full" rows="2" bind:value={form.receiptHeader}></textarea>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="footer">Receipt footer</label>
        <textarea id="footer" class="input-field w-full" rows="2" bind:value={form.receiptFooter}></textarea>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1 block text-sm font-medium" for="currency">Currency</label>
          <input id="currency" class="input-field w-full" bind:value={form.currency} />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="taxRate">Tax %</label>
          <input id="taxRate" type="number" min="0" max="100" step="0.01" class="input-field w-full" bind:value={form.taxRatePercent} />
        </div>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="warranty">Warranty terms</label>
        <textarea id="warranty" class="input-field w-full" rows="4" bind:value={form.warrantyTerms}></textarea>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1 block text-sm font-medium" for="fmt">Default format</label>
          <select id="fmt" class="input-field w-full" bind:value={form.defaultPrintFormat}>
            <option value="a4">A4</option>
            <option value="thermal80">80mm</option>
            <option value="thermal58">58mm</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="plang">Print language</label>
          <select id="plang" class="input-field w-full" bind:value={form.printLanguage}>
            <option value="en">English</option>
            <option value="ur">Urdu</option>
          </select>
        </div>
      </div>
      <Button type="submit" loading={saving}>Save settings</Button>
    </form>
  {/if}
</section>
