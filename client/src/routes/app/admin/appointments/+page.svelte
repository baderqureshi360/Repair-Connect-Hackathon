<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import Alert from '$lib/components/Alert.svelte';

  let loading = $state(true);
  let error = $state('');
  let items = $state<any[]>([]);

  onMount(async () => {
    try {
      items = (await api<any[]>('/api/v1/appointments')) || [];
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  });
</script>

<section>
  <PageHeader title={$t('appointments')} subtitle={$t('appointmentsSubtitle')} />

  {#if loading}
    <Skeleton lines={5} />
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else}
    <ul class="space-y-2">
      {#each items as appt}
        <li class="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p class="font-medium">{appt.customer?.name || $t('customer')}</p>
            <p class="text-sm text-muted">
              {new Date(appt.startsAt).toLocaleString()}
              {#if appt.shop?.name}
                · {appt.shop.name}
              {/if}
            </p>
          </div>
          <StatusPill status={appt.status} />
        </li>
      {:else}
        <li class="text-muted">{$t('empty')}</li>
      {/each}
    </ul>
  {/if}
</section>
