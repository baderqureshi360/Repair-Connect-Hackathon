<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let loading = $state(true);
  let error = $state('');
  let stats = $state({
    activeShops: 0,
    pendingShops: 0,
    approvedShops: 0,
    rejectedShops: 0,
    pendingSuppliers: 0,
    approvedSuppliers: 0,
    suspendedSuppliers: 0,
    rejectedSuppliers: 0,
    reportedReviews: 0,
    owners: 0
  });

  onMount(async () => {
    try {
      const [
        shopsDir,
        pendingShops,
        approvedShops,
        rejectedShops,
        pendingSuppliers,
        approvedSuppliers,
        suspendedSuppliers,
        rejectedSuppliers,
        shopAll,
        supAll,
        reported
      ] = await Promise.all([
        api<{ meta?: { total?: number } }>('/api/v1/shops?limit=1', { full: true }),
        api<{ total: number }>('/api/v1/platform/shop-applications?status=pending'),
        api<{ total: number }>('/api/v1/platform/shop-applications?status=approved'),
        api<{ total: number }>('/api/v1/platform/shop-applications?status=rejected'),
        api<{ total: number }>('/api/v1/platform/supplier-applications?status=pending'),
        api<{ total: number }>('/api/v1/platform/supplier-applications?status=approved'),
        api<{ total: number }>('/api/v1/platform/supplier-applications?status=suspended'),
        api<{ total: number }>('/api/v1/platform/supplier-applications?status=rejected'),
        api<{ items: any[] }>('/api/v1/platform/shop-applications?status=all'),
        api<{ items: any[] }>('/api/v1/platform/supplier-applications?status=all'),
        api<{ items: any[] }>('/api/v1/platform/supplier-reviews?status=reported').catch(() => ({
          items: []
        }))
      ]);

      const emails = new Set<string>();
      for (const r of shopAll.items || []) if (r.businessEmail) emails.add(String(r.businessEmail).toLowerCase());
      for (const r of supAll.items || []) if (r.businessEmail) emails.add(String(r.businessEmail).toLowerCase());

      stats = {
        activeShops: shopsDir.meta?.total || 0,
        pendingShops: pendingShops.total || 0,
        approvedShops: approvedShops.total || 0,
        rejectedShops: rejectedShops.total || 0,
        pendingSuppliers: pendingSuppliers.total || 0,
        approvedSuppliers: approvedSuppliers.total || 0,
        suspendedSuppliers: suspendedSuppliers.total || 0,
        rejectedSuppliers: rejectedSuppliers.total || 0,
        reportedReviews: reported.items?.length || 0,
        owners: emails.size
      };
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('platformReports')} subtitle={$t('platformReportsHint')} />
  <Alert type="info" role="status" message={$t('platformScopeNote')} />

  {#if loading}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 8 }) as _}<Skeleton class="h-28" />{/each}
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else}
    <StatGrid
      stats={[
        { label: $t('activeShops'), value: stats.activeShops, icon: 'building', tone: 'primary' },
        { label: $t('pendingShopApplications'), value: stats.pendingShops, icon: 'clipboard', tone: 'amber' },
        { label: 'Approved shops', value: stats.approvedShops, icon: 'checkCircle', tone: 'green' },
        { label: 'Rejected shops', value: stats.rejectedShops, icon: 'alertTriangle', tone: 'red' },
        { label: $t('activeSuppliers'), value: stats.approvedSuppliers, icon: 'factory', tone: 'green' },
        {
          label: $t('pendingSupplierApplications'),
          value: stats.pendingSuppliers,
          icon: 'clipboard',
          tone: 'amber'
        },
        { label: $t('suspendedSuppliers'), value: stats.suspendedSuppliers, icon: 'alertTriangle', tone: 'red' },
        { label: 'Rejected suppliers', value: stats.rejectedSuppliers, icon: 'alertTriangle', tone: 'violet' },
        {
          label: $t('registeredUsersApprox'),
          value: stats.owners,
          icon: 'users',
          tone: 'blue',
          hint: 'Unique business emails on applications'
        },
        {
          label: 'Reported reviews',
          value: stats.reportedReviews,
          icon: 'clipboard',
          tone: 'amber'
        }
      ]}
    />
  {/if}
</section>
