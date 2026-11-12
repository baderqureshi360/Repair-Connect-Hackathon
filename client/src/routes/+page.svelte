<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { t, lang } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';

  let mobileNav = $state(false);
  let portalHref = $state('/app/customer');
  let menuToggleEl = $state<HTMLButtonElement | null>(null);
  let mobileNavEl = $state<HTMLElement | null>(null);

  onMount(() => {
    if ($user) {
      const map: Record<string, string> = {
        customer: '/app/customer',
        mechanic: '/app/mechanic',
        parts_coordinator: '/app/parts',
        shop_admin: '/app/admin',
        supplier: '/app/supplier',
        platform_operator: '/app/platform/shop-applications'
      };
      portalHref = map[$user.role] || '/app/customer';
    }
  });

  function switchLang(next: 'en' | 'ur') {
    lang.set(next);
  }

  function closeMobileNav(restoreFocus = true) {
    if (!mobileNav) return;
    mobileNav = false;
    if (restoreFocus) {
      queueMicrotask(() => menuToggleEl?.focus());
    }
  }

  function toggleMobileNav() {
    mobileNav = !mobileNav;
    if (mobileNav) {
      queueMicrotask(() => {
        const first = mobileNavEl?.querySelector<HTMLElement>('a, button, select');
        first?.focus();
      });
    }
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (!mobileNav) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeMobileNav(true);
      return;
    }

    if (e.key !== 'Tab' || !mobileNavEl) return;

    const focusable = [
      menuToggleEl,
      ...mobileNavEl.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ].filter((el): el is HTMLElement => !!el && !el.hasAttribute('disabled') && el.tabIndex !== -1);

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const features = [
    { icon: 'wrench', title: 'Repair request management', body: 'Track every request from intake through completion with controlled status history.' },
    { icon: 'calendar', title: 'Appointment scheduling', body: 'Book shop capacity with conflict-aware slots and cancellation policies.' },
    { icon: 'search', title: 'Customer repair tracking', body: 'Follow progress with a private access code — never by reference number alone.' },
    { icon: 'clipboard', title: 'Mechanic workspaces', body: 'Assigned jobs, diagnoses, estimates, and labor recording in one place.' },
    { icon: 'package', title: 'Parts and inventory', body: 'Atomic reservations, stock movements, low-stock alerts, and transfers.' },
    { icon: 'building', title: 'Multi-shop management', body: 'Shop-scoped memberships keep data isolated across repair locations.' },
    { icon: 'chart', title: 'Analytics and reports', body: 'Operational KPIs, payment-backed revenue, and CSV exports from live records.' },
    { icon: 'fileText', title: 'Receipts and invoices', body: 'Issue financial documents with A4 and thermal print formats.' },
    { icon: 'user', title: 'Secure accounts', body: 'Cookie-based sessions, CSRF protection, and role-based authorization.' },
    { icon: 'palette', title: 'Multilingual accessibility', body: 'English and Urdu, RTL layouts, keyboard focus, and theme preferences.' }
  ];

  const customerBullets = [
    'Register your customer account',
    'Find repair shops',
    'Submit repair requests',
    'Book appointments',
    'Review and approve estimates',
    'Track repair progress',
    'View receipts and warranties',
    'Communicate with your repair shop'
  ];

  const shopBullets = [
    'Manage repair operations',
    'Assign mechanics',
    'Manage inventory',
    'Process parts requests',
    'Coordinate shop-to-shop transfers',
    'Manage customers and appointments',
    'Generate invoices and reports'
  ];

  const steps = [
    'Customer submits repair',
    'Shop assigns mechanic',
    'Mechanic diagnoses',
    'Customer approves estimate',
    'Parts coordinator fulfills parts',
    'Repair completed',
    'Customer receives receipt'
  ];
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<svelte:head>
  <title>RepairConnect — Your Repairs. Your Shop. One Connected Platform.</title>
  <meta
    name="description"
    content="Book repairs, track service progress, coordinate spare parts, and manage repair shop operations through one accessible platform."
  />
</svelte:head>

