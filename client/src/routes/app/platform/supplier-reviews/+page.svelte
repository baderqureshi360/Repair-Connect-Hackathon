<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let filter = $state('reported');
  let items = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let reason = $state('Policy review completed after investigation');
  let msg = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const data = await api<{ items: any[] }>(
        `/api/v1/platform/supplier-reviews?status=${encodeURIComponent(filter)}`
      );
      items = data.items || [];
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      items = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function moderate(id: string, action: 'hide' | 'restore' | 'clear_report') {
    msg = '';
    if (!confirm($t('confirmSensitiveAction'))) return;
    try {
      await api(`/api/v1/platform/supplier-reviews/${id}/moderate`, {
        method: 'POST',
        body: JSON.stringify({ action, reason })
      });
      msg = $t('success');
      await load();
    } catch (err) {
      msg = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('supplierReviews')}
    subtitle="Moderate reported reviews. Reviews are never silently deleted."
  />
  <Alert type="info" role="status" message={$t('platformScopeNote')} />

  <div class="surface-card flex flex-wrap items-end gap-3 p-4">
    <label class="text-sm" for="rev-filter"
      >{$t('status')}
      <select id="rev-filter" class="input-field mt-1" bind:value={filter} onchange={load}>
        <option value="reported">Reported</option>
        <option value="hidden">Hidden</option>
        <option value="moderated">Moderated</option>
        <option value="published">Published</option>
      </select>
    </label>
    <label class="grow text-sm" for="mod-reason"
      >Moderation reason
      <input id="mod-reason" class="input-field mt-1 w-full" bind:value={reason} />
    </label>
    <Button variant="outline" onclick={load}>Refresh</Button>
  </div>

  {#if msg}<Alert type="success" role="status" message={msg} />{/if}
  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 3 }) as _}<Skeleton class="h-28" />{/each}
    </div>
  {:else if !items.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">
      {$t('noPlatformReviews')}
    </div>
  {:else}
    <div class="space-y-4">
      {#each items as review}
        <article class="surface-card space-y-2 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="font-medium text-ink">
              {review.publicId} · {review.rating}★ · PO {review.purchaseOrderPublicId}
            </p>
            <StatusPill status={review.status} />
          </div>
          <p class="whitespace-pre-wrap text-sm">{review.comment || '—'}</p>
          {#if (review.reports || []).length}
            <p class="text-xs text-muted">Reports: {review.reports.length}</p>
            <ul class="list-disc ps-4 text-xs">
              {#each review.reports as r}
                <li>{r.reason}</li>
              {/each}
            </ul>
          {/if}
          {#if (review.moderationHistory || []).length}
            <details>
              <summary class="cursor-pointer text-sm">{$t('reviewHistory')}</summary>
              <ul class="mt-2 space-y-1 text-xs">
                {#each review.moderationHistory as m}
                  <li>
                    {m.action}: {m.reason} ({m.previousStatus} → {m.nextStatus})
                    {#if m.actorLabel}<span class="text-muted"> · {m.actorLabel}</span>{/if}
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onclick={() => moderate(review.id, 'hide')}>Hide</Button>
            <Button size="sm" variant="outline" onclick={() => moderate(review.id, 'restore')}>Restore</Button>
            <Button size="sm" variant="outline" onclick={() => moderate(review.id, 'clear_report')}
              >Clear report</Button
            >
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
