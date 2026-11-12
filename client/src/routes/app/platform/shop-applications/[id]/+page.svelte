<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

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
    reviewedBy?: string | null;
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
    if (!confirm($t('confirmSensitiveAction'))) return;
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
    if (!confirm($t('confirmSensitiveAction'))) return;
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
    detail ? ['pending', 'pending_review', 'contacted'].includes(detail.status) : false
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <Button variant="outline" size="sm" onclick={() => goto('/app/platform/shop-applications')}>
    ← {$t('backToApplications')}
  </Button>

  {#if error}
    <Alert type="error" role="alert" message={error} />
  {:else if loading}
    <div class="space-y-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-16" />{/each}
    </div>
  {:else if detail}
    <PageHeader title={detail.shopName} subtitle={`${$t('applicationDetail')} · ${detail.id}`}>
      <StatusPill status={detail.status} />
    </PageHeader>

    {#if actionError}<Alert type="error" role="alert" message={actionError} />{/if}
    {#if actionOk}<Alert type="success" role="status" message={actionOk} />{/if}

    <dl class="surface-card grid gap-3 p-4 sm:grid-cols-2">
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('ownerName')}</dt>
        <dd class="font-medium text-ink">{detail.ownerName}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('businessEmail')}</dt>
        <dd class="font-medium text-ink">{detail.businessEmail}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('phone')}</dt>
        <dd class="font-medium text-ink">{detail.businessPhone || detail.ownerPhone || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('city')}</dt>
        <dd class="font-medium text-ink">{detail.city}, {detail.region}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('address')}</dt>
        <dd class="font-medium text-ink">{detail.address}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('serviceCategories')}</dt>
        <dd class="font-medium text-ink">{(detail.serviceCategories || []).join(', ') || '—'}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('servicesDescription')}</dt>
        <dd class="whitespace-pre-wrap font-medium text-ink">{detail.servicesDescription}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('submissionDate')}</dt>
        <dd class="font-medium text-ink">{formatDate(detail.submittedAt)}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('reviewerIdentity')}</dt>
        <dd class="font-medium text-ink">{detail.reviewedBy || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('reviewHistory')}</dt>
        <dd class="font-medium text-ink">{formatDate(detail.reviewedAt || detail.approvedAt)}</dd>
      </div>
      {#if detail.reviewRemarks}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('approvalRemarks')}</dt>
          <dd class="font-medium text-ink">{detail.reviewRemarks}</dd>
        </div>
      {/if}
      {#if detail.rejectionReason}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('rejectionReasonLabel')}</dt>
          <dd class="font-medium text-ink">{detail.rejectionReason}</dd>
        </div>
      {/if}
    </dl>

    {#if isPending}
      <div class="surface-card space-y-4 p-4">
        <label class="block text-sm">
          <span class="mb-1 block text-muted">{$t('approvalRemarks')}</span>
          <textarea class="input-field min-h-20 w-full" bind:value={remarks} maxlength="2000"></textarea>
        </label>
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onclick={approve}>{$t('approveApplication')}</Button>
          <Button variant="danger" disabled={busy} onclick={() => (showReject = !showReject)}>
            {$t('rejectApplication')}
          </Button>
        </div>
        {#if showReject}
          <label class="block text-sm">
            <span class="mb-1 block text-muted">{$t('rejectionReasonLabel')} *</span>
            <textarea class="input-field min-h-24 w-full" bind:value={rejectReason} maxlength="2000"></textarea>
          </label>
          <Button variant="danger" disabled={busy} onclick={reject}>{$t('rejectApplication')}</Button>
        {/if}
      </div>
    {/if}
  {/if}
</section>
