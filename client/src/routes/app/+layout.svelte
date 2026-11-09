<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import AppShell from '$lib/components/AppShell.svelte';
  import { api } from '$lib/api';
  import { clearSession, setSession, sessionActive, type AuthUser } from '$lib/stores/auth';
  import { applyPreferences, clearPreferencesCache } from '$lib/stores/preferences';

  let { children } = $props();
  let ready = $state(false);
  let pendingOwner = $state(false);

  onMount(async () => {
    try {
      const me = await api<AuthUser & { preferences?: Record<string, unknown> }>('/api/v1/auth/me');
      setSession(me);
      if (me.preferences) applyPreferences(me.preferences as never);
      pendingOwner = Boolean(me.onboardingPending || me.accountStatus === 'pending_shop_owner');
      const path = $page.url.pathname;
      if (pendingOwner && !path.startsWith('/app/shop-application')) {
        goto('/app/shop-application/status');
        ready = true;
        return;
      }
      if (me.role === 'platform_operator') {
        const allowed =
          path.startsWith('/app/platform') ||
          path.startsWith('/app/profile') ||
          path.startsWith('/app/appearance');
        if (!allowed) {
          goto('/app/platform/shop-applications');
          ready = true;
          return;
        }
      } else if (path.startsWith('/app/platform')) {
        goto(me.role === 'shop_admin' ? '/app/admin' : '/app/customer');
        ready = true;
        return;
      }
      if (!pendingOwner && path.startsWith('/app/shop-application') && me.role === 'shop_admin') {
        // Approved owners landing on status can continue; leave page as-is.
      }
      ready = true;
    } catch {
      clearSession();
      clearPreferencesCache();
      goto('/login');
    }
  });
</script>

{#if ready && $sessionActive}
  <AppShell pendingOnboarding={pendingOwner}>
    {@render children()}
  </AppShell>
{/if}
