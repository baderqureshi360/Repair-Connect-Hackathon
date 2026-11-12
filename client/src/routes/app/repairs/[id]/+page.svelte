<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { announce } from '$lib/stores/ui';
  import Alert from '$lib/components/Alert.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Button from '$lib/components/Button.svelte';
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
  import { confirmIfDirty } from '$lib/keyboard/unsaved';
  import { toasts } from '$lib/stores/toast';

  let detail = $state<any>(null);
  let error = $state('');
  let message = $state('');
  let staff = $state<any[]>([]);
  let parts = $state<any[]>([]);

  let showAssign = $state(false);
  let showDiag = $state(false);
  let showEst = $state(false);
  let showParts = $state(false);
  let showComplete = $state(false);

  let mechanicId = $state('');
  let findings = $state('');
  let recommendedActions = $state('');
  let laborCost = $state(0);
  let partsCost = $state(0);
  let partId = $state('');
  let quantity = $state(1);
  let workPerformed = $state('');
  let finalCost = $state(0);
  let rejectReason = $state('');
  let feedbackRating = $state(5);
  let feedbackComment = $state('');
  let laborMinutes = $state(0);
  let priority = $state('normal');
  let deadline = $state('');
  let customerNotes = $state('');
  let internalNotes = $state('');
  let checklistText = $state('Inspect hardware\nTest after repair\nClean device');
  let busy = $state(false);
  let messages = $state<any[]>([]);
  let messageBody = $state('');
  let messageVisibility = $state<'customer_visible' | 'internal'>('customer_visible');
  let messageType = $state<'general' | 'status_update' | 'estimate' | 'payment' | 'system'>('general');
  let revealedAccessCode = $state('');
  let completionSummary = $state('');
  let closureNotes = $state('');
  let payNotes = $state('');
  let showReverse = $state(false);
  let reverseTarget = $state<any>(null);
  let reverseAmount = $state(0);
  let reverseReason = $state('');
  let reverseConfirm = $state(false);

  const diagDirty = $derived(Boolean(findings.trim() || recommendedActions.trim()));
  const estDirty = $derived(Number(laborCost) > 0 || Number(partsCost) > 0);
  const reverseDirty = $derived(
    Boolean(reverseReason.trim() || reverseConfirm || Number(reverseAmount) > 0)
  );
  const editorDirty = $derived(
    (showDiag && diagDirty) || (showEst && estDirty) || (showReverse && reverseDirty)
  );

  function closeDiag() {
    if (!confirmIfDirty(diagDirty, $t('unsavedChangesWarning'))) return;
    showDiag = false;
    findings = '';
    recommendedActions = '';
  }

  function closeEst() {
    if (!confirmIfDirty(estDirty, $t('unsavedChangesWarning'))) return;
    showEst = false;
    laborCost = 0;
    partsCost = 0;
  }

  function closeReverse() {
    if (!confirmIfDirty(reverseDirty, $t('unsavedChangesWarning'))) return;
    showReverse = false;
    reverseReason = '';
    reverseConfirm = false;
    reverseAmount = 0;
  }

  async function load() {
    detail = await api(`/api/v1/repairs/${$page.params.id}`);
    messages = await api<any[]>(`/api/v1/repairs/${$page.params.id}/messages`).catch(() => []);
    if ($user?.role === 'shop_admin') {
      const memberships = await api<any[]>(`/api/v1/auth/staff?shopId=${detail.repair.shop._id || detail.repair.shop}`);
      staff = memberships.filter((m) => m.role === 'mechanic');
      if (staff[0]) mechanicId = staff[0].user._id;
    }
    if ($user?.role === 'mechanic' || $user?.role === 'shop_admin') {
      const res = await api<{ data: any[] }>(`/api/v1/parts?shopId=${detail.repair.shop._id || detail.repair.shop}`, { full: true });
      parts = res.data || [];
      if (parts[0]) partId = parts[0]._id;
    }
  }

  async function sendMessage() {
    if (!messageBody.trim()) return;
    await run(async () => {
      await api(`/api/v1/repairs/${$page.params.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: messageBody.trim(),
          visibility: $user?.role === 'customer' ? 'customer_visible' : messageVisibility,
          messageType: $user?.role === 'customer' ? 'general' : messageType
        })
      });
      messageBody = '';
    });
  }

  async function closeCase(repairId: string) {
    await run(async () => {
      await api(`/api/v1/repairs/${repairId}/close`, {
        method: 'POST',
        body: JSON.stringify({ notes: closureNotes || 'Case closed' })
      });
      closureNotes = '';
    });
  }

  async function regenerateTracking() {
    await run(async () => {
      const res = await api<{ trackingAccessCode: string; trackingToken: string }>(
        `/api/v1/repairs/${$page.params.id}/tracking/regenerate`,
        { method: 'POST' }
      );
      revealedAccessCode = res.trackingAccessCode;
      toasts.success($t('regenerateTracking'));
    });
  }

  onMount(() => {
    load().catch((err) => {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    });
  });

  async function run(action: () => Promise<void>) {
    error = '';
    message = '';
    busy = true;
    try {
      await action();
      message = $t('success');
      announce.set($t('success'));
      toasts.success($t('success'));
      await load();
      showAssign = showDiag = showEst = showParts = showComplete = false;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      if (err instanceof ApiError && err.details) {
        error += ` (${JSON.stringify(err.details)})`;
      }
      toasts.error(error);
    } finally {
      busy = false;
    }
  }

  function trackingUrl(token: string) {
    return `${window.location.origin}/track/${token}`;
  }

  async function copyTracking(token: string) {
    try {
      await navigator.clipboard.writeText(trackingUrl(token));
      toasts.success($t('copyTrackingLink'));
    } catch {
      toasts.error($t('errorGeneric'));
    }
  }

  async function submitFeedback(repairId: string) {
    await run(() =>
      api(`/api/v1/repairs/${repairId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ rating: Number(feedbackRating), comment: feedbackComment })
      }).then(() => undefined)
    );
  }

  async function saveWorkspace(repairId: string) {
    const checklist = checklistText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((label) => ({ label, done: false, visibility: 'internal' as const }));
    await run(() =>
      api(`/api/v1/repairs/${repairId}/workspace`, {
        method: 'PATCH',
        body: JSON.stringify({
          priority,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          laborMinutes: Number(laborMinutes),
          customerNotes,
          internalNotes,
          diagnosisChecklist: checklist
        })
      }).then(() => undefined)
    );
  }

  let payAmount = $state(0);
  let payMethod = $state<
    'cash' | 'card' | 'bank_transfer' | 'jazzcash' | 'easypaisa' | 'mobile_other' | 'other'
  >('cash');
  let payReference = $state('');

  async function issueDoc(repairId: string, docType: string, paymentId?: string) {
    try {
      const doc = await api<{ _id: string }>(`/api/v1/documents/issue`, {
        method: 'POST',
        body: JSON.stringify({ repairId, docType, paymentId })
      });
      toasts.success('Document issued');
      window.location.href = `/app/documents/${doc._id}`;
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  async function previewOrPrintReceipt(repairId: string, preferExisting = true) {
    try {
      if (preferExisting) {
        const docs = await api<any[]>(`/api/v1/documents?repairId=${repairId}&docType=invoice`);
        const latest = Array.isArray(docs) ? docs[0] : null;
        if (latest?._id) {
          window.location.href = `/app/documents/${latest._id}`;
          return;
        }
      }
      await issueDoc(repairId, 'invoice');
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  async function downloadReceipt(repairId: string) {
    try {
      await previewOrPrintReceipt(repairId, false);
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  async function recordPayment(repairId: string) {
    await run(() =>
      api(`/api/v1/documents/payments`, {
        method: 'POST',
        body: JSON.stringify({
          repairId,
          amount: Number(payAmount),
          method: payMethod,
          reference: payReference || undefined,
          notes: payNotes || undefined,
          confirmedReceived: true,
          idempotencyKey: `ui-${repairId}-${Number(payAmount)}-${payMethod}-${Date.now()}`
        })
      }).then(async (payment: any) => {
        if (payment?._id) {
          await issueDoc(repairId, 'payment_receipt', payment._id);
        }
      })
    );
  }

  function openReverse(p: any) {
    reverseTarget = p;
    reverseAmount = Number(p.remainingReversible || 0);
    reverseReason = '';
    reverseConfirm = false;
    showReverse = true;
  }

  async function submitReverse() {
    if (!reverseTarget || !reverseConfirm) return;
    const amount = Number(reverseAmount);
    const remaining = Number(reverseTarget.remainingReversible || 0);
    if (!(amount > 0) || amount - remaining > 0.009) {
      toasts.error($t('reversalExceedsRemaining'));
      return;
    }
    if (reverseReason.trim().length < 5) {
      toasts.error($t('reversalReasonRequired'));
      return;
    }
    await run(async () => {
      await api(`/api/v1/documents/payments/${reverseTarget.id || reverseTarget._id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          reason: reverseReason.trim(),
          idempotencyKey: `ui-rev-${reverseTarget.id || reverseTarget._id}-${amount}-${Date.now()}`
        })
      });
      showReverse = false;
      reverseTarget = null;
      announce.set($t('reversalSuccess'));
      toasts.success($t('reversalSuccess'));
      await load();
    });
  }
</script>

{#if !detail && !error}
  <p class="text-sm text-muted" role="status">{$t('loading')}</p>
{:else if error && !detail}
  <Alert type="error" role="alert" message={error} />
{:else if detail}
  {@const repair = detail.repair}
  {@const pendingEstimate =
    $user?.role === 'customer'
      ? detail.estimates?.find((est: any) => est.status === 'pending' && repair.status === 'estimate_pending')
      : null}
  <section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <UnsavedChangesGuard dirty={editorDirty} />
    <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">
          {$user?.role === 'customer' ? $t('myRepairs') : $t('assignedJobs')}
        </p>
        <h1 class="mt-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">{repair.referenceNumber}</h1>
        <p class="mt-1 text-sm text-muted">{repair.brand} {repair.model} · {repair.deviceType}</p>
        {#if detail.readiness}
          <p class="mt-2 text-sm" role="status" data-testid="readiness-message">
            {$user?.role === 'customer' ? detail.readiness.customerMessage : detail.readiness.staffMessage}
          </p>
          <p class="sr-only" data-testid="parts-requirement-status">
            {detail.readiness.partsRequirementStatus}
          </p>
          <p class="sr-only" data-testid="can-start-repair">{detail.readiness.canStartRepair ? 'yes' : 'no'}</p>
          {#if !detail.readiness.canStartRepair && detail.readiness.reasons?.length && ($user?.role === 'mechanic' || $user?.role === 'shop_admin')}
            <p class="mt-1 text-xs text-muted">{detail.readiness.reasons.join(' · ')}</p>
          {/if}
        {/if}
      </div>
      <div class="text-end">
        {#if detail.customerStatus}
          <p class="text-sm font-medium" data-testid="customer-status">{detail.customerStatus.label}</p>
        {/if}
        <StatusPill status={repair.status} />
      </div>
    </header>

    {#if error}<Alert type="error" role="alert" message={error} />{/if}
    {#if message}<Alert type="success" message={message} />{/if}

    {#if $user?.role === 'customer' && (pendingEstimate || detail.customerStatus?.nextAction || detail.readiness?.customerMessage)}
      <section class="priorities-panel rounded-[var(--radius-ui)] p-4" aria-labelledby="customer-next-action">
        <h2 id="customer-next-action" class="priorities-title mb-1 text-sm font-semibold">{$t('nextAction')}</h2>
        <p class="priorities-hint text-xs">
          {#if pendingEstimate}
            {$t('reviewEstimates')}
          {:else if detail.customerStatus?.nextAction}
            {detail.customerStatus.nextAction}
          {:else}
            {detail.readiness?.customerMessage}
          {/if}
        </p>
        {#if pendingEstimate}
          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              data-testid="approve-estimate"
              loading={busy}
              onclick={() =>
                run(() =>
                  api(`/api/v1/repairs/estimates/${pendingEstimate._id}/decision`, {
                    method: 'POST',
                    body: JSON.stringify({ decision: 'approved' })
                  }).then(() => undefined)
                )}
            >
              {$t('approve')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy}
              onclick={() => {
                if (confirm($t('confirmReject'))) {
                  run(() =>
                    api(`/api/v1/repairs/estimates/${pendingEstimate._id}/decision`, {
                      method: 'POST',
                      body: JSON.stringify({ decision: 'rejected', reason: rejectReason || 'Rejected' })
                    }).then(() => undefined)
                  );
                }
              }}
            >
              {$t('reject')}
            </Button>
          </div>
        {/if}
      </section>
    {/if}

    {#if $user?.role === 'mechanic'}
      {@const canDiagnose = ['assigned', 'diagnosing'].includes(repair.status)}
      {@const canEstimate = [
        'diagnosing',
        'estimate_rejected',
        'estimate_approved',
        'awaiting_parts',
        'parts_reserved',
        'ready_to_start'
      ].includes(repair.status)}
      {@const canRequestParts = [
        'estimate_approved',
        'awaiting_parts',
        'parts_reserved',
        'ready_to_start',
        'in_progress'
      ].includes(repair.status)}
      {@const startEligibleStatus = [
        'estimate_approved',
        'awaiting_parts',
        'parts_reserved',
        'ready_to_start'
      ].includes(repair.status)}
      {@const canStart = Boolean(detail.readiness?.canStartRepair && startEligibleStatus)}
      {@const canComplete = repair.status === 'in_progress'}
      <section class="priorities-panel rounded-[var(--radius-ui)] p-4" aria-labelledby="mechanic-workflow">
        <h2 id="mechanic-workflow" class="priorities-title mb-1 text-sm font-semibold">{$t('mechanicWorkflowTitle')}</h2>
        <p class="priorities-hint mb-3 text-xs">{$t('mechanicWorkflowHint')}</p>
        <ol class="mb-3 list-decimal space-y-1 ps-5 text-sm text-ink">
          <li class={canDiagnose ? 'font-medium' : 'text-muted'}>{$t('diagnose')}</li>
          <li class={canEstimate ? 'font-medium' : 'text-muted'}>{$t('estimate')}</li>
          <li class={canRequestParts ? 'font-medium' : 'text-muted'}>{$t('requestParts')}</li>
          <li class={canStart ? 'font-medium' : 'text-muted'}>{$t('startWork')}</li>
          <li class={canComplete ? 'font-medium' : 'text-muted'}>{$t('complete')}</li>
        </ol>
        <div class="mt-3 flex flex-wrap gap-2">
          {#if canDiagnose}
            <Button size="sm" variant="primary" onclick={() => (showDiag = true)}>{$t('diagnose')}</Button>
          {/if}
          {#if canEstimate}
            <Button size="sm" variant="outline" onclick={() => (showEst = true)}>{$t('estimate')}</Button>
          {/if}
          {#if canRequestParts}
            <Button size="sm" variant="outline" onclick={() => (showParts = true)}>{$t('requestParts')}</Button>
          {/if}
          {#if canStart}
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              data-testid="start-work"
              onclick={() =>
                run(() =>
                  api(`/api/v1/repairs/${repair._id}/start`, {
                    method: 'POST',
                    body: '{}'
                  }).then(() => undefined)
                )}
            >
              {$t('startWork')}
            </Button>
          {:else if startEligibleStatus}
            <Button size="sm" variant="outline" disabled ariaLabel={$t('startWorkBlocked')}>{$t('startWork')}</Button>
          {/if}
          {#if canComplete}
            <Button size="sm" variant="primary" onclick={() => (showComplete = true)}>{$t('complete')}</Button>
          {/if}
        </div>
        {#if startEligibleStatus && !detail.readiness?.canStartRepair}
          <div class="mt-3">
            <Alert
              type="warning"
              message={`${$t('actionUnavailable')}: ${$t('startWorkBlocked')}${detail.readiness?.reasons?.length ? ` — ${detail.readiness.reasons.join(' · ')}` : ''}`}
            />
          </div>
        {/if}
      </section>
    {/if}

    {#if detail.paymentSummary}
      <article class="surface-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={$t('paymentStatus')}>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">{$t('totalDue')}</p>
          <p class="mt-1 font-semibold text-ink">{detail.paymentSummary.totalDue} PKR</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">{$t('amountPaid')}</p>
          <p class="mt-1 font-semibold text-ink">{detail.paymentSummary.amountPaid} PKR</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">{$t('outstanding')}</p>
          <p class="mt-1 font-semibold text-ink">{detail.paymentSummary.outstanding} PKR</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">{$t('paymentStatus')}</p>
          <p class="mt-1 font-semibold capitalize text-ink">{String(detail.paymentSummary.status).replaceAll('_', ' ')}</p>
        </div>
      </article>
    {/if}

    <div class="grid gap-4 lg:grid-cols-2">
      <article class="surface-card p-4">
        <h2 class="font-semibold">{$t('problem')}</h2>
        <p class="mt-2 text-sm">{repair.problemDescription}</p>
        <p class="mt-3 text-sm text-muted">{repair.shop?.name} · {repair.customer?.name}</p>
        {#if $user?.role === 'customer' && repair.shop}
          <div class="mt-3 rounded-[var(--radius-ui)] bg-surface-muted px-3 py-2 text-sm">
            <p class="font-medium text-ink">{repair.shop.name}</p>
            {#if repair.shop.address || repair.shop.city}
              <p class="text-muted">{[repair.shop.address, repair.shop.city].filter(Boolean).join(' · ')}</p>
            {/if}
            {#if repair.shop.phone}
              <p class="text-muted">
                <a class="underline" href={`tel:${repair.shop.phone}`}>{repair.shop.phone}</a>
              </p>
            {/if}
          </div>
        {/if}
        {#if repair.serialNumber}
          <p class="mt-2 text-sm"><strong>{$t('serialNumber')}:</strong> {repair.serialNumber}</p>
        {/if}
        {#if repair.accessories}
          <p class="mt-1 text-sm"><strong>{$t('accessories')}:</strong> {repair.accessories}</p>
        {/if}
        {#if repair.priority}
          <p class="mt-1 text-sm"><strong>{$t('priority')}:</strong> {repair.priority}</p>
        {/if}
        {#if repair.deadline}
          <p class="mt-1 text-sm"><strong>{$t('deadline')}:</strong> {new Date(repair.deadline).toLocaleString()}</p>
        {/if}
        {#if repair.finalCost != null}
          <p class="mt-2 text-sm"><strong>{$t('finalCost')}:</strong> {repair.finalCost} PKR</p>
        {/if}
        {#if repair.workPerformed}
          <p class="mt-2 text-sm"><strong>{$t('workPerformed')}:</strong> {repair.workPerformed}</p>
        {/if}
        {#if repair.warrantyExpiresAt}
          <p class="mt-2 text-sm"><strong>{$t('warranty')}:</strong> {new Date(repair.warrantyExpiresAt).toLocaleDateString()}</p>
        {/if}
        {#if repair.trackingToken}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onclick={() => copyTracking(repair.trackingToken)}>{$t('copyTrackingLink')}</Button>
            <a class="text-sm text-accent underline" href={`/track/${repair.trackingToken}`} target="_blank" rel="noreferrer">{$t('publicTracking')}</a>
            {#if $user?.role === 'customer' || $user?.role === 'shop_admin' || $user?.role === 'mechanic'}
              <Button size="sm" variant="outline" onclick={() => regenerateTracking()}>{$t('regenerateTracking')}</Button>
            {/if}
            <img
              class="h-24 w-24 rounded border border-border bg-white p-1"
              alt="QR tracking code"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(trackingUrl(repair.trackingToken))}`}
            />
          </div>
          {#if revealedAccessCode}
            <p class="mt-2 text-sm" role="status">
              {$t('trackingAccessCode')}: <code class="font-mono font-semibold">{revealedAccessCode}</code>
              · {$t('reference')}: <code class="font-mono">{repair.referenceNumber}</code>
            </p>
          {/if}
        {/if}
        {#if repair.photos?.length}
          <div class="mt-3 flex flex-wrap gap-2">
            {#each repair.photos as photo}
              {#if $user?.role !== 'customer' || photo.visibility !== 'internal'}
                <img src={photo.url} alt={photo.caption || photo.kind} class="h-16 w-16 rounded object-cover" />
              {/if}
            {/each}
          </div>
        {/if}
      </article>

      <article class="surface-card p-4">
        <h2 class="font-semibold">{$t('timeline')}</h2>
        <ol class="mt-3 space-y-3 border-s-2 border-border ps-4" aria-label={$t('timeline')}>
          {#each detail.history as h}
            <li class="relative">
              <span
                class="absolute -start-[1.35rem] top-1.5 size-2.5 rounded-full bg-accent ring-2 ring-[color:var(--color-surface-elevated)]"
                aria-hidden="true"
              ></span>
              <p class="text-sm font-medium text-ink">{(h.fromStatus || '—')} → {h.toStatus}</p>
              <p class="text-xs text-muted">{new Date(h.changedAt).toLocaleString()}{#if h.note} · {h.note}{/if}</p>
            </li>
          {:else}
            <li class="text-sm text-muted" role="status">{$t('empty')}</li>
          {/each}
        </ol>
      </article>
    </div>

    <article class="surface-card p-4" aria-labelledby="repair-messages">
      <h2 id="repair-messages" class="font-semibold">{$t('messages')}</h2>
      <ul class="mt-3 max-h-72 space-y-3 overflow-y-auto" role="log" aria-live="polite">
        {#if !messages.length}
          <li class="text-sm text-muted">{$t('noMessages')}</li>
        {:else}
          {#each messages as msg}
            <li class="rounded-md border border-border p-3 text-sm" class:opacity-80={msg.unread}>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="font-medium">{msg.senderName} · {msg.senderRole}{#if msg.messageType} · {msg.messageType}{/if}</p>
                <p class="text-xs text-muted">{msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ''}{#if msg.unread} · unread{/if}</p>
              </div>
              {#if msg.visibility === 'internal'}
                <p class="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">{$t('internalNote')}</p>
              {/if}
              <p class="mt-1 whitespace-pre-wrap">{msg.body}</p>
            </li>
          {/each}
        {/if}
      </ul>
      <div class="mt-3 space-y-2">
        {#if $user?.role !== 'customer'}
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={messageVisibility === 'internal'} onchange={(e) => (messageVisibility = (e.currentTarget as HTMLInputElement).checked ? 'internal' : 'customer_visible')} />
            {$t('internalNote')}
          </label>
          <label class="block text-sm">
            <span class="mb-1 block text-muted">Message type</span>
            <select class="input-field" bind:value={messageType}>
              <option value="general">General update</option>
              <option value="status_update">Status update</option>
              <option value="estimate">Estimate</option>
              <option value="payment">Payment</option>
              <option value="system">System</option>
            </select>
          </label>
        {/if}
        <label class="sr-only" for="msg-body">{$t('messages')}</label>
        <textarea id="msg-body" class="input-field w-full" rows="3" placeholder={$t('messagePlaceholder')} bind:value={messageBody}></textarea>
        <Button size="sm" onclick={() => sendMessage()} loading={busy} disabled={!messageBody.trim()}>{$t('sendMessage')}</Button>
      </div>
    </article>

    {#if detail.diagnoses?.length}
      <article class="surface-card p-4">
        <h2 class="font-semibold">{$t('diagnose')}</h2>
        {#each detail.diagnoses as d}
          <div class="mt-3 border-t border-border pt-3 first:border-0 first:pt-0">
            <p class="text-sm"><strong>{$t('findings')}:</strong> {d.findings}</p>
            <p class="mt-1 text-sm"><strong>{$t('recommendedActions')}:</strong> {d.recommendedActions}</p>
          </div>
        {/each}
      </article>
    {/if}

    {#if detail.estimates?.length}
      <article class="surface-card p-4">
        <h2 class="font-semibold">{$t('estimate')}</h2>
        {#each detail.estimates as est}
          <div class="mt-3 border-t border-border pt-3 first:border-0 first:pt-0">
            <p class="text-sm font-medium text-ink">v{est.version} · {est.totalCost} PKR · {est.status}</p>
            <p class="text-xs text-muted">{$t('laborCost')} {est.laborCost} · {$t('partsCost')} {est.partsCost}</p>
            {#if $user?.role === 'customer' && est.status === 'pending' && repair.status === 'estimate_pending'}
              <p class="mt-2 text-xs text-muted">{$t('nextAction')}: {$t('reviewEstimates')}</p>
            {/if}
          </div>
        {/each}
      </article>
    {/if}

    {#if detail.partsRequests?.length}
      <article class="surface-card p-4">
        <h2 class="font-semibold">{$t('partsRequests')}</h2>
        <ul class="mt-2 space-y-2 text-sm" role="list">
          {#each detail.partsRequests as pr}
            <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2">
              <span class="font-medium text-ink">{pr.part?.name || pr.part}</span>
              · qty {pr.quantityRequested} · {pr.status}
              {#if pr.quantityShortage}
                · {$t('shortage')}: {pr.quantityShortage}
              {/if}
            </li>
          {/each}
        </ul>
      </article>
    {/if}

    {#if ($user?.role === 'mechanic' || $user?.role === 'shop_admin') && repair.status !== 'completed'}
      <article class="surface-card space-y-3 p-4">
        <h2 class="font-semibold">{$t('checklist')} / {$t('laborMinutes')}</h2>
        {#if !detail.decisions?.some((d: any) => d.decision === 'approved') && ['in_progress', 'parts_reserved'].includes(repair.status)}
          <Alert type="warning" message="Customer estimate approval is missing before completion." />
        {/if}
        {#if detail.partsRequests?.some((p: any) => ['pending', 'partially_fulfilled'].includes(p.status))}
          <Alert type="warning" message="Outstanding parts requests remain open." />
        {/if}
        <div class="grid gap-3 sm:grid-cols-3">
          <div>
            <label class="mb-1 block text-sm" for="priority">{$t('priority')}</label>
            <select id="priority" class="input-field" bind:value={priority}>
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm" for="deadline">{$t('deadline')}</label>
            <input id="deadline" type="datetime-local" class="input-field" bind:value={deadline} />
          </div>
          <div>
            <label class="mb-1 block text-sm" for="laborMin">{$t('laborMinutes')}</label>
            <input id="laborMin" type="number" min="0" class="input-field" bind:value={laborMinutes} />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm" for="cnotes">Customer-visible notes</label>
          <textarea id="cnotes" class="input-field" rows="2" bind:value={customerNotes}></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm" for="inotes">Internal notes</label>
          <textarea id="inotes" class="input-field" rows="2" bind:value={internalNotes}></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm" for="check">{$t('checklist')} (one per line)</label>
          <textarea id="check" class="input-field" rows="3" bind:value={checklistText}></textarea>
        </div>
        <Button onclick={() => saveWorkspace(repair._id)} loading={busy}>{$t('save')}</Button>
      </article>
    {/if}

    {#if ['ready_for_collection', 'completed'].includes(repair.status)}
      <article class="surface-card space-y-3 p-4">
        <h2 class="font-semibold">{$t('documents')}</h2>
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" onclick={() => previewOrPrintReceipt(repair._id, false)}>{$t('printRepairReceipt')}</Button>
          <Button variant="secondary" onclick={() => previewOrPrintReceipt(repair._id, true)}>{$t('previewReceipt')}</Button>
          <Button variant="outline" onclick={() => downloadReceipt(repair._id)}>{$t('downloadReceipt')}</Button>
          {#if $user?.role === 'customer' || $user?.role === 'shop_admin'}
            <Button variant="outline" onclick={() => issueDoc(repair._id, 'warranty')}>Warranty document</Button>
            <Button variant="outline" onclick={() => issueDoc(repair._id, 'handover')}>Handover document</Button>
          {/if}
          {#if $user?.role === 'shop_admin' || $user?.role === 'mechanic'}
            <Button variant="outline" onclick={() => issueDoc(repair._id, 'job_card')}>Job card</Button>
          {/if}
        </div>
      </article>
    {/if}

    {#if ($user?.role === 'shop_admin' || $user?.role === 'parts_coordinator') && repair.status === 'ready_for_collection'}
      <article class="surface-card space-y-3 p-4" data-testid="payment-section">
        <h2 class="font-semibold">Payment collection</h2>
        <p class="text-sm text-muted">Confirm actual receipt before recording. Totals come from PaymentRecords only.</p>
        {#if detail.paymentSummary?.payments?.length}
          <ul class="space-y-2 text-sm" data-testid="payment-history">
            {#each detail.paymentSummary.payments as p}
              <li class="rounded border border-border p-2">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {#if p.entryType === 'reversal'}
                      <span class="font-medium">{$t('reversalEntry')}</span>
                      · −{p.amount} PKR
                      {#if p.reversalReason} · {p.reversalReason}{/if}
                    {:else}
                      {p.paymentNumber} · {p.amount} PKR · {p.method}
                      {#if p.reference} · {p.reference}{/if}
                      · {String(p.status || '').replaceAll('_', ' ')}
                      {#if p.reversedAmount > 0}
                        · {$t('previouslyReversed')}: {p.reversedAmount} PKR
                      {/if}
                      {#if p.remainingReversible > 0}
                        · {$t('remainingReversible')}: {p.remainingReversible} PKR
                      {/if}
                    {/if}
                    {#if p.paidAt}
                      · {new Date(p.paidAt).toLocaleString()}
                    {/if}
                  </div>
                  {#if $user?.role === 'shop_admin' && p.entryType !== 'reversal' && Number(p.remainingReversible || 0) > 0 && repair.status !== 'completed'}
                    <Button
                      variant="outline"
                      data-testid="reverse-payment"
                      onclick={() => openReverse(p)}
                    >
                      {$t('reversePayment')}
                    </Button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="grid gap-3 sm:grid-cols-3">
          <div>
            <label class="mb-1 block text-sm" for="payAmt">Amount</label>
            <input id="payAmt" type="number" min="0.01" step="0.01" class="input-field" bind:value={payAmount} />
          </div>
          <div>
            <label class="mb-1 block text-sm" for="payMethod">Method</label>
            <select id="payMethod" class="input-field" bind:value={payMethod}>
              <option value="cash">Cash</option>
              <option value="jazzcash">JazzCash</option>
              <option value="easypaisa">Easypaisa</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_other">Other mobile</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm" for="payRef">Transaction / reference</label>
            <input id="payRef" class="input-field" bind:value={payReference} />
          </div>
        </div>
        <label class="block text-sm">
          <span class="mb-1 block text-muted">Payment notes</span>
          <input class="input-field w-full" bind:value={payNotes} />
        </label>
        <Button onclick={() => recordPayment(repair._id)} loading={busy}>Confirm payment received</Button>
      </article>
    {/if}

    {#if $user?.role === 'customer' && detail.paymentSummary?.payments?.length}
      <article class="surface-card space-y-3 p-4" aria-labelledby="customer-payment-history">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="customer-payment-history" class="font-semibold">{$t('customerPaymentHistory')}</h2>
          <Button size="sm" variant="outline" href="/app/customer/receipts">{$t('viewAllReceipts')}</Button>
        </div>
        <ul class="space-y-2 text-sm" role="list">
          {#each detail.paymentSummary.payments as p}
            <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2">
              <span class="font-medium text-ink">{p.paymentNumber}</span>
              · {p.amount} PKR · {p.method}
              {#if p.paidAt} · {new Date(p.paidAt).toLocaleString()}{/if}
            </li>
          {/each}
        </ul>
      </article>
    {/if}

    {#if $user?.role === 'customer' && repair.status === 'completed'}
      <article class="surface-card space-y-3 p-4">
        <h2 class="font-semibold">{$t('feedback')}</h2>
        {#if repair.feedbackRating}
          <p class="text-sm">{$t('rating')}: {repair.feedbackRating}/5</p>
          <p class="text-sm text-muted">{repair.feedbackComment}</p>
        {:else}
          <label class="mb-1 block text-sm" for="rating">{$t('rating')}</label>
          <input id="rating" type="number" min="1" max="5" class="input-field" bind:value={feedbackRating} />
          <label class="mb-1 block text-sm" for="fcomment">{$t('notes')}</label>
          <textarea id="fcomment" class="input-field" rows="2" bind:value={feedbackComment}></textarea>
          <Button onclick={() => submitFeedback(repair._id)} loading={busy}>{$t('submit')}</Button>
        {/if}
      </article>
    {/if}

    <div class="flex flex-wrap gap-2">
      {#if $user?.role === 'shop_admin' && ['submitted', 'assigned'].includes(repair.status)}
        <Button variant="outline" onclick={() => (showAssign = true)}>{$t('assign')}</Button>
      {/if}
      {#if $user?.role === 'shop_admin' && ['assigned', 'diagnosing'].includes(repair.status)}
        <Button variant="outline" onclick={() => (showDiag = true)}>{$t('diagnose')}</Button>
      {/if}
      {#if $user?.role === 'shop_admin' && ['diagnosing', 'estimate_rejected', 'estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start'].includes(repair.status)}
        <Button variant="outline" onclick={() => (showEst = true)}>{$t('estimate')}</Button>
      {/if}
      {#if $user?.role === 'shop_admin' && ['estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start', 'in_progress'].includes(repair.status)}
        <Button variant="outline" onclick={() => (showParts = true)}>{$t('requestParts')}</Button>
      {/if}
      {#if ($user?.role === 'mechanic' || $user?.role === 'shop_admin') && (detail.readiness?.partsRequirementStatus === 'undetermined' || !detail.readiness?.partsRequirementDetermined) && ['estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start'].includes(repair.status)}
        <Button
          variant="outline"
          loading={busy}
          data-testid="confirm-no-parts"
          onclick={() =>
            run(() =>
              api(`/api/v1/repairs/${repair._id}/parts-not-required`, {
                method: 'POST',
                body: JSON.stringify({ notes: 'No replacement parts required' })
              }).then(() => undefined)
            )}
        >
          Confirm no parts required
        </Button>
      {/if}
      {#if $user?.role === 'shop_admin' && detail.readiness?.canStartRepair && ['estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start'].includes(repair.status)}
        <Button
          variant="outline"
          loading={busy}
          data-testid="start-work"
          onclick={() =>
            run(() =>
              api(`/api/v1/repairs/${repair._id}/start`, { method: 'POST', body: '{}' }).then(() => undefined)
            )}
        >
          {$t('startWork')}
        </Button>
      {/if}
      {#if $user?.role === 'shop_admin' && repair.status === 'in_progress'}
        <Button onclick={() => (showComplete = true)}>{$t('complete')}</Button>
      {/if}
      {#if ['shop_admin', 'parts_coordinator', 'mechanic'].includes($user?.role || '') && repair.status === 'ready_for_collection' && !repair.collectedAt}
        <Button
          loading={busy}
          data-testid="confirm-collection"
          onclick={() =>
            run(() =>
              api(`/api/v1/repairs/${repair._id}/collect`, {
                method: 'POST',
                body: JSON.stringify({ notes: 'Device collected' })
              }).then(() => undefined)
            )}
        >
          Confirm collection
        </Button>
      {/if}
      {#if $user?.role === 'shop_admin' && repair.status === 'ready_for_collection' && repair.collectedAt}
        <label class="sr-only" for="closure-notes">Closure notes</label>
        <input id="closure-notes" class="input-field" placeholder="Closure notes" bind:value={closureNotes} />
        <Button
          loading={busy}
          data-testid="close-case"
          onclick={() => closeCase(repair._id)}
        >
          Close case
        </Button>
      {/if}
    </div>
  </section>

  <Modal open={showAssign} title={$t('assign')} onclose={() => (showAssign = false)}>
    <label class="mb-1 block text-sm" for="mechanic">{$t('mechanic')}</label>
    <select id="mechanic" class="mb-3 w-full rounded border border-border px-2 py-2" bind:value={mechanicId}>
      {#each staff as m}
        <option value={m.user._id}>{m.user.name}</option>
      {/each}
    </select>
    <button
      type="button"
      class="rounded bg-accent px-3 py-2 text-white"
      onclick={() =>
        run(() =>
          api(`/api/v1/repairs/${repair._id}/assign`, {
            method: 'POST',
            body: JSON.stringify({ mechanicId })
          }).then(() => undefined)
        )}
    >
      {$t('assign')}
    </button>
  </Modal>

  <Modal open={showDiag} title={$t('diagnose')} onclose={closeDiag}>
    <label class="mb-1 block text-sm" for="findings">{$t('findings')}</label>
    <textarea id="findings" class="mb-3 w-full rounded border border-border px-2 py-2" rows="3" bind:value={findings}></textarea>
    <label class="mb-1 block text-sm" for="actions">{$t('recommendedActions')}</label>
    <textarea id="actions" class="mb-3 w-full rounded border border-border px-2 py-2" rows="3" bind:value={recommendedActions}></textarea>
    <button
      type="button"
      class="rounded bg-accent px-3 py-2 text-white"
      onclick={() =>
        run(() =>
          api(`/api/v1/repairs/${repair._id}/diagnosis`, {
            method: 'POST',
            body: JSON.stringify({ findings, recommendedActions })
          }).then(() => {
            findings = '';
            recommendedActions = '';
            showDiag = false;
          })
        )}
    >
      {$t('save')}
    </button>
  </Modal>

  <Modal open={showEst} title={$t('estimate')} onclose={closeEst}>
    <label class="mb-1 block text-sm" for="labor">{$t('laborCost')}</label>
    <input id="labor" type="number" min="0" class="mb-3 w-full rounded border border-border px-2 py-2" bind:value={laborCost} />
    <label class="mb-1 block text-sm" for="pcost">{$t('partsCost')}</label>
    <input id="pcost" type="number" min="0" class="mb-3 w-full rounded border border-border px-2 py-2" bind:value={partsCost} />
    <button
      type="button"
      class="rounded bg-accent px-3 py-2 text-white"
      onclick={() =>
        run(() =>
          api(`/api/v1/repairs/${repair._id}/estimates`, {
            method: 'POST',
            body: JSON.stringify({ laborCost: Number(laborCost), partsCost: Number(partsCost) })
          }).then(() => {
            laborCost = 0;
            partsCost = 0;
            showEst = false;
          })
        )}
    >
      {$t('submit')}
    </button>
  </Modal>

  <Modal open={showParts} title={$t('requestParts')} onclose={() => (showParts = false)}>
    <label class="mb-1 block text-sm" for="part">Part</label>
    <select id="part" class="mb-3 w-full rounded border border-border px-2 py-2" bind:value={partId}>
      {#each parts as p}
        <option value={p._id}>{p.sku} — {p.name} ({$t('available')}: {p.quantityAvailable})</option>
      {/each}
    </select>
    <label class="mb-1 block text-sm" for="qty">{$t('quantity')}</label>
    <input id="qty" type="number" min="1" class="mb-3 w-full rounded border border-border px-2 py-2" bind:value={quantity} />
    <button
      type="button"
      class="rounded bg-accent px-3 py-2 text-white"
      onclick={() =>
        run(() =>
          api(`/api/v1/repairs/${repair._id}/parts-requests`, {
            method: 'POST',
            body: JSON.stringify({ partId, quantity: Number(quantity) })
          }).then(() => undefined)
        )}
    >
      {$t('submit')}
    </button>
  </Modal>

  <Modal open={showComplete} title={$t('complete')} onclose={() => (showComplete = false)}>
    <label class="mb-1 block text-sm" for="work">{$t('workPerformed')}</label>
    <textarea id="work" class="mb-3 w-full rounded border border-border px-2 py-2" rows="3" bind:value={workPerformed}></textarea>
    <label class="mb-1 block text-sm" for="csum">Completion summary (customer-visible)</label>
    <textarea id="csum" class="mb-3 w-full rounded border border-border px-2 py-2" rows="2" bind:value={completionSummary}></textarea>
    <label class="mb-1 block text-sm" for="final">{$t('finalCost')}</label>
    <input id="final" type="number" min="0" class="mb-3 w-full rounded border border-border px-2 py-2" bind:value={finalCost} />
    <button
      type="button"
      class="rounded bg-accent px-3 py-2 text-white"
      onclick={() =>
        run(() =>
          api(`/api/v1/repairs/${repair._id}/complete`, {
            method: 'POST',
            body: JSON.stringify({
              workPerformed,
              finalCost: Number(finalCost),
              completionSummary: completionSummary || workPerformed
            })
          }).then(() => undefined)
        )}
    >
      {$t('complete')}
    </button>
  </Modal>

  <Modal open={showReverse} title={$t('reversePayment')} onclose={closeReverse}>
    {#if reverseTarget}
      <p class="mb-2 text-sm">
        {$t('originalPayment')}: {reverseTarget.amount} PKR
      </p>
      <p class="mb-2 text-sm">
        {$t('previouslyReversed')}: {reverseTarget.reversedAmount || 0} PKR
      </p>
      <p class="mb-3 text-sm font-medium">
        {$t('remainingReversible')}: {reverseTarget.remainingReversible} PKR
      </p>
      <label class="mb-1 block text-sm" for="revAmt">{$t('reverseAmount')}</label>
      <input
        id="revAmt"
        type="number"
        min="0.01"
        step="0.01"
        max={reverseTarget.remainingReversible}
        class="mb-3 w-full rounded border border-border px-2 py-2"
        bind:value={reverseAmount}
        data-testid="reverse-amount"
      />
      <label class="mb-1 block text-sm" for="revReason">{$t('reversalReason')}</label>
      <textarea
        id="revReason"
        class="mb-3 w-full rounded border border-border px-2 py-2"
        rows="3"
        bind:value={reverseReason}
        data-testid="reverse-reason"
      ></textarea>
      <label class="mb-3 flex items-start gap-2 text-sm">
        <input type="checkbox" bind:checked={reverseConfirm} data-testid="reverse-confirm" />
        <span>{$t('confirmReversal')}</span>
      </label>
      <Button
        loading={busy}
        disabled={!reverseConfirm}
        data-testid="submit-reversal"
        onclick={() => submitReverse()}
      >
        {$t('reversePayment')}
      </Button>
    {/if}
  </Modal>
{/if}
