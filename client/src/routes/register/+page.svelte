<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { setSession, type Role } from '$lib/stores/auth';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';

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

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
  <h1 class="text-2xl font-bold">{$t('registerTitle')}</h1>
  <form class="mt-6 space-y-4" onsubmit={onSubmit}>
    {#if error}
      <Alert type="error" role="alert" message={error} />
    {/if}
    <div>
      <label class="mb-1 block text-sm font-medium" for="name">{$t('name')}</label>
      <input id="name" required autocomplete="name" class="w-full rounded-md border border-border bg-surface-elevated px-3 py-2" bind:value={name} />
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="email">{$t('email')}</label>
      <input id="email" type="email" required autocomplete="username" class="w-full rounded-md border border-border bg-surface-elevated px-3 py-2" bind:value={email} />
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="password">{$t('password')}</label>
      <input id="password" type="password" required minlength="8" autocomplete="new-password" class="w-full rounded-md border border-border bg-surface-elevated px-3 py-2" bind:value={password} aria-describedby="password-hint" />
      <p id="password-hint" class="mt-1 text-xs text-muted">{$t('passwordHint')}</p>
    </div>
    <button type="submit" class="w-full rounded-md bg-accent px-4 py-2 font-medium text-white" disabled={loading} aria-busy={loading}>
      {loading ? $t('loading') : $t('register')}
    </button>
  </form>
</main>
