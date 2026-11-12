import type { Role } from '$lib/stores/auth';
import type { ShortcutContext, ShortcutDefinition } from './types';
import { semanticNavByRole } from '$lib/navigation/portalNav';

function navAvailable(slot: keyof (typeof semanticNavByRole)[Role]) {
  return (ctx: ShortcutContext) => {
    if (!ctx.role || ctx.pendingOnboarding) return false;
    return Boolean(semanticNavByRole[ctx.role]?.[slot]);
  };
}

function goSemantic(slot: keyof (typeof semanticNavByRole)[Role]) {
  return (ctx: ShortcutContext) => {
    if (!ctx.role) return;
    const href = semanticNavByRole[ctx.role]?.[slot];
    if (href) void ctx.navigate(href);
  };
}

/** Built-in global + portal shortcuts. Components may register additional ephemeral shortcuts. */
export const builtinShortcuts: ShortcutDefinition[] = [
  {
    id: 'open-command-palette',
    chord: { key: 'k', ctrl: true },
    display: 'Ctrl + K',
    title: 'Command palette',
    description: 'Search pages, records, and actions',
    category: 'global',
    typing: 'allow',
    run: (ctx) => ctx.openCommandPalette()
  },
  {
    id: 'open-shortcuts-help',
    chord: { key: '/', ctrl: true },
    display: 'Ctrl + /',
    title: 'Keyboard shortcuts',
    description: 'Open the shortcuts guide',
    category: 'global',
    typing: 'allow',
    run: (ctx) => ctx.openShortcutsHelp()
  },
  {
    id: 'nav-dashboard',
    chord: { key: '1', alt: true },
    display: 'Alt + 1',
    title: 'Dashboard',
    description: 'Go to your portal dashboard',
    category: 'navigation',
    available: navAvailable('dashboard'),
    run: goSemantic('dashboard')
  },
  {
    id: 'nav-dashboard-0',
    chord: { key: '0', alt: true },
    display: 'Alt + 0',
    title: 'Dashboard',
    description: 'Go to your portal dashboard',
    category: 'navigation',
    available: navAvailable('dashboard'),
    run: goSemantic('dashboard')
  },
  {
    id: 'nav-repairs',
    chord: { key: '2', alt: true },
    display: 'Alt + 2',
    title: 'Repairs / Jobs',
    description: 'Open repairs, jobs, or equivalent queue',
    category: 'navigation',
    available: navAvailable('repairs'),
    run: goSemantic('repairs')
  },
  {
    id: 'nav-appointments',
    chord: { key: '3', alt: true },
    display: 'Alt + 3',
    title: 'Appointments',
    description: 'Open appointments (when available for your role)',
    category: 'navigation',
    available: navAvailable('appointments'),
    run: goSemantic('appointments')
  },
  {
    id: 'nav-inventory',
    chord: { key: '4', alt: true },
    display: 'Alt + 4',
    title: 'Inventory',
    description: 'Open inventory or catalog when authorized',
    category: 'navigation',
    available: navAvailable('inventory'),
    run: goSemantic('inventory')
  },
  {
    id: 'nav-reports',
    chord: { key: '5', alt: true },
    display: 'Alt + 5',
    title: 'Reports',
    description: 'Open reports when authorized',
    category: 'navigation',
    available: navAvailable('reports'),
    run: goSemantic('reports')
  },
  {
    id: 'close-overlay',
    chord: { key: 'Escape' },
    display: 'Esc',
    title: 'Close overlay',
    description: 'Close the topmost dialog, palette, or menu',
    category: 'overlays',
    typing: 'allow',
    run: (ctx) => {
      ctx.closeTopOverlay();
    }
  },
  {
    id: 'submit-form',
    chord: { key: 'Enter', ctrl: true },
    display: 'Ctrl + Enter',
    title: 'Submit form',
    description: 'Submit the active supported form',
    category: 'forms',
    typing: 'forms-only',
    run: (ctx) => {
      ctx.submitActiveForm();
    }
  },
  {
    id: 'save-form',
    chord: { key: 's', ctrl: true },
    display: 'Ctrl + S',
    title: 'Save form',
    description: 'Save the active supported form',
    category: 'forms',
    typing: 'forms-only',
    run: (ctx) => {
      ctx.saveActiveForm();
    }
  },
  {
    id: 'focus-page-search',
    chord: { key: '/' },
    display: '/',
    title: 'Focus search',
    description: 'Focus the page or table search field when safe',
    category: 'global',
    typing: 'block',
    run: (ctx) => {
      ctx.focusPageSearch();
    }
  }
];

export class ShortcutRegistry {
  private map = new Map<string, ShortcutDefinition>();

  constructor(seed: ShortcutDefinition[] = builtinShortcuts) {
    for (const s of seed) this.register(s);
  }

  register(def: ShortcutDefinition) {
    this.map.set(def.id, def);
  }

  unregister(id: string) {
    this.map.delete(id);
  }

  get(id: string) {
    return this.map.get(id);
  }

  list(): ShortcutDefinition[] {
    return [...this.map.values()];
  }

  listForRole(role: Role | null): ShortcutDefinition[] {
    return this.list().filter((s) => {
      if (!s.roles || s.roles === 'all') return true;
      if (!role) return false;
      return s.roles.includes(role);
    });
  }
}

export const shortcutRegistry = new ShortcutRegistry();
