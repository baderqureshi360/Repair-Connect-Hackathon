import type { Role } from '$lib/stores/auth';
import {
  chordMatches,
  focusPageSearch,
  isEditableFormField,
  isReservedBrowserShortcut,
  isTypingTarget,
  saveClosestForm,
  submitClosestForm
} from './dom';
import { shortcutRegistry } from './registry';
import type { OverlayHandle, ShortcutContext, ShortcutDefinition } from './types';

export type ManagerOptions = {
  getRole: () => Role | null;
  getPathname: () => string;
  getPendingOnboarding: () => boolean;
  navigate: (href: string) => void | Promise<void>;
  openCommandPalette: () => void;
  openShortcutsHelp: () => void;
};

/**
 * Single window-level keyboard controller for authenticated app shells.
 * Components must not attach competing global keydown listeners for the same chords.
 */
export class ShortcutManager {
  private installed = false;
  private overlays: OverlayHandle[] = [];
  private options: ManagerOptions | null = null;
  private onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

  install(options: ManagerOptions) {
    if (this.installed) {
      this.options = options;
      return;
    }
    this.options = options;
    window.addEventListener('keydown', this.onKeyDown, true);
    this.installed = true;
  }

  uninstall() {
    if (!this.installed) return;
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.installed = false;
    this.options = null;
    this.overlays = [];
  }

  pushOverlay(handle: OverlayHandle) {
    this.overlays = this.overlays.filter((o) => o.id !== handle.id);
    this.overlays.push(handle);
  }

  removeOverlay(id: string) {
    this.overlays = this.overlays.filter((o) => o.id !== id);
  }

  closeTopOverlay(): boolean {
    const top = this.overlays[this.overlays.length - 1];
    if (!top) return false;
    this.overlays.pop();
    top.close();
    return true;
  }

  hasOverlay(): boolean {
    return this.overlays.length > 0;
  }

  context(): ShortcutContext {
    const opts = this.options;
    if (!opts) {
      return {
        role: null,
        pathname: '/',
        pendingOnboarding: false,
        navigate: () => undefined,
        openCommandPalette: () => undefined,
        openShortcutsHelp: () => undefined,
        closeTopOverlay: () => this.closeTopOverlay(),
        focusPageSearch: () => focusPageSearch(),
        submitActiveForm: () => submitClosestForm(document.activeElement),
        saveActiveForm: () => saveClosestForm(document.activeElement)
      };
    }
    return {
      role: opts.getRole(),
      pathname: opts.getPathname(),
      pendingOnboarding: opts.getPendingOnboarding(),
      navigate: opts.navigate,
      openCommandPalette: opts.openCommandPalette,
      openShortcutsHelp: opts.openShortcutsHelp,
      closeTopOverlay: () => this.closeTopOverlay(),
      focusPageSearch: () => focusPageSearch(),
      submitActiveForm: () => submitClosestForm(document.activeElement),
      saveActiveForm: () => saveClosestForm(document.activeElement)
    };
  }

  availableShortcuts(): Array<ShortcutDefinition & { enabled: boolean }> {
    const ctx = this.context();
    return shortcutRegistry.listForRole(ctx.role).map((s) => ({
      ...s,
      enabled: s.available ? s.available(ctx) : true
    }));
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.options || e.defaultPrevented) return;
    if (isReservedBrowserShortcut(e)) return;

    const ctx = this.context();
    const typing = isTypingTarget(e.target);
    const inForm = isEditableFormField(e.target);

    // Escape always prefers overlay stack first when present.
    if (e.key === 'Escape' && this.overlays.length) {
      e.preventDefault();
      e.stopPropagation();
      this.closeTopOverlay();
      return;
    }

    for (const shortcut of shortcutRegistry.listForRole(ctx.role)) {
      if (!chordMatches(e, shortcut.chord)) continue;

      const policy = shortcut.typing ?? 'block';
      if (policy === 'block' && typing) continue;
      if (policy === 'forms-only' && !inForm) continue;
      // 'allow' runs even while typing

      if (shortcut.available && !shortcut.available(ctx)) continue;

      e.preventDefault();
      e.stopPropagation();
      void shortcut.run(ctx);
      return;
    }
  }
}

export const shortcutManager = new ShortcutManager();
