// ---------------------------------------------------------------------------
// scatter.ts — deterministic seeded scatter layout (pure logic, no DOM/Pixi)
// ---------------------------------------------------------------------------

/**
 * Position and presentation state for a single card on the desk.
 *
 * Coordinate convention: desk space is origin-centered.
 *   x ∈ [−width/2,  width/2]   (right is positive)
 *   y ∈ [−height/2, height/2]  (down  is positive)
 * Task 5 positions the Pixi world from these values.
 */
export interface CardState {
  x: number;        // desk-space center position
  y: number;
  scale: number;    // 1 = natural size
  rotation: number; // radians
  z: number;        // stacking order, higher = on top
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approximate spacing between card grid cells when sizing the desk. */
const SPACING = 340;

/** Minimum desk width in desk units. */
const MIN_WIDTH = 1200;

/** Minimum desk height in desk units. */
const MIN_HEIGHT = 800;

/** Desk height is this fraction of width (roughly 3/4). */
const HEIGHT_RATIO = 0.75;

/** Cards are placed within this margin from the bounds edge. */
const EDGE_MARGIN = 180;

/** Maximum rotation magnitude in radians (±4° = ±0.06981 rad). */
const MAX_ROTATION_RAD = (4 * Math.PI) / 180; // ≈ 0.06981

/** Minimum distance between card centers before a retry is attempted. */
export const MIN_CARD_DISTANCE = 195;

/** Maximum placement retry attempts per new card. */
const MAX_RETRIES = 8;

// ---------------------------------------------------------------------------
// PRNG — mulberry32 seeded from a string hash
// ---------------------------------------------------------------------------

/** djb2-style string → uint32 hash. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // h = ((h << 5) + h) + code  (keep in 32-bit range)
    h = (Math.imul(h, 33) ^ code) >>> 0;
  }
  return h >>> 0;
}

/** Returns a mulberry32 PRNG function given a uint32 seed. */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = (Math.imul(z ^ (z >>> 15), z | 1)) >>> 0;
    z ^= z + (Math.imul(z ^ (z >>> 7), z | 61)) >>> 0;
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

/** Returns a seeded PRNG for a given string seed. */
export function seededPrng(seed: string): () => number {
  return makePrng(hashString(seed));
}

// ---------------------------------------------------------------------------
// deskBounds
// ---------------------------------------------------------------------------

/**
 * Compute desk bounds for a given card count.
 * Area grows monotonically with count; height is ~3/4 of width.
 * Minimum 1200×800.
 *
 * Coordinate convention: desk space is origin-centered.
 *   x ∈ [−width/2,  width/2]
 *   y ∈ [−height/2, height/2]
 */
export function deskBounds(count: number): { width: number; height: number } {
  const n = Math.max(count, 1);
  const side = Math.ceil(Math.sqrt(n)) * SPACING;
  const width = Math.max(side, MIN_WIDTH);
  const height = Math.max(Math.round(width * HEIGHT_RATIO), MIN_HEIGHT);
  return { width, height };
}

/** Half-width/height padding when fitting layout bounds to card footprint. */
const LAYOUT_BOUND_PAD = 150;

/**
 * Fit camera bounds from actual card positions (for grouped layouts).
 * Falls back to deskBounds when layout is empty.
 */
export function boundsForLayout(
  layout: Record<string, CardState>,
  cardCount: number,
): { width: number; height: number } {
  const positions = Object.values(layout);
  if (positions.length === 0) return deskBounds(cardCount);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of positions) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const spanX = maxX - minX + LAYOUT_BOUND_PAD * 2;
  const spanY = maxY - minY + LAYOUT_BOUND_PAD * 2;

