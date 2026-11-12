<script lang="ts">
  import { t } from '$lib/i18n';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
</script>

<section class="mx-auto min-w-0 max-w-2xl space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader title={$t('settings')} subtitle={$t('platformSettingsHint')} />
  <Alert type="info" role="status" message={$t('platformScopeNote')} />

  <div class="surface-card space-y-4 p-4 sm:p-5">
    <div>
      <h2 class="text-sm font-semibold text-ink">{$t('appearance')}</h2>
      <p class="mt-1 text-sm text-muted">Theme, language, reduced motion, and density preferences.</p>
      <Button class="mt-3" href="/app/appearance" variant="outline" size="sm">{$t('appearance')}</Button>
    </div>
    <div class="border-t border-border pt-4">
      <h2 class="text-sm font-semibold text-ink">{$t('profile')}</h2>
      <p class="mt-1 text-sm text-muted">Operator account profile details.</p>
      <Button class="mt-3" href="/app/profile" variant="outline" size="sm">{$t('profile')}</Button>
    </div>
    <div class="border-t border-border pt-4">
      <h2 class="text-sm font-semibold text-ink">{$t('notifications')}</h2>
      <p class="mt-1 text-sm text-muted">Platform notifications inbox and delivery preferences.</p>
      <Button class="mt-3" href="/app/notifications" variant="outline" size="sm">{$t('notifications')}</Button>
    </div>
  </div>
</section>
