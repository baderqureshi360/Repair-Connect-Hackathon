<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import TrackingResults from '$lib/components/TrackingResults.svelte';

  let data = $state<any>(null);
  let error = $state('');
  let loading = $state(true);

  onMount(async () => {
    try {
      const base = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${base}/api/v1/public/track/${$page.params.token}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error($t('trackingDenied'));
      data = json.data;
    } catch {
      error = $t('trackingDenied');
    } finally {
      loading = false;
    }
  });
</script>

<main class="mx-auto min-h-screen max-w-2xl px-4 py-10">
  <a href="/track" class="text-sm text-accent hover:underline">{$t('trackRepair')}</a>
  <p class="mt-4 text-sm font-semibold text-accent">{$t('appName')}</p>
  <h1 class="mt-1 text-2xl font-semibold">{$t('publicTracking')}</h1>

  {#if loading}
    <div class="mt-6"><Skeleton lines={6} /></div>
  {:else if error}
    <p class="mt-6 text-danger" role="alert">{error}</p>
    <a class="btn btn-outline btn-sm mt-4 inline-flex" href="/track">{$t('trackRepairButton')}</a>
  {:else if data}
    <TrackingResults {data} />
  {/if}
</main>
