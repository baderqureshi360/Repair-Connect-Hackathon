<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { setSession, type AuthUser } from '$lib/stores/auth';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';

  let loading = $state(true);
  let saving = $state(false);
  let name = $state('');
  let phone = $state('');
  let preferredLanguage = $state<'en' | 'ur'>('en');
  let email = $state('');
  let role = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let error = $state('');
  let savedSnapshot = $state({ name: '', phone: '', preferredLanguage: 'en' as 'en' | 'ur' });

  const profileDirty = $derived(
    !loading &&
      (name !== savedSnapshot.name ||
        phone !== savedSnapshot.phone ||
        preferredLanguage !== savedSnapshot.preferredLanguage ||
        Boolean(currentPassword || newPassword))
  );

  onMount(async () => {
    try {
      const me = await api<AuthUser & { phone?: string; preferredLanguage?: 'en' | 'ur' }>('/api/v1/auth/me');
      name = me.name;
      email = me.email;
      role = me.role;
      phone = (me as any).phone || '';
      preferredLanguage = me.preferredLanguage || 'en';
      savedSnapshot = { name, phone, preferredLanguage };
      setSession(me);
    } finally {
      loading = false;
    }
  });

  async function saveProfile(e: Event) {
    e.preventDefault();
    saving = true;
    error = '';
    try {
      const updated = await api<AuthUser>('/api/v1/auth/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name, phone, preferredLanguage })
      });
      setSession({ ...updated, email, role: updated.role });
      savedSnapshot = { name, phone, preferredLanguage };
      toasts.success($t('saved') || 'Saved');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      saving = false;
    }
  }

  async function changePassword(e: Event) {
    e.preventDefault();
    saving = true;
    error = '';
    try {
      await api('/api/v1/auth/me/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      currentPassword = '';
      newPassword = '';
      toasts.success('Password updated');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      saving = false;
    }
  }
</script>

<section class="mx-auto min-w-0 max-w-2xl space-y-5 overflow-x-clip md:space-y-6">
  <UnsavedChangesGuard dirty={profileDirty} />
  <PageHeader title={$t('profile') || 'Profile'} subtitle={$t('account')} />

  {#if loading}
    <Skeleton class="h-40 w-full" />
  {:else}
    {#if error}
      <Alert type="error" role="alert" message={error} />
    {/if}

    <form class="surface-card space-y-4 p-4" data-rc-save data-rc-submit onsubmit={saveProfile}>
      <h2 class="text-sm font-semibold text-ink">{$t('profile')}</h2>
      <div>
        <label class="mb-1 block text-sm font-medium" for="profile-email">{$t('email')}</label>
        <input id="profile-email" class="input-field w-full" value={email} disabled />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="profile-role">{$t('role')}</label>
        <input id="profile-role" class="input-field w-full capitalize" value={role} disabled />
        <p class="mt-1 text-xs text-muted">Role and shop membership cannot be changed here.</p>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="profile-name">{$t('name')}</label>
        <input id="profile-name" class="input-field w-full" bind:value={name} required />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="profile-phone">Phone</label>
        <input id="profile-phone" class="input-field w-full" bind:value={phone} />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="profile-lang">{$t('language')}</label>
        <select id="profile-lang" class="input-field w-full" bind:value={preferredLanguage}>
          <option value="en">{$t('english')}</option>
          <option value="ur">{$t('urdu')}</option>
        </select>
      </div>
      <Button type="submit" loading={saving}>Save profile</Button>
    </form>

    <form class="surface-card space-y-4 p-4" onsubmit={changePassword}>
      <h2 class="text-sm font-semibold text-ink">Change password</h2>
      <div>
        <label class="mb-1 block text-sm font-medium" for="current-password">Current password</label>
        <input id="current-password" type="password" class="input-field w-full" bind:value={currentPassword} required autocomplete="current-password" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="new-password">New password</label>
        <input id="new-password" type="password" class="input-field w-full" bind:value={newPassword} required minlength="8" autocomplete="new-password" />
      </div>
      <Button type="submit" variant="secondary" loading={saving}>Update password</Button>
    </form>

    <p class="text-sm">
      <a class="font-medium text-accent underline" href="/app/appearance">Appearance & preferences</a>
    </p>
  {/if}
</section>
