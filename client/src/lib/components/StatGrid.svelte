<script lang="ts">
  import Icon from './Icon.svelte';

  export type KpiStat = {
    label: string;
    value: string | number;
    hint?: string;
    icon?: string;
    tone?: 'indigo' | 'green' | 'amber' | 'violet' | 'blue' | 'red';
    trend?: number | null;
    sparkline?: number[];
  };

  let { stats = [] }: { stats: KpiStat[] } = $props();

  const toneClass: Record<string, string> = {
    indigo: 'kpi-icon kpi-icon-indigo',
    green: 'kpi-icon kpi-icon-green',
    amber: 'kpi-icon kpi-icon-amber',
    violet: 'kpi-icon kpi-icon-violet',
    blue: 'kpi-icon kpi-icon-blue',
    red: 'kpi-icon kpi-icon-red'
  };

  function sparkPoints(values: number[]): string {
    if (!values.length) return '';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = Math.max(max - min, 1);
    return values
      .map((v, i) => {
        const x = values.length === 1 ? 0 : (i / (values.length - 1)) * 64;
        const y = 20 - ((v - min) / span) * 18;
        return `${x},${y}`;
      })
      .join(' ');
  }

  function formatTrend(trend: number | null | undefined) {
    if (trend == null || Number.isNaN(trend)) return null;
    const sign = trend > 0 ? '+' : '';
    return `${sign}${trend}%`;
  }
</script>

<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="list">
  {#each stats as stat}
    {@const trendLabel = formatTrend(stat.trend)}
    <div
      class="surface-card surface-card-interactive kpi-card p-4"
      role="listitem"
      aria-label={`${stat.label}: ${stat.value}${trendLabel ? `, ${trendLabel}` : ''}`}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm text-muted">{stat.label}</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink">{stat.value}</p>
        </div>
        {#if stat.icon}
          <span class={toneClass[stat.tone || 'indigo']}>
            <Icon name={stat.icon} size={18} />
          </span>
        {/if}
      </div>
      <div class="mt-3 flex items-end justify-between gap-2">
        <div class="min-w-0">
          {#if trendLabel}
            <p
              class={`inline-flex items-center gap-1 text-xs font-semibold ${
                (stat.trend ?? 0) >= 0 ? 'text-success' : 'text-danger'
              }`}
            >
              <Icon name={(stat.trend ?? 0) >= 0 ? 'trendingUp' : 'trendingDown'} size={12} />
              <span>{trendLabel}</span>
              <span class="font-normal text-muted">vs prior</span>
            </p>
          {:else if stat.hint}
            <p class="text-xs text-muted">{stat.hint}</p>
          {:else}
            <p class="text-xs text-muted">—</p>
          {/if}
        </div>
        {#if stat.sparkline?.length}
          <svg
            class="h-5 w-16 shrink-0 opacity-80"
            viewBox="0 0 64 22"
            aria-hidden="true"
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              class={
                stat.tone === 'green'
                  ? 'text-success'
                  : stat.tone === 'amber'
                    ? 'text-warning'
                    : stat.tone === 'violet'
                      ? 'text-violet-500'
                      : 'text-accent'
              }
              points={sparkPoints(stat.sparkline)}
            />
          </svg>
        {/if}
      </div>
    </div>
  {/each}
</div>
