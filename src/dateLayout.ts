// ---------------------------------------------------------------------------
// dateLayout.ts — group cards by hour added to channel (connectedAt)
// ---------------------------------------------------------------------------

import type { DeskBlock } from "./types";
import type { CardState } from "./scatter";
import { seededPrng } from "./scatter";

const GROUPS_PER_ROW = 6;
const GROUP_SPACING_X = 1140;
const GROUP_SPACING_Y = 1020;
const CLUSTER_SPREAD = 330;

const UNKNOWN_KEY = "unknown";

export function hourKey(iso: string | null): string {
  if (!iso) return UNKNOWN_KEY;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return UNKNOWN_KEY;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}`;
}

function groupBlocks(blocks: DeskBlock[]): Map<string, DeskBlock[]> {
  const groups = new Map<string, DeskBlock[]>();

  for (const block of blocks) {
    const key = hourKey(block.connectedAt);
    const list = groups.get(key);
    if (list) {
      list.push(block);
    } else {
      groups.set(key, [block]);
    }
  }

  return groups;
}

function sortedGroupKeys(groups: Map<string, DeskBlock[]>): string[] {
  const keys = Array.from(groups.keys());
  keys.sort((a, b) => {
    if (a === UNKNOWN_KEY) return 1;
    if (b === UNKNOWN_KEY) return -1;
    return a.localeCompare(b);
  });
  return keys;
}

function groupCenter(index: number, total: number): { x: number; y: number } {
  const row = Math.floor(index / GROUPS_PER_ROW);
  const col = index % GROUPS_PER_ROW;
  const groupsInRow = Math.min(
    GROUPS_PER_ROW,
    total - row * GROUPS_PER_ROW
  );
  const rowWidth = (groupsInRow - 1) * GROUP_SPACING_X;
  const totalRows = Math.ceil(total / GROUPS_PER_ROW);
  const totalHeight = (totalRows - 1) * GROUP_SPACING_Y;

  const x = col * GROUP_SPACING_X - rowWidth / 2;
  const y = row * GROUP_SPACING_Y - totalHeight / 2;

  return { x, y };
}

function clusterAt(
  blockIds: number[],
  centerX: number,
  centerY: number,
  seed: string,
  zStart: number,
): Record<string, CardState> {
  const result: Record<string, CardState> = {};

  for (let i = 0; i < blockIds.length; i++) {
    const id = blockIds[i] as number;
    const rand = seededPrng(`${seed}:${id}`);
    const angle = rand() * Math.PI * 2;
    const radius = rand() * CLUSTER_SPREAD;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;

    result[String(id)] = {
      x,
      y,
      scale: 1,
      rotation: 0,
      z: zStart + i,
    };
  }

  return result;
}

/**
 * Lay out blocks in chronological hour clusters, oldest groups on the left.
 * Blocks without connectedAt land in an "unknown" group at the end.
 */
export function dateLayout(
  blocks: DeskBlock[],
  seed: string,
): Record<string, CardState> {
  if (blocks.length === 0) return {};

  const groups = groupBlocks(blocks);
  const keys = sortedGroupKeys(groups);
  const result: Record<string, CardState> = {};
  let z = 0;

  for (let gi = 0; gi < keys.length; gi++) {
    const key = keys[gi] as string;
    const group = groups.get(key);
    if (!group || group.length === 0) continue;

    const { x, y } = groupCenter(gi, keys.length);
    const ids = group.map((b) => b.id);
    const cluster = clusterAt(ids, x, y, `${seed}:${key}`, z);

    for (const [id, state] of Object.entries(cluster)) {
      result[id] = state;
    }
    z += ids.length;
  }

  return result;
}

/**
 * Place only new blocks into existing hour clusters without moving current cards.
 * New hour groups use the same center math as a full relayout would for that group.
 */
export function dateLayoutForNewBlocks(
  newBlocks: DeskBlock[],
  existingBlocks: DeskBlock[],
  existingLayout: Record<string, CardState>,
  seed: string,
): Record<string, CardState> {
  if (newBlocks.length === 0) return {};

  const grouped = new Map<string, DeskBlock[]>();
  for (const block of newBlocks) {
    const key = hourKey(block.connectedAt);
    const list = grouped.get(key);
    if (list) {
      list.push(block);
    } else {
      grouped.set(key, [block]);
    }
  }

  let globalMaxZ = -1;
  for (const state of Object.values(existingLayout)) {
    if (state.z > globalMaxZ) globalMaxZ = state.z;
  }

  const result: Record<string, CardState> = {};

  for (const [key, blocks] of grouped) {
    const center = centerForHourKey(
      key,
      existingBlocks,
      existingLayout,
      blocks,
    );
    const zStart = maxZForHourKey(key, existingBlocks, existingLayout) + 1;
    const startZ = Math.max(globalMaxZ + 1, zStart);
    const ids = blocks.map((b) => b.id);
    const cluster = clusterAt(ids, center.x, center.y, `${seed}:${key}`, startZ);

    for (const [id, state] of Object.entries(cluster)) {
      result[id] = state;
      if (state.z > globalMaxZ) globalMaxZ = state.z;
    }
  }

  return result;
}

function centerForHourKey(
  key: string,
  existingBlocks: DeskBlock[],
  existingLayout: Record<string, CardState>,
  incoming: DeskBlock[],
): { x: number; y: number } {
  const members = existingBlocks.filter((b) => hourKey(b.connectedAt) === key);
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const block of members) {
    const state = existingLayout[String(block.id)];
    if (!state) continue;
    sumX += state.x;
    sumY += state.y;
    count++;
  }

  if (count > 0) {
    return { x: sumX / count, y: sumY / count };
  }

  const allBlocks = [...existingBlocks, ...incoming];
  const groups = groupBlocks(allBlocks);
  const keys = sortedGroupKeys(groups);
  const gi = keys.indexOf(key);
  if (gi < 0) return { x: 0, y: 0 };
  return groupCenter(gi, keys.length);
}

function maxZForHourKey(
  key: string,
  existingBlocks: DeskBlock[],
  existingLayout: Record<string, CardState>,
): number {
  let maxZ = -1;
  for (const block of existingBlocks) {
    if (hourKey(block.connectedAt) !== key) continue;
    const state = existingLayout[String(block.id)];
    if (state && state.z > maxZ) maxZ = state.z;
  }
  return maxZ;
}
