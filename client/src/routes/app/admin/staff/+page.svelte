<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';

  let staff = $state<any[]>([]);
  onMount(async () => {
    staff = (await api<any[]>('/api/v1/auth/staff')) || [];
  });
</script>

<section>
  <h1 class="mb-4 text-2xl font-semibold">{$t('staff')}</h1>
  <ul class="space-y-2">
    {#each staff as m}
      <li class="rounded-lg border border-border bg-surface-elevated p-3">
        <p class="font-medium">{m.user?.name}</p>
        <p class="text-sm text-muted">{m.user?.email} · {m.role}</p>
      </li>
    {:else}
      <li class="text-muted">{$t('empty')}</li>
    {/each}
  </ul>
</section>
