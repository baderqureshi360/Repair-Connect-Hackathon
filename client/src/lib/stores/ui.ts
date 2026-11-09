import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export const theme = writable<'light' | 'dark'>(
  browser ? (localStorage.getItem('rc_theme') as 'light' | 'dark') || 'light' : 'light'
);

theme.subscribe((value) => {
  if (!browser) return;
  // Preferences store owns theme when set to system; keep class in sync for light/dark toggles.
  if (document.documentElement.dataset.themeSource === 'preferences-system') return;
  document.documentElement.classList.toggle('dark', value === 'dark');
  localStorage.setItem('rc_theme', value);
});

export const online = writable(browser ? navigator.onLine : true);
export const announce = writable('');

if (browser) {
  window.addEventListener('online', () => online.set(true));
  window.addEventListener('offline', () => online.set(false));
}
