<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';

  type Detail = {
    id: string;
    status: string;
    ownerName: string;
    ownerPhone?: string;
    businessEmail: string;
    businessPhone?: string;
    shopName: string;
    address: string;
    city: string;
    region: string;
    serviceCategories: string[];
    supportedDevices?: string[];
    supportedBrands?: string[];
    servicesDescription: string;
    mechanicCount?: number | null;
    submittedAt?: string;
    rejectionReason?: string;
    reviewRemarks?: string;
    reviewedAt?: string | null;
    approvedAt?: string | null;
  };

  let detail = $state<Detail | null>(null);
  let loading = $state(true);
  let error = $state('');
  let actionError = $state('');
  let actionOk = $state('');
  let busy = $state(false);
  let remarks = $state('');
  let rejectReason = $state('');
  let showReject = $state(false);

  const publicId = $derived($page.params.id);

  async function load() {
    loading = true;
    error = '';
    try {
      detail = await api<Detail>(`/api/v1/platform/shop-applications/${publicId}`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      detail = null;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function formatDate(value?: string | null) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  async function approve() {
    if (!detail || busy) return;
    if (!confirm($t('confirmApprove'))) return;
    busy = true;
    actionError = '';
    actionOk = '';
    try {
      await api(`/api/v1/platform/shop-applications/${detail.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ remarks: remarks.trim() || undefined })
      });
      actionOk = 'Application approved and shop provisioned.';
      await load();
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      busy = false;
    }
  }

  async function reject() {
    if (!detail || busy) return;
    if (rejectReason.trim().length < 5) {
      actionError = 'Rejection reason must be at least 5 characters.';
      return;
    }
    busy = true;
    actionError = '';
    actionOk = '';
    try {
      await api(`/api/v1/platform/shop-applications/${detail.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() })
      });
      actionOk = 'Application rejected.';
      showReject = false;
      await load();
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      busy = false;
    }
  }

  const isPending = $derived(
    detail
      ? ['pending', 'pending_review', 'contacted'].includes(detail.status)
      : false
  );
</script>

<section class="space-y-6">
  <div>
    <button type="button" class="text-sm text-accent underline" onclick={() => goto('/app/platform/shop-applications')}>
      ← {$t('backToApplications')}
    </button>
    <h1 class="mt-2 text-2xl font-semibold">{$t('applicationDetail')}</h1>
  </div>

  {#if error}
    <Alert type="error" role="alert" message={error} />
  {:else if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if detail}
    {#if actionError}
      <Alert type="error" role="alert" message={actionError} />
    {/if}
    {#if actionOk}
      <Alert type="success" role="status" message={actionOk} />
    {/if}

    <dl class="grid gap-3 rounded-lg border border-border bg-surface-elevated p-4 sm:grid-cols-2">
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('applicationReference')}</dt>
        <dd class="font-medium">{detail.id}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('status')}</dt>
        <dd class="font-medium capitalize">{detail.status.replaceAll('_', ' ')}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('ownerName')}</dt>
        <dd class="font-medium">{detail.ownerName}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('businessEmail')}</dt>
        <dd class="font-medium">{detail.businessEmail}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('shopName')}</dt>
        <dd class="font-medium">{detail.shopName}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('city')}</dt>
        <dd class="font-medium">{detail.city}, {detail.region}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('address')}</dt>
        <dd class="font-medium">{detail.address}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('serviceCategories')}</dt>
        <dd class="font-medium">{(detail.serviceCategories || []).join(', ') || '—'}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('servicesDescription')}</dt>
        <dd class="font-medium whitespace-pre-wrap">{detail.servicesDescription}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('submissionDate')}</dt>
        <dd class="font-medium">{formatDate(detail.submittedAt)}</dd>
      </div>
      {#if detail.rejectionReason}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('rejectionReasonLabel')}</dt>
          <dd class="font-medium">{detail.rejectionReason}</dd>
        </div>
      {/if}
    </dl>

    {#if isPending}
      <div class="space-y-4 rounded-lg border border-border p-4">
        <label class="block text-sm">
          <span class="mb-1 block text-muted">{$t('approvalRemarks')}</span>
          <textarea class="input min-h-20 w-full" bind:value={remarks} maxlength="2000"></textarea>
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" disabled={busy} onclick={approve}>
            {$t('approveApplication')}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy}
            onclick={() => (showReject = !showReject)}
          >
            {$t('rejectApplication')}
          </button>
        </div>

        {#if showReject}
          <label class="block text-sm">
            <span class="mb-1 block text-muted">{$t('rejectionReasonLabel')} *</span>
            <textarea class="input min-h-24 w-full" bind:value={rejectReason} maxlength="2000"></textarea>
          </label>
          <button type="button" class="btn btn-danger" disabled={busy} onclick={reject}>
            {$t('rejectApplication')}
          </button>
        {/if}
      </div>
    {/if}
  {/if}
</section>
