<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let transfers = $state<any[]>([]);
  let parts = $state<any[]>([]);
  let shops = $state<any[]>([]);
  let form = $state({ fromPartId: '', toShopId: '', quantity: 1, reason: '' });
  let saving = $state(false);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const [tr, inv, shopRes] = await Promise.all([
        api<any[]>('/api/v1/transfers'),
        api<{ data: any[] }>('/api/v1/parts', { full: true }),
        api<{ data: any[] }>('/api/v1/shops', { full: true })
      ]);
      transfers = tr || [];
      parts = inv.data || [];
      shops = shopRes.data || [];
      if (!form.fromPartId && parts[0]) form.fromPartId = parts[0]._id;
      if (!form.toShopId && shops[1]) form.toShopId = shops[1]._id;
      else if (!form.toShopId && shops[0]) form.toShopId = shops[0]._id;
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load().catch((err) => toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric')));
  });

  async function create() {
    saving = true;
    try {
      await api('/api/v1/transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromPartId: form.fromPartId,
          toShopId: form.toShopId,
          quantity: Number(form.quantity),
          reason: form.reason
        })
      });
      toasts.success($t('success'));
      await load();
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    } finally {
      saving = false;
    }
  }

  async function act(id: string, action: 'approve' | 'reject' | 'dispatch' | 'receive') {
    try {
      await api(`/api/v1/transfers/${id}/${action}`, { method: 'POST', body: '{}' });
      toasts.success($t('success'));
      await load();
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  const selectedPart = $derived(parts.find((p) => p._id === form.fromPartId));
  const insufficient = $derived(
    selectedPart && Number(form.quantity) > Number(selectedPart.quantityAvailable || 0)
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('transfers')}
    subtitle={$t('transfersSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/parts' }, { label: $t('transfers') }]}
  />

  {#if loading}
    <div class="grid gap-4 lg:grid-cols-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      <Skeleton class="h-64" />
      <Skeleton class="h-64" />
    </div>
  {:else}
    {#if error}<Alert type="error" role="alert" message={error} />{/if}

    <form
      class="surface-card grid gap-3 p-4 md:grid-cols-2"
      onsubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <h2 class="text-sm font-semibold text-ink md:col-span-2">{$t('transferStock')}</h2>
      <div>
        <label class="mb-1 block text-sm font-medium" for="fromPart">{$t('inventory')}</label>
        <select id="fromPart" class="input-field" bind:value={form.fromPartId} required>
          {#each parts as part}
            <option value={part._id}>
              {part.sku} · {$t('available')} {part.quantityAvailable} · {$t('reserved')}
              {part.quantityReserved || 0}
            </option>
          {/each}
        </select>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="toShop">{$t('shops')}</label>
        <select id="toShop" class="input-field" bind:value={form.toShopId} required>
          {#each shops as shop}
            <option value={shop._id}>{shop.name}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="qty">{$t('quantity')}</label>
        <input id="qty" class="input-field" type="number" min="1" bind:value={form.quantity} required />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="reason">{$t('reason')}</label>
        <input id="reason" class="input-field" bind:value={form.reason} />
      </div>
      {#if insufficient}
        <p class="text-xs text-warning md:col-span-2" role="status">
          {$t('reserveBlocked')}
        </p>
      {/if}
      <div class="md:col-span-2">
        <Button type="submit" loading={saving} disabled={Boolean(insufficient) || !parts.length}>
          {$t('transferStock')}
        </Button>
      </div>
    </form>

    <ul class="space-y-2" role="list">
      {#each transfers as tr}
        <li class="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium text-ink">{tr.partSku} × {tr.quantity}</p>
              <StatusPill status={tr.status} />
            </div>
            <p class="mt-1 text-sm text-muted">{tr.reason || '—'}</p>
            <p class="text-sm text-muted" data-testid="expected-arrival">
              Expected arrival: {tr.expectedArrivalDisplay || 'Unconfirmed'}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            {#if tr.status === 'requested'}
              <Button size="sm" variant="secondary" onclick={() => act(tr._id, 'approve')}>{$t('approve')}</Button>
              <Button size="sm" variant="outline" onclick={() => act(tr._id, 'reject')}>{$t('reject')}</Button>
            {/if}
            {#if tr.status === 'approved' || tr.status === 'awaiting_transfer'}
              <Button size="sm" onclick={() => act(tr._id, 'dispatch')}>Dispatch</Button>
            {/if}
            {#if tr.status === 'dispatched' || tr.status === 'in_transit'}
              <Button size="sm" onclick={() => act(tr._id, 'receive')}>Receive</Button>
            {/if}
          </div>
        </li>
      {:else}
        <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-8 text-center text-sm text-muted" role="status">
          {$t('empty')}
        </li>
      {/each}
    </ul>
  {/if}
</section>
