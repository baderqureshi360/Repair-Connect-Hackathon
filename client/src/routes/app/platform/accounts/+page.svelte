<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  type AccountRow = {
    email: string;
    name: string;
    kind: 'shop' | 'supplier';
    status: string;
    business: string;
    href: string;
    submittedAt?: string;
  };

  let rows = $state<AccountRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let kindFilter = $state<'all' | 'shop' | 'supplier'>('all');

  onMount(async () => {
    try {
      const [shops, suppliers] = await Promise.all([
        api<{ items: any[] }>('/api/v1/platform/shop-applications?status=all'),
        api<{ items: any[] }>('/api/v1/platform/supplier-applications?status=all')
      ]);
      const mapped: AccountRow[] = [
        ...(shops.items || []).map((r) => ({
          email: r.businessEmail || '',
          name: r.ownerName || '',
          kind: 'shop' as const,
          status: r.status,
          business: r.shopName || '',
          href: `/app/platform/shop-applications/${r.id}`,
          submittedAt: r.submittedAt
        })),
        ...(suppliers.items || []).map((r) => ({
          email: r.businessEmail || '',
          name: r.ownerName || '',
          kind: 'supplier' as const,
          status: r.status,
          business: r.businessName || '',
          href: `/app/platform/supplier-applications/${r.id}`,
          submittedAt: r.submittedAt
        }))
      ];
      rows = mapped.sort(
        (a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime()
      );
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  const filtered = $derived(
    rows.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return [r.email, r.name, r.business, r.status].join(' ').toLowerCase().includes(needle);
    })
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('platformAccounts')} subtitle={$t('platformAccountsHint')} />
  <Alert type="info" role="status" message={$t('platformScopeNote')} />

  <div class="flex flex-wrap gap-2">
    {#each [
      ['all', $t('filterAll')],
      ['shop', 'Shop owners'],
      ['supplier', 'Suppliers']
    ] as [key, label]}
      <button
        type="button"
        class={`btn btn-sm ${kindFilter === key ? 'btn-primary' : 'btn-outline'}`}
        onclick={() => (kindFilter = key as typeof kindFilter)}
      >
        {label}
      </button>
    {/each}
  </div>

  <label class="block max-w-md text-sm" for="acct-q"
    >{$t('search')}
    <input id="acct-q" class="input-field mt-1 w-full" bind:value={q} />
  </label>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-14" />{/each}
    </div>
  {:else if !filtered.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">{$t('empty')}</div>
  {:else}
    <p class="text-sm text-muted">{filtered.length} {$t('results')}</p>
    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">Account</th>
            <th class="px-3 py-2" scope="col">Type</th>
            <th class="px-3 py-2" scope="col">Business</th>
            <th class="px-3 py-2" scope="col">{$t('status')}</th>
            <th class="px-3 py-2" scope="col">{$t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as row}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                <p class="font-medium text-ink">{row.name || '—'}</p>
                <p class="text-xs text-muted">{row.email}</p>
              </td>
              <td class="px-3 py-2 capitalize">{row.kind}</td>
              <td class="px-3 py-2">{row.business}</td>
              <td class="px-3 py-2"><StatusPill status={row.status} /></td>
              <td class="px-3 py-2">
                <a class="text-accent underline" href={row.href}>Open application</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
