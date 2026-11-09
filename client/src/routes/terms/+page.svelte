<script lang="ts">
  import { t } from '$lib/i18n';
</script>

<svelte:head><title>Terms of Service — RepairConnect</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-12 md:px-6">
  <a href="/" class="text-sm text-accent hover:underline">← {$t('appName')}</a>
  <h1 class="mt-4 text-3xl font-bold">Terms of Service</h1>
  <p class="mt-4 text-sm text-muted">
    RepairConnect is provided for authorized repair operations. Customers may self-register. Staff accounts are created
    by authorized shop administrators. Users must not attempt to access shops, repairs, inventory, or documents outside
    their permissions.
  </p>
  <p class="mt-3 text-sm text-muted">
    Inventory reservations and financial documents follow server-enforced business rules. Misuse, abuse, or attempts to
    bypass authorization may result in account deactivation.
  </p>
</main>
