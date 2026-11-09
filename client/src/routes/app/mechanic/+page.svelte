<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Button from '$lib/components/Button.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import DashboardAnalytics from '$lib/components/DashboardAnalytics.svelte';
  import DateRangeFilter, { type RangeKey } from '$lib/components/DateRangeFilter.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Alert from '$lib/components/Alert.svelte';

  let range = $state<RangeKey>('30d');
  let from = $state('');
  let to = $state('');
  let loading = $state(true);
  let error = $state('');
  let analytics = $state<any>(null);
  let jobs = $state<any[]>([]);

  function query() {
    if (range === 'custom' && from && to) {
      return `range=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    }
    return `range=${range === 'custom' ? '30d' : range}`;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [a, res] = await Promise.all([
        api<any>(`/api/v1/analytics/me?${query()}`),
        api<{ data: any[] }>('/api/v1/repairs?limit=20', { full: true })
      ]);
      analytics = a;
      jobs = res.data || [];
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const inProgress = $derived(jobs.filter((j) => j.status === 'in_progress'));
  const awaitingParts = $derived(jobs.filter((j) => j.status === 'awaiting_parts'));
  const overdue = $derived(
    jobs.filter(
      (j) => j.deadline && new Date(j.deadline) < new Date() && !['completed', 'cancelled'].includes(j.status)
    )
  );
  const actionable = $derived(
    jobs.filter((j) =>
      ['assigned', 'diagnosing', 'estimate_approved', 'parts_reserved', 'in_progress'].includes(j.status)
    )
  );
  const firstName = $derived($user?.name?.split(' ')[0] || $t('mechanic'));
</script>

<section class="space-y-6">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight md:text-3xl">
        {$t('welcomeBack')}, {firstName}!
      </h1>
      <p class="mt-1 text-sm text-muted">{$t('mechanicWelcomeSubtitle')}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
      <Button href="/app/mechanic/jobs" variant="secondary" size="sm">{$t('viewJobs')}</Button>
    </div>
  </div>

  {#if loading && !analytics}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-28" />{/each}
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else if analytics}
    <StatGrid
      stats={[
        {
          label: $t('assignedJobs'),
          value: analytics.summary?.assigned ?? jobs.length,
          icon: 'wrench',
          tone: 'indigo'
        },
        {
          label: $t('inProgress'),
          value: analytics.summary?.inProgress ?? inProgress.length,
          icon: 'clock',
          tone: 'amber'
        },
        {
          label: $t('completedRepairs'),
          value: analytics.summary?.completed ?? 0,
          icon: 'checkCircle',
          tone: 'green'
        },
        {
          label: $t('overdue'),
          value: analytics.summary?.overdue ?? overdue.length,
          icon: 'alertTriangle',
          tone: 'red'
        }
      ]}
    />

    <DashboardAnalytics hideRange providedData={analytics} />

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="surface-card p-4 lg:col-span-2">
        <h2 class="mb-3 text-base font-semibold">{$t('assignedJobs')}</h2>
        <ul class="space-y-2">
          {#each jobs as job}
            <li class="surface-card surface-card-interactive p-3">
              <div class="flex justify-between gap-2">
                <a class="font-medium text-accent hover:underline" href={`/app/repairs/${job._id}`}>
                  {job.referenceNumber}
                </a>
                <StatusPill status={job.status} />
              </div>
              <p class="text-sm text-muted">
                {job.brand} {job.model} — {job.customer?.name || ''}
                {#if job.deadline}
                  · {$t('deadline')} {new Date(job.deadline).toLocaleDateString()}
                {/if}
              </p>
            </li>
          {:else}
            <li class="text-muted">{$t('empty')}</li>
          {/each}
        </ul>
      </div>

      <div class="space-y-4">
        <div class="priorities-panel rounded-xl p-4">
          <h2 class="mb-3 text-base font-semibold text-white">{$t('todaysPriorities')}</h2>
          <ul class="space-y-2 text-sm text-indigo-50">
            {#each overdue.slice(0, 4) as job}
              <li>
                <a class="hover:text-white" href={`/app/repairs/${job._id}`}>
                  {$t('overdue')}: {job.referenceNumber}
                </a>
              </li>
            {/each}
            {#each awaitingParts.slice(0, 3) as job}
              <li>
                <a class="hover:text-white" href={`/app/repairs/${job._id}`}>
                  {$t('awaitingParts')}: {job.referenceNumber}
                </a>
              </li>
            {/each}
            {#if !overdue.length && !awaitingParts.length}
              <li class="text-indigo-100/70">{$t('empty')}</li>
            {/if}
          </ul>
        </div>

        <div class="surface-card p-4">
          <h2 class="mb-3 text-base font-semibold">{$t('pendingActions')}</h2>
          {#if actionable.length}
            <ul class="space-y-2 text-sm">
              {#each actionable.slice(0, 5) as job}
                <li class="flex items-center gap-2">
                  <Icon name="wrench" size={14} class="text-accent" />
                  <a class="text-accent hover:underline" href={`/app/repairs/${job._id}`}>
                    {job.referenceNumber} · {job.status.replaceAll('_', ' ')}
                  </a>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-muted">{$t('empty')}</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</section>
