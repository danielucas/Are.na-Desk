/**
 * Core pure-logic tests — algorithms and parsers only.
 * Pixi canvas behaviour is verified manually in the browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseChannelInput, isRetryableStatus, retryDelayMs } from "./api";
import { fitView } from "./desk";
import { computeResizeScale } from "./interactions";
import { dateLayout, dateLayoutForNewBlocks } from "./dateLayout";
import { blockTypeLabel, typesPresentInChannel } from "./blockFilter";
import { formatUtcDate } from "./dateFormat";
import { boundsForLayout } from "./scatter";
import type { DeskBlock } from "./types";
import { loadLayout, saveLayout, clearLayout, reconcileLayout } from "./persistence";
import type { ChannelLayout } from "./persistence";
import {
  scatterLayout,
  scatterInto,
  deskBounds,
  MIN_CARD_DISTANCE,
} from "./scatter";

// ---------------------------------------------------------------------------
// parseChannelInput
// ---------------------------------------------------------------------------

describe("parseChannelInput", () => {
  it("accepts bare slugs and numeric ids", () => {
    expect(parseChannelInput("my-channel")).toBe("my-channel");
    expect(parseChannelInput("12345")).toBe("12345");
  });

  it("extracts slug from are.na URLs", () => {
    expect(parseChannelInput("https://www.are.na/user/my-channel")).toBe("my-channel");
    expect(parseChannelInput("are.na/user/channel")).toBe("channel");
    expect(parseChannelInput("https://www.are.na/user/chan/")).toBe("chan");
    expect(parseChannelInput("https://www.are.na/user/chan?page=2")).toBe("chan");
    expect(parseChannelInput("https://www.are.na/user/chan#section")).toBe("chan");
  });

  it("rejects empty, garbage, and non-are.na paths", () => {
    expect(parseChannelInput("")).toBeNull();
    expect(parseChannelInput("   ")).toBeNull();
    expect(parseChannelInput("are.na")).toBeNull();
    expect(parseChannelInput("https://www.are.na/")).toBeNull();
    expect(parseChannelInput("https://example.com/foo/bar")).toBeNull();
    expect(parseChannelInput("/")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scatterLayout / scatterInto
// ---------------------------------------------------------------------------

describe("request retry policy", () => {
  it("retries rate limits and server faults", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it("does not retry answers — auth, permission, missing", () => {
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(600)).toBe(false);
  });

  it("backs off further on each attempt", () => {
    const first = retryDelayMs(0, null);
    const second = retryDelayMs(1, null);
    // 500 and 1500 plus up to 250ms of jitter — the ranges never overlap
    expect(first).toBeGreaterThanOrEqual(500);
    expect(first).toBeLessThan(750);
    expect(second).toBeGreaterThanOrEqual(1500);
    expect(second).toBeLessThan(1750);
  });

  it("honours a numeric Retry-After, in seconds", () => {
    expect(retryDelayMs(0, "2")).toBe(2000);
    expect(retryDelayMs(1, "0")).toBe(0);
  });

  it("caps Retry-After so a hostile value can't hang the app", () => {
    expect(retryDelayMs(0, "99999")).toBe(10_000);
  });

  it("falls back to backoff when Retry-After is a date or garbage", () => {
    // Are.na may send the HTTP-date form, which Number() can't read
    const delay = retryDelayMs(0, "Wed, 21 Oct 2026 07:28:00 GMT");
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThan(750);
  });
});

describe("scatterLayout", () => {
  it("is deterministic for the same ids and seed", () => {
    const ids = [1, 2, 3, 4, 5];
    expect(scatterLayout(ids, "seed")).toEqual(scatterLayout(ids, "seed"));
  });

  it("places all ids within desk bounds with valid card state", () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = scatterLayout(ids, "bounds");
    const bounds = deskBounds(ids.length);

    for (const id of ids) {
      const card = result[String(id)];
      expect(card).toBeDefined();
      if (!card) continue;
      expect(card.scale).toBe(1);
      expect(card.rotation).toBeGreaterThanOrEqual(-0.0699);
      expect(card.rotation).toBeLessThanOrEqual(0.0699);
      expect(card.x).toBeGreaterThanOrEqual(-bounds.width / 2);
      expect(card.x).toBeLessThanOrEqual(bounds.width / 2);
      expect(card.y).toBeGreaterThanOrEqual(-bounds.height / 2);
      expect(card.y).toBeLessThanOrEqual(bounds.height / 2);
    }
  });

  it("assigns z as a permutation of 0..n-1", () => {
    const ids = [10, 20, 30, 40, 50];
    const z = ids.map((id) => scatterLayout(ids, "z")[String(id)]?.z).sort((a, b) => a! - b!);
    expect(z).toEqual([0, 1, 2, 3, 4]);
  });

  it("spreads cards apart on initial scatter (best-effort min distance)", () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const layout = scatterLayout(ids, "spread-test");
    const positions = ids.map((id) => layout[String(id)]!);

    let closePairs = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < MIN_CARD_DISTANCE) closePairs++;
      }
    }

    expect(closePairs).toBeLessThan(positions.length);
  });
});

describe("scatterInto", () => {
  it("preserves existing cards and places new ones above max z", () => {
    const existing = scatterLayout([1, 2, 3], "base");
    const maxZ = Math.max(...Object.values(existing).map((c) => c.z));
    const result = scatterInto(existing, [10, 20], "extra");

    expect(result["1"]).toBe(existing["1"]);
    expect(result["10"]?.z).toBeGreaterThan(maxZ);
    expect(result["20"]?.z).toBeGreaterThan(maxZ);
  });

  it("keeps new cards at least MIN_CARD_DISTANCE from existing centers", () => {
    const existing: ChannelLayout = {
      "1000": { x: 0, y: 0, scale: 1, rotation: 0, z: 0 },
    };
    const result = scatterInto(existing, [1, 2, 3], "avoidance");

    for (const id of [1, 2, 3]) {
      const card = result[String(id)];
      expect(card).toBeDefined();
      if (!card) continue;
      const d = Math.hypot(card.x, card.y);
      expect(d).toBeGreaterThanOrEqual(MIN_CARD_DISTANCE);
    }
  });
});

// ---------------------------------------------------------------------------
// reconcileLayout
// ---------------------------------------------------------------------------

describe("reconcileLayout", () => {
  it("scatters from scratch when saved is null", () => {
    const ids = [1, 2, 3];
    const a = reconcileLayout(null, ids, "seed");
    const b = scatterLayout(ids, "seed");
    expect(a).toEqual(b);
  });

  it("keeps saved positions, drops removed blocks, scatters new ones", () => {
    const saved: ChannelLayout = {
      "1": { x: 100, y: 200, scale: 1, rotation: 0.03, z: 0 },
      "999": { x: 50, y: 50, scale: 1, rotation: 0, z: 1 },
    };
    const result = reconcileLayout(saved, [1, 100], "seed");

    expect(result["1"]).toEqual(saved["1"]);
    expect(result["999"]).toBeUndefined();
    expect(result["100"]).toBeDefined();
    expect(result["100"]!.z).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// persistence (localStorage)
// ---------------------------------------------------------------------------

function makeLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
}

describe("persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a valid layout", () => {
    const layout: ChannelLayout = {
      "42": { x: 100, y: -200, scale: 1, rotation: 0.03, z: 2 },
    };
    saveLayout("my-channel", layout);
    expect(loadLayout("my-channel")).toEqual(layout);
  });

  it("returns null for corrupted storage", () => {
    localStorage.setItem("arena-desk:layout:broken", "NOT JSON");
    expect(loadLayout("broken")).toBeNull();
  });

  it("clearLayout forgets one channel and leaves the others alone", () => {
    const layout: ChannelLayout = {
      "1": { x: 0, y: 0, scale: 1, rotation: 0, z: 0 },
    };
    saveLayout("kept", layout);
    saveLayout("dropped", layout);

    clearLayout("dropped");

    expect(loadLayout("dropped")).toBeNull();
    expect(loadLayout("kept")).toEqual(layout);
  });
});

// ---------------------------------------------------------------------------
// fitView
// ---------------------------------------------------------------------------

describe("fitView", () => {
  it("centers the desk and applies default padding", () => {
    const result = fitView({ width: 1000, height: 1000 }, { width: 1000, height: 1000 });
    expect(result.scale).toBeCloseTo(0.92, 4);
    expect(result.x).toBeCloseTo(500, 0);
    expect(result.y).toBeCloseTo(500, 0);
  });

  it("uses the constraining viewport dimension", () => {
    const result = fitView({ width: 2000, height: 500 }, { width: 800, height: 600 });
    expect(result.scale).toBeCloseTo((800 / 2000) * 0.92, 4);
  });
});

// ---------------------------------------------------------------------------
// computeResizeScale
// ---------------------------------------------------------------------------

describe("computeResizeScale", () => {
  const center = { x: 100, y: 100 };

  it("scales proportionally to pointer distance from center", () => {
    expect(computeResizeScale(center, 100, { x: 300, y: 100 }, 1)).toBeCloseTo(2);
    expect(computeResizeScale(center, 100, { x: 150, y: 100 }, 1)).toBeCloseTo(0.5);
  });

  it("clamps to min 0.2 and max 5", () => {
    expect(computeResizeScale(center, 10, { x: 1100, y: 100 }, 1)).toBe(5);
    expect(computeResizeScale(center, 200, { x: 101, y: 100 }, 1)).toBe(0.2);
  });

  it("returns startScale when startDist is zero", () => {
    expect(computeResizeScale(center, 0, { x: 200, y: 100 }, 1.5)).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// dateLayout
// ---------------------------------------------------------------------------

function makeBlock(id: number, connectedAt: string | null): DeskBlock {
  return {
    id,
    type: "Image",
    title: null,
    description: null,
    textContent: null,
    imageUrl: "https://example.com/img.jpg",
    imageThumbUrl: null,
    imageLargeUrl: null,
    aspectRatio: 1,
    sourceUrl: null,
    filename: null,
    extension: null,
    connectedAt,
    connectedBy: null,
    arenaUrl: `https://www.are.na/block/${id}`,
  };
}

describe("dateLayout", () => {
  it("is deterministic for the same blocks and seed", () => {
    const blocks = [
      makeBlock(1, "2024-01-15T12:00:00Z"),
      makeBlock(2, "2024-02-10T12:00:00Z"),
      makeBlock(3, "2024-01-20T12:00:00Z"),
    ];
    expect(dateLayout(blocks, "seed")).toEqual(dateLayout(blocks, "seed"));
  });

  it("places same-hour blocks closer than different-hour blocks", () => {
    const blocks = [
      makeBlock(1, "2024-01-15T10:15:00Z"),
      makeBlock(2, "2024-01-15T10:45:00Z"),
      makeBlock(3, "2024-01-15T14:05:00Z"),
      makeBlock(4, "2024-01-15T14:30:00Z"),
    ];
    const layout = dateLayout(blocks, "cluster-test");

    const h10a = layout["1"]!;
    const h10b = layout["2"]!;
    const h14a = layout["3"]!;
    const h14b = layout["4"]!;

    const sameHourDist = Math.hypot(h10a.x - h10b.x, h10a.y - h10b.y);
    const crossHourDist = Math.hypot(h10a.x - h14a.x, h10a.y - h14a.y);

    expect(sameHourDist).toBeLessThan(crossHourDist);
    expect(Math.hypot(h14a.x - h14b.x, h14a.y - h14b.y)).toBeLessThan(crossHourDist);
  });

  it("uses zero rotation for all cards", () => {
    const blocks = [
      makeBlock(1, "2024-03-01T12:00:00Z"),
      makeBlock(2, "2024-04-01T12:00:00Z"),
    ];
    const layout = dateLayout(blocks, "flat");
    for (const state of Object.values(layout)) {
      expect(state.rotation).toBe(0);
    }
  });

  it("places new blocks in an existing hour cluster without moving prior cards", () => {
    const existing = [
      makeBlock(1, "2024-01-15T10:15:00Z"),
      makeBlock(2, "2024-01-15T10:45:00Z"),
    ];
    const priorLayout = dateLayout(existing, "seed");
    const incoming = [makeBlock(3, "2024-01-15T10:50:00Z")];

    const delta = dateLayoutForNewBlocks(incoming, existing, priorLayout, "seed");

    expect(priorLayout["1"]!.x).toBe(dateLayout(existing, "seed")["1"]!.x);
    expect(delta["3"]).toBeDefined();
    const d3 = delta["3"]!;
    const d1 = priorLayout["1"]!;
    expect(Math.hypot(d3.x - d1.x, d3.y - d1.y)).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------------------
// blockFilter
// ---------------------------------------------------------------------------

describe("blockFilter", () => {
  it("lowercases block type labels", () => {
    expect(blockTypeLabel("Image")).toBe("image");
    expect(blockTypeLabel("Text")).toBe("text");
  });

  it("orders present types consistently", () => {
    const blocks = [
      makeBlock(1, null),
      makeBlock(2, null),
    ];
    blocks[0]!.type = "Text";
    blocks[1]!.type = "Image";
    expect(typesPresentInChannel(blocks)).toEqual(["Image", "Text"]);
  });
});

// ---------------------------------------------------------------------------
// boundsForLayout
// ---------------------------------------------------------------------------

describe("boundsForLayout", () => {
  it("pads card center span for camera fitting", () => {
    const layout = {
      "1": { x: 0, y: 0, scale: 1, rotation: 0, z: 0 },
      "2": { x: 100, y: 50, scale: 1, rotation: 0, z: 1 },
    };
    const bounds = boundsForLayout(layout, 2);
    expect(bounds.width).toBeGreaterThan(100);
    expect(bounds.height).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// formatUtcDate
// ---------------------------------------------------------------------------

describe("formatUtcDate", () => {
  it("formats ISO timestamps in UTC", () => {
    expect(formatUtcDate("2024-03-15T22:00:00Z")).toBe("2024-03-15");
  });
});
