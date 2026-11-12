import { writable } from 'svelte/store';

/** Increment to request opening the command palette from anywhere in the app shell. */
export const commandPaletteRequest = writable(0);
/** Increment to request opening the shortcuts help dialog. */
export const shortcutsHelpRequest = writable(0);

export function requestCommandPalette() {
  commandPaletteRequest.update((n) => n + 1);
}

export function requestShortcutsHelp() {
  shortcutsHelpRequest.update((n) => n + 1);
}
