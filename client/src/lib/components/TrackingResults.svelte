<script lang="ts">
  import { t } from '$lib/i18n';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let { data }: { data: any } = $props();

  function fmt(d: string | Date | null | undefined) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }
</script>

<div class="mt-6 space-y-4">
  <section class="surface-card p-4" aria-labelledby="track-summary">
    <h2 id="track-summary" class="text-lg font-semibold">{$t('repairSummary')}</h2>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-lg font-semibold">{data.referenceNumber}</p>
      <StatusPill status={data.status} />
    </div>
    <p class="mt-2 text-sm text-muted">
      {data.brand} {data.model} · {data.deviceType}
    </p>
    <p class="mt-1 text-sm text-muted">{data.shop?.name}{#if data.shop?.city} · {data.shop.city}{/if}</p>
    <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt class="text-muted">{$t('submittedAt')}</dt>
        <dd>{fmt(data.submittedAt)}</dd>
      </div>
      <div>
        <dt class="text-muted">{$t('lastUpdated')}</dt>
        <dd>{fmt(data.lastUpdatedAt)}</dd>
      </div>
    </dl>
    {#if data.warrantyExpiresAt}
      <p class="mt-2 text-sm">{$t('warranty')}: {new Date(data.warrantyExpiresAt).toLocaleDateString()}</p>
    {/if}
  </section>

  {#if data.estimate && data.estimate.estimateState !== 'none'}
    <section class="surface-card p-4" aria-labelledby="track-estimate">
      <h2 id="track-estimate" class="font-semibold">{$t('estimate')}</h2>
      <p class="mt-2 text-sm capitalize">{String(data.estimate.estimateState).replaceAll('_', ' ')}</p>
      {#if data.estimate.requiresCustomerSignIn}
        <a class="btn btn-primary btn-sm mt-3 inline-flex" href="/login?portal=customer&next=/app/customer/repairs">
          {$t('signInToReviewEstimate')}
        </a>
      {/if}
    </section>
  {/if}

  <section class="surface-card p-4" aria-labelledby="track-parts">
    <h2 id="track-parts" class="font-semibold">{$t('partsStatus')}</h2>
    {#if data.parts}
      <p class="mt-2 text-sm">{data.parts.message}</p>
      {#if data.parts.expectedArrivalLabel}
        <p class="mt-1 text-sm font-medium text-muted">{data.parts.expectedArrivalLabel}</p>
      {:else if data.parts.state === 'unavailable' || data.parts.state === 'transfer_requested' || data.parts.state === 'in_transit' || data.parts.state === 'checking'}
        <p class="mt-1 text-sm font-medium text-muted">{$t('expectedArrivalUnconfirmed')}</p>
      {/if}
    {/if}
  </section>

  <section class="surface-card p-4" aria-labelledby="track-milestones">
    <h2 id="track-milestones" class="mb-3 font-semibold">{$t('timeline')}</h2>
    {#if data.milestones?.length}
      <ol class="space-y-3">
        {#each data.milestones as step}
          <li class="border-s-2 border-accent ps-3">
            <p class="text-sm font-medium">{step.title}</p>
            {#if step.message}<p class="text-xs text-muted">{step.message}</p>{/if}
            <p class="text-xs text-muted">{fmt(step.at)}</p>
          </li>
        {/each}
      </ol>
    {:else if data.timeline?.length}
      <ol class="space-y-3">
        {#each data.timeline as step}
          <li class="border-s-2 border-accent ps-3">
            <p class="text-sm font-medium capitalize">{step.toStatus?.replaceAll('_', ' ')}</p>
            <p class="text-xs text-muted">{fmt(step.at)}</p>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="text-sm text-muted">{$t('empty')}</p>
    {/if}
  </section>
</div>
