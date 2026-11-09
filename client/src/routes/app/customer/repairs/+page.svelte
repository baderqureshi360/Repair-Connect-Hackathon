<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let repairs = $state<any[]>([]);
  let status = $state('');
  let loading = $state(true);

  async function load() {
    loading = true;
    const q = status ? `&status=${status}` : '';
    const res = await api<{ data: any[] }>(`/api/v1/repairs?limit=50${q}`, { full: true });
    repairs = res.data || [];
    loading = false;
  }

  onMount(load);
</script>

<section>
  <h1 class="mb-4 text-2xl font-semibold">{$t('repairs')}</h1>
  <div class="mb-4">
    <label class="mb-1 block text-sm" for="status">{$t('filterStatus')}</label>
    <select id="status" class="rounded border border-border bg-surface-elevated px-2 py-1" bind:value={status} onchange={load}>
      <option value="">{$t('all')}</option>
      {#each ['submitted','assigned','estimate_pending','estimate_approved','awaiting_parts','completed'] as s}
        <option value={s}>{s.replaceAll('_',' ')}</option>
      {/each}
    </select>
  </div>
  {#if loading}
    <p>{$t('loading')}</p>
  {:else}
    <ul class="space-y-2">
      {#each repairs as repair}
        <li class="rounded-lg border border-border bg-surface-elevated p-3">
          <div class="flex justify-between gap-2">
            <a class="font-medium underline" href={`/app/repairs/${repair._id}`}>{repair.referenceNumber}</a>
            <StatusPill status={repair.status} />
          </div>
          <p class="text-sm text-muted">{repair.brand} {repair.model}</p>
        </li>
      {:else}
        <li class="text-muted">{$t('empty')}</li>
      {/each}
    </ul>
  {/if}
</section>
