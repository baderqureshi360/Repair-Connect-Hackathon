<script lang="ts">
  import { t } from '$lib/i18n';
  import { SERVICE_CATEGORIES } from '$lib/serviceCategories';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let ownerName = $state('');
  let ownerEmail = $state('');
  let ownerPhone = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let shopName = $state('');
  let businessPhone = $state('');
  let businessEmail = $state('');
  let address = $state('');
  let city = $state('');
  let region = $state('');
  let servicesDescription = $state('');
  let serviceCategories = $state<string[]>([]);
  let supportedDevicesText = $state('');
  let supportedBrandsText = $state('');
  let mechanicCount = $state('');
  let termsAccepted = $state(false);
  let loading = $state(false);
  let error = $state('');
  let fieldErrors = $state<Record<string, string>>({});
  let result = $state<any>(null);

  function splitList(text: string) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function validateClient(): boolean {
    const errs: Record<string, string> = {};
    if (ownerName.trim().length < 2) errs.ownerName = 'Enter your full name';
    if (!ownerEmail.includes('@')) errs.ownerEmail = 'Enter a valid email';
    if (ownerPhone.trim().length < 5) errs.ownerPhone = 'Enter a phone number';
    if (password.length < 8) errs.password = 'Password must be at least 8 characters';
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      errs.password = 'Password must include a letter and a number';
    }
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (shopName.trim().length < 2) errs.shopName = 'Enter the shop name';
    if (businessPhone.trim().length < 5) errs.businessPhone = 'Enter a business phone';
    if (!businessEmail.includes('@')) errs.businessEmail = 'Enter a valid business email';
    if (address.trim().length < 5) errs.address = 'Enter the full address';
    if (city.trim().length < 2) errs.city = 'Enter the city';
    if (region.trim().length < 2) errs.region = 'Enter the region';
    if (servicesDescription.trim().length < 10) {
      errs.servicesDescription = 'Describe your services (at least 10 characters)';
    }
    if (!serviceCategories.length) errs.serviceCategories = 'Select at least one category';
    if (!termsAccepted) errs.termsAccepted = 'Accept the Terms and Privacy Policy to continue';
    fieldErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async function submitApplication() {
    error = '';
    result = null;
    if (!validateClient()) {
      error = 'Please fix the highlighted fields.';
      return;
    }
    loading = true;
    try {
      const base = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${base}/api/v1/public/shop-applications/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          ownerName: ownerName.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerPhone: ownerPhone.trim(),
          password,
          confirmPassword,
          shopName: shopName.trim(),
          businessPhone: businessPhone.trim(),
          businessEmail: businessEmail.trim(),
          address: address.trim(),
          city: city.trim(),
          region: region.trim(),
          servicesDescription: servicesDescription.trim(),
          serviceCategories,
          supportedDevices: splitList(supportedDevicesText),
          supportedBrands: splitList(supportedBrandsText),
          mechanicCount: mechanicCount ? Number(mechanicCount) : undefined,
          termsAccepted: true
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || $t('errorGeneric'));
      }
      result = json.data;
    } catch (err) {
      error = err instanceof Error ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  function onSubmit(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    void submitApplication();
  }
</script>

<svelte:head>
  <title>{$t('shopRegistrationTitle')} — RepairConnect</title>
</svelte:head>

<main class="mx-auto min-h-dvh max-w-2xl px-4 py-10">
  <a href="/" class="mb-4 inline-flex items-center gap-2.5 text-sm font-semibold text-ink hover:opacity-90">
    <BrandMark size={32} compact />
    <span>{$t('appName')}</span>
  </a>
  <h1 class="mt-4 text-2xl font-bold">{$t('shopRegistrationTitle')}</h1>
  <p class="mt-2 text-sm text-muted">{$t('shopRegistrationOwnerHint')}</p>

  {#if result}
    <div class="surface-card mt-6 space-y-3 p-5" role="status">
      <h2 class="font-semibold text-success">{$t('applicationSubmitted')}</h2>
      <p class="text-sm">{$t('applicationReference')}: <span class="font-mono">{result.id}</span></p>
      <p class="text-sm capitalize">{$t('status')}: {result.status.replaceAll('_', ' ')}</p>
      <p class="text-sm text-muted"><strong>{$t('applicationNextSteps')}:</strong> {result.nextSteps}</p>
      <p class="text-sm text-muted">{result.loginHint}</p>
      <div class="flex flex-wrap gap-2 pt-2">
        <Button href="/login?portal=shop" variant="primary">{$t('shopSignIn')}</Button>
        <Button href="/" variant="outline">{$t('home')}</Button>
      </div>
    </div>
  {:else}
    <!--
      No method/action: a native POST to this page hits SvelteKit with no form actions
      ("POST method not allowed") and reloads the form, aborting the client fetch.
    -->
    <form class="mt-6 space-y-6" novalidate onsubmit={onSubmit}>
      {#if error}
        <Alert type="error" role="alert" message={error} />
      {/if}

      <section class="surface-card space-y-3 p-4" aria-labelledby="owner-heading">
        <h2 id="owner-heading" class="text-base font-semibold">{$t('ownerInformation')}</h2>
        <div>
          <label class="mb-1 block text-sm font-medium" for="ownerName">{$t('name')} <span class="text-danger">*</span></label>
          <input id="ownerName" required class="input-field w-full" autocomplete="name" bind:value={ownerName} aria-invalid={!!fieldErrors.ownerName} />
          {#if fieldErrors.ownerName}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.ownerName}</p>{/if}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium" for="ownerEmail">{$t('businessEmail')} <span class="text-danger">*</span></label>
            <input id="ownerEmail" type="email" required class="input-field w-full" autocomplete="email" bind:value={ownerEmail} aria-invalid={!!fieldErrors.ownerEmail} />
            {#if fieldErrors.ownerEmail}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.ownerEmail}</p>{/if}
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium" for="ownerPhone">{$t('contact')} <span class="text-danger">*</span></label>
            <input id="ownerPhone" required class="input-field w-full" autocomplete="tel" bind:value={ownerPhone} aria-invalid={!!fieldErrors.ownerPhone} />
            {#if fieldErrors.ownerPhone}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.ownerPhone}</p>{/if}
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium" for="password">{$t('password')} <span class="text-danger">*</span></label>
            <input id="password" type="password" required class="input-field w-full" autocomplete="new-password" bind:value={password} aria-invalid={!!fieldErrors.password} />
            <p class="mt-1 text-xs text-muted">{$t('passwordStrengthHint')}</p>
            {#if fieldErrors.password}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.password}</p>{/if}
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium" for="confirmPassword">{$t('confirmPassword')} <span class="text-danger">*</span></label>
            <input id="confirmPassword" type="password" required class="input-field w-full" autocomplete="new-password" bind:value={confirmPassword} aria-invalid={!!fieldErrors.confirmPassword} />
            {#if fieldErrors.confirmPassword}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.confirmPassword}</p>{/if}
          </div>
        </div>
      </section>

      <section class="surface-card space-y-3 p-4" aria-labelledby="shop-heading">
        <h2 id="shop-heading" class="text-base font-semibold">{$t('shopInformation')}</h2>
        <div>
          <label class="mb-1 block text-sm font-medium" for="shopName">{$t('shopName')} <span class="text-danger">*</span></label>
          <input id="shopName" required class="input-field w-full" bind:value={shopName} aria-invalid={!!fieldErrors.shopName} />
          {#if fieldErrors.shopName}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.shopName}</p>{/if}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium" for="businessPhone">{$t('businessPhone')} <span class="text-danger">*</span></label>
            <input id="businessPhone" required class="input-field w-full" bind:value={businessPhone} aria-invalid={!!fieldErrors.businessPhone} />
            {#if fieldErrors.businessPhone}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.businessPhone}</p>{/if}
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium" for="businessEmail">{$t('shopBusinessEmail')} <span class="text-danger">*</span></label>
            <input id="businessEmail" type="email" required class="input-field w-full" bind:value={businessEmail} aria-invalid={!!fieldErrors.businessEmail} />
            {#if fieldErrors.businessEmail}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.businessEmail}</p>{/if}
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="address">{$t('address')} <span class="text-danger">*</span></label>
          <input id="address" required class="input-field w-full" bind:value={address} aria-invalid={!!fieldErrors.address} />
          {#if fieldErrors.address}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.address}</p>{/if}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium" for="city">{$t('city')} <span class="text-danger">*</span></label>
            <input id="city" required class="input-field w-full" bind:value={city} aria-invalid={!!fieldErrors.city} />
            {#if fieldErrors.city}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.city}</p>{/if}
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium" for="region">{$t('region')} <span class="text-danger">*</span></label>
            <input id="region" required class="input-field w-full" bind:value={region} aria-invalid={!!fieldErrors.region} />
            {#if fieldErrors.region}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.region}</p>{/if}
          </div>
        </div>
        <fieldset>
          <legend class="mb-2 text-sm font-medium">{$t('serviceCategory')} <span class="text-danger">*</span></legend>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each SERVICE_CATEGORIES as cat}
              <!--
                Implicit label wrapping only (no for= — for=+nested input double-toggles in Chromium).
                bind:group syncs checkbox value ids into serviceCategories for mouse, keyboard, and Playwright.
              -->
              <label class="inline-flex items-center gap-2 text-sm">
                <input
                  id="service-cat-{cat.id}"
                  name="serviceCategories"
                  type="checkbox"
                  value={cat.id}
                  bind:group={serviceCategories}
                />
                {cat.label}
              </label>
            {/each}
          </div>
          {#if fieldErrors.serviceCategories}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.serviceCategories}</p>{/if}
        </fieldset>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium" for="devices">{$t('supportedDevices')}</label>
            <input id="devices" class="input-field w-full" placeholder="Laptop, Phone…" bind:value={supportedDevicesText} />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium" for="brands">{$t('supportedBrands')}</label>
            <input id="brands" class="input-field w-full" placeholder="Apple, Dell…" bind:value={supportedBrandsText} />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="mechanicCount">{$t('mechanicCount')}</label>
          <input id="mechanicCount" type="number" min="0" class="input-field w-full" bind:value={mechanicCount} />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium" for="servicesDescription">{$t('servicesDescription')} <span class="text-danger">*</span></label>
          <textarea id="servicesDescription" required rows="4" class="input-field w-full" bind:value={servicesDescription} aria-invalid={!!fieldErrors.servicesDescription}></textarea>
          {#if fieldErrors.servicesDescription}<p class="mt-1 text-xs text-danger" role="alert">{fieldErrors.servicesDescription}</p>{/if}
        </div>
      </section>

      <label class="flex items-start gap-2 text-sm">
        <input class="mt-1" type="checkbox" bind:checked={termsAccepted} aria-invalid={!!fieldErrors.termsAccepted} />
        <span>
          {$t('acceptTermsPrefix')}
          <a class="text-accent underline" href="/terms" target="_blank" rel="noopener">{$t('terms')}</a>
          {$t('and')}
          <a class="text-accent underline" href="/privacy" target="_blank" rel="noopener">{$t('privacy')}</a>.
        </span>
      </label>
      {#if fieldErrors.termsAccepted}<p class="text-xs text-danger" role="alert">{fieldErrors.termsAccepted}</p>{/if}

      <!-- type=submit + onsubmit preventDefault: mouse, keyboard Enter, and Playwright -->
      <button
        type="submit"
        class="btn btn-primary w-full"
        disabled={loading}
        aria-busy={loading || undefined}
      >
        {loading ? $t('loading') : $t('submitShopApplication')}
      </button>
    </form>
  {/if}
</main>
