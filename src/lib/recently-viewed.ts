const STORAGE_KEY = "ovi_recently_viewed";
const STORAGE_VERSION = 1;
const MAX_STORED_ENTRIES = 20;
const MAX_RETURNED_ENTRIES = 8;
const MAX_PRODUCT_ID_LENGTH = 40;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

interface RecentlyViewedItem {
  id: string;
  viewedAt: number;
}

interface RecentlyViewedState {
  v: typeof STORAGE_VERSION;
  items: RecentlyViewedItem[];
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id.length <= MAX_PRODUCT_ID_LENGTH ? id : null;
}

function readItems(): RecentlyViewedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const state = parsed as { v?: unknown; items?: unknown };
    if (state.v !== STORAGE_VERSION || !Array.isArray(state.items)) return [];

    const now = Date.now();
    const seen = new Set<string>();
    const items: RecentlyViewedItem[] = [];
    for (const candidate of state.items) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as { id?: unknown; viewedAt?: unknown };
      const id = normalizeId(item.id);
      if (!id || typeof item.viewedAt !== "number" || !Number.isFinite(item.viewedAt)) continue;
      if (item.viewedAt <= 0 || item.viewedAt > now || now - item.viewedAt > RETENTION_MS || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, viewedAt: item.viewedAt });
      if (items.length === MAX_STORED_ENTRIES) break;
    }
    return items;
  } catch {
    return [];
  }
}

export function recordProductView(productId: string): void {
  const id = normalizeId(productId);
  if (!id || typeof window === "undefined") return;
  try {
    const state: RecentlyViewedState = {
      v: STORAGE_VERSION,
      items: [{ id, viewedAt: Date.now() }, ...readItems().filter((item) => item.id !== id)].slice(0, MAX_STORED_ENTRIES),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be blocked or full; product pages must remain unaffected.
  }
}

export function readRecentlyViewedIds(): string[] {
  return readItems().slice(0, MAX_RETURNED_ENTRIES).map((item) => item.id);
}

export function clearRecentlyViewed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Clearing history is best-effort when browser storage is unavailable.
  }
}
