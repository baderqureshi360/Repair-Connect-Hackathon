import { get, writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Accent = 'indigo' | 'blue' | 'teal' | 'violet' | 'emerald';
export type ThemePref = 'light' | 'dark' | 'system';

export interface UserPreferences {
  theme: ThemePref;
  accent: Accent;
  density: 'comfortable' | 'compact';
  fontScale: 'standard' | 'large';
  reducedMotion: boolean;
  highContrast: boolean;
  sidebarCollapsed: boolean;
  dashboardWidgets?: string[];
  chartStyle: 'bar' | 'line' | 'donut';
}

export const defaultPreferences: UserPreferences = {
  theme: 'system',
  /* Product default is indigo; emerald remains an available accent (Porto green). */
  accent: 'indigo',
  density: 'comfortable',
  fontScale: 'standard',
  reducedMotion: false,
  highContrast: false,
  sidebarCollapsed: false,
  chartStyle: 'bar'
};

export const preferences = writable<UserPreferences>({ ...defaultPreferences });

const accentVars: Record<
  Accent,
  { accent: string; hover: string; soft: string; focus: string; foreground: string }
> = {
  indigo: { accent: '#3730a3', hover: '#312e81', soft: '#eef2ff', focus: '#4f46e5', foreground: '#ffffff' },
  blue: { accent: '#1d4ed8', hover: '#1e40af', soft: '#eff6ff', focus: '#2563eb', foreground: '#ffffff' },
  teal: { accent: '#0f766e', hover: '#115e59', soft: '#f0fdfa', focus: '#0d9488', foreground: '#ffffff' },
  violet: { accent: '#6d28d9', hover: '#5b21b6', soft: '#f5f3ff', focus: '#7c3aed', foreground: '#ffffff' },
  /* Porto-inspired green — dark foreground for WCAG AA on primary buttons */
  emerald: {
    accent: '#82b440',
    hover: '#6f9a36',
    soft: '#eef6e3',
    focus: '#5a8a28',
    foreground: '#1a2e05'
  }
};

function resolveTheme(theme: ThemePref): 'light' | 'dark' {
  if (theme === 'system') {
    if (!browser) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function applyPreferences(prefs: Partial<UserPreferences>) {
  /* Merge onto current store so partial /me payloads cannot wipe a saved accent
     (e.g. Porto green / emerald) with the indigo product default. */
  const next = { ...defaultPreferences, ...get(preferences), ...prefs } as UserPreferences;
  preferences.set(next);
  if (!browser) return;

  const mode = resolveTheme(next.theme);
  document.documentElement.dataset.themeSource =
    next.theme === 'system' ? 'preferences-system' : 'preferences';
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.dataset.accent = next.accent;
  document.documentElement.dataset.density = next.density;
  document.documentElement.dataset.fontScale = next.fontScale;
  document.documentElement.classList.toggle('reduce-motion', next.reducedMotion);
  document.documentElement.classList.toggle('high-contrast', next.highContrast);

  const vars = accentVars[next.accent] || accentVars.indigo;
  const root = document.documentElement;
  root.style.setProperty('--color-accent', vars.accent);
  root.style.setProperty('--color-accent-hover', vars.hover);
  root.style.setProperty('--color-accent-soft', vars.soft);
  root.style.setProperty('--color-accent-foreground', vars.foreground);
  root.style.setProperty('--color-focus', vars.focus);
  root.style.setProperty('--color-primary', vars.accent);
  root.style.setProperty('--color-primary-hover', vars.hover);

  localStorage.setItem('rc_prefs', JSON.stringify(next));
  localStorage.setItem('rc_theme', mode);
}

export function clearPreferencesCache() {
  preferences.set({ ...defaultPreferences });
  if (browser) {
    localStorage.removeItem('rc_prefs');
    localStorage.removeItem('rc_theme');
    /* Reset inline accent overrides so CSS theme tokens apply until next hydrate/login */
    const root = document.documentElement;
    for (const prop of [
      '--color-accent',
      '--color-accent-hover',
      '--color-accent-soft',
      '--color-accent-foreground',
      '--color-focus',
      '--color-primary',
      '--color-primary-hover'
    ]) {
      root.style.removeProperty(prop);
    }
    root.classList.remove('dark', 'reduce-motion', 'high-contrast');
    delete root.dataset.accent;
    delete root.dataset.density;
    delete root.dataset.fontScale;
    delete root.dataset.themeSource;
  }
}

/**
 * Apply cached prefs immediately so saved Porto green (emerald) / accents
 * do not flash to the CSS indigo default before /auth/me returns.
 * Server preferences from /me still win when applied afterwards.
 */
export function hydratePreferencesFromCache(): boolean {
  if (!browser) return false;
  try {
    const raw = localStorage.getItem('rc_prefs');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    if (!parsed || typeof parsed !== 'object') return false;
    applyPreferences(parsed);
    return true;
  } catch {
    return false;
  }
}

if (browser) {
  hydratePreferencesFromCache();
}
