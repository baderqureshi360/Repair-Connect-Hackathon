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
      const pendingShop = me.accountStatus === 'pending_shop_owner';
      const pendingSupplier = me.accountStatus === 'pending_supplier';
      pendingOwner = Boolean(me.onboardingPending || pendingShop || pendingSupplier);
      const path = $page.url.pathname;
      if (pendingShop && !path.startsWith('/app/shop-application')) {
        goto('/app/shop-application/status');
        ready = true;
        return;
      }
      if (pendingSupplier && !path.startsWith('/app/supplier-application')) {
        goto('/app/supplier-application/status');
        ready = true;
        return;
      }
      if (me.role === 'platform_operator') {
        const allowed =
          path.startsWith('/app/platform') ||
          path.startsWith('/app/profile') ||
          path.startsWith('/app/appearance') ||
          path.startsWith('/app/notifications');
        if (!allowed) {
          goto('/app/platform');
          ready = true;
          return;
        }
      } else if (path.startsWith('/app/platform')) {
        goto(
          me.role === 'shop_admin'
            ? '/app/admin'
            : me.role === 'supplier'
              ? '/app/supplier'
              : '/app/customer'
        );
        ready = true;
        return;
      }
      if (me.role === 'supplier' && !pendingSupplier) {
        const allowed =
          path.startsWith('/app/supplier') ||
          path.startsWith('/app/supplier-application') ||
          path.startsWith('/app/profile') ||
          path.startsWith('/app/appearance') ||
          path.startsWith('/app/notifications');
        if (!allowed) {
          goto('/app/supplier');
          ready = true;
          return;
        }
      } else if (path.startsWith('/app/supplier') && me.role !== 'supplier' && !path.startsWith('/app/supplier-application')) {
        // /app/admin/suppliers is marketplace for shop admins — allow that path separately
        if (!path.startsWith('/app/admin')) {
          goto(me.role === 'shop_admin' ? '/app/admin' : '/app/customer');
          ready = true;
          return;
        }
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
