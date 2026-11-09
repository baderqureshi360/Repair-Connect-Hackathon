import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'rc_selected_shop';

function load(): string {
  if (!browser) return '';
  return localStorage.getItem(KEY) || '';
}

/** Authorized shop currently selected in the app shell (staff only). */
export const selectedShopId = writable<string>(load());

selectedShopId.subscribe((id) => {
  if (!browser) return;
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
});

export function getSelectedShopId(): string {
  return get(selectedShopId);
}

export function shopQuery(extra = ''): string {
  const id = getSelectedShopId();
  const params = new URLSearchParams(extra.startsWith('?') ? extra.slice(1) : extra);
  if (id) params.set('shopId', id);
  const q = params.toString();
  return q ? `?${q}` : '';
}
