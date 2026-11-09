import { writable } from 'svelte/store';
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
  accent: 'indigo',
  density: 'comfortable',
  fontScale: 'standard',
  reducedMotion: false,
  highContrast: false,
  sidebarCollapsed: false,
  chartStyle: 'bar'
};

export const preferences = writable<UserPreferences>({ ...defaultPreferences });

const accentVars: Record<Accent, { accent: string; hover: string; soft: string; focus: string }> = {
  indigo: { accent: '#3730a3', hover: '#312e81', soft: '#eef2ff', focus: '#4f46e5' },
  blue: { accent: '#1d4ed8', hover: '#1e40af', soft: '#eff6ff', focus: '#2563eb' },
  teal: { accent: '#0f766e', hover: '#115e59', soft: '#f0fdfa', focus: '#0d9488' },
  violet: { accent: '#6d28d9', hover: '#5b21b6', soft: '#f5f3ff', focus: '#7c3aed' },
  emerald: { accent: '#047857', hover: '#065f46', soft: '#ecfdf5', focus: '#059669' }
};

function resolveTheme(theme: ThemePref): 'light' | 'dark' {
  if (theme === 'system') {
    if (!browser) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function applyPreferences(prefs: Partial<UserPreferences>) {
  const next = { ...defaultPreferences, ...prefs } as UserPreferences;
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
  root.style.setProperty('--color-focus', vars.focus);

  localStorage.setItem('rc_prefs', JSON.stringify(next));
  localStorage.setItem('rc_theme', mode);
}

export function clearPreferencesCache() {
  preferences.set({ ...defaultPreferences });
  if (browser) {
    localStorage.removeItem('rc_prefs');
    localStorage.removeItem('rc_theme');
  }
}
