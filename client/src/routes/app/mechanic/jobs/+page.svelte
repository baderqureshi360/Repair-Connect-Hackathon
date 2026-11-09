<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let jobs = $state<any[]>([]);
  onMount(async () => {
    const res = await api<{ data: any[] }>('/api/v1/repairs?limit=50', { full: true });
    jobs = res.data || [];
  });
</script>

<section>
  <h1 class="mb-4 text-2xl font-semibold">{$t('assignedJobs')}</h1>
  <ul class="space-y-2">
    {#each jobs as job}
      <li class="rounded-lg border border-border bg-surface-elevated p-3">
        <div class="flex justify-between">
          <a class="underline" href={`/app/repairs/${job._id}`}>{job.referenceNumber}</a>
          <StatusPill status={job.status} />
        </div>
      </li>
    {:else}
      <li class="text-muted">{$t('empty')}</li>
    {/each}
  </ul>
</section>
