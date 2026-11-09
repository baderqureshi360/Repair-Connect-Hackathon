<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';

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
</script>

<section class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">{$t('shopApplications')}</h1>
    <p class="mt-1 text-sm text-muted">{$t('shopApplicationsHint')}</p>
  </header>

  <div class="flex flex-wrap gap-2" role="tablist" aria-label="Application filters">
    {#each [
      ['pending', $t('filterPending')],
      ['approved', $t('filterApproved')],
      ['rejected', $t('filterRejected')],
      ['all', $t('filterAll')]
    ] as [key, label]}
      <button
        type="button"
        role="tab"
        aria-selected={filter === key}
        class={`rounded-md px-3 py-1.5 text-sm ${filter === key ? 'bg-accent text-white' : 'border border-border'}`}
        onclick={() => setFilter(key as typeof filter)}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if error}
    <Alert type="error" role="alert" message={error} />
  {/if}

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if !items.length}
    <p class="text-muted">{$t('noApplications')}</p>
  {:else}
    <p class="text-sm text-muted">{total} {$t('results')}</p>
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-surface-elevated text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">{$t('applicationReference')}</th>
            <th class="px-3 py-2 font-medium">{$t('ownerName')}</th>
            <th class="px-3 py-2 font-medium">{$t('businessEmail')}</th>
            <th class="px-3 py-2 font-medium">{$t('shopName')}</th>
            <th class="px-3 py-2 font-medium">{$t('city')}</th>
            <th class="px-3 py-2 font-medium">{$t('serviceCategories')}</th>
            <th class="px-3 py-2 font-medium">{$t('submissionDate')}</th>
            <th class="px-3 py-2 font-medium">{$t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {#each items as row}
            <tr class="border-t border-border">
              <td class="px-3 py-2">
                <a class="text-accent underline" href={`/app/platform/shop-applications/${row.id}`}>
                  {row.id}
                </a>
              </td>
              <td class="px-3 py-2">{row.ownerName}</td>
              <td class="px-3 py-2">{row.businessEmail}</td>
              <td class="px-3 py-2">{row.shopName}</td>
              <td class="px-3 py-2">{row.location || `${row.city}, ${row.region}`}</td>
              <td class="px-3 py-2">{(row.serviceCategories || []).join(', ') || '—'}</td>
              <td class="px-3 py-2">{formatDate(row.submittedAt)}</td>
              <td class="px-3 py-2 capitalize">{String(row.status).replaceAll('_', ' ')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
