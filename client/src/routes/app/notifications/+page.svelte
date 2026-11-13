<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t, lang } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import { notificationsInbox } from '$lib/stores/notificationsInbox';
  import {
    hrefForNotification,
    formatNotificationTime,
    referenceLabel
  } from '$lib/notifications/href';
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
        api<{ items: any[]; unread: number }>('/api/v1/notifications?limit=50'),
        api<any>('/api/v1/auth/me')
      ]);
      items = data.items || [];
      unread = data.unread || 0;
      if (me.notificationPreferences) prefs = { ...prefs, ...me.notificationPreferences };
      await notificationsInbox.refresh({ limit: 12, force: true });
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
    try {
      await notificationsInbox.markAll();
      await load();
      toasts.success($t('success'));
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  async function markOne(id: string) {
    try {
      await notificationsInbox.markOne(id);
      items = items.map((n) => (n._id === id ? { ...n, isRead: true } : n));
      unread = Math.max(0, unread - 1);
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
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
  <PageHeader
    title={$t('notifications')}
    subtitle={unread ? `${unread} ${$t('unread')}` : $t('allCaughtUp')}
  >
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
      <p class="mb-3 text-xs text-muted">{$t('notificationPrefsHint')}</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={prefs.repairUpdates} /> {$t('prefRepairUpdates')}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={prefs.estimateRequests} /> {$t('prefEstimateRequests')}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={prefs.partsAlerts} /> {$t('prefPartsAlerts')}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={prefs.appointmentReminders} />
          {$t('prefAppointmentReminders')}
        </label>
      </div>
      <Button class="mt-3" size="sm" onclick={savePrefs}>{$t('save')}</Button>
    </div>

    <ul class="space-y-2" aria-live="polite" role="list">
      {#each items as n (n._id)}
        {@const href = hrefForNotification(n, $user?.role)}
        {@const ref = referenceLabel(n)}
        <li
          class="surface-card p-4"
          class:opacity-70={n.isRead}
          class:ring-1={!n.isRead}
          class:ring-[color-mix(in_oklab,var(--color-primary)_35%,transparent)]={!n.isRead}
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-medium text-ink" class:font-semibold={!n.isRead}>{n.title}</p>
                {#if !n.isRead}
                  <span class="size-2 rounded-full bg-[color:var(--color-primary)]" aria-label={$t('unread')}
                  ></span>
                {/if}
              </div>
              <p class="mt-1 text-sm text-muted">{n.message}</p>
              <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <time datetime={n.createdAt}>{formatNotificationTime(n.createdAt, $lang)}</time>
                {#if ref}<span>{ref}</span>{/if}
                {#if href}
                  <a class="font-medium text-accent underline" href={href}>{$t('viewDetails')}</a>
                {/if}
              </div>
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
