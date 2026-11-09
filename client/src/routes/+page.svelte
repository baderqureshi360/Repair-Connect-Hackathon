<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { t, lang } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';

  let mobileNav = $state(false);
  let portalHref = $state('/app/customer');

  onMount(() => {
    if ($user) {
      const map: Record<string, string> = {
        customer: '/app/customer',
        mechanic: '/app/mechanic',
        parts_coordinator: '/app/parts',
        shop_admin: '/app/admin',
        platform_operator: '/app/platform/shop-applications'
      };
      portalHref = map[$user.role] || '/app/customer';
    }
  });

  function switchLang(next: 'en' | 'ur') {
    lang.set(next);
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

<svelte:head>
  <title>RepairConnect — Your Repairs. Your Shop. One Connected Platform.</title>
  <meta
    name="description"
    content="Book repairs, track service progress, coordinate spare parts, and manage repair shop operations through one accessible platform."
  />
</svelte:head>

<div class="marketing-page min-h-screen bg-[var(--color-surface)] text-[var(--color-ink)]">
  <a href="#main" class="skip-link">{$t('skipToContent')}</a>

  <header class="sticky top-0 z-40 border-b border-border/80 bg-surface-elevated/90 backdrop-blur">
    <div class="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:px-6">
      <a href="/" class="flex items-center gap-2 font-bold text-accent">
        <span class="sidebar-logo !h-8 !w-8" aria-hidden="true"><Icon name="wrench" size={14} /></span>
        <span>{$t('appName')}</span>
      </a>

      <nav class="ms-4 hidden items-center gap-1 xl:flex" aria-label="Marketing">
        <a class="nav-marketing" href="#home">{$t('home')}</a>
        <a class="nav-marketing" href="#features">{$t('features')}</a>
        <a class="nav-marketing" href="#how-it-works">{$t('howItWorks')}</a>
        <a class="nav-marketing" href="#for-customers">{$t('forCustomers')}</a>
        <a class="nav-marketing" href="#for-shops">{$t('forRepairShops')}</a>
        <a class="nav-marketing" href="#track">{$t('trackRepair')}</a>
      </nav>

      <div class="ms-auto flex items-center gap-2">
        <label class="sr-only" for="public-lang">{$t('language')}</label>
        <select
          id="public-lang"
          class="input-field w-auto py-1.5 text-sm"
          value={$lang}
          onchange={(e) => switchLang((e.currentTarget as HTMLSelectElement).value as 'en' | 'ur')}
        >
          <option value="en">EN</option>
          <option value="ur">اردو</option>
        </select>
        {#if $user}
          <a href={portalHref} class="btn btn-primary btn-sm">Open app</a>
        {:else}
          <a href="/login?portal=customer" class="btn btn-outline btn-sm hidden sm:inline-flex">{$t('customerSignIn')}</a>
          <a href="/login?portal=shop" class="btn btn-primary btn-sm hidden sm:inline-flex">{$t('shopSignIn')}</a>
        {/if}
        <button
          type="button"
          class="btn btn-ghost btn-icon xl:hidden"
          aria-label={mobileNav ? $t('closeMenu') : $t('openMenu')}
          aria-expanded={mobileNav}
          onclick={() => (mobileNav = !mobileNav)}
        >
          <Icon name={mobileNav ? 'x' : 'menu'} size={18} />
        </button>
      </div>
    </div>
    {#if mobileNav}
      <nav class="border-t border-border px-4 py-3 xl:hidden" aria-label="Mobile marketing">
        <div class="flex flex-col gap-1">
          <a class="nav-marketing" href="#home" onclick={() => (mobileNav = false)}>{$t('home')}</a>
          <a class="nav-marketing" href="#features" onclick={() => (mobileNav = false)}>{$t('features')}</a>
          <a class="nav-marketing" href="#how-it-works" onclick={() => (mobileNav = false)}>{$t('howItWorks')}</a>
          <a class="nav-marketing" href="#for-customers" onclick={() => (mobileNav = false)}>{$t('forCustomers')}</a>
          <a class="nav-marketing" href="#for-shops" onclick={() => (mobileNav = false)}>{$t('forRepairShops')}</a>
          <a class="nav-marketing" href="#track" onclick={() => (mobileNav = false)}>{$t('trackRepair')}</a>
          {#if !$user}
            <a class="btn btn-outline btn-sm mt-2" href="/login?portal=customer" onclick={() => (mobileNav = false)}>
              {$t('customerSignIn')}
            </a>
            <a class="btn btn-outline btn-sm" href="/register" onclick={() => (mobileNav = false)}>
              {$t('customerRegistration')}
            </a>
            <a class="btn btn-primary btn-sm" href="/login?portal=shop" onclick={() => (mobileNav = false)}>
              {$t('shopSignIn')}
            </a>
            <a class="btn btn-outline btn-sm" href="/shop-registration" onclick={() => (mobileNav = false)}>
              {$t('registerYourShop')}
            </a>
            <a class="btn btn-ghost btn-sm" href="/track" onclick={() => (mobileNav = false)}>
              {$t('trackRepair')}
            </a>
          {/if}
        </div>
      </nav>
    {/if}
  </header>

  <main id="main">
    <section id="home" class="relative overflow-hidden">
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(59,130,246,0.12),transparent_50%)]"
        aria-hidden="true"
      ></div>
      <div class="relative mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-accent">RepairConnect</p>
        <h1 class="mt-3 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
          {$t('heroTitle')}
        </h1>
        <p class="mt-4 max-w-2xl text-base text-muted md:text-lg">{$t('heroSubtitle')}</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="/login?portal=customer" class="btn btn-primary">{$t('customerSignIn')}</a>
          <a href="/register" class="btn btn-outline">{$t('customerRegistration')}</a>
          <a href="/login?portal=shop" class="btn btn-outline">{$t('shopSignIn')}</a>
          <a href="/shop-registration" class="btn btn-outline">{$t('registerYourShop')}</a>
          <a href="/track" class="btn btn-ghost border border-border">{$t('trackRepair')}</a>
        </div>
        {#if $user}
          <p class="mt-4 text-sm text-muted">
            Signed in as {$user.name}.
            <a class="font-medium text-accent hover:underline" href={portalHref}>Continue to your portal</a>
          </p>
        {/if}
      </div>
    </section>

    <section id="for-customers" class="border-t border-border py-16 md:py-20">
      <div class="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-2 md:px-6">
        <article class="surface-card border-accent/30 p-6 shadow-panel">
          <p class="text-xs font-semibold uppercase tracking-wide text-accent">{$t('forCustomers')}</p>
          <h2 class="mt-2 text-2xl font-bold">{$t('customerAccessTitle')}</h2>
          <ul class="mt-4 space-y-2 text-sm text-muted">
            {#each customerBullets as item}
              <li class="flex gap-2"><Icon name="checkCircle" size={16} class="mt-0.5 shrink-0 text-success" />{item}</li>
            {/each}
          </ul>
          <div class="mt-6 flex flex-wrap gap-2">
            <a href="/login?portal=customer" class="btn btn-primary btn-sm">{$t('customerSignIn')}</a>
            <a href="/register" class="btn btn-outline btn-sm">{$t('createCustomerAccount')}</a>
          </div>
        </article>

        <article id="for-shops" class="surface-card border-sky-500/20 bg-slate-950/5 p-6 shadow-panel dark:bg-slate-900/40">
          <p class="text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">{$t('forRepairShops')}</p>
          <h2 class="mt-2 text-2xl font-bold">{$t('shopAccessTitle')}</h2>
          <ul class="mt-4 space-y-2 text-sm text-muted">
            {#each shopBullets as item}
              <li class="flex gap-2"><Icon name="checkCircle" size={16} class="mt-0.5 shrink-0 text-success" />{item}</li>
            {/each}
          </ul>
          <p class="mt-3 text-xs text-muted">
            Supports Shop Admin, Mechanic, and Parts Coordinator accounts provisioned by your organization.
          </p>
          <div class="mt-6 flex flex-wrap gap-2">
            <a href="/login?portal=shop" class="btn btn-primary btn-sm">{$t('shopSignIn')}</a>
            <a href="/shop-registration" class="btn btn-outline btn-sm">{$t('registerYourShop')}</a>
          </div>
        </article>
      </div>
    </section>

    <section id="track" class="border-y border-border bg-surface-elevated py-16 md:py-20">
      <div class="mx-auto max-w-6xl px-4 md:px-6">
        <h2 class="text-3xl font-bold tracking-tight">{$t('trackRepairTitle')}</h2>
        <p class="mt-2 max-w-2xl text-muted">{$t('trackRepairHelp')}</p>
        <a href="/track" class="btn btn-primary mt-6 inline-flex">{$t('trackRepairButton')}</a>
      </div>
    </section>

    <section id="features" class="py-16 md:py-20">
      <div class="mx-auto max-w-6xl px-4 md:px-6">
        <h2 class="text-3xl font-bold tracking-tight">{$t('features')}</h2>
        <ul class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {#each features as feature}
            <li class="surface-card p-5">
              <span class="kpi-icon kpi-icon-indigo" aria-hidden="true"><Icon name={feature.icon} size={18} /></span>
              <h3 class="mt-3 text-base font-semibold">{feature.title}</h3>
              <p class="mt-1.5 text-sm text-muted">{feature.body}</p>
            </li>
          {/each}
        </ul>
      </div>
    </section>

    <section id="how-it-works" class="border-t border-border bg-surface-elevated py-16 md:py-20">
      <div class="mx-auto max-w-6xl px-4 md:px-6">
        <h2 class="text-3xl font-bold tracking-tight">{$t('howItWorks')}</h2>
        <ol class="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {#each steps as step, i}
            <li class="surface-card flex gap-3 p-4">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
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
    <div class="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-4 md:px-6">
      <div class="md:col-span-2">
        <p class="flex items-center gap-2 font-bold text-accent">
          <span class="sidebar-logo !h-7 !w-7" aria-hidden="true"><Icon name="wrench" size={12} /></span>
          {$t('appName')}
        </p>
        <p class="mt-2 max-w-md text-sm text-muted">
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
    <p class="mx-auto mt-8 max-w-6xl px-4 text-xs text-muted md:px-6">
      © {new Date().getFullYear()} RepairConnect. Staff accounts are provisioned by authorized shop administrators.
    </p>
  </footer>
</div>

<style>
  :global(.nav-marketing) {
    border-radius: 0.5rem;
    padding: 0.4rem 0.65rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-muted);
  }
  :global(.nav-marketing:hover),
  :global(.nav-marketing:focus-visible) {
    color: var(--color-ink);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    outline: none;
  }
</style>
