<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { toasts } from '$lib/stores/toast';
  import {
    applyPreferences,
    defaultPreferences,
    preferences,
    type UserPreferences
  } from '$lib/stores/preferences';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Alert from '$lib/components/Alert.svelte';

  let form = $state<UserPreferences>({ ...defaultPreferences });
  let error = $state('');
  let saving = $state(false);

  onMount(async () => {
    try {
      const me = await api<{ preferences?: Partial<UserPreferences> }>('/api/v1/auth/me');
      form = { ...defaultPreferences, ...(me.preferences || {}) };
      applyPreferences(form);
    } catch {
      form = { ...$preferences };
    }
  });

  async function save(e: Event) {
    e.preventDefault();
    saving = true;
    error = '';
    try {
      const saved = await api<UserPreferences>('/api/v1/auth/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify(form)
      });
      applyPreferences(saved);
      toasts.success('Preferences saved');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      saving = false;
    }
  }

  function restoreDefaults() {
    form = { ...defaultPreferences };
    applyPreferences(form);
  }
</script>

<section class="mx-auto max-w-2xl space-y-6">
  <PageHeader title="Appearance & preferences" subtitle="Personal settings for this account only" />

  {#if error}
    <Alert type="error" role="alert" message={error} />
  {/if}

  <form class="space-y-5 rounded-lg border border-border bg-surface-elevated p-4" onsubmit={save}>
    <div>
      <label class="mb-1 block text-sm font-medium" for="theme">Theme</label>
      <select id="theme" class="input-field w-full" bind:value={form.theme}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">Follow system</option>
      </select>
    </div>

    <fieldset>
      <legend class="mb-2 text-sm font-medium">Accent color</legend>
      <div class="flex flex-wrap gap-2">
        {#each ['indigo', 'blue', 'teal', 'violet', 'emerald'] as accent}
          <label class="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <input type="radio" name="accent" value={accent} bind:group={form.accent} />
            <span class="capitalize">{accent}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <div>
      <label class="mb-1 block text-sm font-medium" for="density">Layout density</label>
      <select id="density" class="input-field w-full" bind:value={form.density}>
        <option value="comfortable">Comfortable</option>
        <option value="compact">Compact</option>
      </select>
    </div>

    <div>
      <label class="mb-1 block text-sm font-medium" for="fontScale">Typography</label>
      <select id="fontScale" class="input-field w-full" bind:value={form.fontScale}>
        <option value="standard">Standard</option>
        <option value="large">Larger</option>
      </select>
    </div>

    <div>
      <label class="mb-1 block text-sm font-medium" for="chartStyle">Chart style</label>
      <select id="chartStyle" class="input-field w-full" bind:value={form.chartStyle}>
        <option value="bar">Bar</option>
        <option value="line">Line</option>
        <option value="donut">Donut</option>
      </select>
    </div>

    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={form.reducedMotion} />
      Reduced motion
    </label>
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={form.highContrast} />
      High contrast
    </label>
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={form.sidebarCollapsed} />
      Collapse sidebar by default
    </label>

    <div class="flex flex-wrap gap-2">
      <Button type="submit" loading={saving}>Save preferences</Button>
      <Button type="button" variant="outline" onclick={restoreDefaults}>Restore defaults</Button>
    </div>
  </form>
</section>
