// ---------------------------------------------------------------------------
// persistence.ts — localStorage-backed layout persistence (pure logic)
// ---------------------------------------------------------------------------

import type { CardState } from "./scatter";
import { scatterLayout, scatterInto } from "./scatter";
import { getStorage } from "./storage";

export type ChannelLayout = Record<string, CardState>; // key = block id as string

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = "arena-desk:layout:";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function layoutKey(slug: string): string {
  return `${STORAGE_KEY_PREFIX}${slug}`;
}

/**
 * Validate that a value is a finite number.
 * Rejects NaN, Infinity, null, undefined, strings, etc.
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

/** Validate that a parsed value looks like a CardState. */
function isValidCardState(v: unknown): v is CardState {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    isFiniteNumber(c["x"]) &&
    isFiniteNumber(c["y"]) &&
    isFiniteNumber(c["scale"]) &&
    isFiniteNumber(c["rotation"]) &&
    isFiniteNumber(c["z"])
  );
}

/** Matches valid block-id keys: one or more decimal digits only. */
const BLOCK_ID_RE = /^\d+$/;

/** Validate that a parsed value looks like a ChannelLayout. */
function isValidChannelLayout(v: unknown): v is ChannelLayout {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!BLOCK_ID_RE.test(key)) return false;
    if (!isValidCardState(obj[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// loadLayout
// ---------------------------------------------------------------------------

/**
 * Load a saved layout from localStorage.
 * Returns null if the key is absent, the JSON is unparseable, or the shape
 * is invalid (corrupted storage must never crash the app or half-load).
 */
export function loadLayout(slug: string): ChannelLayout | null {
  const storage = getStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(layoutKey(slug));
  } catch {
    return null;
  }

  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isValidChannelLayout(parsed)) return null;

  return parsed;
}

// ---------------------------------------------------------------------------
// saveLayout
// ---------------------------------------------------------------------------

/**
 * Save a layout to localStorage.
 * Swallows all storage errors (QuotaExceeded, etc.) — this is a best-effort cache.
 */
export function saveLayout(slug: string, layout: ChannelLayout): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(layoutKey(slug), JSON.stringify(layout));
  } catch {
    // Swallow QuotaExceededError and any other storage failure
  }
}

// ---------------------------------------------------------------------------
// clearLayout
// ---------------------------------------------------------------------------

/**
 * Forget the saved layout for a channel, so the next reconcile starts from a
 * fresh scatter. Best-effort, like saveLayout.
 */
export function clearLayout(slug: string): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(layoutKey(slug));
  } catch {
    // Swallow storage failures — this is a best-effort cache
  }
}

// ---------------------------------------------------------------------------
// reconcileLayout
// ---------------------------------------------------------------------------

/**
 * Reconcile a saved layout with the channel's current block ids.
 *
 * - Kept blocks keep their saved state.
 * - Ids no longer in the channel are dropped.
 * - New ids are scattered into free space via scatterInto.
 * - If saved is null, a full scatterLayout is performed.
 */
export function reconcileLayout(
  saved: ChannelLayout | null,
  blockIds: number[],
  seed: string
): ChannelLayout {
  // No saved state → fresh scatter
  if (saved === null) {
    return scatterLayout(blockIds, seed);
  }

  const currentIdSet = new Set(blockIds.map(String));

  // Keep only entries for blocks still in the channel
  const kept: ChannelLayout = {};
  for (const key of Object.keys(saved)) {
    if (currentIdSet.has(key)) {
      const card = saved[key];
      if (card !== undefined) {
        kept[key] = card;
      }
    }
  }

  // Find new block ids (not present in saved)
  const newIds = blockIds.filter((id) => saved[String(id)] === undefined);

  if (newIds.length === 0) {
    return kept;
  }

  // Scatter new ids into free space around the kept cards
  return scatterInto(kept, newIds, seed);
}
