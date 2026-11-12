<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

  let items = $state<any[]>([]);
  let unread = $state(0);
  let loading = $state(true);
  let error = $state('');
  let prefs = $state({
    repairUpdates: true,
    estimateRequests: true,
    partsAlerts: true,
    appointmentReminders: true
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const [data, me] = await Promise.all([
        api<{ items: any[]; unread: number }>('/api/v1/notifications'),
        api<any>('/api/v1/auth/me')
      ]);
      items = data.items || [];
      unread = data.unread || 0;
      if (me.notificationPreferences) prefs = { ...prefs, ...me.notificationPreferences };
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
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

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('notifications')} subtitle={`${unread} unread`}>
    <Button variant="outline" size="sm" onclick={markAll} disabled={!unread}>{$t('markAllRead')}</Button>
  </PageHeader>

  {#if loading}
    <div class="space-y-2" role="status" aria-busy="true" aria-label={$t('loading')}>
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-16" />{/each}
    </div>
  {:else if error}
    <div class="space-y-3">
      <Alert type="error" role="alert" message={error} />
      <Button variant="outline" onclick={load}>{$t('retry')}</Button>
    </div>
  {:else}
    <div class="surface-card p-4">
      <h2 class="mb-1 text-sm font-semibold text-ink">{$t('notificationPrefs')}</h2>
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

    <ul class="space-y-2" aria-live="polite" role="list">
      {#each items as n}
        <li class="surface-card p-4" class:opacity-70={n.isRead}>
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-medium text-ink">{n.title}</p>
              <p class="mt-1 text-sm text-muted">{n.message}</p>
              {#if n.repairRequest}
                <a class="mt-2 inline-block text-sm font-medium text-accent underline" href={`/app/repairs/${n.repairRequest}`}>
                  {$t('viewDetails')}
                </a>
              {/if}
            </div>
            {#if !n.isRead}
              <Button size="sm" variant="ghost" onclick={() => markOne(n._id)}>{$t('markRead')}</Button>
            {/if}
          </div>
        </li>
      {:else}
        <li class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-8 text-center text-sm text-muted" role="status">
          {$t('noNotifications')}
        </li>
      {/each}
    </ul>
  {/if}
</section>
