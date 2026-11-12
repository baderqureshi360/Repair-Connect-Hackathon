<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let requests = $state<any[]>([]);
  let error = $state('');
  let message = $state('');
  let loading = $state(true);
  let busyId = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      requests = (await api<any[]>('/api/v1/parts/requests/incoming')) || [];
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      requests = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function remainingQty(req: any) {
    return Math.max(0, Number(req.quantityRequested || 0) - Number(req.quantityFulfilled || 0));
  }

  function canReserve(req: any) {
    if (!['pending', 'partially_fulfilled'].includes(req.status)) return false;
    const need = remainingQty(req);
    if (need <= 0) return false;
    const available = Number(req.part?.quantityAvailable ?? 0);
    return available >= need;
  }

  function blockedReason(req: any) {
    const need = remainingQty(req);
    const available = Number(req.part?.quantityAvailable ?? 0);
    if (need <= 0) return '';
    if (available < need) {
      return `${$t('reserveBlocked')} (${$t('available')}: ${available}, ${$t('shortage')}: ${need - available})`;
    }
    return '';
  }

  async function reserve(id: string, qty: number) {
    error = '';
    message = '';
    busyId = id;
    try {
      await api(`/api/v1/parts/requests/${id}/reserve`, {
        method: 'POST',
        body: JSON.stringify({ quantity: qty })
      });
      message = $t('success');
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      if (err instanceof ApiError && err.details) {
        const d = err.details as any;
        if (d.shortage != null) {
          error = `${err.message} — ${$t('shortage')}: ${d.shortage}, ${$t('available')}: ${d.available}`;
        }
      }
      await load();
    } finally {
      busyId = '';
    }
  }
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('partsRequests')}
    subtitle={$t('partsRequestsSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/parts' }, { label: $t('partsRequests') }]}
  >
    <Button href="/app/parts/inventory" size="sm" variant="outline">{$t('inventory')}</Button>
  </PageHeader>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if message}<Alert type="success" message={message} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-24" />{/each}
    </div>
  {:else}
    <ul class="space-y-3" role="list">
      {#each requests as req}
        {@const need = remainingQty(req)}
        {@const ok = canReserve(req)}
        {@const blocked = blockedReason(req)}
        <li class="surface-card p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold text-ink">{req.part?.name} ({req.part?.sku})</p>
                <StatusPill status={req.status} />
              </div>
              <p class="mt-1 text-sm text-muted">
                {#if req.repairRequest?.referenceNumber}
                  <a class="hover:underline" href={`/app/repairs/${req.repairRequest._id || req.repairRequest}`}>
                    {req.repairRequest.referenceNumber}
                  </a>
                  ·
                {/if}
                qty {req.quantityRequested}
                {#if req.quantityFulfilled}
                  · fulfilled {req.quantityFulfilled}
                {/if}
                · remaining {need}
              </p>
              <p class="mt-1 text-sm">
                <span class="font-medium text-ink">{$t('available')}:</span>
                {req.part?.quantityAvailable ?? '—'}
                <span class="ms-2 text-muted">{$t('reserved')}: {req.part?.quantityReserved ?? 0}</span>
                {#if req.quantityShortage}
                  · <span class="text-warning">{$t('shortage')}: {req.quantityShortage}</span>
                {/if}
              </p>
              {#if blocked}
                <p class="mt-2 text-xs text-warning" role="status">{blocked}</p>
              {/if}
            </div>
            {#if ['pending', 'partially_fulfilled'].includes(req.status) && need > 0}
              <Button
                size="sm"
                variant={ok ? 'primary' : 'outline'}
                data-testid="reserve-part"
                loading={busyId === req._id}
                ariaLabel={ok ? $t('reserve') : $t('reserveBlocked')}
                onclick={() => reserve(req._id, need)}
              >
                {$t('reserve')}
              </Button>
            {/if}
          </div>
        </li>
      {:else}
        <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-8 text-center text-sm text-muted" role="status">
          {$t('empty')}
        </li>
      {/each}
    </ul>
  {/if}
</section>
