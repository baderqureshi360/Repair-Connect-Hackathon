import { describe, expect, it } from 'vitest';
import { chordMatches, isReservedBrowserShortcut, isTypingTarget } from './dom';
import { ShortcutRegistry, builtinShortcuts } from './registry';
import { filterCommands, buildStaticCommands, recordsToCommands } from './commands';
import { semanticNavByRole } from '../navigation/portalNav';
import type { Role } from '$lib/stores/auth';

function keyEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: partial.key,
    ctrlKey: Boolean(partial.ctrlKey),
    metaKey: Boolean(partial.metaKey),
    altKey: Boolean(partial.altKey),
    shiftKey: Boolean(partial.shiftKey),
    preventDefault() {},
    stopPropagation() {},
    defaultPrevented: false,
    target: partial.target ?? null
  } as unknown as KeyboardEvent;
}

describe('keyboard chord matching', () => {
  it('matches Ctrl+K and Meta+K', () => {
    expect(chordMatches(keyEvent({ key: 'k', ctrlKey: true }), { key: 'k', ctrl: true })).toBe(true);
    expect(chordMatches(keyEvent({ key: 'k', metaKey: true }), { key: 'k', ctrl: true })).toBe(true);
    expect(chordMatches(keyEvent({ key: 'k' }), { key: 'k', ctrl: true })).toBe(false);
  });

  it('matches Alt+1 navigation chords', () => {
    expect(chordMatches(keyEvent({ key: '1', altKey: true }), { key: '1', alt: true })).toBe(true);
    expect(chordMatches(keyEvent({ key: '1', ctrlKey: true, altKey: true }), { key: '1', alt: true })).toBe(
      false
    );
  });

  it('does not intercept reserved browser shortcuts', () => {
    expect(isReservedBrowserShortcut(keyEvent({ key: 'l', ctrlKey: true }))).toBe(true);
    expect(isReservedBrowserShortcut(keyEvent({ key: 'w', metaKey: true }))).toBe(true);
    expect(isReservedBrowserShortcut(keyEvent({ key: 't', ctrlKey: true }))).toBe(true);
    expect(isReservedBrowserShortcut(keyEvent({ key: 'r', ctrlKey: true }))).toBe(true);
    expect(isReservedBrowserShortcut(keyEvent({ key: 'k', ctrlKey: true }))).toBe(false);
  });
});

describe('typing target detection', () => {
  it('returns false for non-elements', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('shortcut registry', () => {
  it('registers every proposed global shortcut id', () => {
    const ids = builtinShortcuts.map((s) => s.id);
    for (const id of [
      'open-command-palette',
      'open-shortcuts-help',
      'nav-dashboard',
      'nav-dashboard-0',
      'nav-repairs',
      'nav-appointments',
      'nav-inventory',
      'nav-reports',
      'close-overlay',
      'submit-form',
      'save-form',
      'focus-page-search'
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('filters role availability for inventory/reports semantics', () => {
    const registry = new ShortcutRegistry();
    const inventory = registry.get('nav-inventory')!;
    const appointments = registry.get('nav-appointments')!;

    const mechanicCtx = {
      role: 'mechanic' as Role,
      pathname: '/app/mechanic',
      pendingOnboarding: false,
      navigate: () => undefined,
      openCommandPalette: () => undefined,
      openShortcutsHelp: () => undefined,
      closeTopOverlay: () => false,
      focusPageSearch: () => false,
      submitActiveForm: () => false,
      saveActiveForm: () => false
    };

    expect(inventory.available?.(mechanicCtx)).toBe(false);
    expect(appointments.available?.(mechanicCtx)).toBe(false);

    const adminCtx = { ...mechanicCtx, role: 'shop_admin' as Role, pathname: '/app/admin' };
    expect(inventory.available?.(adminCtx)).toBe(true);
    expect(appointments.available?.(adminCtx)).toBe(true);
  });
});

describe('portal semantic navigation', () => {
  const roles: Role[] = [
    'customer',
    'mechanic',
    'parts_coordinator',
    'shop_admin',
    'supplier',
    'platform_operator'
  ];

  it('defines a dashboard destination for every role', () => {
    for (const role of roles) {
      expect(semanticNavByRole[role].dashboard).toBeTruthy();
    }
  });
});

describe('command palette helpers', () => {
  it('builds only role-scoped navigation and filters by query', () => {
    const items = buildStaticCommands({
      role: 'customer',
      t: (k) => k,
      openShortcutsHelp: () => undefined
    });
    expect(items.some((i) => i.href === '/app/customer/repairs')).toBe(true);
    expect(items.some((i) => i.href === '/app/admin')).toBe(false);
    expect(filterCommands(items, 'repairs').every((i) => /repair|myRepairs/i.test(JSON.stringify(i)))).toBe(
      true
    );
  });

  it('maps authorized search records into command items', () => {
    const cmds = recordsToCommands({
      repairs: [{ href: '/app/repairs/1', referenceNumber: 'RC-1', brand: 'Apple', model: 'Phone' }],
      customers: [],
      parts: [],
      documents: []
    });
    expect(cmds).toHaveLength(1);
    expect(cmds[0].group).toBe('records');
    expect(cmds[0].href).toBe('/app/repairs/1');
  });
});
