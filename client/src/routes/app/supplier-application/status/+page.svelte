<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let app = $state<any>(null);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      app = await api('/api/v1/supplier-applications/mine');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });
</script>

<section class="mx-auto max-w-2xl space-y-4">
  <header>
    <h1 class="text-2xl font-semibold">{$t('applicationStatusTitle')}</h1>
    <p class="mt-1 text-sm text-muted">{$t('supplierRegistrationHint')}</p>
  </header>

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else if !app}
    <Alert type="warning" role="status" message="No supplier application found for this account." />
  {:else}
    <dl class="grid gap-3 rounded-lg border border-border bg-surface-elevated p-4 sm:grid-cols-2">
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('applicationReference')}</dt>
        <dd class="font-medium">{app.id}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('status')}</dt>
        <dd class="font-medium capitalize">{String(app.status || '').replaceAll('_', ' ')}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('businessName')}</dt>
        <dd class="font-medium">{app.businessName}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('city')}</dt>
        <dd class="font-medium">{app.city}{app.region ? `, ${app.region}` : ''}</dd>
      </div>
      {#if app.rejectionReason}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('rejectionReason')}</dt>
          <dd class="font-medium">{app.rejectionReason}</dd>
        </div>
      {/if}
      {#if app.reviewRemarks}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('reviewRemarks')}</dt>
          <dd class="font-medium">{app.reviewRemarks}</dd>
        </div>
      {/if}
    </dl>
    <p class="text-sm text-muted">{app.nextSteps}</p>
    {#if app.status === 'approved'}
      <Button href="/app/supplier" variant="primary">{$t('openSupplierPortal')}</Button>
    {/if}
  {/if}
</section>
