<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { preferences } from '$lib/stores/preferences';
  import AnalyticsChart from './AnalyticsChart.svelte';
  import Skeleton from './Skeleton.svelte';
  import Alert from './Alert.svelte';
  import Button from './Button.svelte';
  import DateRangeFilter, { type RangeKey } from './DateRangeFilter.svelte';

  let {
    chartStyle = undefined as 'bar' | 'line' | 'donut' | undefined,
    hideRange = false,
    externalRange = undefined as RangeKey | undefined,
    externalFrom = '',
    externalTo = '',
    providedData = undefined as any,
    onData = undefined as ((data: any) => void) | undefined,
    compact = false
  }: {
    chartStyle?: 'bar' | 'line' | 'donut';
    hideRange?: boolean;
    externalRange?: RangeKey;
    externalFrom?: string;
    externalTo?: string;
    providedData?: any;
    onData?: (data: any) => void;
    compact?: boolean;
  } = $props();

  let range = $state<RangeKey>('30d');
  let from = $state('');
  let to = $state('');
  let loading = $state(true);
  let error = $state('');
  let data = $state<any>(null);

  const effectiveStyle = $derived(chartStyle || $preferences.chartStyle || 'bar');
  const useProvided = $derived(providedData !== undefined);

  function queryString() {
    const r = externalRange ?? range;
    const f = externalRange != null ? externalFrom : from;
    const tVal = externalRange != null ? externalTo : to;
    if (r === 'custom' && f && tVal) {
      return `range=custom&from=${encodeURIComponent(f)}&to=${encodeURIComponent(tVal)}`;
    }
    return `range=${r === 'custom' ? '30d' : r}`;
  }

  async function load() {
    if (useProvided) return;
    loading = true;
    error = '';
    try {
      data = await api(`/api/v1/analytics/me?${queryString()}`);
      onData?.(data);
    } catch (err) {
      error = err instanceof ApiError ? err.message : $t('errorGeneric');
      data = null;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (!useProvided) void load();
    else {
      data = providedData;
      loading = false;
    }
  });

  $effect(() => {
    if (providedData !== undefined) {
      data = providedData;
      loading = false;
      return;
    }
    void externalRange;
    void externalFrom;
    void externalTo;
    if (externalRange) void load();
  });

  function chartTypeFor(key: string): 'bar' | 'line' | 'donut' {
    const k = key.toLowerCase();
    if (k.includes('status') || k.includes('stock')) return 'donut';
    if (k.includes('time') || k.includes('revenue') || k.includes('history') || k.includes('consumption')) {
      return 'line';
    }
    return effectiveStyle;
  }

  function titleFor(key: string) {
    const map: Record<string, string> = {
      statusDistribution: $t('repairStatus'),
      volumeOverTime: $t('repairVolume'),
      revenueOverTime: $t('recordedRevenue'),
      mechanicWorkload: $t('mechanicWorkload'),
      inventoryConsumption: $t('inventoryConsumption'),
      historyOverTime: $t('repairHistory'),
      workloadOverTime: $t('workload'),
      laborHours: $t('laborHours'),
      stockAvailability: $t('stockAvailability'),
      lowStock: $t('lowStock'),
      movements: $t('stockMovements'),
      topRequested: $t('topRequested'),
      monthlyCompletedRepairValue: $t('completedRepairValue'),
      monthlyActualSpending: $t('actualSpending')
    };
    return (
      map[key] ||
      key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
    );
  }

  const businessOverview = $derived.by(() => {
    if (!data?.businessOverview?.length) return null;
    return {
      repairs: data.businessOverview.map((r: any) => ({ label: r.label, value: r.repairs })),
      revenue: data.businessOverview.map((r: any) => ({ label: r.label, value: r.revenue }))
    };
  });

  const chartEntries = $derived.by(() => {
    if (!data?.charts) return [];
    const skip = new Set<string>();
    if (businessOverview) {
      skip.add('volumeOverTime');
      skip.add('revenueOverTime');
      skip.add('statusDistribution');
    }
    return Object.entries(data.charts)
      .filter(([key]) => !skip.has(key))
      .map(([key, points]) => ({
        key,
        title: titleFor(key),
        type: chartTypeFor(key),
        points: Array.isArray(points) ? (points as { label: string; value: number }[]) : []
      }));
  });

  const statusTotal = $derived(
    (data?.charts?.statusDistribution || []).reduce(
      (s: number, p: { value: number }) => s + (Number(p.value) || 0),
      0
    )
  );
</script>

<section class="space-y-4" aria-label={$t('analytics')}>
  {#if !hideRange}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <DateRangeFilter bind:value={range} bind:from bind:to onchange={load} />
      <Button variant="secondary" size="sm" type="button" onclick={load}>{$t('refresh')}</Button>
    </div>
  {/if}

  {#if loading}
    <div class="grid gap-4 lg:grid-cols-3" aria-busy="true">
      <Skeleton class="h-64 lg:col-span-2" />
      <Skeleton class="h-64" />
    </div>
  {:else if error}
    <Alert type="error" role="alert" message={error} />
  {:else if data}
    {#if data.summary?.completedRepairValue != null || data.summary?.actualCustomerSpending != null}
      <div class="grid gap-3 sm:grid-cols-3" data-testid="customer-financial-summary">
        <div class="surface-card p-3">
          <p class="text-xs text-muted">{$t('completedRepairValue')}</p>
          <p class="text-lg font-semibold tabular-nums" data-testid="completed-repair-value">
            {data.summary.completedRepairValue ?? 0}
          </p>
        </div>
        <div class="surface-card p-3">
          <p class="text-xs text-muted">{$t('actualSpending')}</p>
          <p class="text-lg font-semibold tabular-nums" data-testid="actual-customer-spending">
            {data.summary.actualCustomerSpending ?? 0}
          </p>
        </div>
        <div class="surface-card p-3">
          <p class="text-xs text-muted">{$t('outstandingBalance')}</p>
          <p class="text-lg font-semibold tabular-nums" data-testid="outstanding-balance">
            {data.summary.outstandingBalance ?? 0}
          </p>
        </div>
      </div>
    {/if}

    <div class={`grid gap-4 ${compact ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
      {#if businessOverview}
        <div class="surface-card p-4 lg:col-span-2">
          <AnalyticsChart
            title={$t('businessOverview')}
            type="line"
            heightClass="h-64"
            series={[
              { label: $t('repairs'), points: businessOverview.repairs },
              { label: $t('recordedRevenue'), points: businessOverview.revenue }
            ]}
          />
        </div>
        {#if data.charts?.statusDistribution}
          <div class="surface-card p-4">
            <AnalyticsChart
              title={$t('repairStatus')}
              type="donut"
              heightClass="h-64"
              points={data.charts.statusDistribution}
              centerLabel={$t('total')}
            />
            <p class="sr-only">{$t('total')}: {statusTotal}</p>
          </div>
        {/if}
      {/if}

      {#each chartEntries as chart}
        <div
          class={`surface-card p-4 ${
            chart.type === 'donut' && !businessOverview ? '' : chart.key.includes('Workload') || chart.key.includes('Consumption') ? '' : ''
          }`}
        >
          <AnalyticsChart
            title={chart.title}
            type={chart.type}
            points={chart.points}
            centerLabel={chart.type === 'donut' ? $t('total') : ''}
            heightClass={compact ? 'h-48' : 'h-56'}
          />
        </div>
      {/each}
    </div>
  {/if}
</section>
