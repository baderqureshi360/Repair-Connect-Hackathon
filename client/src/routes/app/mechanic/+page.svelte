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
        api<{ data: any[] }>('/api/v1/repairs?limit=50', { full: true })
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

  const newAssignments = $derived(jobs.filter((j) => j.status === 'assigned'));
  const awaitingDiagnosis = $derived(jobs.filter((j) => ['assigned', 'diagnosing'].includes(j.status)));
  const estimatesAwaiting = $derived(jobs.filter((j) => j.status === 'estimate_pending'));
  const awaitingParts = $derived(
    jobs.filter((j) => ['awaiting_parts', 'parts_reserved'].includes(j.status))
  );
  const inProgress = $derived(jobs.filter((j) => j.status === 'in_progress'));
  const readyForCollection = $derived(jobs.filter((j) => j.status === 'ready_for_collection'));
  const overdue = $derived(
    jobs.filter(
      (j) => j.deadline && new Date(j.deadline) < new Date() && !['completed', 'cancelled'].includes(j.status)
    )
  );
  const priorityJobs = $derived(
    [
      ...overdue.map((j) => ({ job: j, reason: 'overdue' as const })),
      ...newAssignments.map((j) => ({ job: j, reason: 'new' as const })),
      ...awaitingDiagnosis
        .filter((j) => j.status === 'diagnosing')
        .map((j) => ({ job: j, reason: 'diagnosis' as const })),
      ...estimatesAwaiting.map((j) => ({ job: j, reason: 'estimate' as const })),
      ...awaitingParts.map((j) => ({ job: j, reason: 'parts' as const })),
      ...inProgress.map((j) => ({ job: j, reason: 'active' as const })),
      ...readyForCollection.map((j) => ({ job: j, reason: 'collection' as const }))
    ]
      .filter((item, idx, arr) => arr.findIndex((x) => x.job._id === item.job._id) === idx)
      .slice(0, 8)
  );

  function priorityLabel(reason: string) {
    switch (reason) {
      case 'overdue':
        return $t('overdue');
      case 'new':
        return $t('newAssignments');
      case 'diagnosis':
        return $t('awaitingDiagnosis');
      case 'estimate':
        return $t('estimatesAwaitingApproval');
      case 'parts':
        return $t('awaitingParts');
      case 'active':
        return $t('inProgress');
      case 'collection':
        return $t('readyForCollection');
      default:
        return $t('pendingActions');
    }
  }

  const firstName = $derived($user?.name?.split(' ')[0] || $t('mechanic'));
  const assignedTotal = $derived(analytics?.summary?.assigned ?? jobs.length);
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <header class="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('dashboard')}</p>
      <h1 class="mt-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">
        {$t('welcomeBack')}, {firstName}
      </h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{$t('mechanicWelcomeSubtitle')}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
      <Button href="/app/mechanic/jobs" variant="secondary" size="sm">{$t('viewJobs')}</Button>
    </div>
  </header>

  {#if loading && !analytics}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-28" />{/each}
    </div>
    <div class="grid gap-4 lg:grid-cols-3" aria-hidden="true">
      <Skeleton class="h-72 lg:col-span-2" />
      <Skeleton class="h-72" />
    </div>
  {:else if error}
    <div class="space-y-3">
      <Alert type="error" role="alert" message={error} />
      <Button variant="outline" loading={loading} onclick={load}>{$t('retry')}</Button>
    </div>
  {:else if analytics}
    <StatGrid
      stats={[
        {
          label: $t('assignedJobs'),
          value: assignedTotal,
          icon: 'wrench',
          tone: 'primary',
          hint: $t('newAssignments') + `: ${newAssignments.length}`
        },
        {
          label: $t('awaitingDiagnosis'),
          value: awaitingDiagnosis.length,
          icon: 'clipboard',
          tone: 'amber'
        },
        {
          label: $t('estimatesAwaitingApproval'),
          value: estimatesAwaiting.length,
          icon: 'fileText',
          tone: 'violet'
        },
        {
          label: $t('awaitingParts'),
          value: analytics.summary?.awaitingParts ?? awaitingParts.length,
          icon: 'package',
          tone: 'blue'
        },
        {
          label: $t('inProgress'),
          value: analytics.summary?.inProgress ?? inProgress.length,
          icon: 'clock',
          tone: 'amber'
        },
        {
          label: $t('readyForCollection'),
          value: readyForCollection.length,
          icon: 'checkCircle',
          tone: 'green'
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

    <div class="grid gap-4 xl:grid-cols-3">
      <section class="surface-card flex flex-col p-4 xl:col-span-2" aria-labelledby="mechanic-jobs-heading">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 id="mechanic-jobs-heading" class="text-sm font-semibold text-ink">{$t('assignedJobs')}</h2>
          <a class="text-xs font-medium hover:underline" href="/app/mechanic/jobs">{$t('viewAll')}</a>
        </div>
        <ul class="space-y-2" role="list">
          {#each jobs.slice(0, 8) as job}
            <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <a class="font-medium hover:underline" href={`/app/repairs/${job._id}`}>
                  {job.referenceNumber}
                </a>
                <StatusPill status={job.status} />
              </div>
              <p class="mt-1 text-sm text-muted">
                {job.brand} {job.model}
                {#if job.customer?.name}
                  — {job.customer.name}
                {/if}
                {#if job.deadline}
                  · {$t('deadline')} {new Date(job.deadline).toLocaleDateString()}
                {/if}
              </p>
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>
      </section>

      <section class="priorities-panel flex flex-col rounded-[var(--radius-ui)] p-4" aria-labelledby="mechanic-priorities">
        <h2 id="mechanic-priorities" class="priorities-title mb-1 text-sm font-semibold">{$t('todaysPriorities')}</h2>
        <p class="priorities-hint mb-3 text-xs">{$t('mechanicWorkflowHint')}</p>
        <ul class="flex-1 space-y-2 text-sm" role="list">
          {#each priorityJobs as item}
            <li>
              <a
                class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]"
                href={`/app/repairs/${item.job._id}`}
              >
                <Icon
                  name={item.reason === 'overdue' ? 'alertTriangle' : 'wrench'}
                  size={15}
                  class={`mt-0.5 shrink-0 ${item.reason === 'overdue' ? 'text-danger' : 'text-accent'}`}
                />
                <span>
                  <span class="font-medium">{priorityLabel(item.reason)}: {item.job.referenceNumber}</span>
                  <span class="block text-xs text-muted">{item.job.brand} {item.job.model}</span>
                </span>
              </a>
            </li>
          {:else}
            <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-muted" role="status">
              {$t('empty')}
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</section>
