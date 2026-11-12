<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import {
    chartGridColor,
    chartLabelColor,
    chartPalette,
    chartTickColor
  } from '$lib/chartColors';

  export type ChartPoint = { label: string; value: number };
  export type ChartSeries = { label: string; points: ChartPoint[]; color?: string };

  let {
    title,
    type = 'bar',
    points = [],
    series = [],
    empty = 'No data for this range',
    centerLabel = '',
    heightClass = 'h-56'
  }: {
    title: string;
    type?: 'bar' | 'line' | 'donut';
    points?: ChartPoint[];
    series?: ChartSeries[];
    empty?: string;
    centerLabel?: string;
    heightClass?: string;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let chart: { destroy: () => void } | undefined;
  let renderGen = 0;

  function resolvedSeries(): ChartSeries[] {
    if (series.length) return series;
    if (points.length) return [{ label: title, points }];
    return [];
  }

  function tableRows() {
    const s = resolvedSeries();
    if (!s.length) return [] as { label: string; values: number[] }[];
    const labels = s[0].points.map((p) => p.label);
    return labels.map((label, i) => ({
      label,
      values: s.map((ser) => Number(ser.points[i]?.value) || 0)
    }));
  }

  async function render() {
    if (!browser || !canvas) return;
    const gen = ++renderGen;
    if (chart) {
      chart.destroy();
      chart = undefined;
    }
    const dataSeries = resolvedSeries();
    if (!dataSeries.length || !dataSeries.some((s) => s.points.length)) return;

    const {
      Chart,
      BarController,
      LineController,
      DoughnutController,
      BarElement,
      LineElement,
      PointElement,
      ArcElement,
      CategoryScale,
      LinearScale,
      Tooltip,
      Legend,
      Filler
    } = await import('chart.js');

    Chart.register(
      BarController,
      LineController,
      DoughnutController,
      BarElement,
      LineElement,
      PointElement,
      ArcElement,
      CategoryScale,
      LinearScale,
      Tooltip,
      Legend,
      Filler
    );

    if (gen !== renderGen || !canvas) return;

    const palette = chartPalette();
    const tick = chartTickColor();
    const labelColor = chartLabelColor();
    const grid = chartGridColor();
    const chartFont =
      getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() ||
      'Helvetica Neue, Helvetica, Arial, sans-serif';

    if (type === 'donut') {
      const pts = dataSeries[0].points;
      const total = pts.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
      chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: pts.map((p) => String(p.label).replaceAll('_', ' ')),
          datasets: [
            {
              data: pts.map((p) => Number(p.value) || 0),
              backgroundColor: palette,
              borderWidth: 0,
              hoverOffset: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: tick, boxWidth: 10, usePointStyle: true, pointStyle: 'circle' }
            },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const val = Number(ctx.raw) || 0;
                  const pct = total ? Math.round((val / total) * 100) : 0;
                  return ` ${ctx.label}: ${val} (${pct}%)`;
                }
              }
            }
          }
        },
        plugins: centerLabel
          ? [
              {
                id: 'centerText',
                afterDraw(c) {
                  const { ctx, chartArea } = c;
                  if (!chartArea) return;
                  const x = (chartArea.left + chartArea.right) / 2;
                  const y = (chartArea.top + chartArea.bottom) / 2;
                  ctx.save();
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle = labelColor;
                  ctx.font = `700 18px ${chartFont}`;
                  ctx.fillText(String(total), x, y - 8);
                  ctx.fillStyle = tick;
                  ctx.font = `500 11px ${chartFont}`;
                  ctx.fillText(centerLabel, x, y + 12);
                  ctx.restore();
                }
              }
            ]
          : undefined
      });
      if (gen !== renderGen) {
        chart.destroy();
        chart = undefined;
      }
      return;
    }

    if (gen !== renderGen || !canvas) return;
    const labels = dataSeries[0].points.map((p) => String(p.label));
    chart = new Chart(canvas, {
      type,
      data: {
        labels,
        datasets: dataSeries.map((ser, idx) => {
          const color = ser.color || palette[idx % palette.length];
          return {
            label: ser.label,
            data: ser.points.map((p) => Number(p.value) || 0),
            borderColor: color,
            backgroundColor: type === 'line' ? hexToRgba(color, 0.12) : hexToRgba(color, 0.55),
            borderWidth: type === 'line' ? 2.25 : 0,
            tension: 0.35,
            fill: type === 'line',
            pointRadius: type === 'line' ? 2.5 : 0,
            pointHoverRadius: 4,
            yAxisID: idx === 1 && dataSeries.length > 1 ? 'y1' : 'y'
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: dataSeries.length > 1,
            labels: { color: tick, usePointStyle: true, boxWidth: 8 }
          },
          tooltip: { enabled: true }
        },
        scales: {
          x: {
            ticks: { color: tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: tick },
            grid: { color: grid }
          },
          ...(dataSeries.length > 1
            ? {
                y1: {
                  beginAtZero: true,
                  position: 'right' as const,
                  ticks: { color: tick },
                  grid: { drawOnChartArea: false }
                }
              }
            : {})
        }
      }
    });
    if (gen !== renderGen) {
      chart.destroy();
      chart = undefined;
    }
  }

  function hexToRgba(hex: string, alpha: number) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  onMount(() => {
    void render();
  });

  $effect(() => {
    void points;
    void series;
    void type;
    void title;
    void centerLabel;
    if (browser) void render();
  });

  onDestroy(() => chart?.destroy());

  const rows = $derived(tableRows());
  const seriesLabels = $derived(resolvedSeries().map((s) => s.label));
  const hasData = $derived(resolvedSeries().some((s) => s.points.length > 0));
</script>

<section class="space-y-3" aria-labelledby={`chart-${title.replace(/\s+/g, '-')}`}>
  <h3 id={`chart-${title.replace(/\s+/g, '-')}`} class="text-sm font-semibold">{title}</h3>
  {#if !hasData}
    <p class="text-sm text-muted" role="status">{empty}</p>
  {:else}
    <div class={`relative w-full ${heightClass}`} aria-hidden="true">
      <canvas bind:this={canvas}></canvas>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <caption class="sr-only">{title} data table</caption>
        <thead>
          <tr class="border-b border-border text-start">
            <th scope="col" class="px-2 py-1 font-medium">Label</th>
            {#each seriesLabels as label}
              <th scope="col" class="px-2 py-1 font-medium">{label}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row}
            <tr class="border-b border-border last:border-0">
              <td class="px-2 py-1">{String(row.label).replaceAll('_', ' ')}</td>
              {#each row.values as value}
                <td class="px-2 py-1 tabular-nums">{value}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
