<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  type AuditRow = {
    id: string;
    source: string;
    action: string;
    actor?: string;
    when?: string;
    href: string;
    detail?: string;
    status?: string;
  };

  let rows = $state<AuditRow[]>([]);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      const [supplierApps, reviewsReported, reviewsModerated, shopApps] = await Promise.all([
        api<{ items: any[] }>('/api/v1/platform/supplier-applications?status=all'),
        api<{ items: any[] }>('/api/v1/platform/supplier-reviews?status=reported').catch(() => ({
          items: []
        })),
        api<{ items: any[] }>('/api/v1/platform/supplier-reviews?status=moderated').catch(() => ({
          items: []
        })),
        api<{ items: any[] }>('/api/v1/platform/shop-applications?status=all')
      ]);

      const collected: AuditRow[] = [];

      for (const app of (shopApps.items || []).filter((a) => a.reviewedAt || a.approvedAt).slice(0, 20)) {
        collected.push({
          id: `${app.id}-review`,
          source: 'Shop application',
          action: app.status,
          actor: app.reviewedBy ? String(app.reviewedBy) : undefined,
          when: app.reviewedAt || app.approvedAt || app.submittedAt,
          href: `/app/platform/shop-applications/${app.id}`,
          detail: app.rejectionReason || app.reviewRemarks || app.shopName,
          status: app.status
        });
      }

      const candidates = (supplierApps.items || [])
        .filter((a) => ['approved', 'rejected', 'suspended'].includes(a.status))
        .slice(0, 12);

      const audits = await Promise.all(
        candidates.map(async (app) => {
          try {
            const entries = await api<any[]>(`/api/v1/platform/supplier-applications/${app.id}/audit`);
            return (entries || []).map((e) => ({
              id: `${app.id}-${e.id || e.createdAt}-${e.action}`,
              source: `Supplier ${app.businessName || app.id}`,
              action: e.action || app.status,
              actor: e.actorLabel,
              when: e.createdAt,
              href: `/app/platform/supplier-applications/${app.id}`,
              detail: e.reason || e.remarks || '',
              status: app.status
            }));
          } catch {
            return [] as AuditRow[];
          }
        })
      );
      collected.push(...audits.flat());

      for (const review of [...(reviewsReported.items || []), ...(reviewsModerated.items || [])]) {
        for (const m of review.moderationHistory || []) {
          collected.push({
            id: `${review.id}-${m.action}-${m.at || m.createdAt || ''}`,
            source: `Review ${review.publicId || review.id}`,
            action: m.action,
            actor: m.actorLabel,
            when: m.at || m.createdAt || review.updatedAt,
            href: '/app/platform/supplier-reviews',
            detail: m.reason,
            status: review.status
          });
        }
      }

      rows = collected
        .sort((a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime())
        .slice(0, 80);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('platformAudit')} subtitle={$t('platformAuditHint')} />
  <Alert type="info" role="status" message={$t('platformScopeNote')} />

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 5 }) as _}<Skeleton class="h-14" />{/each}
    </div>
  {:else if !rows.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">
      {$t('noAuditEntries')}
    </div>
  {:else}
    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">When</th>
            <th class="px-3 py-2" scope="col">Source</th>
            <th class="px-3 py-2" scope="col">Action</th>
            <th class="px-3 py-2" scope="col">{$t('reviewerIdentity')}</th>
            <th class="px-3 py-2" scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row}
            <tr class="border-t border-border">
              <td class="px-3 py-2 text-muted">
                {row.when ? new Date(row.when).toLocaleString() : '—'}
              </td>
              <td class="px-3 py-2">
                <a class="text-accent underline" href={row.href}>{row.source}</a>
              </td>
              <td class="px-3 py-2">
                {#if row.status}
                  <StatusPill status={row.action} />
                {:else}
                  {row.action}
                {/if}
              </td>
              <td class="px-3 py-2">{row.actor || '—'}</td>
              <td class="px-3 py-2 text-muted">{row.detail || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
