<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let docs = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');

  const receiptTypes = new Set(['invoice', 'payment_receipt', 'intake_receipt', 'handover', 'warranty']);

  async function load() {
    loading = true;
    error = '';
    try {
      const items = await api<any[]>('/api/v1/documents');
      docs = (items || []).filter((d) => receiptTypes.has(d.docType));
    } catch (err: any) {
      error = err?.message || $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const typeLabels: Record<string, string> = {
    invoice: 'docType_invoice',
    payment_receipt: 'docType_payment_receipt',
    intake_receipt: 'docType_intake_receipt',
    handover: 'docType_handover',
    warranty: 'docType_warranty'
  };

  function typeLabel(docType: string) {
    const key = typeLabels[docType];
    return key ? $t(key as 'docType_invoice') : docType.replaceAll('_', ' ');
  }
</script>

<section class="space-y-6">
  <PageHeader
    title={$t('myReceipts')}
    subtitle={$t('myReceiptsSubtitle')}
    breadcrumbs={[{ label: $t('home'), href: '/app/customer' }, { label: $t('myReceipts') }]}
  />

  {#if loading}
    <div class="space-y-2" aria-busy="true">
      {#each Array.from({ length: 4 }) as _}<Skeleton class="h-16" />{/each}
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else}
    <ul class="space-y-2">
      {#each docs as doc}
        <li class="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p class="font-medium">{doc.documentNumber || doc._id}</p>
            <p class="text-sm text-muted">
              {typeLabel(doc.docType)}
              {#if doc.issuedAt}
                · {new Date(doc.issuedAt).toLocaleString()}
              {/if}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            {#if doc.repairRequest}
              <Button size="sm" variant="outline" href={`/app/repairs/${doc.repairRequest}`}>{$t('myRepairs')}</Button>
            {/if}
            <Button size="sm" variant="primary" href={`/app/documents/${doc._id}`}>{$t('viewReceipt')}</Button>
          </div>
        </li>
      {:else}
        <li class="text-muted">{$t('noReceiptsYet')}</li>
      {/each}
    </ul>
  {/if}
</section>
