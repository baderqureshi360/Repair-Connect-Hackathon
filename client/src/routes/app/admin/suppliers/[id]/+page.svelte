<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { partCategoryLabel } from '$lib/partCategories';
  import { selectedShopId } from '$lib/stores/shopContext';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';

  let profile = $state<any>(null);
  let eligible = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let reviewMsg = $state('');
  let purchaseOrderId = $state('');
  let reviewComment = $state('');
  let cats = $state({
    productQuality: 5,
    deliveryPerformance: 5,
    communication: 5,
    orderFulfilment: 5,
    overallExperience: 5
  });

  const id = $derived($page.params.id);

  async function load() {
    loading = true;
    error = '';
    try {
      profile = await api(`/api/v1/marketplace/suppliers/${id}`);
      if ($selectedShopId) {
        const elig = await api<{ items: any[] }>(
          `/api/v1/marketplace/suppliers/${id}/review-eligibility?shopId=${$selectedShopId}`
        );
        eligible = elig.items || [];
        if (!purchaseOrderId && eligible[0]) purchaseOrderId = eligible[0].publicId;
      } else {
        eligible = [];
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      profile = null;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function submitReview() {
    reviewMsg = '';
    if (!$selectedShopId) {
      reviewMsg = 'Select a shop first.';
      return;
    }
    if (!purchaseOrderId) {
      reviewMsg = 'Select an eligible fulfilled purchase order.';
      return;
    }
    try {
      await api(`/api/v1/marketplace/suppliers/${id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          shopId: $selectedShopId,
          purchaseOrderId,
          categoryRatings: {
            productQuality: Number(cats.productQuality),
            deliveryPerformance: Number(cats.deliveryPerformance),
            communication: Number(cats.communication),
            orderFulfilment: Number(cats.orderFulfilment),
            overallExperience: Number(cats.overallExperience)
          },
          comment: reviewComment
        })
      });
      reviewMsg = $t('success');
      reviewComment = '';
      await load();
    } catch (err) {
      reviewMsg = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  async function reportReview(reviewId: string) {
    if (!$selectedShopId) return;
    try {
      await api(`/api/v1/marketplace/suppliers/reviews/${reviewId}/report`, {
        method: 'POST',
        body: JSON.stringify({
          shopId: $selectedShopId,
          reason: 'This review appears inappropriate or inaccurate for moderation'
        })
      });
      reviewMsg = 'Review reported for moderation.';
      await load();
    } catch (err) {
      reviewMsg = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }

  function metric(m: { label?: string; sampleCount?: number } | null | undefined) {
    if (!m) return $t('notEnoughData');
    return `${m.label} (n=${m.sampleCount ?? 0})`;
  }
</script>

<section class="space-y-6">
  <button type="button" class="text-sm text-accent underline" onclick={() => goto('/app/admin/suppliers')}>
    ← {$t('supplierMarketplace')}
  </button>

  {#if loading}
    <p class="text-muted">{$t('loading')}</p>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else if profile}
    <header class="flex items-start gap-4">
      {#if profile.logoUrl}
        <img src={profile.logoUrl} alt="" class="h-16 w-16 rounded object-cover" />
      {/if}
      <div>
        <h1 class="text-2xl font-semibold">{profile.businessName}</h1>
        <p class="text-sm text-muted">{profile.city}{profile.region ? `, ${profile.region}` : ''}</p>
        {#if profile.verified}
          <p class="text-sm text-accent">{$t('verified')} supplier</p>
        {/if}
        <p class="text-sm">
          {$t('genuineRating')}: {profile.reviewSummary?.label || $t('notEnoughData')}
        </p>
        <p class="text-sm">{$t('fulfilmentRate')}: {metric(profile.fulfilmentPerformance)}</p>
        <p class="text-sm">{$t('onTimeDelivery')}: {metric(profile.onTimeDeliveryPerformance)}</p>
        <p class="text-sm text-muted">
          Pending overdue: {profile.pendingOverdueShipments?.label || 'No pending overdue shipments'}
        </p>
      </div>
    </header>

    {#if profile.reviewBreakdown}
      <div class="grid gap-2 sm:grid-cols-5 text-sm rounded-lg border border-border p-3">
        <p>Quality: {profile.reviewBreakdown.productQuality}★</p>
        <p>Delivery: {profile.reviewBreakdown.deliveryPerformance}★</p>
        <p>Comm: {profile.reviewBreakdown.communication}★</p>
        <p>Fulfilment: {profile.reviewBreakdown.orderFulfilment}★</p>
        <p>Overall: {profile.reviewBreakdown.overallExperience}★</p>
      </div>
    {/if}

    <dl class="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase text-muted">{$t('businessDescription')}</dt>
        <dd class="whitespace-pre-wrap">{profile.description || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase text-muted">{$t('partCategories')}</dt>
        <dd>{(profile.partCategories || []).map(partCategoryLabel).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase text-muted">{$t('supportedBrands')}</dt>
        <dd>{(profile.supportedBrands || []).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase text-muted">{$t('deliveryCoverage')}</dt>
        <dd>{(profile.deliveryCities || []).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase text-muted">{$t('availability')}</dt>
        <dd class="capitalize">{profile.availability}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase text-muted">{$t('contactPerson')}</dt>
        <dd>{profile.contactPerson}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase text-muted">{$t('phone')}</dt>
        <dd>
          <a class="text-accent underline" href={`tel:${profile.businessPhone}`}>{profile.businessPhone}</a>
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase text-muted">{$t('email')}</dt>
        <dd>
          <a class="text-accent underline" href={`mailto:${profile.businessEmail}`}>{profile.businessEmail}</a>
        </dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs uppercase text-muted">{$t('address')}</dt>
        <dd>{profile.address}</dd>
      </div>
    </dl>

    <div class="flex flex-wrap gap-2">
      <Button variant="primary" href={`mailto:${profile.businessEmail}`}>{$t('contactSupplier')}</Button>
      <Button variant="outline" href={`tel:${profile.businessPhone}`}>{$t('phone')}</Button>
      <Button
        variant="outline"
        onclick={async () => {
          try {
            if (!$selectedShopId) {
              error = 'Select a shop first.';
              return;
            }
            const convo = await api<{ id: string }>('/api/v1/supplier-network/conversations', {
              method: 'POST',
              body: JSON.stringify({
                shopId: $selectedShopId,
                supplierBusinessId: profile.id,
                subject: profile.businessName
              })
            });
            goto(`/app/admin/messages?c=${convo.id}`);
          } catch (err) {
            error = err instanceof ApiError ? err.message : $t('errorGeneric');
          }
        }}
      >
        {$t('startConversation')}
      </Button>
      <Button variant="outline" href="/app/admin/rfqs">{$t('requestQuote')}</Button>
    </div>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">{$t('verifiedReviews')}</h2>
      {#if !(profile.recentReviews || []).length}
        <p class="text-sm text-muted">{$t('notEnoughData')} — no published verified reviews yet.</p>
      {:else}
        {#each profile.recentReviews as review}
          <article class="rounded-lg border border-border p-3 space-y-1">
            <p class="text-sm font-medium">
              {review.rating}★ · PO {review.purchaseOrderPublicId}
              <span class="text-xs text-muted"> · verified</span>
            </p>
            {#if review.comment}<p class="text-sm whitespace-pre-wrap">{review.comment}</p>{/if}
            {#if review.supplierResponse}
              <p class="text-xs text-muted">Supplier: {review.supplierResponse.body}</p>
            {/if}
            <Button size="sm" variant="outline" onclick={() => reportReview(review.id)}>Report</Button>
          </article>
        {/each}
      {/if}
    </section>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">{$t('catalog')}</h2>
      {#if !(profile.catalog || []).length}
        <p class="text-sm text-muted">No catalog items published.</p>
      {:else}
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-surface-elevated text-muted">
              <tr>
                <th class="px-3 py-2">Name</th>
                <th class="px-3 py-2">SKU / MPN</th>
                <th class="px-3 py-2">{$t('partCategories')}</th>
                <th class="px-3 py-2">Brand</th>
                <th class="px-3 py-2">Price</th>
                <th class="px-3 py-2">MOQ / Lead</th>
                <th class="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each profile.catalog as item}
                <tr class="border-t border-border {item.discontinued || item.unavailable ? 'opacity-70' : ''}">
                  <td class="px-3 py-2">{item.name}</td>
                  <td class="px-3 py-2 text-xs">
                    {item.sku || '—'}
                    {#if item.manufacturerPartNumber}<br />{item.manufacturerPartNumber}{/if}
                  </td>
                  <td class="px-3 py-2">{partCategoryLabel(item.category)}</td>
                  <td class="px-3 py-2">{item.brand || '—'}</td>
                  <td class="px-3 py-2">{item.currency} {item.unitPrice}</td>
                  <td class="px-3 py-2 text-xs">{item.minOrderQuantity ?? 1} / {item.leadTimeDays ?? 0}d</td>
                  <td class="px-3 py-2 capitalize">
                    {(item.stockStatus || (item.inStock ? 'in_stock' : 'out_of_stock')).replaceAll('_', ' ')}
                    {#if item.discontinued}<span class="text-danger"> · discontinued</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="space-y-3 rounded-lg border border-border p-4">
      <h2 class="text-lg font-semibold">Submit verified review</h2>
      <p class="text-xs text-muted">
        Only fulfilled or closed purchase orders with accepted goods receipts are eligible. One review per PO.
      </p>
      {#if reviewMsg}<Alert type="success" role="status" message={reviewMsg} />{/if}
      {#if !eligible.length}
        <p class="text-sm text-muted">No eligible purchase orders for this supplier.</p>
      {:else}
        <label class="block text-sm"
          >Purchase order
          <select class="input-field mt-1 w-full" bind:value={purchaseOrderId}>
            {#each eligible as po}
              <option value={po.publicId}>{po.publicId} · {po.status}</option>
            {/each}
          </select>
        </label>
        <div class="grid gap-2 sm:grid-cols-5">
          {#each Object.keys(cats) as key}
            <label class="block text-sm"
              >{key}
              <input
                type="number"
                min="1"
                max="5"
                class="input-field mt-1 w-full"
                bind:value={cats[key as keyof typeof cats]}
              />
            </label>
          {/each}
        </div>
        <label class="block text-sm"
          >{$t('notes')}
          <textarea class="input-field mt-1 w-full" rows="2" bind:value={reviewComment}></textarea>
        </label>
        <Button variant="outline" onclick={submitReview}>Submit verified review</Button>
      {/if}
    </section>
  {/if}
</section>
