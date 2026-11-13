<script lang="ts">
  import { t } from '$lib/i18n';
  import BrandMark from '$lib/components/BrandMark.svelte';
</script>

<svelte:head><title>Accessibility — RepairConnect</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-12 md:px-6">
  <a href="/" class="inline-flex items-center gap-2.5 text-sm font-semibold text-ink hover:opacity-90">
    <BrandMark size={28} compact />
    <span>{$t('appName')}</span>
  </a>
  <h1 class="mt-6 text-2xl font-semibold tracking-tight md:text-3xl">Accessibility</h1>
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
