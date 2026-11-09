<script lang="ts">
  import { t } from '$lib/i18n';
</script>

<svelte:head><title>Accessibility — RepairConnect</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-12 md:px-6">
  <a href="/" class="text-sm text-accent hover:underline">← {$t('appName')}</a>
  <h1 class="mt-4 text-3xl font-bold">Accessibility</h1>
  <ul class="mt-4 list-disc space-y-2 ps-5 text-sm text-muted">
    <li>Keyboard navigation and visible focus styles</li>
    <li>Skip link to main content</li>
    <li>English and Urdu with RTL document direction</li>
    <li>Chart data tables as accessible alternatives</li>
    <li>Theme, density, reduced-motion, and high-contrast preferences</li>
    <li>Responsive layouts for phone and desktop viewports</li>
  </ul>
  <p class="mt-4 text-sm text-muted">
    Automated axe-core checks run in the Playwright suite. Device-level assistive technology verification is still
    recommended.
  </p>
</main>