<div class="marketing-page min-h-screen bg-[var(--color-surface)] text-[var(--color-ink)]">
  <a href="#main" class="skip-link">{$t('skipToContent')}</a>

  <header class="sticky top-0 z-40 overflow-x-clip border-b border-border/80 bg-surface-elevated/95 backdrop-blur">
    <div class="mx-auto flex h-16 w-full max-w-7xl flex-nowrap items-center gap-2 px-3 sm:gap-3 sm:px-4 md:px-6 lg:px-8">
      <a href="/" class="flex min-w-0 shrink items-center gap-2 whitespace-nowrap font-bold text-accent">
        <span class="sidebar-logo !h-8 !w-8 shrink-0" aria-hidden="true"><Icon name="wrench" size={14} /></span>
        <span class="truncate">{$t('appName')}</span>
      </a>

      <nav
        class="ms-1 hidden min-w-0 flex-1 flex-nowrap items-center justify-center gap-0.5 xl:flex 2xl:gap-1"
        aria-label="Marketing"
      >
        <a class="nav-marketing" href="#home">{$t('home')}</a>
        <a class="nav-marketing" href="#features">{$t('features')}</a>
        <a class="nav-marketing" href="#how-it-works">{$t('howItWorks')}</a>
        <a class="nav-marketing" href="#for-customers">{$t('forCustomers')}</a>
        <a class="nav-marketing" href="#for-shops">{$t('forRepairShops')}</a>
        <a class="nav-marketing" href="#track">{$t('trackRepair')}</a>
      </nav>

      <div class="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <label class="sr-only" for="public-lang">{$t('language')}</label>
        <select
          id="public-lang"
          class="input-field w-auto min-w-[3.75rem] py-1.5 text-sm"
          value={$lang}
          onchange={(e) => switchLang((e.currentTarget as HTMLSelectElement).value as 'en' | 'ur')}
        >
          <option value="en">EN</option>
          <option value="ur">اردو</option>
        </select>
        {#if $user}
          <a href={portalHref} class="btn btn-primary btn-sm hidden whitespace-nowrap sm:inline-flex">
            Open app
          </a>
        {:else}
          <a
            href="/login?portal=customer"
            class="btn btn-outline btn-sm hidden whitespace-nowrap lg:inline-flex"
          >
            {$t('customerSignIn')}
          </a>
          <a
            href="/login?portal=shop"
            class="btn btn-primary btn-sm hidden whitespace-nowrap lg:inline-flex"
          >
            {$t('shopSignIn')}
          </a>
        {/if}
        <button
          type="button"
          class="btn btn-ghost btn-icon xl:hidden"
          aria-label={mobileNav ? $t('closeMenu') : $t('openMenu')}
          aria-expanded={mobileNav}
          aria-controls="mobile-marketing-nav"
          bind:this={menuToggleEl}
          onclick={toggleMobileNav}
        >
          <Icon name={mobileNav ? 'x' : 'menu'} size={18} />
        </button>
      </div>
    </div>
    {#if mobileNav}
      <nav
        id="mobile-marketing-nav"
        class="border-t border-border px-4 py-3 xl:hidden"
        aria-label="Mobile marketing"
        bind:this={mobileNavEl}
      >
        <div class="mx-auto flex max-w-7xl flex-col gap-1">
          <a class="nav-marketing" href="#home" onclick={() => closeMobileNav(false)}>{$t('home')}</a>
          <a class="nav-marketing" href="#features" onclick={() => closeMobileNav(false)}>{$t('features')}</a>
          <a class="nav-marketing" href="#how-it-works" onclick={() => closeMobileNav(false)}>{$t('howItWorks')}</a>
          <a class="nav-marketing" href="#for-customers" onclick={() => closeMobileNav(false)}>{$t('forCustomers')}</a>
          <a class="nav-marketing" href="#for-shops" onclick={() => closeMobileNav(false)}>{$t('forRepairShops')}</a>
          <a class="nav-marketing" href="#track" onclick={() => closeMobileNav(false)}>{$t('trackRepair')}</a>
          <div class="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            {#if $user}
              <a class="btn btn-primary" href={portalHref} onclick={() => closeMobileNav(false)}>Open app</a>
            {:else}
              <a class="btn btn-primary" href="/login?portal=customer" onclick={() => closeMobileNav(false)}>
                {$t('customerSignIn')}
              </a>
              <a class="btn btn-outline" href="/register" onclick={() => closeMobileNav(false)}>
                {$t('customerRegistration')}
              </a>
              <a class="btn btn-primary" href="/login?portal=shop" onclick={() => closeMobileNav(false)}>
                {$t('shopSignIn')}
              </a>
              <a class="btn btn-outline" href="/shop-registration" onclick={() => closeMobileNav(false)}>
                {$t('registerYourShop')}
              </a>
              <a class="btn btn-outline" href="/supplier-registration" onclick={() => closeMobileNav(false)}>
                {$t('registerAsSupplier')}
              </a>
              <a class="btn btn-ghost border border-border" href="/track" onclick={() => closeMobileNav(false)}>
                {$t('trackRepair')}
              </a>
            {/if}
          </div>
        </div>
      </nav>
    {/if}
  </header>

  <main id="main">
    <section id="home" class="relative overflow-hidden">
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(130,180,64,0.16),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(130,180,64,0.08),transparent_50%)]"
        aria-hidden="true"
      ></div>
      <div class="relative mx-auto max-w-7xl px-4 py-14 sm:py-16 md:px-6 md:py-20 lg:px-8 lg:py-24">
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-accent">RepairConnect</p>
        <h1
          class="mt-4 max-w-[18ch] text-balance text-4xl font-bold tracking-tight leading-[1.15] sm:max-w-3xl sm:text-5xl lg:text-[3.25rem] lg:leading-[1.12]"
        >
          {$t('heroTitle')}
        </h1>
        <p class="mt-5 max-w-xl text-base leading-relaxed text-muted md:mt-6 md:max-w-2xl md:text-lg">
          {$t('heroSubtitle')}
        </p>
        <div class="mt-8 flex max-w-3xl flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center md:mt-10">
          <a href="/login?portal=customer" class="btn btn-primary min-h-11 w-full px-5 sm:w-auto">{$t('customerSignIn')}</a>
          <a href="/login?portal=shop" class="btn btn-primary min-h-11 w-full px-5 sm:w-auto">{$t('shopSignIn')}</a>
          <a href="/register" class="btn btn-outline min-h-11 w-full px-5 sm:w-auto">{$t('customerRegistration')}</a>
          <a href="/shop-registration" class="btn btn-outline min-h-11 w-full px-5 sm:w-auto">{$t('registerYourShop')}</a>
          <a href="/track" class="btn btn-ghost min-h-11 w-full border border-border px-5 sm:w-auto">{$t('trackRepair')}</a>
        </div>
        {#if $user}
          <p class="mt-5 text-sm text-muted">
            Signed in as {$user.name}.
            <a class="font-medium text-accent hover:underline" href={portalHref}>Continue to your portal</a>
          </p>
        {/if}
      </div>
    </section>

    <section id="for-customers" class="border-t border-border py-14 md:py-20">
      <div class="mx-auto grid max-w-7xl items-stretch gap-6 px-4 md:grid-cols-2 md:px-6 lg:px-8">
        <article class="surface-card flex h-full flex-col border-accent/30 p-6 md:p-7 shadow-panel">
          <p class="text-xs font-semibold uppercase tracking-wide text-accent">{$t('forCustomers')}</p>
          <h2 class="mt-2 text-2xl font-bold leading-snug">{$t('customerAccessTitle')}</h2>
          <ul class="mt-5 flex-1 space-y-2.5 text-sm leading-relaxed text-muted">
            {#each customerBullets as item}
              <li class="flex gap-2">
                <Icon name="checkCircle" size={16} class="mt-0.5 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            {/each}
          </ul>
          <div class="mt-7 flex flex-wrap gap-2">
            <a href="/login?portal=customer" class="btn btn-primary btn-sm min-h-9">{$t('customerSignIn')}</a>
            <a href="/register" class="btn btn-outline btn-sm min-h-9">{$t('createCustomerAccount')}</a>
          </div>
        </article>

        <article
          id="for-shops"
          class="surface-card flex h-full flex-col border-sky-500/25 bg-slate-950/[0.03] p-6 md:p-7 shadow-panel dark:bg-slate-900/40"
        >
          <p class="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
            {$t('forRepairShops')}
          </p>
          <h2 class="mt-2 text-2xl font-bold leading-snug">{$t('shopAccessTitle')}</h2>
          <ul class="mt-5 flex-1 space-y-2.5 text-sm leading-relaxed text-muted">
            {#each shopBullets as item}
              <li class="flex gap-2">
                <Icon name="checkCircle" size={16} class="mt-0.5 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            {/each}
          </ul>
          <p class="mt-4 text-xs leading-relaxed text-muted">
            Supports Shop Admin, Mechanic, and Parts Coordinator accounts provisioned by your organization.
          </p>
          <div class="mt-7 flex flex-wrap gap-2">
            <a href="/login?portal=shop" class="btn btn-primary btn-sm min-h-9">{$t('shopSignIn')}</a>
            <a href="/shop-registration" class="btn btn-outline btn-sm min-h-9">{$t('registerYourShop')}</a>
          </div>
        </article>
      </div>
    </section>

    <section id="track" class="border-y border-border bg-surface-elevated py-14 md:py-20">
      <div class="mx-auto max-w-7xl px-4 md:px-6 lg:px-8">
        <h2 class="text-3xl font-bold tracking-tight">{$t('trackRepairTitle')}</h2>
        <p class="mt-3 max-w-2xl text-muted leading-relaxed">{$t('trackRepairHelp')}</p>
        <a href="/track" class="btn btn-primary mt-6 inline-flex min-h-11">{$t('trackRepairButton')}</a>
      </div>
    </section>

    <section id="features" class="py-14 md:py-20">
      <div class="mx-auto max-w-7xl px-4 md:px-6 lg:px-8">
        <h2 class="text-3xl font-bold tracking-tight">{$t('features')}</h2>
        <ul class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {#each features as feature}
            <li class="surface-card p-5">
              <span class="kpi-icon kpi-icon-indigo" aria-hidden="true"><Icon name={feature.icon} size={18} /></span>
              <h3 class="mt-3 text-base font-semibold">{feature.title}</h3>
              <p class="mt-1.5 text-sm text-muted leading-relaxed">{feature.body}</p>
            </li>
          {/each}
        </ul>
      </div>
    </section>

    <section id="how-it-works" class="border-t border-border bg-surface-elevated py-14 md:py-20">
      <div class="mx-auto max-w-7xl px-4 md:px-6 lg:px-8">
        <h2 class="text-3xl font-bold tracking-tight">{$t('howItWorks')}</h2>
        <ol class="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {#each steps as step, i}
            <li class="surface-card flex gap-3 p-4">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground"
              >
                {i + 1}
              </span>
              <p class="text-sm font-medium leading-snug">{step}</p>
            </li>
          {/each}
        </ol>
      </div>
    </section>
  </main>

  <footer class="border-t border-border bg-surface-elevated py-12">
    <div class="mx-auto grid max-w-7xl gap-8 px-4 md:grid-cols-4 md:px-6 lg:px-8">
      <div class="md:col-span-2">
        <p class="flex items-center gap-2 font-bold text-accent">
          <span class="sidebar-logo !h-7 !w-7" aria-hidden="true"><Icon name="wrench" size={12} /></span>
          {$t('appName')}
        </p>
        <p class="mt-2 max-w-md text-sm text-muted leading-relaxed">
          An accessible multi-shop repair network for customers, mechanics, parts teams, and shop administrators.
        </p>
      </div>
      <div>
        <p class="text-sm font-semibold">Product</p>
        <ul class="mt-2 space-y-1 text-sm text-muted">
          <li><a class="hover:text-accent" href="#features">{$t('features')}</a></li>
          <li><a class="hover:text-accent" href="/track">{$t('trackRepair')}</a></li>
          <li><a class="hover:text-accent" href="/shop-registration">{$t('registerYourShop')}</a></li>
        </ul>
      </div>
      <div>
        <p class="text-sm font-semibold">Legal & access</p>
        <ul class="mt-2 space-y-1 text-sm text-muted">
          <li><a class="hover:text-accent" href="/privacy">Privacy Policy</a></li>
          <li><a class="hover:text-accent" href="/terms">Terms of Service</a></li>
          <li><a class="hover:text-accent" href="/accessibility">Accessibility</a></li>
          <li><a class="hover:text-accent" href="/login?portal=customer">{$t('customerSignIn')}</a></li>
          <li><a class="hover:text-accent" href="/login?portal=shop">{$t('shopSignIn')}</a></li>
        </ul>
      </div>
    </div>
    <p class="mx-auto mt-8 max-w-7xl px-4 text-xs text-muted md:px-6 lg:px-8">
      © {new Date().getFullYear()} RepairConnect. Staff accounts are provisioned by authorized shop administrators.
    </p>
  </footer>
</div>

<style>
  :global(.nav-marketing) {
    display: inline-flex;
    align-items: center;
    border-radius: 0.5rem;
    padding: 0.4rem 0.55rem;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25;
    white-space: nowrap;
    color: var(--color-muted);
  }
  :global(.nav-marketing:hover) {
    color: var(--color-ink);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  :global(.nav-marketing:focus-visible) {
    color: var(--color-ink);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (min-width: 1280px) and (max-width: 1399px) {
    :global(.nav-marketing) {
      padding: 0.35rem 0.4rem;
      font-size: 0.8125rem;
    }
  }
</style>
