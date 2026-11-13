<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { selectedShopId } from '$lib/stores/shopContext';
  import { PART_CATEGORIES, partCategoryLabel } from '$lib/partCategories';
  import Alert from '$lib/components/Alert.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  type Metric = { value: number | null; sampleCount: number; enoughData: boolean; label: string };
  type SupplierCard = {
    id: string;
    publicId: string;
    businessName: string;
    logoUrl?: string;
    verified?: boolean;
    city: string;
    partCategories: string[];
    supportedBrands: string[];
    deliveryCities: string[];
    availability: string;
    genuineRating?: { average: number; count: number } | null;
    reviewSummary?: { label: string; enoughData: boolean; count: number };
    fulfilmentPerformance?: Metric;
    onTimeDeliveryPerformance?: Metric;
  };

  type ProductCard = {
    id: string;
    name: string;
    sku: string;
    manufacturerPartNumber?: string;
    category: string;
    brand: string;
    unitPrice: number;
    currency: string;
    stockStatus: string;
    minOrderQuantity: number;
    leadTimeDays: number;
    unavailable?: boolean;
    discontinued?: boolean;
    supplier: {
      publicId: string;
      businessName: string;
      verified?: boolean;
      city: string;
      deliveryCities: string[];
    };
  };

  let mode = $state<'suppliers' | 'products'>('products');
  let city = $state('');
  let q = $state('');
  let category = $state('');
  let brand = $state('');
  let availability = $state('');
  let minPrice = $state('');
  let maxPrice = $state('');
  let minRating = $state('');
  let minFulfilment = $state('');
  let minOnTime = $state('');
  let verifiedReviewsOnly = $state(false);
  let sortBy = $state('name');
  let cities = $state<string[]>([]);
  let brands = $state<string[]>([]);
  let suppliers = $state<SupplierCard[]>([]);
  let products = $state<ProductCard[]>([]);
  let loading = $state(true);
  let error = $state('');
  let compareIds = $state<string[]>([]);
  let compareResult = $state<any>(null);
  let compareMsg = $state('');

  async function loadMeta() {
    const meta = await api<{ defaultCity?: string; cities: string[]; brands: string[] }>(
      '/api/v1/marketplace/suppliers/meta'
    );
    cities = meta.cities || [];
    brands = meta.brands || [];
    if (!city && meta.defaultCity) city = meta.defaultCity;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams();
      if (city) params.set('city', city);
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (brand) params.set('brand', brand);
      if (availability) params.set('availability', availability);

      if (mode === 'products') {
        if (minPrice !== '') params.set('minPrice', String(minPrice));
        if (maxPrice !== '') params.set('maxPrice', String(maxPrice));
        const data = await api<{ city: string; items: ProductCard[] }>(
          `/api/v1/marketplace/suppliers/products?${params.toString()}`
        );
        if (data.city && !city) city = data.city;
        products = data.items || [];
        suppliers = [];
      } else {
        if (minRating !== '') params.set('minRating', String(minRating));
        if (minFulfilment !== '') params.set('minFulfilmentRate', String(minFulfilment));
        if (minOnTime !== '') params.set('minOnTimeRate', String(minOnTime));
        if (verifiedReviewsOnly) params.set('verifiedReviewsOnly', '1');
        if (sortBy) params.set('sortBy', sortBy);
        const data = await api<{ city: string; items: SupplierCard[] }>(
          `/api/v1/marketplace/suppliers?${params.toString()}`
        );
        if (data.city && !city) city = data.city;
        suppliers = data.items || [];
        products = [];
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      suppliers = [];
      products = [];
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    try {
      await loadMeta();
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      loading = false;
    }
  });

  function statusClass(status: string) {
    if (status === 'discontinued' || status === 'out_of_stock') return 'text-danger';
    if (status === 'low_stock') return 'text-amber-700';
    return 'text-accent';
  }

  function toggleCompare(id: string) {
    if (compareIds.includes(id)) {
      compareIds = compareIds.filter((x) => x !== id);
    } else if (compareIds.length < 5) {
      compareIds = [...compareIds, id];
    }
  }

  async function runCompare() {
    compareMsg = '';
    compareResult = null;
    if (compareIds.length < 2) {
      compareMsg = 'Select 2–5 suppliers to compare.';
      return;
    }
    try {
      const params = new URLSearchParams({ ids: compareIds.join(',') });
      if ($selectedShopId) params.set('shopId', $selectedShopId);
      compareResult = await api(`/api/v1/marketplace/suppliers/compare?${params.toString()}`);
    } catch (err) {
      compareMsg = err instanceof ApiError ? err.message : $t('errorGeneric');
    }
  }
