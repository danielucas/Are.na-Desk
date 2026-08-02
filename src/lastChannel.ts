// ---------------------------------------------------------------------------
// lastChannel.ts — remember most recently opened channel (localStorage)
// ---------------------------------------------------------------------------

import { getStorage } from "./storage";

const STORAGE_KEY = "arena-desk:last-channel";

export function saveLastChannel(slug: string): void {
  const storage = getStorage();
  if (!storage) return;

  const trimmed = slug.trim();
  if (!trimmed) return;

  try {
    storage.setItem(STORAGE_KEY, trimmed);
  } catch {
    // best-effort
  }
}

export function loadLastChannel(): string | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function clearLastChannel(): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
