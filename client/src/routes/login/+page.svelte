<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { setSession, type Role } from '$lib/stores/auth';
  import { lang, t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let portalHint = $state('');
  let loading = $state(false);
  let portal = $state<'customer' | 'shop'>('customer');

  onMount(() => {
    const p = $page.url.searchParams.get('portal');
    portal = p === 'shop' ? 'shop' : 'customer';
  });

  const roleHome: Record<Role, string> = {
    customer: '/app/customer',
    mechanic: '/app/mechanic',
    parts_coordinator: '/app/parts',
    shop_admin: '/app/admin',
    platform_operator: '/app/platform/shop-applications'
  };

  function isShopRole(role: Role) {
    return (
      role === 'mechanic' ||
      role === 'parts_coordinator' ||
      role === 'shop_admin' ||
      role === 'platform_operator'
    );
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = '';
    portalHint = '';
    loading = true;
    try {
      const data = await api<{
        csrfToken?: string;
        user: {
          id: string;
          email: string;
          name: string;
          role: Role;
          preferredLanguage?: 'en' | 'ur';
          accountStatus?: 'active' | 'pending_shop_owner';
          onboardingPending?: boolean;
        };
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setSession(data.user, data.csrfToken);
      if (data.user.preferredLanguage) lang.set(data.user.preferredLanguage);

      // Pending shop owners never enter customer or operational shop portals.
      if (data.user.onboardingPending || data.user.accountStatus === 'pending_shop_owner') {
        goto('/app/shop-application/status');
        return;
      }

      const dest = roleHome[data.user.role];
      const mismatchCustomerPortal = portal === 'customer' && isShopRole(data.user.role);
      const mismatchShopPortal = portal === 'shop' && data.user.role === 'customer';

      if (mismatchCustomerPortal) {
        portalHint = $t('portalMismatchCustomer');
        await new Promise((r) => setTimeout(r, 1200));
      } else if (mismatchShopPortal) {
        portalHint = $t('portalMismatchShop');
        await new Promise((r) => setTimeout(r, 1200));
      }

      const next = $page.url.searchParams.get('next');
      // Ignore next redirects that would bypass onboarding or escalate portals.
      const safeNext =
        next &&
        next.startsWith('/app') &&
        !next.startsWith('/app/customer') &&
        data.user.role !== 'customer'
          ? next
          : next && next.startsWith('/app') && data.user.role === 'customer'
            ? next
            : null;
      goto(safeNext || dest);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{portal === 'shop' ? $t('loginShopTitle') : $t('loginCustomerTitle')} — RepairConnect</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
  <a href="/" class="mb-4 text-sm text-accent hover:underline">← {$t('home')}</a>
  <h1 class="text-2xl font-bold">{portal === 'shop' ? $t('loginShopTitle') : $t('loginCustomerTitle')}</h1>
  <p class="mt-1 text-sm text-muted">
    {portal === 'shop' ? $t('loginShopHint') : $t('loginCustomerHint')}
  </p>
  {#if portal === 'shop'}
    <p class="mt-2 text-sm">
      <a class="font-medium text-accent hover:underline" href="/shop-registration">{$t('registerYourShop')}</a>
    </p>
  {/if}

  <div class="mt-4 flex gap-2 text-sm" role="tablist" aria-label="Portal">
    <a
      class={`rounded-md px-3 py-1.5 ${portal === 'customer' ? 'bg-accent text-white' : 'border border-border'}`}
      href="/login?portal=customer"
      role="tab"
      aria-selected={portal === 'customer'}
    >
      {$t('forCustomers')}
    </a>
    <a
      class={`rounded-md px-3 py-1.5 ${portal === 'shop' ? 'bg-accent text-white' : 'border border-border'}`}
      href="/login?portal=shop"
      role="tab"
      aria-selected={portal === 'shop'}
    >
      {$t('forRepairShops')}
    </a>
  </div>

  <form class="mt-6 space-y-4" onsubmit={onSubmit} novalidate>
    {#if error}
      <Alert type="error" role="alert" message={error} />
    {/if}
    {#if portalHint}
      <Alert type="info" role="status" message={portalHint} />
    {/if}
    <div>
      <label class="mb-1 block text-sm font-medium" for="email">{$t('email')}</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autocomplete="username"
        class="w-full rounded-md border border-border bg-surface-elevated px-3 py-2"
        bind:value={email}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'login-error' : undefined}
      />
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="password">{$t('password')}</label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autocomplete="current-password"
        class="w-full rounded-md border border-border bg-surface-elevated px-3 py-2"
        bind:value={password}
        aria-invalid={error ? 'true' : undefined}
      />
    </div>
    {#if error}
      <div id="login-error" class="sr-only" role="alert">{error}</div>
    {/if}
    <button
      type="submit"
      class="w-full rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-60"
      disabled={loading}
      aria-busy={loading}
    >
      {loading ? $t('loading') : $t('login')}
    </button>
  </form>
  <p class="mt-4 flex flex-wrap gap-3 text-sm">
    {#if portal === 'customer'}
      <a class="underline" href="/register">{$t('register')}</a>
    {:else}
      <a class="underline" href="/shop-registration">{$t('registerYourShop')}</a>
    {/if}
    <a class="underline" href="/forgot-password">{$t('forgotPassword')}</a>
    <a class="underline" href="/track">{$t('trackRepair')}</a>
  </p>
</main>
