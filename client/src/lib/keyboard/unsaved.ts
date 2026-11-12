/** Confirm discarding dirty editor state. Returns true when it is safe to leave. */
export function confirmIfDirty(dirty: boolean, message: string): boolean {
  if (!dirty) return true;
  if (typeof window === 'undefined') return true;
  return window.confirm(message);
}
