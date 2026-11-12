import { navForRole } from '$lib/navigation/portalNav';
import type { Role } from '$lib/stores/auth';
import type { CommandItem } from './types';

export type TranslateFn = (key: string) => string;

export type SearchApiResult = {
  repairs: Array<{ href: string; referenceNumber?: string; brand?: string; model?: string }>;
  customers: Array<{ href: string; name?: string; email?: string }>;
  parts: Array<{ href: string; sku?: string; name?: string }>;
  documents: Array<{ href: string; documentNumber?: string; type?: string }>;
};

/** Role-scoped static command items (navigation + actions). Records come from search API. */
export function buildStaticCommands(opts: {
  role: Role | null;
  pendingOnboarding?: boolean;
  t: TranslateFn;
  openShortcutsHelp: () => void;
  logout?: () => void;
}): CommandItem[] {
  const { role, pendingOnboarding = false, t, openShortcutsHelp, logout } = opts;
  if (!role) return [];

  const nav = navForRole(role, pendingOnboarding).map((item) => ({
    id: `nav:${item.href}`,
    group: 'navigation' as const,
    label: t(item.key),
    description: item.href,
    href: item.href,
    keywords: [item.key, item.href, t(item.key)]
  }));

  const actions: CommandItem[] = [
    {
      id: 'action:shortcuts',
      group: 'actions',
      label: t('keyboardShortcuts'),
      description: t('keyboardShortcutsHint'),
      keywords: ['shortcuts', 'keyboard', 'help', 'Ctrl+/'],
      run: openShortcutsHelp
    },
    {
      id: 'action:appearance',
      group: 'actions',
      label: t('appearance'),
      href: '/app/appearance',
      keywords: ['theme', 'preferences', 'settings']
    },
    {
      id: 'action:profile',
      group: 'actions',
      label: t('profile'),
      href: '/app/profile',
      keywords: ['account', 'profile']
    },
    {
      id: 'action:notifications',
      group: 'actions',
      label: t('notifications'),
      href: '/app/notifications',
      keywords: ['alerts', 'bell']
    }
  ];

  if (logout) {
    actions.push({
      id: 'action:logout',
      group: 'actions',
      label: t('logout'),
      keywords: ['sign out', 'logout'],
      run: logout
    });
  }

  return [...nav, ...actions];
}

export function recordsToCommands(res: SearchApiResult): CommandItem[] {
  const items: CommandItem[] = [];
  for (const r of res.repairs || []) {
    items.push({
      id: `record:repair:${r.href}`,
      group: 'records',
      label: r.referenceNumber || 'Repair',
      description: [r.brand, r.model].filter(Boolean).join(' '),
      href: r.href,
      keywords: [r.referenceNumber || '', r.brand || '', r.model || '']
    });
  }
  for (const c of res.customers || []) {
    items.push({
      id: `record:customer:${c.href}`,
      group: 'records',
      label: c.name || 'Customer',
      description: c.email,
      href: c.href,
      keywords: [c.name || '', c.email || '']
    });
  }
  for (const p of res.parts || []) {
    items.push({
      id: `record:part:${p.href}`,
      group: 'records',
      label: p.sku || p.name || 'Part',
      description: p.name,
      href: p.href,
      keywords: [p.sku || '', p.name || '']
    });
  }
  for (const d of res.documents || []) {
    items.push({
      id: `record:doc:${d.href}`,
      group: 'records',
      label: d.documentNumber || 'Document',
      description: d.type,
      href: d.href,
      keywords: [d.documentNumber || '', d.type || '']
    });
  }
  return items;
}

export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = [item.label, item.description || '', ...(item.keywords || [])]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function groupCommands(items: CommandItem[]): Record<'navigation' | 'records' | 'actions', CommandItem[]> {
  return {
    navigation: items.filter((i) => i.group === 'navigation'),
    records: items.filter((i) => i.group === 'records'),
    actions: items.filter((i) => i.group === 'actions')
  };
}