  return {
    width: Math.max(spanX, MIN_WIDTH),
    height: Math.max(spanY, MIN_HEIGHT),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates shuffle of an array in-place using the provided PRNG. */
function shuffleArray<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
}

/**
 * Pick a random position within bounds, respecting the edge margin.
 * Returns [x, y] as desk-space coordinates (origin at center).
 */
function randomPosition(
  bounds: { width: number; height: number },
  rand: () => number
): [number, number] {
  const halfW = bounds.width / 2 - EDGE_MARGIN;
  const halfH = bounds.height / 2 - EDGE_MARGIN;
  const x = (rand() * 2 - 1) * halfW;
  const y = (rand() * 2 - 1) * halfH;
  return [x, y];
}

/** Euclidean distance between two centers. */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Pick a position that maximizes clearance from existing card centers.
 * Retries up to MAX_RETRIES; accepts the best candidate found.
 */
function pickSpreadPosition(
  bounds: { width: number; height: number },
  existingCenters: Array<{ x: number; y: number }>,
  positionRand: () => number,
): { x: number; y: number } {
  let bestX = 0;
  let bestY = 0;
  let bestMinDist = -1;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const [cx, cy] = randomPosition(bounds, positionRand);

    let minDist = Infinity;
    for (const center of existingCenters) {
      const d = dist(cx, cy, center.x, center.y);
      if (d < minDist) minDist = d;
    }

    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestX = cx;
      bestY = cy;
    }

    if (minDist >= MIN_CARD_DISTANCE) break;
  }

  return { x: bestX, y: bestY };
}

// ---------------------------------------------------------------------------
// scatterLayout
// ---------------------------------------------------------------------------

/**
 * Deterministic seeded scatter for a set of block ids.
 * Returns a Record keyed by string block id.
 */
export function scatterLayout(
  blockIds: number[],
  seed: string
): Record<string, CardState> {
  if (blockIds.length === 0) return {};

  const rand = seededPrng(seed);
  const bounds = deskBounds(blockIds.length);

  // Build a shuffled z-order permutation
  const zOrder = Array.from({ length: blockIds.length }, (_, i) => i);
  shuffleArray(zOrder, rand);

  const result: Record<string, CardState> = {};
  const placedCenters: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < blockIds.length; i++) {
    const id = blockIds[i] as number;
    const cardRand = seededPrng(`${seed}:${id}`);
    const { x, y } = pickSpreadPosition(bounds, placedCenters, cardRand);
    const rotRand = seededPrng(`${seed}:${id}:rot`);
    const rotation = (rotRand() * 2 - 1) * MAX_ROTATION_RAD;
    const z = zOrder[i] as number;

    result[String(id)] = { x, y, scale: 1, rotation, z };
    placedCenters.push({ x, y });
  }

  return result;
}

// ---------------------------------------------------------------------------
// scatterInto
// ---------------------------------------------------------------------------

/**
 * Place additional blocks into a layout that already has cards.
 * Best-effort avoids pile-up (up to MAX_RETRIES per card).
 * Existing entries pass through untouched.
 * New cards' z values start above the current max z.
 * Returns a NEW object containing existing + new placements.
 */
export function scatterInto(
  existing: Record<string, CardState>,
  newBlockIds: number[],
  seed: string
): Record<string, CardState> {
  // Copy existing
  const result: Record<string, CardState> = { ...existing };

  if (newBlockIds.length === 0) return result;

  const totalCount = Object.keys(existing).length + newBlockIds.length;
  const bounds = deskBounds(totalCount);

  // Find current max z (or -1 if empty)
  let maxZ = -1;
  for (const key of Object.keys(existing)) {
    const card = existing[key];
    if (card !== undefined && card.z > maxZ) {
      maxZ = card.z;
    }
  }

  // Collect existing centers for proximity checks
  const existingCenters: Array<{ x: number; y: number }> = Object.values(existing);

  for (let i = 0; i < newBlockIds.length; i++) {
    const id = newBlockIds[i] as number;

    // Each card gets its own PRNG derived from seed + blockId so placement is
    // per-card-deterministic and order-independent across incremental sessions.
    const cardRand = seededPrng(`${seed}:${id}`);

    const { x: bestX, y: bestY } = pickSpreadPosition(
      bounds,
      existingCenters,
      cardRand,
    );

    const rotRand = seededPrng(`${seed}:${id}:rot`);
    const rotation = (rotRand() * 2 - 1) * MAX_ROTATION_RAD;
    const z = maxZ + 1 + i;

    const card: CardState = { x: bestX, y: bestY, scale: 1, rotation, z };
    result[String(id)] = card;

    existingCenters.push({ x: bestX, y: bestY });
  }

  return result;
}
