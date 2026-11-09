<script lang="ts">
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let email = $state('');
  let loading = $state(false);
  let done = $state(false);
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    loading = true;
    error = '';
    try {
      await api('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      done = true;
    } catch (err) {
      // Always show success-style completion for unknown emails to avoid enumeration;
      // only surface validation errors.
      if (err instanceof ApiError && err.status === 400) {
        error = err.message;
      } else {
        done = true;
      }
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Forgot password — RepairConnect</title></svelte:head>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
  <a href="/login" class="mb-6 text-sm text-accent hover:underline">← {$t('login')}</a>
  <h1 class="text-2xl font-bold">Forgot password</h1>
  <p class="mt-2 text-sm text-muted">
    Enter your account email. If an account exists, a reset instruction will be recorded securely. Email delivery depends
    on server configuration; contact your shop administrator if you do not receive further steps.
  </p>

  {#if done}
    <div class="mt-6">
      <Alert
        type="success"
        message="If an account exists for that email, password reset instructions have been prepared. Check with your administrator if needed."
      />
      <a class="btn btn-primary mt-4 inline-flex" href="/login">{$t('login')}</a>
    </div>
  {:else}
    <form class="mt-6 space-y-4" onsubmit={submit}>
      {#if error}<Alert type="error" role="alert" message={error} />{/if}
      <div>
        <label class="mb-1 block text-sm font-medium" for="email">{$t('email')}</label>
        <input id="email" class="input-field" type="email" required autocomplete="email" bind:value={email} />
      </div>
      <Button type="submit" loading={loading} class="w-full">Request reset</Button>
    </form>
  {/if}
</main>
