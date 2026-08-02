// ---------------------------------------------------------------------------
// interactions.ts — card drag, resize, click, bring-to-front
// ---------------------------------------------------------------------------

import type { Container } from "pixi.js";
import type { CardState } from "./scatter";
import type { DeskBlock } from "./types";
import type { Desk } from "./desk";
import { shouldLoadFullTexture, type CardHandle } from "./card";
import { Graphics } from "pixi.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InteractionOpts {
  /** Fired after drag end, resize end, or bring-to-front. */
  onCardChange(blockId: number, state: CardState): void;
  /** Fired on pointerup without significant movement. */
  onCardClick(block: DeskBlock, screenX: number, screenY: number): void;
}

export function initInteractions(desk: Desk, opts: InteractionOpts): void {
  const canvas = desk.getCanvas();

  function setCanvasCursor(cursor: string): void {
    if (canvas) canvas.style.cursor = cursor;
  }

  // Track the highest zIndex in use across the current channel.
  let maxZ = 0;

  // Guard against double-wiring the same container across re-wires.
  const wired = new WeakSet<Container>();

  function wireAll(): void {
    // Re-initialize maxZ from whatever's currently loaded
    maxZ = 0;
    for (const handle of desk.getCards().values()) {
      if (handle.container.zIndex > maxZ) maxZ = handle.container.zIndex;
    }

    for (const handle of desk.getCards().values()) {
      if (!wired.has(handle.container)) {
        wired.add(handle.container);
        wireCard(handle);
      }
    }
  }

  function readState(handle: CardHandle): CardState {
    const c = handle.container;
    return {
      x: c.x,
      y: c.y,
      scale: c.scale.x,
      rotation: c.rotation,
      z: c.zIndex,
    };
  }

  function bringToFront(handle: CardHandle): void {
    if (handle.container.zIndex >= maxZ) return;
    maxZ += 1;
    handle.container.zIndex = maxZ;
    opts.onCardChange(handle.block.id, readState(handle));
  }

  function wireCard(handle: CardHandle): void {
    const container = handle.container;

    // Hover cursor
    container.cursor = "pointer";

    // -----------------------------------------------------------------------
    // Resize handle — created once per card, shown on hover/resize
    // -----------------------------------------------------------------------

    const HANDLE_SIZE = 14;
    const resizeHandle = new Graphics();
    // Draw a small white square with 1px --ink stroke, centered in itself
    resizeHandle
      .rect(-HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
      .fill(0xffffff)
      .stroke({ width: 0.5, color: 0xcccccc });

    // Position at bottom-right of the card (unscaled — it's in container space)
    resizeHandle.x = handle.baseWidth / 2;
    resizeHandle.y = handle.baseHeight / 2;

    resizeHandle.eventMode = "static";
    resizeHandle.cursor = "nwse-resize";
    resizeHandle.visible = false;
    container.addChild(resizeHandle);

    // Counter-scale the handle so it stays ~14 screen-ish px at any card scale
    function updateHandleScale(): void {
      const s = container.scale.x;
      if (s > 0.001) {
        resizeHandle.scale.set(1 / s);
      }
    }

    // Show resize handle on hover (counter-scaled)
    container.on("pointerover", () => {
      updateHandleScale();
      resizeHandle.visible = true;
    });
    container.on("pointerout", () => {
      if (!isResizing) resizeHandle.visible = false;
    });

    // -----------------------------------------------------------------------
    // Drag state
    // -----------------------------------------------------------------------

    const DRAG_THRESHOLD = 4; // screen pixels

    let isDragging = false;
    let dragStartScreenX = 0;
    let dragStartScreenY = 0;
    let moved = false;

    // Grab offset in world (desk) coordinates
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    // -----------------------------------------------------------------------
    // Resize state
    // -----------------------------------------------------------------------

    let isResizing = false;
    let resizeStartScale = 1;
    let resizeStartDist = 0;

    // -----------------------------------------------------------------------
    // Resize handle: pointerdown
    // -----------------------------------------------------------------------

    resizeHandle.on("pointerdown", (e) => {
      // Stop propagation so card drag logic is NOT triggered
      e.stopPropagation();

      // Bring-to-front is fine on resize start
      bringToFront(handle);

      isResizing = true;
      resizeHandle.visible = true;
      updateHandleScale();

      resizeStartScale = container.scale.x;

      // Card center in screen/global coords — computed fresh each time
      const world = container.parent;
      if (!world) return;

      const getGlobalCenter = () => world.toGlobal({ x: container.x, y: container.y });
      const initialCenter = getGlobalCenter();

      // Start distance from card center to pointer
      resizeStartDist = Math.hypot(
        e.clientX - initialCenter.x,
        e.clientY - initialCenter.y
      );

      // Attach stage-level listeners for move/up
      const stage = world.parent;
      if (!stage) return;

      const onResizeMove = (ev: { clientX: number; clientY: number }) => {
        if (!isResizing) return;
        // Recompute card center fresh on every move so wheel-zoom mid-resize
        // doesn't cause a scale jump
        const center = getGlobalCenter();
        const newScale = computeResizeScale(
          center,
          resizeStartDist,
          { x: ev.clientX, y: ev.clientY },
          resizeStartScale
        );
        container.scale.set(newScale);
        // Keep the handle visually stable
        updateHandleScale();
      };

      const onResizeUp = () => {
        if (!isResizing) return;
        isResizing = false;
        resizeHandle.visible = false;

        stage.off("globalpointermove", onResizeMove);
        stage.off("pointerup", onResizeUp);
        stage.off("pointerupoutside", onResizeUp);

        opts.onCardChange(handle.block.id, readState(handle));

        const worldScale = container.parent?.scale.x ?? 1;
        if (shouldLoadFullTexture(worldScale, container.scale.x)) {
          void handle.loadFullTexture();
        }
      };

      stage.on("globalpointermove", onResizeMove);
      stage.on("pointerup", onResizeUp);
      stage.on("pointerupoutside", onResizeUp);
    });

    // -----------------------------------------------------------------------
    // Card: pointerdown → begin potential drag
    // -----------------------------------------------------------------------

    container.on("pointerdown", (e) => {
      // Bring-to-front
      bringToFront(handle);

      isDragging = true;
      moved = false;
      dragStartScreenX = e.clientX;
      dragStartScreenY = e.clientY;

      // Compute grab offset in world (desk) coordinates so the card doesn't
      // jump. We use getLocalPosition(world) which gives us desk-space coords.
      const world = container.parent;
      if (!world) return;

      const pointerInWorld = e.getLocalPosition(world);
      grabOffsetX = pointerInWorld.x - container.x;
      grabOffsetY = pointerInWorld.y - container.y;

      // Stage-level move and up listeners so drag doesn't freeze when crossing
      // DOM chrome elements
      const onMove = (ev: { clientX: number; clientY: number; getLocalPosition: (c: Container) => { x: number; y: number } }) => {
        if (!isDragging) return;

        const dx = ev.clientX - dragStartScreenX;
        const dy = ev.clientY - dragStartScreenY;

        if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          moved = true;
          setCanvasCursor("grabbing");
        }

        if (!moved) return;

        // Move card to pointer in world (desk) coords
        const w = container.parent;
        if (!w) return;
        const pointerWorld = (ev as unknown as { getLocalPosition: (c: Container) => { x: number; y: number } }).getLocalPosition(w);
        container.x = pointerWorld.x - grabOffsetX;
        container.y = pointerWorld.y - grabOffsetY;
      };

      // onUp is the SINGLE owner of drag-end: click detection, onCardChange,
      // cursor reset, and listener teardown all happen here.
      const onUp = (ev: { clientX: number; clientY: number }) => {
        if (!isDragging) return;
        isDragging = false;
        const wasMoved = moved;
        moved = false;

        setCanvasCursor("");

        // Remove stage listeners
        const w = container.parent;
        const stg = w?.parent;
        if (stg) {
          stg.off("globalpointermove", onMove);
          stg.off("pointerup", onUp);
          stg.off("pointerupoutside", onUp);
        }

        // Click detection: no significant movement and not a resize gesture
        if (!wasMoved && !isResizing) {
          opts.onCardClick(handle.block, ev.clientX, ev.clientY);
        }

        // Persist position (drag end) — always fire so the final position
        // is saved to localStorage regardless of whether the pointer was
        // released over the card or outside it.
        opts.onCardChange(handle.block.id, readState(handle));
      };

      const stage2 = world.parent;
      if (stage2) {
        stage2.on("globalpointermove", onMove);
        stage2.on("pointerup", onUp);
        stage2.on("pointerupoutside", onUp);
      }
    });

    // NOTE: No container "pointerup" handler — the stage-level onUp above is
    // the single owner of gesture end (drag, click detection, cleanup).
    // Container AT_TARGET listeners would fire BEFORE the stage bubble listener,
    // which would cause isDragging to be cleared before onUp runs.
  }

  // Initial wiring
  wireAll();

  // Re-wire when desk rebuilds cards (channel switch or clear)
  desk.onCardsChanged(wireAll);
}

// ---------------------------------------------------------------------------
// computeResizeScale — pure helper, exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Compute the new scale when resizing proportionally.
 *
 * @param center     Card center in screen coords (recomputed each move frame)
 * @param startDist  Distance from center to pointer at gesture start
 * @param current    Current pointer position in screen coords
 * @param startScale Card scale at the start of the resize gesture
 *
 * scale = startScale × (currentDist / startDist), clamped to [0.2, 5].
 * Degenerate case (startDist ≈ 0): returns startScale unchanged.
 */
export function computeResizeScale(
  center: { x: number; y: number },
  startDist: number,
  current: { x: number; y: number },
  startScale: number
): number {
  const dist = Math.hypot(current.x - center.x, current.y - center.y);

  if (startDist < 0.001) return startScale;

  const scale = startScale * (dist / startDist);
  return Math.min(5, Math.max(0.2, scale));
}
