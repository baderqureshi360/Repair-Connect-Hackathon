<script lang="ts">
  import { statusLabel } from '$lib/i18n';
  let { status = '', label: labelOverride = '' }: { status: string; label?: string } = $props();
  const label = $derived(labelOverride || statusLabel(status));
  const statusKey = $derived(
    String(status || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
  );
</script>

<span class="status-pill" data-status={statusKey} aria-label={`Status: ${label}`}>
  {label}
</span>
