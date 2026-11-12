<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  type AppRow = {
    id: string;
    status: string;
    ownerName: string;
    businessEmail: string;
    shopName: string;
    city: string;
    region: string;
    location?: string;
    serviceCategories: string[];
    submittedAt?: string;
  };

  let filter = $state<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  let items = $state<AppRow[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const data = await api<{ items: AppRow[]; total: number }>(
        `/api/v1/platform/shop-applications?status=${filter}`
      );
      items = data.items || [];
      total = data.total || 0;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      items = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function setFilter(next: typeof filter) {
    filter = next;
    void load();
  }

  function formatDate(value?: string) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  const filtered = $derived(
    items.filter((row) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return [row.id, row.ownerName, row.businessEmail, row.shopName, row.city, row.region]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    })
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('shopApplications')} subtitle={$t('shopApplicationsHint')} />
  <Alert type="info" role="status" message={$t('platformScopeNote')} />

  <div class="flex flex-wrap gap-2" role="group" aria-label={$t('shopApplications')}>
    {#each [
      ['pending', $t('filterPending')],
      ['approved', $t('filterApproved')],
      ['rejected', $t('filterRejected')],
      ['all', $t('filterAll')]
    ] as [key, label]}
      <Button
        size="sm"
        variant={filter === key ? 'primary' : 'outline'}
        onclick={() => setFilter(key as typeof filter)}
      >
        {label}
      </Button>
    {/each}
  </div>

  <label class="block max-w-md text-sm" for="shop-app-q"
    >{$t('search')}
    <input id="shop-app-q" class="input-field mt-1 w-full" bind:value={q} />
  </label>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-14" />{/each}
    </div>
  {:else if !filtered.length}
    <div class="surface-card px-4 py-10 text-center text-sm text-muted" role="status">{$t('noApplications')}</div>
  {:else}
    <p class="text-sm text-muted">{filtered.length} / {total} {$t('results')}</p>
    <div class="surface-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-muted text-muted">
          <tr>
            <th class="px-3 py-2" scope="col">{$t('applicationReference')}</th>
            <th class="px-3 py-2" scope="col">{$t('ownerName')}</th>
            <th class="px-3 py-2" scope="col">{$t('shopName')}</th>
            <th class="px-3 py-2" scope="col">{$t('city')}</th>
            <th class="px-3 py-2" scope="col">{$t('submissionDate')}</th>
            <th class="px-3 py-2" scope="col">{$t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as row}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                <a class="font-medium text-accent underline" href={`/app/platform/shop-applications/${row.id}`}>
                  {row.id}
                </a>
              </td>
              <td class="px-3 py-2">
                <p class="text-ink">{row.ownerName}</p>
                <p class="text-xs text-muted">{row.businessEmail}</p>
              </td>
              <td class="px-3 py-2 text-ink">{row.shopName}</td>
              <td class="px-3 py-2">{row.location || `${row.city}, ${row.region}`}</td>
              <td class="px-3 py-2">{formatDate(row.submittedAt)}</td>
              <td class="px-3 py-2"><StatusPill status={row.status} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
