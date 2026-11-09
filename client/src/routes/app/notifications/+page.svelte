<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';

  let items = $state<any[]>([]);
  let unread = $state(0);
  let prefs = $state({
    repairUpdates: true,
    estimateRequests: true,
    partsAlerts: true,
    appointmentReminders: true
  });

  async function load() {
    const [data, me] = await Promise.all([
      api<{ items: any[]; unread: number }>('/api/v1/notifications'),
      api<any>('/api/v1/auth/me')
    ]);
    items = data.items || [];
    unread = data.unread || 0;
    if (me.notificationPreferences) prefs = { ...prefs, ...me.notificationPreferences };
  }

  onMount(() => {
    load().catch((err) => toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric')));
  });

  async function markAll() {
    await api('/api/v1/notifications/read-all', { method: 'POST' });
    await load();
    toasts.success($t('success'));
  }

  async function markOne(id: string) {
    await api(`/api/v1/notifications/${id}/read`, { method: 'POST' });
    await load();
  }

  async function savePrefs() {
    try {
      await api('/api/v1/auth/me/notifications', {
        method: 'PATCH',
        body: JSON.stringify(prefs)
      });
      toasts.success($t('success'));
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }
</script>

<section class="space-y-6">
  <PageHeader title={$t('notifications')} subtitle={`${unread} unread`}>
    <Button variant="outline" onclick={markAll}>{$t('markAllRead')}</Button>
  </PageHeader>

  <div class="surface-card p-4">
    <h2 class="mb-3 font-semibold">{$t('notificationPrefs')}</h2>
    <p class="mb-3 text-xs text-muted">In-app only — no SMS/email delivery is configured.</p>
    <div class="grid gap-2 sm:grid-cols-2">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={prefs.repairUpdates} /> Repair updates
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={prefs.estimateRequests} /> Estimate requests
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={prefs.partsAlerts} /> Parts alerts
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={prefs.appointmentReminders} /> Appointment reminders
      </label>
    </div>
    <Button class="mt-3" size="sm" onclick={savePrefs}>{$t('save')}</Button>
  </div>

  <ul class="space-y-2" aria-live="polite">
    {#each items as n}
      <li class="surface-card p-3" class:opacity-60={n.isRead}>
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="font-medium">{n.title}</p>
            <p class="text-sm text-muted">{n.message}</p>
            {#if n.repairRequest}
              <a class="mt-1 inline-block text-sm text-accent underline" href={`/app/repairs/${n.repairRequest}`}>{$t('viewDetails')}</a>
            {/if}
          </div>
          {#if !n.isRead}
            <Button size="sm" variant="ghost" onclick={() => markOne(n._id)}>{$t('markRead')}</Button>
          {/if}
        </div>
      </li>
    {:else}
      <li class="text-muted">{$t('noNotifications')}</li>
    {/each}
  </ul>
</section>
