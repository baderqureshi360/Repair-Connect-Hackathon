<script lang="ts">
  import { statusLabel } from '$lib/i18n';
  let { status = '', label: labelOverride = '' }: { status: string; label?: string } = $props();
  const label = $derived(labelOverride || statusLabel(status));
</script>

<span class="status-pill" data-status={status} aria-label={`Status: ${label}`}>
  {label}
</span>
