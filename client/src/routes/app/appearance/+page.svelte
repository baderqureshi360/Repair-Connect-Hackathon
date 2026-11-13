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
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
  import { requestShortcutsHelp } from '$lib/keyboard/ui';

  let form = $state<UserPreferences>({ ...defaultPreferences });
  let savedJson = $state(JSON.stringify(defaultPreferences));
  let error = $state('');
  let saving = $state(false);

  const dirty = $derived(JSON.stringify(form) !== savedJson);

  onMount(async () => {
    try {
      const me = await api<{ preferences?: Partial<UserPreferences> }>('/api/v1/auth/me');
      form = { ...defaultPreferences, ...(me.preferences || {}) };
      savedJson = JSON.stringify(form);
      applyPreferences(form);
    } catch {
      form = { ...$preferences };
      savedJson = JSON.stringify(form);
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
      form = { ...saved };
      savedJson = JSON.stringify(form);
      toasts.success('Preferences saved');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      saving = false;
    }
  }

  function restoreDefaults() {
    /* Local restore only — does not PATCH until Save. Preserves intentional user saves. */
    form = { ...defaultPreferences };
    applyPreferences(form);
  }
</script>

<section class="mx-auto max-w-2xl space-y-6">
  <UnsavedChangesGuard dirty={dirty} />
  <PageHeader title="Appearance & preferences" subtitle="Personal settings for this account only" />

  {#if error}
    <Alert type="error" role="alert" message={error} />
  {/if}

  <div class="surface-card p-4">
    <h2 class="text-sm font-semibold">{$t('keyboardShortcuts')}</h2>
    <p class="mt-1 text-sm text-muted">{$t('keyboardShortcutsHint')}</p>
    <p class="mt-2 text-xs text-muted">
      <kbd class="rounded border border-border px-1.5 py-0.5">Ctrl + K</kbd>
      {$t('commandPalette')}
      ·
      <kbd class="rounded border border-border px-1.5 py-0.5">Ctrl + /</kbd>
      {$t('keyboardShortcuts')}
    </p>
    <button type="button" class="btn btn-outline btn-sm mt-3" onclick={() => requestShortcutsHelp()}>
      {$t('viewAllShortcuts')}
    </button>
  </div>

  <form
    class="surface-card space-y-5 p-4 md:p-5"
    data-rc-save
    data-rc-submit
    onsubmit={save}
  >
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
      <p class="mb-2 text-xs text-muted">
        Saved accents are kept until you change them. Restore defaults selects Indigo locally —
        click Save preferences to persist.
      </p>
      <div class="flex flex-wrap gap-2">
        {#each [
          { id: 'indigo', label: 'Indigo', swatch: '#3730a3' },
          { id: 'blue', label: 'Blue', swatch: '#1d4ed8' },
          { id: 'teal', label: 'Teal', swatch: '#0f766e' },
          { id: 'violet', label: 'Violet', swatch: '#6d28d9' },
          { id: 'emerald', label: 'Porto green', swatch: '#82b440' }
        ] as accent}
          <label
            class={`inline-flex items-center gap-2 rounded-[var(--radius-ui)] border px-3 py-2 text-sm ${
              form.accent === accent.id ? 'border-[color:var(--color-primary)] bg-accent-soft' : 'border-border'
            }`}
          >
            <input type="radio" name="accent" value={accent.id} bind:group={form.accent} />
            <span
              class="inline-block h-3.5 w-3.5 rounded-full border border-border"
              style={`background:${accent.swatch}`}
              aria-hidden="true"
            ></span>
            <span>{accent.label}</span>
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
