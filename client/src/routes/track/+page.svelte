<script lang="ts">
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import TrackingResults from '$lib/components/TrackingResults.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let referenceNumber = $state('');
  let accessCode = $state('');
  let loading = $state(false);
  let error = $state('');
  let data = $state<any>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = '';
    data = null;
    loading = true;
    try {
      const base = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${base}/api/v1/public/track/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceNumber: referenceNumber.trim(), accessCode: accessCode.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error($t('trackingDenied'));
      }
      data = json.data;
    } catch {
      error = $t('trackingDenied');
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{$t('trackRepair')} — RepairConnect</title>
</svelte:head>

<main class="mx-auto min-h-dvh max-w-2xl px-4 py-10">
  <a href="/" class="inline-flex items-center gap-2.5 text-sm font-semibold text-ink hover:opacity-90">
    <BrandMark size={32} compact />
    <span>{$t('appName')}</span>
  </a>
  <h1 class="mt-6 text-xl font-semibold tracking-tight md:text-2xl">{$t('trackRepairTitle')}</h1>
  <p class="mt-2 text-sm text-muted">{$t('trackRepairHelp')}</p>

  <form class="mt-6 space-y-4 surface-card p-4" onsubmit={onSubmit} novalidate>
    {#if error}
      <Alert type="error" role="alert" message={error} />
    {/if}
    <div>
      <label class="field-label" for="reference">{$t('referenceNumber')}</label>
      <input
        id="reference"
        name="reference"
        required
        autocomplete="off"
        class="input-field"
        bind:value={referenceNumber}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby="track-help"
      />
    </div>
    <div>
      <label class="field-label" for="accessCode">{$t('trackingAccessCode')}</label>
      <input
        id="accessCode"
        name="accessCode"
        required
        autocomplete="off"
        class="input-field font-mono tracking-wider"
        bind:value={accessCode}
        aria-invalid={error ? 'true' : undefined}
      />
    </div>
    <p id="track-help" class="text-xs text-muted">
      Find these on your intake receipt or repair confirmation. QR links still work at /track/&lt;token&gt;.
    </p>
    <button type="submit" class="btn btn-primary w-full" disabled={loading} aria-busy={loading}>
      {loading ? $t('loading') : $t('trackRepairButton')}
    </button>
  </form>

  {#if loading}
    <div class="mt-6"><Skeleton lines={6} /></div>
  {:else if data}
    <TrackingResults {data} />
  {/if}
</main>
