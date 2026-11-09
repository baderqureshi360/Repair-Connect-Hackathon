import { derived, writable } from 'svelte/store';
import { en, type MessageKey } from './en';
import { ur } from './ur';

export type Lang = 'en' | 'ur';

const dictionaries = { en, ur };

function initialLang(): Lang {
  if (typeof localStorage === 'undefined') return 'en';
  return (localStorage.getItem('rc_lang') as Lang) || 'en';
}

export const lang = writable<Lang>(initialLang());

lang.subscribe((value) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value === 'ur' ? 'ur' : 'en';
    document.documentElement.dir = value === 'ur' ? 'rtl' : 'ltr';
    localStorage.setItem('rc_lang', value);
  }
});

export const t = derived(lang, ($lang) => {
  const dict = dictionaries[$lang];
  return (key: MessageKey) => dict[key] || en[key] || key;
});

const STATUS_MESSAGES: Record<string, string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  diagnosing: 'Diagnosing',
  estimate_pending: 'Awaiting your approval.',
  estimate_approved: 'Quote approved',
  estimate_rejected: 'Estimate rejected',
  awaiting_parts: 'Quote approved, awaiting part reservation.',
  parts_reserved: 'Ready to start.',
  ready_to_start: 'Ready to start.',
  in_progress: 'Repair in progress.',
  ready_for_collection: 'Ready for collection.',
  completed: 'Collected / closed.',
  cancelled: 'Cancelled',
  requested: 'Requested',
  awaiting_transfer: 'Awaiting supplier or shop transfer',
  approved: 'Awaiting supplier or shop transfer',
  in_transit: 'In transit',
  dispatched: 'In transit',
  received: 'Received',
  reserved: 'Reserved',
  rejected: 'Rejected',
  cancelled_transfer: 'Cancelled'
};

export function statusLabel(status: string, _$t?: (k: MessageKey) => string): string {
  return STATUS_MESSAGES[status] || status.replaceAll('_', ' ');
}
