<script lang="ts">
  import { t } from '$lib/i18n';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ReportsCenter from '$lib/components/ReportsCenter.svelte';
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('reports')}
    subtitle={$t('partsWelcomeSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/parts' }, { label: $t('reports') }]}
  />
  <ReportsCenter allowedCategories={['inventory']} />
</section>
