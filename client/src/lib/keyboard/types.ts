import type { Role } from '$lib/stores/auth';

export type ShortcutCategory =
  | 'global'
  | 'navigation'
  | 'forms'
  | 'tables'
  | 'overlays'
  | 'actions';

export type TypingPolicy = 'block' | 'allow' | 'forms-only';

export type ShortcutChord = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export type ShortcutContext = {
  role: Role | null;
  pathname: string;
  pendingOnboarding: boolean;
  navigate: (href: string) => void | Promise<void>;
  openCommandPalette: () => void;
  openShortcutsHelp: () => void;
  closeTopOverlay: () => boolean;
  focusPageSearch: () => boolean;
  submitActiveForm: () => boolean;
  saveActiveForm: () => boolean;
};

export type ShortcutDefinition = {
  id: string;
  chord: ShortcutChord;
  /** Display label e.g. "Ctrl + K" */
  display: string;
  title: string;
  description: string;
  category: ShortcutCategory;
  /** Roles that may use this shortcut. Omit or 'all' for every authenticated role. */
  roles?: Role[] | 'all';
  typing?: TypingPolicy;
  /** Soft-disable when false; still listed in help as unavailable. */
  available?: (ctx: ShortcutContext) => boolean;
  run: (ctx: ShortcutContext) => void | Promise<void>;
};

export type OverlayHandle = {
  id: string;
  close: () => void;
};

export type CommandGroup = 'navigation' | 'records' | 'actions';

export type CommandItem = {
  id: string;
  group: CommandGroup;
  label: string;
  description?: string;
  href?: string;
  keywords?: string[];
  run?: () => void | Promise<void>;
};
