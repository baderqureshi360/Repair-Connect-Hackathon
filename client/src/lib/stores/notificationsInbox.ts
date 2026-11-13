import { writable } from 'svelte/store';
import { api } from '$lib/api';

export type InboxNotification = {
  _id: string;
  type: string;
  title: string;
  message: string;
  repairRequest?: string | null;
  isRead: boolean;
  meta?: Record<string, unknown> | null;
  createdAt?: string;
};

type InboxState = {
  items: InboxNotification[];
  unread: number;
  loading: boolean;
  error: string;
  loadedAt: number;
};

const initial: InboxState = {
  items: [],
  unread: 0,
  loading: false,
  error: '',
  loadedAt: 0
};

function createInbox() {
  const { subscribe, set, update } = writable<InboxState>(initial);
  let inFlight: Promise<void> | null = null;

  async function refresh(opts?: { limit?: number; force?: boolean }) {
    if (inFlight && !opts?.force) return inFlight;
    const limit = opts?.limit ?? 12;
    update((s) => ({ ...s, loading: true, error: '' }));
    inFlight = (async () => {
      try {
        const data = await api<{ items: InboxNotification[]; unread: number }>(
          `/api/v1/notifications?limit=${limit}`
        );
        set({
          items: data.items || [],
          unread: data.unread || 0,
          loading: false,
          error: '',
          loadedAt: Date.now()
        });
      } catch (err) {
        update((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load notifications'
        }));
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function markOne(id: string) {
    const wasUnread = await new Promise<boolean>((resolve) => {
      const unsub = subscribe((s) => {
        resolve(s.items.some((n) => n._id === id && !n.isRead));
        unsub();
      });
    });
    await api(`/api/v1/notifications/${id}/read`, { method: 'POST' });
    update((s) => ({
      ...s,
      items: s.items.map((n) => (n._id === id ? { ...n, isRead: true } : n)),
      unread: wasUnread ? Math.max(0, s.unread - 1) : s.unread
    }));
  }

  async function markAll() {
    await api('/api/v1/notifications/read-all', { method: 'POST' });
    update((s) => ({
      ...s,
      unread: 0,
      items: s.items.map((n) => ({ ...n, isRead: true }))
    }));
  }

  function reset() {
    set(initial);
  }

  return { subscribe, refresh, markOne, markAll, reset };
}

export const notificationsInbox = createInbox();
