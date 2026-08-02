// ---------------------------------------------------------------------------
// desk.ts — PixiJS v8 desk canvas: pan, zoom, card management
// ---------------------------------------------------------------------------

import { Application, Container } from "pixi.js";
import type { DeskBlock, DeskBlockType } from "./types";
import type { ChannelLayout } from "./persistence";
import { boundsForLayout } from "./scatter";
import { createCard, evictTextures, shouldLoadFullTexture } from "./card";
import type { CardHandle } from "./card";

// ---------------------------------------------------------------------------
// fitView — pure function for camera fitting (also exported for tests)
// ---------------------------------------------------------------------------

/**
 * Compute world transform so that a centered desk (origin at desk center)
 * fits inside the viewport with the given padding fraction.
 *
 * Returns { scale, x, y } where (x, y) is world.position (screen coords of
 * desk origin) and scale is world.scale.x == world.scale.y.
 *
 * The desk origin (0,0) will be placed at the viewport center, so the world
 * container should be positioned at (x, y) = (viewport.width/2, viewport.height/2).
 */
export function fitView(
  bounds: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 0.08
): { scale: number; x: number; y: number } {
  const scaleW = viewport.width / bounds.width;
  const scaleH = viewport.height / bounds.height;
  const rawScale = Math.min(scaleW, scaleH);
  const scale = rawScale * (1 - padding);
  const x = viewport.width / 2;
  const y = viewport.height / 2;
  return { scale, x, y };
}

// ---------------------------------------------------------------------------
// Desk interface
// ---------------------------------------------------------------------------

export interface Desk {
  /** Create Application, attach canvas (z-index under all chrome), wire pan/zoom. */
  init(root: HTMLElement): Promise<void>;
  /** Build cards, fit camera to deskBounds(blocks.length). */
  showChannel(
    blocks: DeskBlock[],
    layout: ChannelLayout,
    opts?: { preserveCamera?: boolean },
  ): void;
  /** Add new cards without clearing existing ones or resetting the camera. */
  addBlocks(blocks: DeskBlock[], layout: ChannelLayout): void;
  /** Show/hide cards by block type (hidden types are invisible, not removed). */
  setTypeFilter(hiddenTypes: ReadonlySet<DeskBlockType>): void;
  /** Block id → handle (for interactions). */
  getCards(): Map<number, CardHandle>;
  /** Pixi canvas element, if initialized. */
  getCanvas(): HTMLCanvasElement | null;
  /**
   * Register a callback that is invoked at the end of showChannel and clear.
   * Interactions use this to re-wire listeners when cards change.
   */
  onCardsChanged(cb: () => void): void;
}

// ---------------------------------------------------------------------------
// Zoom/pan constants
// ---------------------------------------------------------------------------

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;

// CSS class applied to the Pixi canvas (single source of truth for canvas styles)
const CANVAS_CLASS = "desk-canvas";

// ---------------------------------------------------------------------------
// createDesk
// ---------------------------------------------------------------------------

