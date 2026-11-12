<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t, statusLabel } from '$lib/i18n';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let repairs = $state<any[]>([]);
  let status = $state('');
  let loading = $state(true);
  let error = $state('');

  const statusOptions = [
    'submitted',
    'assigned',
    'estimate_pending',
    'estimate_approved',
    'awaiting_parts',
    'in_progress',
    'ready_for_collection',
    'completed'
  ] as const;

  async function load() {
    loading = true;
    error = '';
    try {
      const q = status ? `&status=${status}` : '';
      const res = await api<{ data: any[] }>(`/api/v1/repairs?limit=50${q}`, { full: true });
      repairs = res.data || [];
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
      repairs = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('myRepairs')}
    subtitle={$t('myRepairsSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/customer' }, { label: $t('myRepairs') }]}
  >
    <Button href="/app/customer/new" size="sm" variant="primary">{$t('submitRepairRequest')}</Button>
  </PageHeader>

  <div class="surface-card p-4">
    <label class="mb-1 block text-sm font-medium" for="status">{$t('filterStatus')}</label>
    <select id="status" class="input-field max-w-xs" bind:value={status} onchange={load}>
      <option value="">{$t('all')}</option>
      {#each statusOptions as s}
        <option value={s}>{statusLabel(s)}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 5 }) as _}<Skeleton class="h-16" />{/each}
    </div>
  {:else if error}
    <div class="space-y-3">
      <Alert type="error" role="alert" message={error} />
      <Button variant="outline" onclick={load}>{$t('retry')}</Button>
    </div>
  {:else}
    <ul class="space-y-2" role="list">
      {#each repairs as repair}
        <li class="surface-card surface-card-interactive p-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <a class="text-base font-semibold hover:underline" href={`/app/repairs/${repair._id}`}>
                {repair.referenceNumber}
              </a>
              <p class="mt-1 text-sm text-muted">
                {repair.brand} {repair.model}
                {#if repair.deviceType}
                  · {repair.deviceType}
                {/if}
              </p>
              {#if repair.status === 'estimate_pending'}
                <p class="mt-2 text-xs font-medium text-warning">{$t('nextAction')}: {$t('reviewEstimates')}</p>
              {/if}
            </div>
            <StatusPill status={repair.status} />
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
