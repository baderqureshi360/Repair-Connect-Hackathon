<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

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
    const [shopRes, list] = await Promise.all([
      api<{ data: any[] }>('/api/v1/shops', { full: true }),
      api<any[]>('/api/v1/appointments')
    ]);
    shops = shopRes.data || [];
    if (!shopId && shops[0]) shopId = shops[0]._id;
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
</script>

<section>
  <PageHeader title={$t('appointments')} subtitle={$t('bookAppointment')} />

  {#if loading}
    <Skeleton lines={5} />
  {:else}
    {#if error}<Alert type="error" role="alert" message={error} />{/if}

    <div class="grid gap-4 lg:grid-cols-2">
      <form
        class="surface-card space-y-3 p-4"
        onsubmit={(e) => {
          e.preventDefault();
          book();
        }}
      >
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

      <div class="surface-card p-4">
        <h2 class="mb-3 text-lg font-semibold">{$t('recentActivity')}</h2>
        <ul class="space-y-2">
          {#each appointments as appt}
            <li class="rounded-md border border-border p-3 text-sm">
              <p class="font-medium">{appt.shop?.name} · {new Date(appt.startsAt).toLocaleString()}</p>
              <p class="text-muted capitalize">{appt.status}</p>
              {#if appt.status === 'booked'}
                <Button class="mt-2" size="sm" variant="outline" onclick={() => cancel(appt._id)}>
                  {$t('cancel')}
                </Button>
              {/if}
            </li>
          {:else}
            <li class="text-muted">{$t('empty')}</li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</section>