export function createDesk(): Desk {
  let app: Application | null = null;
  let world: Container | null = null;
  let cards = new Map<number, CardHandle>();

  // Callbacks registered via onCardsChanged
  const cardsChangedCallbacks: Array<() => void> = [];

  function notifyCardsChanged(): void {
    for (const cb of cardsChangedCallbacks) cb();
  }

  // Pan state
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let worldStartX = 0;
  let worldStartY = 0;
  let textureRefreshScheduled = false;

  function scheduleRefreshCardTextures(): void {
    if (textureRefreshScheduled) return;
    textureRefreshScheduled = true;
    requestAnimationFrame(() => {
      textureRefreshScheduled = false;
      refreshCardTextures();
    });
  }

  async function init(root: HTMLElement): Promise<void> {
    // Guard against double-init (e.g. HMR or accidental second call)
    if (app) return;

    app = new Application();
    await app.init({
      resizeTo: window,
      background: 0xffffff,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Style the canvas via a class — style.css is the single source of truth
    app.canvas.classList.add(CANVAS_CLASS);
    root.appendChild(app.canvas);

    // World container — all cards are children
    world = new Container();
    world.sortableChildren = true;
    app.stage.addChild(world);

    // Stage needs hit area for empty-space pointer events
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;

    // ---------------------------------------------------------------------------
    // Zoom via wheel (cursor-anchored)
    // ---------------------------------------------------------------------------

    app.canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        if (!app || !world) return;

        const zoomFactor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        const currentScale = world.scale.x;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale * zoomFactor));

        if (newScale === currentScale) return;

        // Anchor zoom at cursor: the desk point under the cursor stays fixed
        const cx = e.clientX;
        const cy = e.clientY;

        const deskX = (cx - world.x) / currentScale;
        const deskY = (cy - world.y) / currentScale;

        world.scale.set(newScale);
        world.x = cx - deskX * newScale;
        world.y = cy - deskY * newScale;

        scheduleRefreshCardTextures();
      },
      { passive: false }
    );

    // ---------------------------------------------------------------------------
    // Pinch to zoom (touch)
    //
    // The canvas carries touch-action: none so one-finger panning works, which
    // also suppresses the browser's own pinch — so this is the only way to zoom
    // on a touch device. Listening natively rather than through Pixi's stage
    // because we need per-pointer tracking, not the primary pointer.
    //
    // Anchoring the desk point grabbed at pinch start to the *live* midpoint
    // gives two-finger panning for free: when the fingers translate without
    // spreading, scale holds and the world follows the midpoint.
    // ---------------------------------------------------------------------------

    const touches = new Map<number, { x: number; y: number }>();
    let pinching = false;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchDeskX = 0;
    let pinchDeskY = 0;

    function firstTwoTouches(): [
      { x: number; y: number },
      { x: number; y: number },
    ] | null {
      const pts = [...touches.values()];
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) return null;
      return [a, b];
    }

    function beginPinch(): void {
      const pair = firstTwoTouches();
      if (!pair || !world) return;
      const [a, b] = pair;

      pinchStartDist = Math.hypot(b.x - a.x, b.y - a.y);
      if (pinchStartDist <= 0) return;

      // A one-finger pan may already be in flight — stop it fighting the pinch
      isPanning = false;
      if (app) app.canvas.style.cursor = "";

      pinching = true;
      pinchStartScale = world.scale.x;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      pinchDeskX = (midX - world.x) / pinchStartScale;
      pinchDeskY = (midY - world.y) / pinchStartScale;
    }

    app.canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) beginPinch();
    });

    app.canvas.addEventListener("pointermove", (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (!pinching || !world) return;
      const pair = firstTwoTouches();
      if (!pair) return;
      const [a, b] = pair;

      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist <= 0) return;

      const newScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinchStartScale * (dist / pinchStartDist)),
      );
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      world.scale.set(newScale);
      world.x = midX - pinchDeskX * newScale;
      world.y = midY - pinchDeskY * newScale;

      scheduleRefreshCardTextures();
    });

    function releaseTouch(e: PointerEvent): void {
      if (e.pointerType === "mouse") return;
      touches.delete(e.pointerId);
      if (touches.size < 2) pinching = false;
    }

    app.canvas.addEventListener("pointerup", releaseTouch);
    app.canvas.addEventListener("pointercancel", releaseTouch);
    app.canvas.addEventListener("pointerleave", releaseTouch);

    // ---------------------------------------------------------------------------
    // Pan via pointer drag on empty stage
    // ---------------------------------------------------------------------------

    app.stage.on("pointerdown", (e) => {
      if (!world) return;
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      worldStartX = world.x;
      worldStartY = world.y;
      app!.canvas.style.cursor = "grabbing";
    });

    app.stage.on("pointermove", (e) => {
      if (!isPanning || !world) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      world.x = worldStartX + dx;
      world.y = worldStartY + dy;
    });

    const stopPan = () => {
      if (!isPanning) return;
      isPanning = false;
      if (app) app.canvas.style.cursor = "";
    };

    app.stage.on("pointerup", stopPan);
    app.stage.on("pointerupoutside", stopPan);
  }

  function addCardsFromLayout(
    blocks: DeskBlock[],
    layout: ChannelLayout,
  ): void {
    if (!world) return;

    for (const block of blocks) {
      if (cards.has(block.id)) continue;
      const stateKey = String(block.id);
      const state = layout[stateKey];
      if (!state) continue;

      const handle = createCard(block, state, { onRenderable: refreshCardTextures });
      world.addChild(handle.container);
      cards.set(block.id, handle);
    }
  }

  function showChannel(
    blocks: DeskBlock[],
    layout: ChannelLayout,
    opts?: { preserveCamera?: boolean },
  ): void {
    if (!app || !world) return;

    const preserveCamera = opts?.preserveCamera === true;
    const prevScale = world.scale.x;
    const prevX = world.x;
    const prevY = world.y;

    clearCards();

    const count = blocks.length;
    const bounds = boundsForLayout(layout, count);

    if (!preserveCamera) {
      const vp = { width: app.screen.width, height: app.screen.height };
      const { scale, x, y } = fitView(bounds, vp);
      world.scale.set(scale);
      world.x = x;
      world.y = y;
    } else {
      world.scale.set(prevScale);
      world.x = prevX;
      world.y = prevY;
    }

    addCardsFromLayout(blocks, layout);

    notifyCardsChanged();
    refreshCardTextures();
  }

  function addBlocks(blocks: DeskBlock[], layout: ChannelLayout): void {
    if (!app || !world) return;
    addCardsFromLayout(blocks, layout);
    notifyCardsChanged();
    refreshCardTextures();
  }

  function refreshCardTextures(): void {
    if (!world) return;
    const worldScale = world.scale.x;
    for (const handle of cards.values()) {
      if (!handle.sprite) continue;
      if (shouldLoadFullTexture(worldScale, handle.container.scale.x)) {
        void handle.loadFullTexture();
      }
    }
  }

  function clearCards(): void {
    if (!world) return;
    for (const handle of cards.values()) {
      world.removeChild(handle.container);
      handle.container.destroy({ children: true });
    }
    cards = new Map();
    evictTextures();
  }

  function setTypeFilter(hiddenTypes: ReadonlySet<DeskBlockType>): void {
    for (const handle of cards.values()) {
      handle.container.visible = !hiddenTypes.has(handle.block.type);
    }
  }

  function getCards(): Map<number, CardHandle> {
    return cards;
  }

  function getCanvas(): HTMLCanvasElement | null {
    return app?.canvas ?? null;
  }

  function onCardsChanged(cb: () => void): void {
    cardsChangedCallbacks.push(cb);
  }

  return {
    init,
    showChannel,
    addBlocks,
    setTypeFilter,
    getCards,
    getCanvas,
    onCardsChanged,
  };
}
