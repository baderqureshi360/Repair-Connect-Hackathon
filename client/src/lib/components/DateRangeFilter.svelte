<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '$lib/i18n';

  export type RangeKey = '1d' | '7d' | '30d' | '90d' | 'custom';

  let {
    value = $bindable('30d' as RangeKey),
    from = $bindable(''),
    to = $bindable(''),
    onchange
  }: {
    value?: RangeKey;
    from?: string;
    to?: string;
    onchange?: () => void;
  } = $props();

  function emit() {
    onchange?.();
  }
</script>

<div class="flex flex-wrap items-end gap-2">
  <div>
    <label class="sr-only" for="analytics-range">{$t('dateRange')}</label>
    <div class="relative">
      <span class="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-muted">
        <Icon name="calendar" size={15} />
      </span>
      <select
        id="analytics-range"
        class="input-field w-auto pe-3 ps-8 py-2"
        bind:value
        onchange={emit}
      >
        <option value="1d">{$t('rangeToday')}</option>
        <option value="7d">{$t('range7d')}</option>
        <option value="30d">{$t('range30d')}</option>
        <option value="90d">{$t('range90d')}</option>
        <option value="custom">{$t('rangeCustom')}</option>
      </select>
    </div>
  </div>
  {#if value === 'custom'}
    <div>
      <label class="mb-1 block text-xs text-muted" for="dash-from">{$t('from')}</label>
      <input id="dash-from" class="input-field w-auto" type="date" bind:value={from} onchange={emit} />
    </div>
    <div>
      <label class="mb-1 block text-xs text-muted" for="dash-to">{$t('to')}</label>
      <input id="dash-to" class="input-field w-auto" type="date" bind:value={to} onchange={emit} />
    </div>
  {/if}
</div>
