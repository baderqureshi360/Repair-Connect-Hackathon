<script lang="ts">
  import { t } from '$lib/i18n';
  import { PART_CATEGORIES } from '$lib/partCategories';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let contactPerson = $state('');
  let email = $state('');
  let phone = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let businessName = $state('');
  let address = $state('');
  let city = $state('');
  let region = $state('');
  let description = $state('');
  let partCategories = $state<string[]>([]);
  let supportedBrandsText = $state('');
  let deliveryCitiesText = $state('');
  let logoUrl = $state('');
  let verificationDocuments = $state<Array<{ name: string; dataUrl: string }>>([]);
  let termsAccepted = $state(false);
  let loading = $state(false);
  let error = $state('');
  let fieldErrors = $state<Record<string, string>>({});
  let result = $state<any>(null);

  function toggleCategory(id: string) {
    if (partCategories.includes(id)) {
      partCategories = partCategories.filter((c) => c !== id);
    } else {
      partCategories = [...partCategories, id];
    }
  }

  function splitList(text: string) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function onLogoChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      logoUrl = '';
      return;
    }
    if (file.size > 280_000) {
      fieldErrors = { ...fieldErrors, logoUrl: 'Logo must be under ~200KB' };
      return;
    }
    logoUrl = await readAsDataUrl(file);
  }

  async function onDocsChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files || [])].slice(0, 5);
    const docs: Array<{ name: string; dataUrl: string }> = [];
    for (const file of files) {
      if (file.size > 280_000) continue;
      docs.push({ name: file.name.slice(0, 160), dataUrl: await readAsDataUrl(file) });
    }
    verificationDocuments = docs;
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function validateClient(): boolean {
    const errs: Record<string, string> = {};
    if (contactPerson.trim().length < 2) errs.contactPerson = 'Enter contact person name';
    if (!email.includes('@')) errs.email = 'Enter a valid email';
    if (phone.trim().length < 5) errs.phone = 'Enter a phone number';
    if (password.length < 8) errs.password = 'Password must be at least 8 characters';
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      errs.password = 'Password must include a letter and a number';
    }
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (businessName.trim().length < 2) errs.businessName = 'Enter the business name';
    if (address.trim().length < 5) errs.address = 'Enter the full address';
    if (city.trim().length < 2) errs.city = 'Enter the city';
    if (region.trim().length < 2) errs.region = 'Enter the province/region';
    if (description.trim().length < 10) errs.description = 'Describe your business (at least 10 characters)';
    if (!partCategories.length) errs.partCategories = 'Select at least one category';
    if (!splitList(deliveryCitiesText).length) errs.deliveryCities = 'Enter at least one delivery city';
    if (!termsAccepted) errs.termsAccepted = 'Accept the Terms and Privacy Policy to continue';
    fieldErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = '';
    result = null;
    if (!validateClient()) {
      error = 'Please fix the highlighted fields.';
      return;
    }
    loading = true;
    try {
      const base = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${base}/api/v1/public/supplier-applications/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactPerson: contactPerson.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
          confirmPassword,
          businessName: businessName.trim(),
          address: address.trim(),
          city: city.trim(),
          region: region.trim(),
          description: description.trim(),
          partCategories,
          supportedBrands: splitList(supportedBrandsText),
          deliveryCities: splitList(deliveryCitiesText),
          logoUrl: logoUrl || undefined,
          verificationDocuments: verificationDocuments.length ? verificationDocuments : undefined,
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
</script>

<svelte:head>
  <title>{$t('supplierRegistrationTitle')} — RepairConnect</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-2xl px-4 py-10">
  <p class="mb-4 text-sm"><a class="text-accent underline" href="/">← RepairConnect</a></p>
  <h1 class="text-2xl font-semibold">{$t('supplierRegistrationTitle')}</h1>
  <p class="mt-2 text-sm text-muted">{$t('supplierRegistrationHint')}</p>

  {#if result}
    <div class="mt-6 space-y-3 rounded-lg border border-border bg-surface-elevated p-4">
      <Alert type="success" role="status" message={$t('applicationSubmitted')} />
      <p class="text-sm"><strong>{$t('applicationReference')}:</strong> {result.id}</p>
      <p class="text-sm text-muted">{result.nextSteps}</p>
      <p class="text-sm text-muted">{result.loginHint}</p>
      <Button href="/login?portal=shop" variant="primary">{$t('login')}</Button>
    </div>
  {:else}
    <form class="mt-6 space-y-6" onsubmit={onSubmit}>
      {#if error}
        <Alert type="error" role="alert" message={error} />
      {/if}

      <fieldset class="space-y-3">
        <legend class="text-sm font-semibold">{$t('ownerInformation')}</legend>
        <label class="block text-sm" for="contactPerson"
          >{$t('contactPerson')} <span class="text-danger">*</span>
          <input id="contactPerson" class="input-field mt-1 w-full" bind:value={contactPerson} />
        </label>
        {#if fieldErrors.contactPerson}<p class="text-xs text-danger">{fieldErrors.contactPerson}</p>{/if}
        <label class="block text-sm" for="email"
          >{$t('email')} <span class="text-danger">*</span>
          <input id="email" type="email" class="input-field mt-1 w-full" bind:value={email} />
        </label>
        {#if fieldErrors.email}<p class="text-xs text-danger">{fieldErrors.email}</p>{/if}
        <label class="block text-sm" for="phone"
          >{$t('phone')} <span class="text-danger">*</span>
          <input id="phone" class="input-field mt-1 w-full" bind:value={phone} />
        </label>
        {#if fieldErrors.phone}<p class="text-xs text-danger">{fieldErrors.phone}</p>{/if}
        <label class="block text-sm" for="password"
          >{$t('password')} <span class="text-danger">*</span>
          <input id="password" type="password" class="input-field mt-1 w-full" bind:value={password} />
        </label>
        <p class="text-xs text-muted">{$t('passwordStrengthHint')}</p>
        {#if fieldErrors.password}<p class="text-xs text-danger">{fieldErrors.password}</p>{/if}
        <label class="block text-sm" for="confirmPassword"
          >{$t('confirmPassword')} <span class="text-danger">*</span>
          <input id="confirmPassword" type="password" class="input-field mt-1 w-full" bind:value={confirmPassword} />
        </label>
        {#if fieldErrors.confirmPassword}<p class="text-xs text-danger">{fieldErrors.confirmPassword}</p>{/if}
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="text-sm font-semibold">{$t('shopInformation')}</legend>
        <label class="block text-sm" for="businessName"
          >{$t('businessName')} <span class="text-danger">*</span>
          <input id="businessName" class="input-field mt-1 w-full" bind:value={businessName} />
        </label>
        {#if fieldErrors.businessName}<p class="text-xs text-danger">{fieldErrors.businessName}</p>{/if}
        <label class="block text-sm" for="address"
          >{$t('address')} <span class="text-danger">*</span>
          <input id="address" class="input-field mt-1 w-full" bind:value={address} />
        </label>
        {#if fieldErrors.address}<p class="text-xs text-danger">{fieldErrors.address}</p>{/if}
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-sm" for="city"
            >{$t('city')} <span class="text-danger">*</span>
            <input id="city" class="input-field mt-1 w-full" bind:value={city} />
          </label>
          <label class="block text-sm" for="region"
            >{$t('region')} <span class="text-danger">*</span>
            <input id="region" class="input-field mt-1 w-full" bind:value={region} />
          </label>
        </div>
        {#if fieldErrors.city}<p class="text-xs text-danger">{fieldErrors.city}</p>{/if}
        {#if fieldErrors.region}<p class="text-xs text-danger">{fieldErrors.region}</p>{/if}
        <label class="block text-sm" for="description"
          >{$t('businessDescription')} <span class="text-danger">*</span>
          <textarea id="description" rows="4" class="input-field mt-1 w-full" bind:value={description}></textarea>
        </label>
        {#if fieldErrors.description}<p class="text-xs text-danger">{fieldErrors.description}</p>{/if}

        <div>
          <p class="text-sm font-medium">{$t('partCategories')} <span class="text-danger">*</span></p>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each PART_CATEGORIES as cat}
              <label class="inline-flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={partCategories.includes(cat.id)}
                  onchange={() => toggleCategory(cat.id)}
                />
                {cat.label}
              </label>
            {/each}
          </div>
          {#if fieldErrors.partCategories}<p class="mt-1 text-xs text-danger">{fieldErrors.partCategories}</p>{/if}
        </div>

        <label class="block text-sm" for="brands"
          >{$t('supportedBrands')}
          <input
            id="brands"
            class="input-field mt-1 w-full"
            bind:value={supportedBrandsText}
            placeholder="Apple, Samsung, Xiaomi"
          />
        </label>
        <label class="block text-sm" for="delivery"
          >{$t('deliveryCoverage')} <span class="text-danger">*</span>
          <input
            id="delivery"
            class="input-field mt-1 w-full"
            bind:value={deliveryCitiesText}
            placeholder="Karachi, Lahore, Islamabad"
          />
        </label>
        <p class="text-xs text-muted">{$t('deliveryCitiesHint')}</p>
        {#if fieldErrors.deliveryCities}<p class="text-xs text-danger">{fieldErrors.deliveryCities}</p>{/if}

        <label class="block text-sm" for="logo"
          >{$t('optionalLogo')}
          <input id="logo" type="file" accept="image/*" class="mt-1 block w-full text-sm" onchange={onLogoChange} />
        </label>
        <label class="block text-sm" for="docs"
          >{$t('verificationDocuments')}
          <input id="docs" type="file" multiple class="mt-1 block w-full text-sm" onchange={onDocsChange} />
        </label>
      </fieldset>

      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" bind:checked={termsAccepted} class="mt-1" />
        <span>
          {$t('acceptTermsPrefix')}
          <a class="underline" href="/terms" target="_blank">{$t('terms')}</a>
          {$t('and')}
          <a class="underline" href="/privacy" target="_blank">{$t('privacy')}</a>
        </span>
      </label>
      {#if fieldErrors.termsAccepted}<p class="text-xs text-danger">{fieldErrors.termsAccepted}</p>{/if}

      <Button type="submit" variant="primary" disabled={loading}>
        {loading ? $t('loading') : $t('submitSupplierApplication')}
      </Button>
    </form>
  {/if}
</main>
