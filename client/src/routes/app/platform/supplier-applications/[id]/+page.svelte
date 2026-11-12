<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { partCategoryLabel } from '$lib/partCategories';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  type Detail = {
    id: string;
    status: string;
    contactPerson: string;
    businessEmail: string;
    businessPhone?: string;
    businessName: string;
    address: string;
    city: string;
    region: string;
    description: string;
    partCategories: string[];
    supportedBrands?: string[];
    deliveryCities?: string[];
    logoUrl?: string;
    verificationDocuments?: Array<{ name: string; dataUrl?: string }>;
    submittedAt?: string;
    rejectionReason?: string;
    reviewRemarks?: string;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
    approvedAt?: string | null;
  };

  let detail = $state<Detail | null>(null);
  let audit = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let actionError = $state('');
  let actionOk = $state('');
  let busy = $state(false);
  let remarks = $state('');
  let rejectReason = $state('');
  let suspendReason = $state('');
  let showReject = $state(false);
  let showSuspend = $state(false);

  const publicId = $derived($page.params.id);

  async function load() {
    loading = true;
    error = '';
    try {
      detail = await api<Detail>(`/api/v1/platform/supplier-applications/${publicId}`);
      audit = (await api<any[]>(`/api/v1/platform/supplier-applications/${publicId}/audit`)) || [];
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
      await api(`/api/v1/platform/supplier-applications/${detail.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ remarks: remarks.trim() || undefined })
      });
      actionOk = 'Supplier approved and provisioned.';
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
      await api(`/api/v1/platform/supplier-applications/${detail.id}/reject`, {
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

  async function suspend() {
    if (!detail || busy) return;
    if (suspendReason.trim().length < 5) {
      actionError = 'Suspension reason must be at least 5 characters.';
      return;
    }
    if (!confirm($t('confirmSuspend'))) return;
    if (!confirm($t('confirmSensitiveAction'))) return;
    busy = true;
    actionError = '';
    actionOk = '';
    try {
      await api(`/api/v1/platform/supplier-applications/${detail.id}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason: suspendReason.trim() })
      });
      actionOk = 'Supplier suspended.';
      showSuspend = false;
      await load();
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      busy = false;
    }
  }

  async function reactivate() {
    if (!detail || busy) return;
    if (!confirm($t('confirmReactivate'))) return;
    busy = true;
    actionError = '';
    actionOk = '';
    try {
      await api(`/api/v1/platform/supplier-applications/${detail.id}/reactivate`, {
        method: 'POST',
        body: JSON.stringify({ remarks: remarks.trim() || undefined })
      });
      actionOk = 'Supplier reactivated.';
      await load();
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      busy = false;
    }
  }

  const isPending = $derived(detail ? detail.status === 'pending_review' : false);
  const isApproved = $derived(detail ? detail.status === 'approved' : false);
  const isSuspended = $derived(detail ? detail.status === 'suspended' : false);
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <Button variant="outline" size="sm" onclick={() => goto('/app/platform/supplier-applications')}>
    ← {$t('backToApplications')}
  </Button>

  {#if error}
    <Alert type="error" role="alert" message={error} />
  {:else if loading}
    <div class="space-y-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-16" />{/each}
    </div>
  {:else if detail}
    <PageHeader title={detail.businessName} subtitle={`${$t('applicationDetail')} · ${detail.id}`}>
      <StatusPill status={detail.status} />
    </PageHeader>

    {#if actionError}<Alert type="error" role="alert" message={actionError} />{/if}
    {#if actionOk}<Alert type="success" role="status" message={actionOk} />{/if}

    <dl class="surface-card grid gap-3 p-4 sm:grid-cols-2">
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('contactPerson')}</dt>
        <dd class="font-medium text-ink">{detail.contactPerson}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('businessEmail')}</dt>
        <dd class="font-medium text-ink">{detail.businessEmail}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('phone')}</dt>
        <dd class="font-medium text-ink">{detail.businessPhone || '—'}</dd>
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
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('partCategories')}</dt>
        <dd class="font-medium text-ink">
          {(detail.partCategories || []).map(partCategoryLabel).join(', ') || '—'}
        </dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('supportedBrands')}</dt>
        <dd class="font-medium text-ink">{(detail.supportedBrands || []).join(', ') || '—'}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('deliveryCoverage')}</dt>
        <dd class="font-medium text-ink">{(detail.deliveryCities || []).join(', ') || '—'}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-muted">{$t('businessDescription')}</dt>
        <dd class="whitespace-pre-wrap font-medium text-ink">{detail.description}</dd>
      </div>
      {#if detail.logoUrl}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('optionalLogo')}</dt>
          <dd class="mt-1"><img src={detail.logoUrl} alt="" class="h-16 w-16 rounded object-cover" /></dd>
        </div>
      {/if}
      {#if detail.verificationDocuments?.length}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('supportingDocuments')}</dt>
          <dd class="mt-1 space-y-1">
            {#each detail.verificationDocuments as doc}
              <div>
                {#if doc.dataUrl}
                  <a class="text-accent underline" href={doc.dataUrl} target="_blank" rel="noreferrer">{doc.name}</a>
                {:else}
                  {doc.name}
                {/if}
              </div>
            {/each}
          </dd>
        </div>
      {/if}
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
      {#if detail.rejectionReason}
        <div class="sm:col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted">{$t('rejectionReason')}</dt>
          <dd class="font-medium text-ink">{detail.rejectionReason}</dd>
        </div>
      {/if}
    </dl>

    {#if isPending}
      <div class="surface-card space-y-3 p-4">
        <label class="block text-sm"
          >{$t('approvalRemarks')}
          <textarea class="input-field mt-1 w-full" rows="2" bind:value={remarks}></textarea>
        </label>
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onclick={approve}>{$t('approveApplication')}</Button>
          <Button variant="outline" disabled={busy} onclick={() => (showReject = !showReject)}>
            {$t('rejectApplication')}
          </Button>
        </div>
        {#if showReject}
          <label class="block text-sm"
            >{$t('rejectionReasonLabel')}
            <textarea class="input-field mt-1 w-full" rows="3" bind:value={rejectReason}></textarea>
          </label>
          <Button variant="danger" disabled={busy} onclick={reject}>{$t('rejectApplication')}</Button>
        {/if}
      </div>
    {/if}

    {#if isApproved}
      <div class="surface-card space-y-3 p-4">
        <Button variant="outline" disabled={busy} onclick={() => (showSuspend = !showSuspend)}>
          {$t('suspendSupplier')}
        </Button>
        {#if showSuspend}
          <label class="block text-sm"
            >Suspension reason
            <textarea class="input-field mt-1 w-full" rows="3" bind:value={suspendReason}></textarea>
          </label>
          <Button variant="danger" disabled={busy} onclick={suspend}>{$t('suspendSupplier')}</Button>
        {/if}
      </div>
    {/if}
    {#if isSuspended}
      <div class="surface-card p-4">
        <label class="mb-3 block text-sm"
          >{$t('approvalRemarks')}
          <textarea class="input-field mt-1 w-full" rows="2" bind:value={remarks}></textarea>
        </label>
        <Button variant="primary" disabled={busy} onclick={reactivate}>{$t('reactivateSupplier')}</Button>
      </div>
    {/if}

    <section class="surface-card space-y-2 p-4" aria-labelledby="app-history">
      <h2 id="app-history" class="text-lg font-semibold text-ink">{$t('applicationHistory')}</h2>
      {#if !audit.length}
        <p class="text-sm text-muted" role="status">{$t('noAuditEntries')}</p>
      {:else}
        <ul class="space-y-2 text-sm" role="list">
          {#each audit as entry}
            <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2">
              <span class="font-medium text-ink">{entry.action}</span>
              {#if entry.actorLabel}<span class="text-muted"> · {entry.actorLabel}</span>{/if}
              <span class="text-muted"> · {formatDate(entry.createdAt)}</span>
              {#if entry.reason || entry.remarks}
                <p class="mt-1 text-muted">{entry.reason || entry.remarks}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>
