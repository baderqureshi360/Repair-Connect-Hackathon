<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { user } from '$lib/stores/auth';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';

  type SupplierOption = {
    id: string;
    publicId: string;
    businessName: string;
    city: string;
    region?: string;
    businessEmail?: string;
    businessPhone?: string;
    contactPerson?: string;
  };

  let reports = $state<any>(null);
  let entries = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let okMsg = $state('');

  let supplierQuery = $state('');
  let supplierOptions = $state<SupplierOption[]>([]);
  let supplierSearchLoading = $state(false);
  let selectedSupplier = $state<SupplierOption | null>(null);
  let amount = $state(0);
  let reference = $state('');
  let method = $state<'cash' | 'bank_transfer' | 'cheque' | 'jazzcash' | 'easypaisa' | 'other'>(
    'bank_transfer'
  );
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const paymentDirty = $derived(Number(amount) > 0 || Boolean(reference.trim()));

  function shopId() {
    const shops = ($user as { shops?: { id?: string; _id?: string }[] } | null)?.shops;
    return String(shops?.[0]?.id || shops?.[0]?._id || entries[0]?.shopId || '');
  }

  async function load() {
    loading = true;
    error = '';
    try {
      reports = await api('/api/v1/supplier-network/purchasing-reports');
      entries = await api('/api/v1/supplier-network/ledger');
      await searchSuppliers('');
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    } finally {
      loading = false;
    }
  }

  async function searchSuppliers(q: string) {
    supplierSearchLoading = true;
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      const searched = await api<{ items: any[] }>(`/api/v1/marketplace/suppliers${qs}`);
      let base: SupplierOption[] = (searched.items || []).map((s: any) => ({
        id: s.id,
        publicId: s.publicId,
        businessName: s.businessName,
        city: s.city,
        region: s.region,
        businessEmail: s.businessEmail,
        businessPhone: s.businessPhone,
        contactPerson: s.contactPerson
      }));

      for (const row of reports?.outstandingPayables || []) {
        if (!base.some((s) => s.id === row.supplierBusinessId)) {
          try {
            const profile = await api<any>(`/api/v1/marketplace/suppliers/${row.supplierBusinessId}`);
            base = [
              ...base,
              {
                id: profile.id,
                publicId: profile.publicId,
                businessName: profile.businessName,
                city: profile.city,
                region: profile.region,
                businessEmail: profile.businessEmail,
                businessPhone: profile.businessPhone,
                contactPerson: profile.contactPerson
              }
            ];
          } catch {
            /* skip unavailable */
          }
        }
      }
      supplierOptions = base;
    } catch (err) {
      if (!supplierOptions.length) {
        error = err instanceof ApiError ? err.message : $t('errorGeneric');
      }
    } finally {
      supplierSearchLoading = false;
    }
  }

  function onQueryInput(value: string) {
    supplierQuery = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchSuppliers(value), 250);
  }

  async function selectSupplier(option: SupplierOption) {
    selectedSupplier = option;
    // Load contact details if list payload omitted them
    if (!option.businessEmail && !option.businessPhone) {
      try {
        const profile = await api<any>(`/api/v1/marketplace/suppliers/${option.id}`);
        selectedSupplier = {
          ...option,
          businessEmail: profile.businessEmail,
          businessPhone: profile.businessPhone,
          contactPerson: profile.contactPerson,
          region: profile.region
        };
      } catch {
        /* keep basic option */
      }
    }
  }

  function selectById(id: string) {
    const found = supplierOptions.find((s) => s.id === id);
    if (found) void selectSupplier(found);
    else void selectSupplier({ id, publicId: id, businessName: id, city: '' });
  }

  onMount(async () => {
    if ($user && $user.role !== 'shop_admin') {
      const dest =
        $user.role === 'parts_coordinator'
          ? '/app/parts'
          : $user.role === 'mechanic'
            ? '/app/mechanic'
            : $user.role === 'supplier'
              ? '/app/supplier'
              : '/app/customer';
      await goto(dest);
      return;
    }
    await load();
  });

  async function pay() {
    if (!selectedSupplier || amount <= 0) return;
    const sid = shopId();
    if (!sid) {
      error = 'Shop context missing';
      return;
    }
    try {
      await api('/api/v1/supplier-network/ledger/payments', {
        method: 'POST',
        body: JSON.stringify({
          shopId: sid,
          supplierBusinessId: selectedSupplier.id,
          amount,
          paymentMethod: method,
          externalReference: reference || undefined,
          idempotencyKey: `pay-${selectedSupplier.id}-${amount}-${Date.now()}`
        })
      });
      okMsg = 'Payment recorded.';
      amount = 0;
      reference = '';
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="space-y-6">
  <UnsavedChangesGuard dirty={paymentDirty} />
  <header>
    <h1 class="text-2xl font-semibold">{$t('supplierFinance')}</h1>
    <p class="text-sm text-muted">Supplier payables are separate from customer repair revenue.</p>
  </header>

  {#if error}<Alert type="error" role="alert" message={error} />{/if}
  {#if okMsg}<Alert type="success" role="status" message={okMsg} />{/if}

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if reports}
    <section class="space-y-2">
      <h2 class="text-lg font-semibold">Outstanding payables</h2>
      {#if !reports.outstandingPayables?.length}
        <p class="text-sm text-muted">No outstanding balances.</p>
      {:else}
        <ul class="space-y-1 text-sm">
          {#each reports.outstandingPayables as row}
            {@const match = supplierOptions.find((s) => s.id === row.supplierBusinessId)}
            <li class="rounded border border-border px-3 py-2 flex justify-between gap-2">
              <button type="button" class="text-left text-accent underline" onclick={() => selectById(row.supplierBusinessId)}>
                {match?.businessName || row.supplierBusinessId}
                {#if match?.city}<span class="text-muted"> · {match.city}</span>{/if}
              </button>
              <span>{row.outstandingPayable} {row.currency}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="space-y-2">
      <h2 class="text-lg font-semibold">Pending purchase orders</h2>
      <p class="text-sm">{reports.pendingPurchaseOrders?.length || 0} open</p>
    </section>

    <section class="space-y-3 rounded-lg border border-border p-4">
      <h2 class="font-semibold">{$t('recordPayment')}</h2>

      <label class="block text-sm" for="supplier-search">Supplier</label>
      <input
        id="supplier-search"
        class="input-field"
        type="search"
        placeholder="Search by supplier name"
        value={supplierQuery}
        oninput={(e) => onQueryInput((e.currentTarget as HTMLInputElement).value)}
        aria-controls="supplier-results"
        autocomplete="off"
      />
      {#if supplierSearchLoading}
        <p class="text-xs text-muted" aria-live="polite">{$t('loading')}</p>
      {/if}
      <ul id="supplier-results" class="max-h-48 overflow-y-auto rounded border border-border" role="listbox" aria-label="Suppliers">
        {#each supplierOptions as opt}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={selectedSupplier?.id === opt.id}
              class="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-surface-elevated {selectedSupplier?.id === opt.id
                ? 'bg-surface-elevated'
                : ''}"
              onclick={() => selectSupplier(opt)}
            >
              <span class="font-medium">{opt.businessName}</span>
              <span class="text-xs text-muted">{opt.city}{opt.region ? `, ${opt.region}` : ''}</span>
            </button>
          </li>
        {:else}
          <li class="px-3 py-2 text-sm text-muted">No suppliers found for this shop city.</li>
        {/each}
      </ul>

      {#if selectedSupplier}
        <div class="rounded border border-border bg-surface-elevated px-3 py-2 text-sm" aria-live="polite">
          <p class="font-medium">{selectedSupplier.businessName}</p>
          <p class="text-muted">{selectedSupplier.city}{selectedSupplier.region ? `, ${selectedSupplier.region}` : ''}</p>
          {#if selectedSupplier.contactPerson}
            <p>Contact: {selectedSupplier.contactPerson}</p>
          {/if}
          {#if selectedSupplier.businessPhone}
            <p>Phone: {selectedSupplier.businessPhone}</p>
          {/if}
          {#if selectedSupplier.businessEmail}
            <p>Email: {selectedSupplier.businessEmail}</p>
          {/if}
        </div>
      {/if}

      <label class="block text-sm" for="amt">Amount</label>
      <input id="amt" class="input-field" type="number" min="0" step="0.01" bind:value={amount} />
      <label class="block text-sm" for="method">Method</label>
      <select id="method" class="input-field" bind:value={method}>
        <option value="bank_transfer">Bank transfer</option>
        <option value="cash">Cash</option>
        <option value="cheque">Cheque</option>
        <option value="jazzcash">JazzCash</option>
        <option value="easypaisa">Easypaisa</option>
        <option value="other">Other</option>
      </select>
      <label class="block text-sm" for="ref">Reference</label>
      <input id="ref" class="input-field" bind:value={reference} />
      <Button variant="primary" onclick={pay} disabled={!selectedSupplier || amount <= 0}>
        {$t('recordPayment')}
      </Button>
    </section>

    <section class="space-y-2">
      <h2 class="text-lg font-semibold">Ledger</h2>
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="min-w-full text-left text-sm">
          <thead class="bg-surface-elevated text-muted">
            <tr>
              <th class="px-3 py-2">Ref</th>
              <th class="px-3 py-2">Kind</th>
              <th class="px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {#each entries as e}
              <tr class="border-t border-border">
                <td class="px-3 py-2">{e.publicId}</td>
                <td class="px-3 py-2">{e.kind}</td>
                <td class="px-3 py-2">{e.amount} {e.currency}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</section>
