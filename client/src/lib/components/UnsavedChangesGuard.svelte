<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';

  let {
    dirty = false,
    message
  }: {
    dirty: boolean;
    message?: string;
  } = $props();

  const warnMessage = $derived(message || $t('unsavedChangesWarning'));

  beforeNavigate(({ cancel }) => {
    if (!dirty) return;
    if (!window.confirm(warnMessage)) cancel();
  });

  onMount(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  });
</script>
