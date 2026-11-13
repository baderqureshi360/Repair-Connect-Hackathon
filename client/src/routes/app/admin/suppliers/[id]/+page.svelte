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
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';

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

  const categoryLabels: Record<string, string> = {
    productQuality: 'Quality',
    deliveryPerformance: 'Delivery',
    communication: 'Communication',
    orderFulfilment: 'Fulfilment',
    overallExperience: 'Overall'
  };
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  {#if loading}
    <div class="space-y-3" role="status" aria-busy="true" aria-label={$t('loading')}>
      <Skeleton class="h-10 w-2/3 max-w-md" />
      <Skeleton class="h-28 w-full" />
      <Skeleton class="h-48 w-full" />
    </div>
  {:else if error && !profile}
    <PageHeader
      title={$t('supplierMarketplace')}
      breadcrumbs={[
        { label: $t('home'), href: '/app/admin' },
        { label: $t('supplierMarketplace'), href: '/app/admin/suppliers' }
      ]}
    />
    <Alert type="error" role="alert" message={error} />
    <Button variant="outline" onclick={load}>{$t('retry')}</Button>
  {:else if profile}
    <PageHeader
      title={profile.businessName}
      subtitle={`${profile.city}${profile.region ? `, ${profile.region}` : ''}${profile.verified ? ` · ${$t('verified')}` : ''}`}
      breadcrumbs={[
        { label: $t('home'), href: '/app/admin' },
        { label: $t('supplierMarketplace'), href: '/app/admin/suppliers' },
        { label: profile.businessName }
      ]}
    >
      <Button variant="primary" size="sm" href={`mailto:${profile.businessEmail}`}>{$t('contactSupplier')}</Button>
      <Button variant="outline" size="sm" href={`tel:${profile.businessPhone}`}>{$t('phone')}</Button>
      <Button
        variant="outline"
        size="sm"
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
      <Button variant="outline" size="sm" href="/app/admin/rfqs">{$t('requestQuote')}</Button>
    </PageHeader>

    {#if error}
      <Alert type="error" role="alert" message={error} />
    {/if}

    <div class="surface-card flex flex-col gap-4 p-4 sm:flex-row sm:items-start md:p-5">
      {#if profile.logoUrl}
        <img
          src={profile.logoUrl}
          alt=""
          class="h-16 w-16 shrink-0 rounded-[var(--radius-ui)] border border-border object-cover"
        />
      {/if}
      <div class="grid min-w-0 flex-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <p>
          <span class="block text-xs font-semibold uppercase tracking-wide text-muted">{$t('genuineRating')}</span>
          {profile.reviewSummary?.label || $t('notEnoughData')}
        </p>
        <p>
          <span class="block text-xs font-semibold uppercase tracking-wide text-muted">{$t('fulfilmentRate')}</span>
          {metric(profile.fulfilmentPerformance)}
        </p>
        <p>
          <span class="block text-xs font-semibold uppercase tracking-wide text-muted">{$t('onTimeDelivery')}</span>
          {metric(profile.onTimeDeliveryPerformance)}
        </p>
        <p class="sm:col-span-2 lg:col-span-3 text-muted">
          Pending overdue: {profile.pendingOverdueShipments?.label || 'No pending overdue shipments'}
        </p>
      </div>
    </div>

    {#if profile.reviewBreakdown}
      <div class="surface-card grid gap-3 p-4 text-sm sm:grid-cols-5" role="list">
        <p role="listitem">
          <span class="block text-xs text-muted">Quality</span>
          <span class="font-semibold tabular-nums">{profile.reviewBreakdown.productQuality}★</span>
        </p>
        <p role="listitem">
          <span class="block text-xs text-muted">Delivery</span>
          <span class="font-semibold tabular-nums">{profile.reviewBreakdown.deliveryPerformance}★</span>
        </p>
        <p role="listitem">
          <span class="block text-xs text-muted">Comm</span>
          <span class="font-semibold tabular-nums">{profile.reviewBreakdown.communication}★</span>
        </p>
        <p role="listitem">
          <span class="block text-xs text-muted">Fulfilment</span>
          <span class="font-semibold tabular-nums">{profile.reviewBreakdown.orderFulfilment}★</span>
        </p>
        <p role="listitem">
          <span class="block text-xs text-muted">Overall</span>
          <span class="font-semibold tabular-nums">{profile.reviewBreakdown.overallExperience}★</span>
        </p>
      </div>
    {/if}

    <dl class="surface-card grid gap-4 p-4 text-sm sm:grid-cols-2 md:p-5">
      <div class="sm:col-span-2">
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('businessDescription')}</dt>
        <dd class="mt-1 whitespace-pre-wrap text-ink">{profile.description || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('partCategories')}</dt>
        <dd class="mt-1">{(profile.partCategories || []).map(partCategoryLabel).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('supportedBrands')}</dt>
        <dd class="mt-1">{(profile.supportedBrands || []).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('deliveryCoverage')}</dt>
        <dd class="mt-1">{(profile.deliveryCities || []).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('availability')}</dt>
        <dd class="mt-1 capitalize">{profile.availability}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('contactPerson')}</dt>
        <dd class="mt-1">{profile.contactPerson}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('phone')}</dt>
        <dd class="mt-1">
          <a class="font-medium hover:underline" href={`tel:${profile.businessPhone}`}>{profile.businessPhone}</a>
        </dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('email')}</dt>
        <dd class="mt-1">
          <a class="font-medium hover:underline" href={`mailto:${profile.businessEmail}`}>{profile.businessEmail}</a>
        </dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{$t('address')}</dt>
        <dd class="mt-1">{profile.address}</dd>
      </div>
    </dl>

    <section class="space-y-3" aria-labelledby="verified-reviews-heading">
      <h2 id="verified-reviews-heading" class="text-sm font-semibold text-ink">{$t('verifiedReviews')}</h2>
      {#if !(profile.recentReviews || []).length}
        <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-8 text-center text-sm text-muted" role="status">
          {$t('notEnoughData')} — no published verified reviews yet.
        </p>
      {:else}
        <ul class="space-y-3" role="list">
          {#each profile.recentReviews as review}
            <li class="surface-card space-y-2 p-4">
              <p class="text-sm font-medium text-ink">
                {review.rating}★ · PO {review.purchaseOrderPublicId}
                <span class="text-xs font-normal text-muted"> · verified</span>
              </p>
              {#if review.comment}<p class="text-sm whitespace-pre-wrap text-muted">{review.comment}</p>{/if}
              {#if review.supplierResponse}
                <p class="text-xs text-muted">Supplier: {review.supplierResponse.body}</p>
              {/if}
              <Button size="sm" variant="outline" onclick={() => reportReview(review.id)}>Report</Button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="space-y-3" aria-labelledby="catalog-heading">
      <h2 id="catalog-heading" class="text-sm font-semibold text-ink">{$t('catalog')}</h2>
      {#if !(profile.catalog || []).length}
        <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-8 text-center text-sm text-muted" role="status">
          No catalog items published.
        </p>
      {:else}
        <div class="data-table-shell">
          <table class="min-w-full text-start text-sm">
            <caption class="sr-only">{$t('catalog')}</caption>
            <thead class="border-b border-border text-muted">
              <tr>
                <th class="px-3 py-2" scope="col">Name</th>
                <th class="px-3 py-2" scope="col">SKU / MPN</th>
                <th class="px-3 py-2" scope="col">{$t('partCategories')}</th>
                <th class="px-3 py-2" scope="col">Brand</th>
                <th class="px-3 py-2" scope="col">Price</th>
                <th class="px-3 py-2" scope="col">MOQ / Lead</th>
                <th class="px-3 py-2" scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each profile.catalog as item}
                <tr class="border-t border-border {item.discontinued || item.unavailable ? 'opacity-70' : ''}">
                  <td class="px-3 py-2 font-medium">{item.name}</td>
                  <td class="px-3 py-2 text-xs text-muted">
                    {item.sku || '—'}
                    {#if item.manufacturerPartNumber}<br />{item.manufacturerPartNumber}{/if}
                  </td>
                  <td class="px-3 py-2">{partCategoryLabel(item.category)}</td>
                  <td class="px-3 py-2">{item.brand || '—'}</td>
                  <td class="px-3 py-2 tabular-nums">{item.currency} {item.unitPrice}</td>
                  <td class="px-3 py-2 text-xs tabular-nums">{item.minOrderQuantity ?? 1} / {item.leadTimeDays ?? 0}d</td>
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

    <section class="surface-card space-y-4 p-4 md:p-5" aria-labelledby="submit-review-heading">
      <div>
        <h2 id="submit-review-heading" class="text-sm font-semibold text-ink">Submit verified review</h2>
        <p class="mt-1 text-xs text-muted">
          Only fulfilled or closed purchase orders with accepted goods receipts are eligible. One review per PO.
        </p>
      </div>
      {#if reviewMsg}<Alert type="success" role="status" message={reviewMsg} />{/if}
      {#if !eligible.length}
        <p class="rounded-[var(--radius-ui)] bg-surface-muted px-3 py-6 text-center text-sm text-muted" role="status">
          No eligible purchase orders for this supplier.
        </p>
      {:else}
        <div>
          <label class="field-label" for="eligible-po">Purchase order</label>
          <select id="eligible-po" class="input-field w-full" bind:value={purchaseOrderId}>
            {#each eligible as po}
              <option value={po.publicId}>{po.publicId} · {po.status}</option>
            {/each}
          </select>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {#each Object.keys(cats) as key}
            <div>
              <label class="field-label" for={`cat-${key}`}>{categoryLabels[key] || key}</label>
              <input
                id={`cat-${key}`}
                type="number"
                min="1"
                max="5"
                class="input-field w-full"
                bind:value={cats[key as keyof typeof cats]}
              />
            </div>
          {/each}
        </div>
        <div>
          <label class="field-label" for="review-notes">{$t('notes')}</label>
          <textarea id="review-notes" class="input-field min-h-[4.5rem] w-full" rows="2" bind:value={reviewComment}
          ></textarea>
        </div>
        <Button variant="primary" onclick={submitReview}>Submit verified review</Button>
      {/if}
    </section>
  {/if}
</section>
