<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';

  let shops = $state<any[]>([]);
  let appointments = $state<any[]>([]);
  let slots = $state<string[]>([]);
  let shopId = $state('');
  let date = $state(new Date().toISOString().slice(0, 10));
  let startsAt = $state('');
  let notes = $state('');
  let loading = $state(true);
  let booking = $state(false);
  let error = $state('');

  async function refresh() {
    const preferred = $page.url.searchParams.get('shopId') || '';
    const [shopRes, list] = await Promise.all([
      api<{ data: any[] }>('/api/v1/shops', { full: true }),
      api<any[]>('/api/v1/appointments')
    ]);
    shops = shopRes.data || [];
    if (preferred && shops.some((s) => String(s._id) === preferred)) {
      shopId = preferred;
    } else if (!shopId && shops[0]) {
      shopId = shops[0]._id;
    }
    appointments = list || [];
  }

  async function loadSlots() {
    if (!shopId || !date) return;
    const data = await api<{ slots: string[] }>(
      `/api/v1/appointments/slots?shopId=${shopId}&date=${date}`
    );
    slots = data.slots || [];
    startsAt = slots[0] || '';
  }

  onMount(async () => {
    try {
      await refresh();
      await loadSlots();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  });

  async function book() {
    error = '';
    booking = true;
    try {
      await api('/api/v1/appointments', {
        method: 'POST',
        body: JSON.stringify({ shopId, startsAt, notes })
      });
      toasts.success($t('success'));
      notes = '';
      await refresh();
      await loadSlots();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      toasts.error(error);
    } finally {
      booking = false;
    }
  }

  async function cancel(id: string) {
    try {
      await api(`/api/v1/appointments/${id}/cancel`, { method: 'POST', body: '{}' });
      toasts.success($t('success'));
      await refresh();
      await loadSlots();
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  const upcoming = $derived(
    appointments.filter((a) => a.status === 'booked' && new Date(a.startsAt) >= new Date())
  );
  const past = $derived(
    appointments.filter((a) => !(a.status === 'booked' && new Date(a.startsAt) >= new Date()))
  );
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('appointments')}
    subtitle={$t('customerAppointmentsSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/customer' }, { label: $t('appointments') }]}
  />

  {#if loading}
    <div class="grid gap-4 lg:grid-cols-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      <Skeleton class="h-64" />
      <Skeleton class="h-64" />
    </div>
  {:else}
    {#if error}<Alert type="error" role="alert" message={error} />{/if}

    <div class="grid gap-4 lg:grid-cols-2">
      <form
        class="surface-card space-y-3 p-4"
        aria-labelledby="book-appointment-heading"
        onsubmit={(e) => {
          e.preventDefault();
          book();
        }}
      >
        <h2 id="book-appointment-heading" class="text-sm font-semibold text-ink">{$t('bookAppointment')}</h2>
        <div>
          <label class="mb-1 block text-sm font-medium" for="shop">{$t('preferredShop')}</label>
          <select
            id="shop"
            class="input-field"
            bind:value={shopId}
            onchange={loadSlots}
            required
          >
            {#each shops as shop}
              <option value={shop._id}>{shop.name} — {shop.city}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="date">{$t('date')}</label>
          <input id="date" type="date" class="input-field" bind:value={date} onchange={loadSlots} required />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="slot">{$t('slot')}</label>
          <select id="slot" class="input-field" bind:value={startsAt} required>
            {#each slots as slot}
              <option value={slot}>{new Date(slot).toLocaleString()}</option>
            {:else}
              <option value="">{$t('empty')}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="notes">{$t('notes')}</label>
          <textarea id="notes" class="input-field" rows="2" bind:value={notes}></textarea>
        </div>
        <Button type="submit" loading={booking} disabled={!startsAt}>{$t('bookAppointment')}</Button>
      </form>

      <div class="space-y-4">
        <div class="surface-card p-4">
          <h2 class="mb-3 text-sm font-semibold text-ink">{$t('upcomingAppointments')}</h2>
          <ul class="space-y-2" role="list">
            {#each upcoming as appt}
              <li class="rounded-[var(--radius-ui)] border border-border p-3 text-sm">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-medium text-ink">{appt.shop?.name}</p>
                    <p class="text-muted">{new Date(appt.startsAt).toLocaleString()}</p>
                  </div>
                  <StatusPill status={appt.status} />
                </div>
                {#if appt.status === 'booked'}
                  <Button class="mt-2" size="sm" variant="outline" onclick={() => cancel(appt._id)}>
                    {$t('cancel')}
                  </Button>
                {/if}
              </li>
            {:else}
              <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
                {$t('empty')}
              </li>
            {/each}
          </ul>
        </div>

        {#if past.length}
          <div class="surface-card p-4">
            <h2 class="mb-3 text-sm font-semibold text-ink">{$t('recentActivity')}</h2>
            <ul class="space-y-2" role="list">
              {#each past.slice(0, 8) as appt}
                <li class="rounded-[var(--radius-ui)] border border-border px-3 py-2 text-sm">
                  <p class="font-medium">{appt.shop?.name} · {new Date(appt.startsAt).toLocaleString()}</p>
                  <p class="capitalize text-muted">{appt.status}</p>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>
