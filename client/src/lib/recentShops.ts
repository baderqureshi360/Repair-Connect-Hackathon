const KEY = 'rc_recent_shops';
const MAX = 6;

export function getRecentShopIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberShop(id: string) {
  if (typeof localStorage === 'undefined' || !id) return;
  const next = [id, ...getRecentShopIds().filter((x) => x !== id)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
}