</script>

<section class="min-w-0 space-y-5 overflow-x-clip md:space-y-6">
  <PageHeader
    title={$t('supplierMarketplace')}
    subtitle={$t('supplierMarketplaceHint')}
    breadcrumbs={[{ label: $t('home'), href: '/app/admin' }, { label: $t('supplierMarketplace') }]}
  />

  <div class="flex flex-wrap gap-2" role="tablist" aria-label="Marketplace views">
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'products'}
      class={`btn btn-sm ${mode === 'products' ? 'btn-primary' : 'btn-outline'}`}
      onclick={() => {
        mode = 'products';
        load();
      }}
    >
      Products
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'suppliers'}
      class={`btn btn-sm ${mode === 'suppliers' ? 'btn-primary' : 'btn-outline'}`}
      onclick={() => {
        mode = 'suppliers';
        load();
      }}
    >
      Suppliers
    </button>
  </div>

  <div class="surface-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" role="search">
    <label class="text-sm" for="mkt-city"
      >{$t('city')}
      {#if cities.length}
        <select id="mkt-city" class="input-field mt-1 w-full" bind:value={city} onchange={load}>
          {#each cities as c}
            <option value={c}>{c}</option>
          {/each}
        </select>
      {:else}
        <input id="mkt-city" class="input-field mt-1 w-full" bind:value={city} onchange={load} />
      {/if}
    </label>
    <label class="text-sm" for="mkt-q"
      >{$t('search')}
      <input
        id="mkt-q"
        class="input-field mt-1 w-full"
        placeholder={mode === 'products' ? 'Name, SKU, MPN' : 'Supplier name'}
        bind:value={q}
        onkeydown={(e) => e.key === 'Enter' && load()}
      />
    </label>
    <label class="text-sm" for="mkt-cat"
      >{$t('partCategories')}
      <select id="mkt-cat" class="input-field mt-1 w-full" bind:value={category} onchange={load}>
        <option value="">{$t('all')}</option>
        {#each PART_CATEGORIES as cat}
          <option value={cat.id}>{cat.label}</option>
        {/each}
      </select>
    </label>
    <label class="text-sm" for="mkt-brand"
      >Brand
      <select id="mkt-brand" class="input-field mt-1 w-full" bind:value={brand} onchange={load}>
        <option value="">{$t('all')}</option>
        {#each brands as b}
          <option value={b}>{b}</option>
        {/each}
      </select>
    </label>
    <label class="text-sm" for="mkt-avail"
      >{$t('availability')}
      <select id="mkt-avail" class="input-field mt-1 w-full" bind:value={availability} onchange={load}>
        <option value="">{$t('all')}</option>
        {#if mode === 'products'}
          <option value="in_stock">In stock</option>
          <option value="low_stock">Low stock</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="discontinued">Discontinued</option>
          <option value="available">Available (in/low)</option>
          <option value="unavailable">Unavailable</option>
        {:else}
          <option value="available">{$t('available')}</option>
          <option value="limited">{$t('limited')}</option>
          <option value="unavailable">{$t('unavailable')}</option>
        {/if}
      </select>
    </label>
    {#if mode === 'products'}
      <div class="grid grid-cols-2 gap-2">
        <label class="text-sm" for="min-price"
          >Min price
          <input id="min-price" type="number" min="0" class="input-field mt-1 w-full" bind:value={minPrice} />
        </label>
        <label class="text-sm" for="max-price"
          >Max price
          <input id="max-price" type="number" min="0" class="input-field mt-1 w-full" bind:value={maxPrice} />
        </label>
      </div>
    {:else}
      <label class="text-sm" for="min-rating"
        >Min rating
        <input id="min-rating" type="number" min="1" max="5" step="0.1" class="input-field mt-1 w-full" bind:value={minRating} />
      </label>
      <label class="text-sm" for="min-fulfil"
        >Min fulfilment %
        <input id="min-fulfil" type="number" min="0" max="100" class="input-field mt-1 w-full" bind:value={minFulfilment} />
      </label>
      <label class="text-sm" for="min-ontime"
        >Min on-time %
        <input id="min-ontime" type="number" min="0" max="100" class="input-field mt-1 w-full" bind:value={minOnTime} />
      </label>
      <label class="text-sm" for="sort-by"
        >Sort
        <select id="sort-by" class="input-field mt-1 w-full" bind:value={sortBy} onchange={load}>
          <option value="name">Name</option>
          <option value="rating">Rating</option>
          <option value="fulfilment">Fulfilment</option>
          <option value="onTime">On-time</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-sm mt-6">
        <input type="checkbox" bind:checked={verifiedReviewsOnly} onchange={load} />
        Verified reviews only
      </label>
    {/if}
  </div>
  <div class="flex flex-wrap gap-2">
    <Button variant="outline" onclick={load}>{$t('search')}</Button>
    {#if mode === 'suppliers'}
      <Button variant="primary" onclick={runCompare} disabled={compareIds.length < 2}>
        {$t('compareSuppliers')} ({compareIds.length}/5)
      </Button>
    {/if}
  </div>

  {#if error}
    <Alert type="error" role="alert" message={error} />
  {/if}
  {#if compareMsg}
    <Alert type="error" role="alert" message={compareMsg} />
  {/if}
  {#if compareResult}
    <section class="space-y-3 rounded-lg border border-border p-4">
      <h2 class="text-lg font-semibold">{$t('compareSuppliers')}</h2>
      <p class="text-xs text-muted">{compareResult.note}</p>
      <div class="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {#each compareResult.items || [] as item}
          <article class="rounded-lg border border-border p-3 space-y-1 text-sm">
            <p class="font-semibold">
              {item.businessName}
              {#if item.verified}<span class="text-xs text-accent"> · {$t('verified')}</span>{/if}
            </p>
            <p class="text-xs text-muted">{item.city} · {(item.deliveryCities || []).join(', ')}</p>
            <p>{$t('genuineRating')}: {item.reviewSummary?.label}</p>
            <p>
              {$t('fulfilmentRate')}: {item.fulfilmentPerformance?.label}
              (n={item.fulfilmentPerformance?.sampleCount})
            </p>
            <p>
              {$t('onTimeDelivery')}: {item.onTimeDeliveryPerformance?.label}
              (n={item.onTimeDeliveryPerformance?.sampleCount})
            </p>
            <p>
              {$t('historicalPurchasing')}: PKR {item.historicalPurchasingRelationship?.purchasingValue}
              · {item.historicalPurchasingRelationship?.poCount} POs
            </p>
            <p class="text-xs font-medium mt-2">{$t('productPriceComparison')}</p>
            <ul class="text-xs space-y-0.5">
              {#each (item.productAvailability || []).slice(0, 5) as p}
                <li>{p.name} — {p.currency} {p.unitPrice} · {p.stockStatus}</li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if loading}
    <p class="text-muted" aria-live="polite">{$t('loading')}</p>
  {:else if mode === 'products'}
    {#if !products.length}
      <p class="text-muted">No products found for this city and filters.</p>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {#each products as product}
          <article
            class="rounded-lg border border-border p-4 {product.unavailable || product.discontinued
              ? 'opacity-75'
              : ''}"
          >
            <div class="flex items-start justify-between gap-2">
              <h2 class="font-semibold">{product.name}</h2>
              <span class={`text-xs capitalize ${statusClass(product.stockStatus)}`}>
                {product.stockStatus.replaceAll('_', ' ')}
              </span>
            </div>
            <p class="mt-1 text-xs text-muted">
              {product.sku || 'No SKU'}
              {#if product.manufacturerPartNumber} · MPN {product.manufacturerPartNumber}{/if}
            </p>
            <p class="mt-2 text-sm">{partCategoryLabel(product.category)} · {product.brand || '—'}</p>
            <p class="mt-1 text-sm font-medium">{product.currency} {product.unitPrice}</p>
            <p class="mt-2 text-xs text-muted">
              MOQ {product.minOrderQuantity} · Lead {product.leadTimeDays}d
            </p>
            <p class="mt-2 text-sm">
              <a class="text-accent underline" href={`/app/admin/suppliers/${product.supplier.publicId}`}>
                {product.supplier.businessName}
              </a>
              {#if product.supplier.verified}<span class="text-xs text-accent"> · {$t('verified')}</span>{/if}
            </p>
            <p class="text-xs text-muted">{$t('deliveryCoverage')}: {(product.supplier.deliveryCities || []).join(', ')}</p>
            {#if product.discontinued}
              <p class="mt-2 text-xs font-medium text-danger" role="status">Discontinued</p>
            {:else if product.unavailable}
              <p class="mt-2 text-xs font-medium text-danger" role="status">Currently unavailable</p>
            {/if}
            <div class="mt-3">
              <Button size="sm" variant="outline" href={`/app/admin/suppliers/${product.supplier.publicId}`}>
                {$t('viewProfile')}
              </Button>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  {:else if !suppliers.length}
    <p class="text-muted">{$t('noSuppliersFound')}</p>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {#each suppliers as card}
        <article class="rounded-lg border border-border p-4">
          <div class="flex items-start gap-3">
            {#if card.logoUrl}
              <img src={card.logoUrl} alt="" class="h-12 w-12 rounded object-cover" />
            {:else}
              <div class="flex h-12 w-12 items-center justify-center rounded bg-surface-elevated text-sm font-semibold">
                {card.businessName.slice(0, 1)}
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <h2 class="truncate font-semibold">{card.businessName}</h2>
              <p class="text-xs text-muted">{card.city}</p>
              {#if card.verified}<p class="text-xs text-accent">{$t('verified')} supplier</p>{/if}
            </div>
          </div>
          <p class="mt-3 text-xs text-muted">{$t('partCategories')}</p>
          <p class="text-sm">{(card.partCategories || []).map(partCategoryLabel).join(', ') || '—'}</p>
          <p class="mt-2 text-xs text-muted">{$t('supportedBrands')}</p>
          <p class="text-sm">{(card.supportedBrands || []).join(', ') || '—'}</p>
          <p class="mt-2 text-xs text-muted">{$t('deliveryCoverage')}</p>
          <p class="text-sm">{(card.deliveryCities || []).join(', ') || '—'}</p>
          <p class="mt-2 text-sm">
            {$t('genuineRating')}: {card.reviewSummary?.label ||
              (card.genuineRating
                ? `${card.genuineRating.average}★ · ${card.genuineRating.count}`
                : $t('notEnoughData'))}
          </p>
          <p class="text-xs text-muted">
            {$t('fulfilmentRate')}: {card.fulfilmentPerformance?.label || $t('notEnoughData')}
            (n={card.fulfilmentPerformance?.sampleCount ?? 0})
          </p>
          <p class="text-xs text-muted">
            {$t('onTimeDelivery')}: {card.onTimeDeliveryPerformance?.label || $t('notEnoughData')}
            (n={card.onTimeDeliveryPerformance?.sampleCount ?? 0})
          </p>
          <label class="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={compareIds.includes(card.publicId || card.id)}
              onchange={() => toggleCompare(card.publicId || card.id)}
            />
            {$t('compareSuppliers')}
          </label>
          <div class="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" href={`/app/admin/suppliers/${card.publicId || card.id}`}>
              {$t('viewProfile')}
            </Button>
            <Button size="sm" variant="outline" href={`/app/admin/suppliers/${card.publicId || card.id}`}>
              {$t('contactSupplier')}
            </Button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
