<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let loading = $state(true);
  let error = $state('');
  let app = $state<any>(null);

  async function load() {
    loading = true;
    error = '';
    try {
      app = await api('/api/v1/shop-applications/mine');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      app = null;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function statusLabel(status: string) {
    return String(status || '').replaceAll('_', ' ');
  }
</script>

<section class="mx-auto max-w-2xl space-y-6">
  <PageHeader title={$t('applicationStatusTitle')} subtitle={$t('applicationStatusSubtitle')} />

  {#if loading}
    <Skeleton class="h-48" />
  {:else if error}
    <Alert type="error" role="alert" message={error} />
    <Button variant="secondary" onclick={load}>{$t('refresh')}</Button>
  {:else if app}
    <div class="surface-card space-y-4 p-5">
      <dl class="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-muted">{$t('applicationReference')}</dt>
          <dd class="font-mono font-medium">{app.id}</dd>
        </div>
        <div>
          <dt class="text-muted">{$t('status')}</dt>
          <dd class="font-medium capitalize">{statusLabel(app.status)}</dd>
        </div>
        <div class="sm:col-span-2">
          <dt class="text-muted">{$t('shopName')}</dt>
          <dd class="font-medium">{app.shopName}</dd>
        </div>
        <div>
          <dt class="text-muted">{$t('submittedAt')}</dt>
          <dd>{app.submittedAt ? new Date(app.submittedAt).toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt class="text-muted">{$t('city')}</dt>
          <dd>{app.city}{app.region ? `, ${app.region}` : ''}</dd>
        </div>
      </dl>

      {#if app.reviewRemarks}
        <Alert type="info" message={`${$t('reviewRemarks')}: ${app.reviewRemarks}`} />
      {/if}
      {#if app.rejectionReason}
        <Alert type="error" message={`${$t('rejectionReason')}: ${app.rejectionReason}`} />
      {/if}

      <div>
        <h2 class="text-sm font-semibold">{$t('applicationNextSteps')}</h2>
        <p class="mt-1 text-sm text-muted">{app.nextSteps}</p>
      </div>

      <div>
        <h2 class="text-sm font-semibold">{$t('contactSupport')}</h2>
        <p class="mt-1 text-sm text-muted">{$t('applicationContactHint')}</p>
      </div>

      <div class="flex flex-wrap gap-2 pt-2">
        <Button variant="secondary" onclick={load}>{$t('refresh')}</Button>
        {#if app.status === 'approved' || app.status === 'provisioned'}
          <Button href="/app/admin" variant="primary">{$t('openShopAdmin')}</Button>
        {/if}
      </div>
    </div>
  {/if}
</section>
