<script lang="ts">
  import { t } from '$lib/i18n';
  import BrandMark from '$lib/components/BrandMark.svelte';
</script>

<svelte:head><title>Privacy Policy — RepairConnect</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-12 md:px-6">
  <a href="/" class="inline-flex items-center gap-2.5 text-sm font-semibold text-ink hover:opacity-90">
    <BrandMark size={28} compact />
    <span>{$t('appName')}</span>
  </a>
  <h1 class="mt-6 text-2xl font-semibold tracking-tight md:text-3xl">Privacy Policy</h1>
  <p class="mt-4 text-sm text-muted">
    RepairConnect processes account, repair, inventory, and payment records needed to operate the service. Data is
    scoped by role and shop membership. Session authentication uses HttpOnly cookies. Do not share credentials.
  </p>
  <p class="mt-3 text-sm text-muted">
    Repair tracking tokens expose only privacy-safe status details. Financial documents retain historical snapshots.
    Contact your shop administrator for account-specific data requests.
  </p>
</main>
