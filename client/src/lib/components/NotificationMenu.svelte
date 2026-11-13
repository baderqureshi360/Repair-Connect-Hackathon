<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t, lang } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import { ApiError } from '$lib/api';
  import {
    notificationsInbox,
    type InboxNotification
  } from '$lib/stores/notificationsInbox';
  import {
    hrefForNotification,
    formatNotificationTime,
    referenceLabel
  } from '$lib/notifications/href';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  import Skeleton from './Skeleton.svelte';

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  // Mutable box so document listeners always see current open state (no stale closure).
  const openRef = { current: false };

  const unread = $derived($notificationsInbox.unread);
  const items = $derived($notificationsInbox.items);
  const loading = $derived($notificationsInbox.loading);
  const error = $derived($notificationsInbox.error);

  async function openMenu() {
    open = true;
    openRef.current = true;
    await notificationsInbox.refresh({ limit: 12, force: true });
  }

  function closeMenu() {
    open = false;
    openRef.current = false;
  }

  async function toggle() {
    if (openRef.current) closeMenu();
    else await openMenu();
  }

  async function onItemActivate(n: InboxNotification) {
    try {
      if (!n.isRead) await notificationsInbox.markOne(n._id);
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
    const href = hrefForNotification(n, $user?.role);
    closeMenu();
    if (href) await goto(href);
    else await goto('/app/notifications');
  }

  async function onMarkAll() {
    try {
      await notificationsInbox.markAll();
      toasts.success($t('success'));
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : $t('errorGeneric'));
    }
  }

  function onDocPointer(e: MouseEvent) {
    if (!openRef.current || !rootEl) return;
    if (!rootEl.contains(e.target as Node)) closeMenu();
  }

  function onKey(e: KeyboardEvent) {
    if (!openRef.current) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      queueMicrotask(() => triggerEl?.focus());
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', onDocPointer);
    // Capture so Escape closes even if shell shortcut manager also listens.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<div class="relative" bind:this={rootEl}>
  <button
    type="button"
    bind:this={triggerEl}
    class="btn btn-outline btn-icon relative"
    aria-label={`${$t('notifications')}${unread ? `, ${unread} ${$t('unread')}` : ''}`}
    aria-haspopup="true"
    aria-expanded={open}
    aria-controls="notification-panel"
    data-testid="notification-bell"
    onclick={toggle}
  >
    <Icon name="bell" size={17} />
    {#if unread > 0}
      <span
        class="absolute -end-1 -top-1 inline-flex min-w-4 justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
        aria-hidden="true"
      >
        {unread > 99 ? '99+' : unread}
      </span>
    {/if}
  </button>

  {#if open}
    <div
      id="notification-panel"
      class="absolute end-0 z-50 mt-2 w-[min(100vw-1.5rem,22rem)] overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-panel"
      role="dialog"
      aria-label={$t('notifications')}
      data-testid="notification-panel"
      tabindex="-1"
      onkeydown={onKey}
    >
      <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div>
          <p class="text-sm font-semibold text-ink">{$t('notifications')}</p>
          <p class="text-xs text-muted">
            {unread ? `${unread} ${$t('unread')}` : $t('allCaughtUp')}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onclick={onMarkAll}
          disabled={!unread}
          data-testid="notification-mark-all"
        >
          {$t('markAllRead')}
        </Button>
      </div>

      <div class="max-h-[min(70vh,24rem)] overflow-y-auto" role="list" aria-live="polite">
        {#if loading && !items.length}
          <div class="space-y-2 p-3" role="status" aria-busy="true" aria-label={$t('loading')}>
            {#each Array.from({ length: 3 }) as _}
              <Skeleton class="h-14 w-full" />
            {/each}
          </div>
        {:else if error}
          <div class="space-y-2 p-3">
            <p class="text-sm text-danger" role="alert">{error}</p>
            <Button size="sm" variant="outline" onclick={() => notificationsInbox.refresh({ force: true })}>
              {$t('retry')}
            </Button>
          </div>
        {:else if !items.length}
          <p class="px-3 py-8 text-center text-sm text-muted" role="status">{$t('noNotifications')}</p>
        {:else}
          {#each items as n (n._id)}
            {@const href = hrefForNotification(n, $user?.role)}
            {@const ref = referenceLabel(n)}
            <div role="listitem" class="border-b border-border last:border-0">
              <button
                type="button"
                class="flex w-full flex-col gap-0.5 px-3 py-2.5 text-start transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                class:bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)]={!n.isRead}
                data-testid="notification-item"
                data-read={n.isRead ? 'true' : 'false'}
                onclick={() => onItemActivate(n)}
              >
                <div class="flex items-start justify-between gap-2">
                  <p class="text-sm font-medium text-ink" class:font-semibold={!n.isRead}>{n.title}</p>
                  {#if !n.isRead}
                    <span
                      class="mt-1.5 size-2 shrink-0 rounded-full bg-[color:var(--color-primary)]"
                      aria-label={$t('unread')}
                    ></span>
                  {/if}
                </div>
                <p class="line-clamp-2 text-xs text-muted">{n.message}</p>
                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                  <time datetime={n.createdAt}>{formatNotificationTime(n.createdAt, $lang)}</time>
                  {#if ref}
                    <span aria-hidden="true">·</span>
                    <span>{ref}</span>
                  {/if}
                  {#if href}
                    <span class="sr-only">{$t('viewDetails')}</span>
                  {/if}
                </div>
              </button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="border-t border-border p-2">
        <a
          href="/app/notifications"
          class="btn btn-ghost btn-sm w-full justify-center"
          onclick={closeMenu}
          data-testid="notification-view-all"
        >
          {$t('viewAllNotifications')}
        </a>
      </div>
    </div>
  {/if}
</div>
