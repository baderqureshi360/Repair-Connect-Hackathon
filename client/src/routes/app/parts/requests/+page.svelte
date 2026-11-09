<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';

  let requests = $state<any[]>([]);
  let error = $state('');
  let message = $state('');

  async function load() {
    requests = (await api<any[]>('/api/v1/parts/requests/incoming')) || [];
  }

  onMount(load);

  async function reserve(id: string, qty: number) {
    error = '';
    message = '';
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
    }
  }
</script>

<section>
  <h1 class="mb-4 text-2xl font-semibold">{$t('partsRequests')}</h1>
  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if message}<Alert type="success" message={message} />{/if}
  <ul class="space-y-3">
    {#each requests as req}
      <li class="rounded-lg border border-border bg-surface-elevated p-4">
        <div class="flex flex-wrap justify-between gap-2">
          <div>
            <p class="font-medium">{req.part?.name} ({req.part?.sku})</p>
            <p class="text-sm text-muted">
              {req.repairRequest?.referenceNumber} · qty {req.quantityRequested} · {req.status}
            </p>
            <p class="text-sm">
              {$t('available')}: {req.part?.quantityAvailable}
              {#if req.quantityShortage}
                · {$t('shortage')}: {req.quantityShortage}
              {/if}
            </p>
          </div>
          <button
            type="button"
            class="rounded bg-accent px-3 py-2 text-sm text-white"
            data-testid="reserve-part"
            onclick={() => reserve(req._id, req.quantityRequested - req.quantityFulfilled)}
          >
            {$t('reserve')}
          </button>
        </div>
      </li>
    {:else}
      <li class="text-muted">{$t('empty')}</li>
    {/each}
  </ul>
</section>
