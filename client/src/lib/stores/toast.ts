import { writable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  timeoutMs?: number;
};

function createToastStore() {
  const { subscribe, update } = writable<ToastItem[]>([]);

  function push(kind: ToastKind, message: string, timeoutMs = 3200) {
    const id = crypto.randomUUID();
    update((list) => [...list, { id, kind, message, timeoutMs }]);
    if (timeoutMs > 0) {
      setTimeout(() => dismiss(id), timeoutMs);
    }
    return id;
  }

  function dismiss(id: string) {
    update((list) => list.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
    info: (message: string) => push('info', message),
    warning: (message: string) => push('warning', message),
    dismiss
  };
}

export const toasts = createToastStore();
