<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { t, lang } from '$lib/i18n';
  import { clearSession, user } from '$lib/stores/auth';
  import { announce, online, theme } from '$lib/stores/ui';
  import { applyPreferences, preferences, type ThemePref } from '$lib/stores/preferences';
  import { selectedShopId } from '$lib/stores/shopContext';
  import { api } from '$lib/api';
  import { navByRole, pendingNavByRole } from '$lib/navigation/portalNav';
  import { shortcutManager } from '$lib/keyboard/manager';
  import { commandPaletteRequest, shortcutsHelpRequest } from '$lib/keyboard/ui';
  import { notificationsInbox } from '$lib/stores/notificationsInbox';
  import Alert from './Alert.svelte';
  import ToastHost from './ToastHost.svelte';
  import Icon from './Icon.svelte';
  import BrandMark from './BrandMark.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import ShortcutsHelp from './ShortcutsHelp.svelte';
  import NotificationMenu from './NotificationMenu.svelte';
  let {
    children,
    pendingOnboarding = false
  }: { children: import('svelte').Snippet; pendingOnboarding?: boolean } = $props();

  let collapsed = $state(false);
  let mobileOpen = $state(false);
  let searchQ = $state('');
  let searching = $state(false);
  let searchOpen = $state(false);
  let searchResults = $state<{
    repairs: any[];
    customers: any[];
    parts: any[];
    documents: any[];
  } | null>(null);
  let isNarrow = $state(false);
  let shops = $state<{ id: string; name: string }[]>([]);
  let isFullscreen = $state(false);
  let commandPaletteOpen = $state(false);
  let shortcutsHelpOpen = $state(false);

  const pendingNav = $derived(
    $user?.role === 'supplier'
      ? pendingNavByRole.supplier || []
      : pendingNavByRole.shop_admin || []
  );
  const shellNav = $derived(
    $user ? (pendingOnboarding ? pendingNav : navByRole[$user.role] || []) : []
  );
  const brandHref = $derived(shellNav[0]?.href || '/');
  const unread = $derived($notificationsInbox.unread);

  async function refreshUnread() {
    try {
      await notificationsInbox.refresh({ limit: 12 });
    } catch {
      /* ignore when unauthenticated briefly */
    }
  }

  async function loadShops() {
    if (!$user || ($user.role !== 'shop_admin' && $user.role !== 'parts_coordinator' && $user.role !== 'mechanic')) {
      return;
    }
    try {
      const list = await api<any[]>('/api/v1/shops/mine');
      shops = (list || [])
        .map((s) => ({ id: String(s._id || s.id), name: s.name || s.code || 'Shop' }))
        .filter((s) => s.id);
      if (!$selectedShopId && shops[0]) selectedShopId.set(shops[0].id);
      else if ($selectedShopId && !shops.some((s) => s.id === $selectedShopId) && shops[0]) {
        selectedShopId.set(shops[0].id);
      }
    } catch {
      shops = [];
    }
  }

  function onShopChange(id: string) {
    selectedShopId.set(id);
    announce.set($t('shopSwitched'));
    searchResults = null;
    searchQ = '';
    searchOpen = false;
    commandPaletteOpen = false;
    // Soft refresh current view so shop-scoped pages reload.
    goto($page.url.pathname + $page.url.search, { invalidateAll: true, replaceState: true });
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      announce.set($t('fullscreenUnavailable'));
    }
  }

  onMount(() => {
    collapsed = $preferences.sidebarCollapsed;
    refreshUnread();
    loadShops();
    const id = setInterval(refreshUnread, 45000);
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshUnread();
    };
    document.addEventListener('visibilitychange', onVis);
    const mq = window.matchMedia('(max-width: 1023px)');
    const syncNarrow = () => {
      isNarrow = mq.matches;
    };
    syncNarrow();
    mq.addEventListener('change', syncNarrow);

    const onFs = () => {
      isFullscreen = Boolean(document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFs);
    onFs();

    shortcutManager.install({
      getRole: () => get(user)?.role ?? null,
      getPathname: () => get(page).url.pathname,
      getPendingOnboarding: () => pendingOnboarding,
      navigate: (href) => goto(href),
      openCommandPalette: () => {
        commandPaletteOpen = true;
        searchOpen = false;
      },
      openShortcutsHelp: () => {
        shortcutsHelpOpen = true;
      }
    });

    return () => {
      clearInterval(id);
      mq.removeEventListener('change', syncNarrow);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('visibilitychange', onVis);
      shortcutManager.uninstall();
    };
  });

  $effect(() => {
    if (searchOpen) {
      shortcutManager.pushOverlay({
        id: 'header-search',
        close: () => {
          searchOpen = false;
          searchResults = null;
        }
      });
    } else {
      shortcutManager.removeOverlay('header-search');
    }
  });

  $effect(() => {
    if (mobileOpen) {
      shortcutManager.pushOverlay({
        id: 'mobile-nav',
        close: () => {
          mobileOpen = false;
          const menuBtn = document.querySelector<HTMLElement>('[data-testid="open-mobile-nav"]');
          menuBtn?.focus();
        }
      });
    } else {
      shortcutManager.removeOverlay('mobile-nav');
    }
  });

  let lastPaletteReq = $state(0);
  let lastHelpReq = $state(0);
  $effect(() => {
    const n = $commandPaletteRequest;
    if (n > lastPaletteReq) {
      lastPaletteReq = n;
      commandPaletteOpen = true;
    }
  });
  $effect(() => {
    const n = $shortcutsHelpRequest;
    if (n > lastHelpReq) {
      lastHelpReq = n;
      shortcutsHelpOpen = true;
    }
  });

  $effect(() => {
    void $page.url.pathname;
    mobileOpen = false;
    searchOpen = false;
    commandPaletteOpen = false;
    shortcutsHelpOpen = false;
  });

  $effect(() => {
    if (!mobileOpen || !isNarrow) return;
    const panel = document.getElementById('primary-nav');
    const focusable = panel?.querySelector<HTMLElement>(
      'button, [href], select, input, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  });

  async function persistSidebar(next: boolean) {
    collapsed = next;
    try {
      const prefs = { ...$preferences, sidebarCollapsed: next };
      applyPreferences(prefs);
      await api('/api/v1/auth/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ sidebarCollapsed: next })
      });
    } catch {
      /* local preference still applied */
    }
  }

  async function switchLang(next: 'en' | 'ur') {
    lang.set(next);
    try {
      await api('/api/v1/auth/me/language', {
        method: 'PATCH',
        body: JSON.stringify({ preferredLanguage: next })
      });
    } catch {
      /* preference still local */
    }
  }

  async function setThemePref(next: ThemePref) {
    const prefs = { ...$preferences, theme: next };
    applyPreferences(prefs);
    const resolved =
      next === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : next;
    theme.set(resolved);
    try {
      await api('/api/v1/auth/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ theme: next })
      });
    } catch {
      /* local preference still applied */
    }
  }

  async function logout() {
    try {
      await api('/api/v1/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* clear client session regardless */
    }
    commandPaletteOpen = false;
    shortcutsHelpOpen = false;
    searchOpen = false;
    searchResults = null;
    searchQ = '';
    clearSession();
    notificationsInbox.reset();
    const { clearPreferencesCache } = await import('$lib/stores/preferences');
    clearPreferencesCache();
    goto('/login');
  }

  let lastPrincipalKey = $state('');
  $effect(() => {
    // Drop cached search/palette state only when identity/role actually changes.
    const principalKey = `${$user?.id || ''}:${$user?.role || ''}`;
    if (principalKey === lastPrincipalKey) return;
    lastPrincipalKey = principalKey;
    searchResults = null;
    searchQ = '';
    searchOpen = false;
    commandPaletteOpen = false;
  });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function onSearchInput() {
    searchOpen = true;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void runSearch(false), 280);
  }

  async function runSearch(navigateFirst = true) {
    const q = searchQ.trim();
    if (!q || !$user) return;
    searching = true;
    try {
      const res = await api<{
        repairs: any[];
        customers: any[];
        parts: any[];
        documents: any[];
      }>(`/api/v1/search?q=${encodeURIComponent(q)}&limit=6`);
      searchResults = res;
      const first =
        res.repairs[0]?.href ||
        res.customers[0]?.href ||
        res.parts[0]?.href ||
        res.documents[0]?.href;
      if (navigateFirst && first) {
        goto(first);
        searchQ = '';
        searchOpen = false;
        searchResults = null;
      } else if (
        !res.repairs.length &&
        !res.customers.length &&
        !res.parts.length &&
        !res.documents.length
      ) {
        announce.set($t('searchNoResults'));
      }
    } catch {
      announce.set($t('errorGeneric'));
    } finally {
      searching = false;
    }
  }

  function submitSearch(e: Event) {
    e.preventDefault();
    void runSearch(true);
  }

  function isActive(href: string) {
    const path = $page.url.pathname;
    if (path === href) return true;
    if (
      href === '/app/customer' ||
      href === '/app/mechanic' ||
      href === '/app/parts' ||
      href === '/app/admin'
    ) {
      return false;
    }
    return path.startsWith(href + '/');
  }

  function initials(name?: string) {
    if (!name) return 'RC';
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('');
  }

  const roleLabel = $derived($user ? $t($user.role) : '');
</script>

<a href="#main" class="skip-link">{$t('skipToContent')}</a>
<ToastHost />
<CommandPalette
  open={commandPaletteOpen}
  {pendingOnboarding}
  onclose={() => (commandPaletteOpen = false)}
  onopenHelp={() => (shortcutsHelpOpen = true)}
  onlogout={logout}
/>
<ShortcutsHelp open={shortcutsHelpOpen} onclose={() => (shortcutsHelpOpen = false)} />

{#if mobileOpen}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-[color-mix(in_oklab,var(--color-ink)_45%,transparent)] lg:hidden"
    aria-label={$t('closeMenu')}
    onclick={() => (mobileOpen = false)}
  ></button>
{/if}

<div class="min-h-dvh lg:flex">
  <aside
    id="primary-nav"
    class={`sidebar-panel sidebar-dark inset-y-0 start-0 z-50 w-60 flex-col lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:shrink-0 ${
      collapsed ? 'lg:w-[4.5rem]' : 'lg:w-60'
    } ${mobileOpen ? 'fixed flex translate-x-0' : 'fixed hidden'}`}
    aria-label="Primary"
  >
    <div class="flex items-center justify-between gap-2 border-b border-[color:var(--color-sidebar-border)] px-3 py-3">
      <a
        href={brandHref}
        class={`flex min-w-0 items-center gap-2.5 text-[color:var(--color-sidebar-text-active)] ${collapsed ? 'lg:justify-center lg:w-full' : ''}`}
        aria-label={$t('appName')}
      >
        <span class="sidebar-logo" aria-hidden="true">
          <BrandMark size={28} compact />
        </span>
        {#if !collapsed}
          <div class="min-w-0">
            <p class="truncate text-sm font-bold tracking-tight">
              {$t('appName')}
            </p>
          </div>
        {:else}
          <p class="hidden text-xs font-bold lg:sr-only">RC</p>
        {/if}
      </a>
      <button
        type="button"
        class="sidebar-icon-btn hidden lg:inline-flex"
        aria-label={collapsed ? $t('expandSidebar') : $t('collapseSidebar')}
        aria-expanded={!collapsed}
        title={collapsed ? $t('expandSidebar') : $t('collapseSidebar')}
        onclick={() => persistSidebar(!collapsed)}
      >
        <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
      </button>
      <button
        type="button"
        class="sidebar-icon-btn lg:hidden"
        aria-label={$t('closeMenu')}
        onclick={() => (mobileOpen = false)}
      >
        <Icon name="x" size={16} />
      </button>
    </div>

    <nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2" aria-label="Main">
      {#each shellNav as item, i}
        {#if i > 0 && item.section && item.section !== shellNav[i - 1]?.section}
          <div
            class="my-1.5 border-t border-[color:var(--color-sidebar-border)]"
            role="separator"
            aria-hidden="true"
          ></div>
        {/if}
        <a
          href={item.href}
          class="nav-link-dark"
          class:justify-center={collapsed}
          aria-current={isActive(item.href) ? 'page' : undefined}
          title={collapsed ? $t(item.key) : undefined}
          onclick={() => {
            if (isNarrow) mobileOpen = false;
          }}
        >
          <Icon name={item.icon} size={18} class="shrink-0 opacity-90" />
          <span class={collapsed ? 'lg:sr-only' : ''}>{$t(item.key)}</span>
          {#if item.key === 'notifications' && unread > 0}
            <span
              class={`nav-badge ms-auto ${collapsed ? 'lg:absolute lg:end-1 lg:top-1' : ''}`}
              aria-label={`${unread} ${$t('unread')}`}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          {/if}
        </a>
      {/each}
    </nav>

    <div class="mt-auto border-t border-[color:var(--color-sidebar-border)] p-3">
      {#if $user}
        <div class={`mb-3 flex items-center gap-2.5 ${collapsed ? 'lg:justify-center' : ''}`}>
          <div class="sidebar-avatar" aria-hidden="true">{initials($user.name)}</div>
          <div class={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
            <p class="truncate text-sm font-semibold text-[color:var(--color-sidebar-text-active)]">
              {$user.name}
            </p>
            <p class="truncate text-xs text-[color:var(--color-sidebar-text)]">{roleLabel}</p>
          </div>
        </div>
        <div class={`mb-3 space-y-0.5 ${collapsed ? 'lg:hidden' : ''}`}>
          <a href="/app/profile" class="nav-link-dark text-xs">{$t('myAccount')}</a>
          <a href="/app/appearance" class="nav-link-dark text-xs">{$t('appearance')}</a>
          <button type="button" class="nav-link-dark w-full text-start text-xs" onclick={logout}>
            {$t('logout')}
          </button>
        </div>
      {/if}
      <div class={`flex items-center gap-2 ${collapsed ? 'lg:flex-col' : 'justify-between'}`}>
        <label class="sr-only" for="lang-select">{$t('language')}</label>
        <select
          id="lang-select"
          class={`rounded-[var(--radius-ui)] border border-[color:var(--color-sidebar-border)] bg-white/5 px-1.5 py-1 text-xs text-[color:var(--color-sidebar-text-active)] ${collapsed ? 'lg:w-full' : 'w-auto'}`}
          value={$lang}
          onchange={(e) => switchLang((e.currentTarget as HTMLSelectElement).value as 'en' | 'ur')}
        >
          <option value="en">EN</option>
          <option value="ur">اردو</option>
        </select>
        <button
          type="button"
          class="sidebar-icon-btn"
          aria-label={$t('theme')}
          title={$t('theme')}
          onclick={() => setThemePref($theme === 'dark' ? 'light' : 'dark')}
        >
          <Icon name={$theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
      </div>
    </div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col overflow-x-clip">
    <header class="sticky top-0 z-30 border-b border-border bg-surface-elevated/95 backdrop-blur supports-[backdrop-filter]:bg-surface-elevated/85">
      <div class="flex h-14 min-w-0 items-center gap-2 px-3 md:px-4">
        <button
          type="button"
          class="btn btn-outline btn-icon shrink-0 lg:hidden"
          aria-label={$t('openMenu')}
          aria-expanded={mobileOpen}
          aria-controls="primary-nav"
          data-testid="open-mobile-nav"
          onclick={() => (mobileOpen = true)}
        >
          <Icon name="menu" size={18} />
        </button>

        <div class="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
          <BrandMark size={22} compact class="shrink-0" />
          <p class="min-w-0 truncate text-sm font-semibold text-ink">{$t('appName')}</p>
        </div>

        <form class="relative hidden min-w-0 flex-1 md:block md:max-w-xl" onsubmit={submitSearch}>
          <label class="sr-only" for="global-search">{$t('globalSearch')}</label>
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
              <Icon name="search" size={16} />
            </span>
            <input
              id="global-search"
              class="input-field pe-20 ps-9"
              type="search"
              placeholder={$t('globalSearchPlaceholder')}
              bind:value={searchQ}
              oninput={onSearchInput}
              onfocus={() => (searchOpen = true)}
              autocomplete="off"
              aria-controls="global-search-results"
            />
            <button
              type="button"
              class="absolute inset-y-0 end-1 my-auto hidden h-7 items-center rounded border border-border bg-surface px-1.5 text-[10px] font-medium text-muted hover:text-ink sm:inline-flex"
              aria-label={$t('commandPalette')}
              onclick={() => (commandPaletteOpen = true)}
            >
              Ctrl K
            </button>
          </div>
          <div
            id="global-search-results"
            class={`absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-xl border border-border bg-surface-elevated p-2 shadow-panel ${
              searchOpen && searchResults ? '' : 'hidden'
            }`}
            role="region"
            aria-label={$t('searchResults')}
            hidden={!(searchOpen && searchResults)}
          >
          {#if searchResults}
              {#each [
                { key: 'repairs' as const, labelKey: 'repairs' as const, items: searchResults.repairs },
                { key: 'customers' as const, labelKey: 'customers' as const, items: searchResults.customers },
                { key: 'parts' as const, labelKey: 'inventory' as const, items: searchResults.parts },
                { key: 'documents' as const, labelKey: 'documents' as const, items: searchResults.documents }
              ] as group}
                {#if group.items.length}
                  <p class="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {$t(group.labelKey)}
                  </p>
                  {#each group.items as item}
                    <a
                      href={item.href}
                      class="block rounded-lg px-2 py-2 text-sm hover:bg-accent-soft"
                      onclick={() => {
                        searchOpen = false;
                        searchQ = '';
                      }}
                    >
                      {#if group.key === 'repairs'}
                        <span class="font-medium">{item.referenceNumber}</span>
                        <span class="text-muted"> · {item.brand} {item.model}</span>
                      {:else if group.key === 'customers'}
                        <span class="font-medium">{item.name}</span>
                        <span class="text-muted"> · {item.email}</span>
                      {:else if group.key === 'parts'}
                        <span class="font-medium">{item.sku}</span>
                        <span class="text-muted"> · {item.name}</span>
                      {:else}
                        <span class="font-medium">{item.documentNumber}</span>
                        <span class="text-muted"> · {item.type}</span>
                      {/if}
                    </a>
                  {/each}
                {/if}
              {/each}
              {#if !searchResults.repairs.length && !searchResults.customers.length && !searchResults.parts.length && !searchResults.documents.length}
                <p class="px-2 py-3 text-sm text-muted">{$t('searchNoResults')}</p>
              {/if}
          {/if}
          </div>
          {#if searching}
            <span class="sr-only" aria-live="polite">{$t('loading')}</span>
          {/if}
        </form>

        <div class="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {#if shops.length > 1}
            <label class="sr-only" for="shop-select">{$t('shops')}</label>
            <select
              id="shop-select"
              class="input-field hidden w-auto max-w-[10rem] py-1.5 md:block"
              value={$selectedShopId}
              onchange={(e) => onShopChange((e.currentTarget as HTMLSelectElement).value)}
            >
              {#each shops as shop}
                <option value={shop.id}>{shop.name}</option>
              {/each}
            </select>
          {:else if shops.length === 1}
            <span class="hidden rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted md:inline">
              {shops[0].name}
            </span>
          {/if}

          <button
            type="button"
            class="btn btn-outline btn-icon hidden sm:inline-flex"
            aria-label={$t('keyboardShortcuts')}
            title={`${$t('keyboardShortcuts')} (Ctrl + /)`}
            onclick={() => (shortcutsHelpOpen = true)}
          >
            <Icon name="fileText" size={17} />
          </button>

          <button
            type="button"
            class="btn btn-outline btn-icon hidden sm:inline-flex"
            aria-label={isFullscreen ? $t('exitFullscreen') : $t('enterFullscreen')}
            title={isFullscreen ? $t('exitFullscreen') : $t('enterFullscreen')}
            onclick={toggleFullscreen}
          >
            <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={17} />
          </button>

          <NotificationMenu />

          {#if !isNarrow}
            <label class="sr-only" for="theme-select">{$t('theme')}</label>
            <select
              id="theme-select"
              class="input-field w-auto py-1.5"
              value={$preferences.theme}
              onchange={(e) => setThemePref((e.currentTarget as HTMLSelectElement).value as ThemePref)}
            >
              <option value="light">{$t('light')}</option>
              <option value="dark">{$t('dark')}</option>
              <option value="system">{$t('system')}</option>
            </select>
          {/if}

          <details class="relative">
            <summary
              class="btn btn-outline btn-sm cursor-pointer list-none gap-2"
              aria-label={$t('account')}
            >
              <span class="header-avatar">{initials($user?.name)}</span>
              <span class="max-w-[7rem] truncate sm:max-w-none">{$user?.name?.split(' ')[0] || $t('account')}</span>
            </summary>
            <div
              class="absolute end-0 z-40 mt-1 w-56 rounded-xl border border-border bg-surface-elevated p-2 shadow-panel"
              role="menu"
              aria-label={$t('account')}
            >
              <p class="px-2 py-1 text-xs text-muted">{$user?.email}</p>
              <p class="px-2 pb-2 text-xs capitalize text-muted">{roleLabel}</p>
              <a href="/app/profile" class="btn btn-ghost btn-sm w-full justify-start" role="menuitem">{$t('myAccount')}</a>
              <a href="/app/appearance" class="btn btn-ghost btn-sm w-full justify-start" role="menuitem">{$t('appearance')}</a>
              {#if isNarrow}
                <div class="space-y-2 border-t border-border px-1 py-2">
                  <label class="block text-xs font-medium" for="lang-select-mobile">{$t('language')}</label>
                  <select
                    id="lang-select-mobile"
                    class="input-field w-full py-1.5"
                    value={$lang}
                    onchange={(e) => switchLang((e.currentTarget as HTMLSelectElement).value as 'en' | 'ur')}
                  >
                    <option value="en">{$t('english')}</option>
                    <option value="ur">{$t('urdu')}</option>
                  </select>
                  <label class="block text-xs font-medium" for="theme-select-mobile">{$t('theme')}</label>
                  <select
                    id="theme-select-mobile"
                    class="input-field w-full py-1.5"
                    value={$preferences.theme}
                    onchange={(e) => setThemePref((e.currentTarget as HTMLSelectElement).value as ThemePref)}
                  >
                    <option value="light">{$t('light')}</option>
                    <option value="dark">{$t('dark')}</option>
                    <option value="system">{$t('system')}</option>
                  </select>
                </div>
              {/if}
              <button type="button" class="btn btn-danger btn-sm mt-1 w-full" role="menuitem" onclick={logout}>
                {$t('logout')}
              </button>
            </div>
          </details>
        </div>
      </div>
    </header>

    {#if !$online}
      <div class="px-4 pt-3">
        <Alert type="warning" role="alert" message={$t('offline')} />
      </div>
    {/if}

    <div class="sr-only" aria-live="polite">{$announce}</div>

    <main id="main" class="min-w-0 flex-1 overflow-x-clip px-4 py-5 md:px-6 md:py-6">
      {@render children()}
    </main>
  </div>
</div>
