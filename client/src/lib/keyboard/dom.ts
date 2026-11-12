const TYPING_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]';

/** True when the event target is an editable field where most shortcuts should be blocked. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest(TYPING_SELECTOR)) {
    const el = target.closest(TYPING_SELECTOR) as HTMLElement;
    if (el instanceof HTMLInputElement) {
      const type = (el.type || 'text').toLowerCase();
      // Allow shortcuts on non-text inputs (checkbox/radio/button/range/etc.)
      if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'color', 'range'].includes(type)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function isEditableFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('form') && isTypingTarget(target));
}

/** Browser / OS shortcuts we must never intercept. */
export function isReservedBrowserShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return false;
  // Address bar, close tab, new tab/window, reload, print, save-as page, find-in-page (browser), history
  if (['l', 'w', 't', 'n', 'r', 'p', 'u', 'h', 'j', 'd'].includes(key)) return true;
  // Hard refresh
  if (key === 'f5') return true;
  return false;
}

export function chordMatches(e: KeyboardEvent, chord: {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const expected = chord.key.length === 1 ? chord.key.toLowerCase() : chord.key;
  if (key !== expected && e.key !== chord.key) return false;

  const wantsCtrlOrMeta = Boolean(chord.ctrl || chord.meta);
  if (wantsCtrlOrMeta) {
    if (!(e.ctrlKey || e.metaKey)) return false;
  } else if (e.ctrlKey || e.metaKey) {
    return false;
  }

  if (Boolean(chord.alt) !== e.altKey) return false;
  if (Boolean(chord.shift) !== e.shiftKey) return false;
  return true;
}

export function focusFirstInvalidField(root: ParentNode = document): boolean {
  const invalid = root.querySelector<HTMLElement>(
    'input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"]'
  );
  if (!invalid) return false;
  invalid.focus();
  return true;
}

export function submitClosestForm(from: EventTarget | null): boolean {
  const el = from instanceof Element ? from : document.activeElement;
  const form =
    (el instanceof HTMLFormElement && el) ||
    (el instanceof HTMLElement ? el.closest('form') : null) ||
    document.querySelector('form[data-rc-submit], form[data-keyboard-submit]');
  if (!(form instanceof HTMLFormElement)) return false;
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
  } else {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  return true;
}

export function saveClosestForm(from: EventTarget | null): boolean {
  const el = from instanceof Element ? from : document.activeElement;
  const form =
    (el instanceof HTMLElement
      ? el.closest('form[data-rc-save], form[data-keyboard-save]')
      : null) || document.querySelector('form[data-rc-save], form[data-keyboard-save]');
  if (!(form instanceof HTMLFormElement)) return false;
  const saveBtn = form.querySelector<HTMLButtonElement>(
    'button[data-rc-save], button[name="save"], button[type="submit"]'
  );
  if (saveBtn && !saveBtn.disabled) {
    saveBtn.click();
    return true;
  }
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
    return true;
  }
  return false;
}

export function focusPageSearch(): boolean {
  const candidates = [
    document.querySelector<HTMLElement>('[data-page-search]'),
    document.querySelector<HTMLElement>('#table-search'),
    document.querySelector<HTMLElement>('main input[type="search"]'),
    document.querySelector<HTMLElement>('main input[name="q"]'),
    document.querySelector<HTMLElement>('#global-search')
  ];
  for (const el of candidates) {
    if (!el) continue;
    if (el instanceof HTMLElement && el.offsetParent === null && getComputedStyle(el).display === 'none') {
      continue;
    }
    el.focus();
    if (el instanceof HTMLInputElement) el.select?.();
    return true;
  }
  return false;
}
