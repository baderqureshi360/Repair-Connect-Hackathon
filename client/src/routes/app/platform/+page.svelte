<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import StatGrid from '$lib/components/StatGrid.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let loading = $state(true);
  let error = $state('');
  let pendingShops = $state<any[]>([]);
  let approvedShops = $state(0);
  let rejectedShops = $state(0);
  let pendingSuppliers = $state<any[]>([]);
  let approvedSuppliers = $state(0);
  let suspendedSuppliers = $state(0);
  let allShopApps = $state<any[]>([]);
  let allSupplierApps = $state<any[]>([]);
  let activeShopsTotal = $state(0);
  let reportedReviews = $state<any[]>([]);
  let recentActivity = $state<{ label: string; href: string; when?: string; status?: string }[]>([]);

  onMount(async () => {
    try {
      const [
        shopPending,
        shopApproved,
        shopRejected,
        shopAll,
        supPending,
        supApproved,
        supSuspended,
        supAll,
        shopsDir,
        reviews
      ] = await Promise.all([
        api<{ items: any[]; total: number }>('/api/v1/platform/shop-applications?status=pending'),
        api<{ items: any[]; total: number }>('/api/v1/platform/shop-applications?status=approved'),
        api<{ items: any[]; total: number }>('/api/v1/platform/shop-applications?status=rejected'),
        api<{ items: any[]; total: number }>('/api/v1/platform/shop-applications?status=all'),
        api<{ items: any[]; total: number }>('/api/v1/platform/supplier-applications?status=pending'),
        api<{ items: any[]; total: number }>('/api/v1/platform/supplier-applications?status=approved'),
        api<{ items: any[]; total: number }>('/api/v1/platform/supplier-applications?status=suspended'),
        api<{ items: any[]; total: number }>('/api/v1/platform/supplier-applications?status=all'),
        api<{ data: any[]; meta?: { total?: number } }>('/api/v1/shops?limit=1', { full: true }).catch(
          () => ({ data: [], meta: { total: 0 } })
        ),
        api<{ items: any[] }>('/api/v1/platform/supplier-reviews?status=reported').catch(() => ({
          items: []
        }))
      ]);

      pendingShops = shopPending.items || [];
      approvedShops = shopApproved.total || 0;
      rejectedShops = shopRejected.total || 0;
      allShopApps = shopAll.items || [];
      pendingSuppliers = supPending.items || [];
      approvedSuppliers = supApproved.total || 0;
      suspendedSuppliers = supSuspended.total || 0;
      allSupplierApps = supAll.items || [];
      activeShopsTotal = shopsDir?.meta?.total ?? shopsDir?.data?.length ?? 0;
      reportedReviews = reviews.items || [];

      recentActivity = [
        ...pendingShops.slice(0, 4).map((r) => ({
          label: `Shop application ${r.id}`,
          href: `/app/platform/shop-applications/${r.id}`,
          when: r.submittedAt,
          status: r.status
        })),
        ...pendingSuppliers.slice(0, 4).map((r) => ({
          label: `Supplier application ${r.id}`,
          href: `/app/platform/supplier-applications/${r.id}`,
          when: r.submittedAt,
          status: r.status
        })),
        ...reportedReviews.slice(0, 3).map((r) => ({
          label: `Reported review ${r.publicId || r.id}`,
          href: '/app/platform/supplier-reviews',
          when: r.updatedAt || r.createdAt,
          status: r.status
        }))
      ]
        .sort((a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime())
        .slice(0, 10);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  const ownerCount = $derived.by(() => {
    const emails = new Set<string>();
    for (const r of allShopApps) if (r.businessEmail) emails.add(String(r.businessEmail).toLowerCase());
    for (const r of allSupplierApps) if (r.businessEmail) emails.add(String(r.businessEmail).toLowerCase());
    return emails.size;
  });

  const priorities = $derived([
    ...pendingShops.slice(0, 5).map((r) => ({
      href: `/app/platform/shop-applications/${r.id}`,
      label: `${$t('pendingShopApplications')}: ${r.shopName || r.id}`,
      icon: 'clipboard' as const
    })),
    ...pendingSuppliers.slice(0, 5).map((r) => ({
      href: `/app/platform/supplier-applications/${r.id}`,
      label: `${$t('pendingSupplierApplications')}: ${r.businessName || r.id}`,
      icon: 'factory' as const
    })),
    ...reportedReviews.slice(0, 4).map((r) => ({
      href: '/app/platform/supplier-reviews',
      label: `${$t('supplierReviews')}: ${r.publicId || r.id}`,
      icon: 'alertTriangle' as const
    })),
    ...allSupplierApps
      .filter((r) => r.status === 'suspended')
      .slice(0, 3)
      .map((r) => ({
        href: `/app/platform/supplier-applications/${r.id}`,
        label: `${$t('suspendedSuppliers')}: ${r.businessName || r.id}`,
        icon: 'alertTriangle' as const
      }))
  ].slice(0, 12));

  const firstName = $derived($user?.name?.split(' ')[0] || 'Operator');
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <header class="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('dashboard')}</p>
      <h1 class="mt-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">
        {$t('welcomeBack')}, {firstName}
      </h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{$t('platformDashboardHint')}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href="/app/platform/shop-applications" variant="primary" size="sm">{$t('shopApplications')}</Button>
      <Button href="/app/platform/supplier-applications" variant="outline" size="sm">{$t('supplierApplications')}</Button>
      <Button href="/app/platform/supplier-reviews" variant="outline" size="sm">{$t('supplierReviews')}</Button>
    </div>
  </header>

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
        {
          label: $t('activeShops'),
          value: activeShopsTotal,
          icon: 'building',
          tone: 'primary',
          hint: $t('publicShopDirectory')
        },
        {
          label: $t('pendingShopApplications'),
          value: pendingShops.length,
          icon: 'clipboard',
          tone: 'amber'
        },
        {
          label: $t('filterApproved'),
          value: approvedShops,
          icon: 'checkCircle',
          tone: 'green',
          hint: 'Approved shop applications'
        },
        {
          label: $t('filterRejected'),
          value: rejectedShops,
          icon: 'alertTriangle',
          tone: 'red',
          hint: $t('suspendedShopsNote')
        },
        {
          label: $t('activeSuppliers'),
          value: approvedSuppliers,
          icon: 'factory',
          tone: 'green'
        },
        {
          label: $t('pendingSupplierApplications'),
          value: pendingSuppliers.length,
          icon: 'clipboard',
          tone: 'amber'
        },
        {
          label: $t('suspendedSuppliers'),
          value: suspendedSuppliers,
          icon: 'alertTriangle',
          tone: 'red'
        },
        {
          label: $t('registeredUsersApprox'),
          value: ownerCount,
          icon: 'users',
          tone: 'violet',
          hint: 'Unique business emails on applications'
        },
        {
          label: $t('supplierReviews'),
          value: reportedReviews.length,
          icon: 'clipboard',
          tone: 'amber',
          hint: 'Reported reviews awaiting moderation'
        }
      ]}
    />

    <div class="grid gap-4 xl:grid-cols-3">
      <section class="surface-card p-4 xl:col-span-2" aria-labelledby="platform-activity">
        <h2 id="platform-activity" class="mb-3 text-sm font-semibold text-ink">{$t('recentPlatformActivity')}</h2>
        {#if !recentActivity.length}
          <p class="text-sm text-muted" role="status">{$t('empty')}</p>
        {:else}
          <ul class="space-y-2" role="list">
            {#each recentActivity as item}
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ui)] border border-border px-3 py-2 text-sm">
                <a class="font-medium text-ink hover:underline" href={item.href}>{item.label}</a>
                <div class="flex items-center gap-2">
                  {#if item.status}<StatusPill status={item.status} />{/if}
                  <span class="text-xs text-muted">
                    {item.when ? new Date(item.when).toLocaleString() : ''}
                  </span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="priorities-panel flex flex-col rounded-[var(--radius-ui)] p-4" aria-labelledby="platform-priorities">
        <h2 id="platform-priorities" class="priorities-title mb-1 text-sm font-semibold">
          {$t('pendingAdminActions')}
        </h2>
        <p class="priorities-hint mb-3 text-xs">{$t('todaysPriorities')}</p>
        <ul class="flex-1 space-y-2 text-sm" role="list">
          {#each priorities as item}
            <li>
              <a class="flex items-start gap-2 text-ink hover:text-[color:var(--color-primary-hover)]" href={item.href}>
                <Icon name={item.icon} size={15} class="mt-0.5 shrink-0 text-accent" />
                <span class="font-medium">{item.label}</span>
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
