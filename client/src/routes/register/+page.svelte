<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { setSession, type Role } from '$lib/stores/auth';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      const data = await api<{
        csrfToken?: string;
        user: { id: string; email: string; name: string; role: Role };
      }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role: 'customer' })
      });
      setSession(data.user, data.csrfToken);
      goto('/app/customer');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{$t('registerTitle')} — RepairConnect</title>
</svelte:head>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
  <a href="/" class="mb-6 inline-flex items-center gap-2.5 text-sm font-semibold text-ink hover:opacity-90">
    <BrandMark size={36} compact />
    <span>{$t('appName')}</span>
  </a>
  <h1 class="text-xl font-semibold tracking-tight text-ink md:text-2xl">{$t('registerTitle')}</h1>
  <form class="surface-card mt-6 space-y-4 p-5" onsubmit={onSubmit}>
    {#if error}
      <Alert type="error" role="alert" message={error} />
    {/if}
    <div>
      <label class="field-label" for="name">{$t('name')}</label>
      <input id="name" required autocomplete="name" class="input-field" bind:value={name} />
    </div>
    <div>
      <label class="field-label" for="email">{$t('email')}</label>
      <input id="email" type="email" required autocomplete="username" class="input-field" bind:value={email} />
    </div>
    <div>
      <label class="field-label" for="password">{$t('password')}</label>
      <input
        id="password"
        type="password"
        required
        minlength="8"
        autocomplete="new-password"
        class="input-field"
        bind:value={password}
        aria-describedby="password-hint"
      />
      <p id="password-hint" class="field-hint">{$t('passwordHint')}</p>
    </div>
    <button type="submit" class="btn btn-primary w-full" disabled={loading} aria-busy={loading}>
      {loading ? $t('loading') : $t('register')}
    </button>
  </form>
  <p class="mt-4 text-sm">
    <a class="underline" href="/login?portal=customer">{$t('login')}</a>
  </p>
</main>
