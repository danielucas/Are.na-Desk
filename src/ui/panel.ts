// ---------------------------------------------------------------------------
// ui/panel.ts — draggable DOM panel in screen coords
// ---------------------------------------------------------------------------
//
// Cards on the desk are Pixi containers dragged in world coords (interactions.ts).
// This is the DOM equivalent for chrome that should feel like it's lying on the
// desk rather than floating above it in a modal.
// ---------------------------------------------------------------------------

import { bindDismiss } from "./dismiss";

export interface PanelHandle {
  el: HTMLDivElement;
  body: HTMLDivElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface PanelOpts {
  title: string;
  /** Extra class on the panel root, for per-panel sizing. */
  className?: string;
  /**
   * Width of a band at the centre of the viewport to keep clear on first open.
   * The panel sits to the left of it when both fit side by side, and falls back
   * to dead centre when they don't.
   */
  reserveCentreWidth?: number;
  onClose?: () => void;
}

/** Below this width the panel goes near-fullwidth and stops being draggable. */
const COMPACT_MAX_WIDTH = 600;

/** Smallest gap between the panel and a viewport edge. */
const EDGE_MARGIN = 8;

export function createPanel(root: HTMLElement, opts: PanelOpts): PanelHandle {
  const el = document.createElement("div");
  el.className = "desk-panel";
  if (opts.className) el.classList.add(opts.className);
  el.style.display = "none";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", opts.title);

  const bar = document.createElement("div");
  bar.className = "desk-panel-bar";

  const titleEl = document.createElement("span");
  titleEl.className = "desk-panel-title";
  titleEl.textContent = opts.title;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "desk-panel-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "close");

  bar.appendChild(titleEl);
  bar.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "desk-panel-body";

  el.appendChild(bar);
  el.appendChild(body);
  root.appendChild(el);

  let isOpen = false;
  /** False until the first non-compact open, so reopening keeps the last spot. */
  let placed = false;

  const compact = window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH}px)`);

  // -------------------------------------------------------------------------
  // Positioning
  // -------------------------------------------------------------------------

  function clamp(left: number, top: number): { left: number; top: number } {
    const rect = el.getBoundingClientRect();
    // Math.max guards the case where the panel is taller than the viewport:
    // pin it to the top edge rather than pushing it off the top.
    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - rect.width - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN);
    return {
      left: Math.min(Math.max(EDGE_MARGIN, left), maxLeft),
      top: Math.min(Math.max(EDGE_MARGIN, top), maxTop),
    };
  }

  function place(left: number, top: number): void {
    const pos = clamp(left, top);
    el.style.left = `${Math.round(pos.left)}px`;
    el.style.top = `${Math.round(pos.top)}px`;
  }

  /** Gap between the panel and the reserved centre band. */
  const RESERVE_GAP = 20;

  /**
   * Sitting beside the centre is only worth it if the panel also clears the
   * fixed chrome down the left edge (logo top-left, about button bottom-left).
   * Below this, centring looks deliberate where a near-miss looks broken.
   */
  const MIN_BESIDE_LEFT = 52;

  /**
   * Returns false when the panel can't be measured yet — opening while the tab
   * is hidden or before first layout gives a zero-width rect, and latching a
   * position from that would strand the panel in the corner for good.
   */
  function placeDefault(): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || window.innerWidth <= 0) return false;

    const top = (window.innerHeight - rect.height) / 2;
    const reserve = opts.reserveCentreWidth ?? 0;

    if (reserve > 0) {
      const beside =
        window.innerWidth / 2 - reserve / 2 - rect.width - RESERVE_GAP;
      if (beside >= MIN_BESIDE_LEFT) {
        place(beside, top);
        return true;
      }
    }

    place((window.innerWidth - rect.width) / 2, top);
    return true;
  }

  /**
   * Compact mode is positioned entirely by CSS, so inline left/top must be
   * cleared or it would fight the stylesheet.
   */
  function syncPosition(): void {
    if (compact.matches) {
      el.style.left = "";
      el.style.top = "";
      return;
    }
    if (!placed) {
      // Stays false on a failed measurement, so the next resize tries again
      placed = placeDefault();
      return;
    }
    place(el.offsetLeft, el.offsetTop);
  }

  // -------------------------------------------------------------------------
  // Drag by the title bar
  // -------------------------------------------------------------------------

  let dragging = false;
  let dragPointerId = -1;
  let grabX = 0;
  let grabY = 0;

  function onPointerDown(e: PointerEvent): void {
    if (compact.matches) return;
    if (e.target instanceof Node && closeBtn.contains(e.target)) return;

    const rect = el.getBoundingClientRect();
    dragging = true;
    dragPointerId = e.pointerId;
    grabX = e.clientX - rect.left;
    grabY = e.clientY - rect.top;
    bar.setPointerCapture(dragPointerId);
    el.classList.add("is-dragging");
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    place(e.clientX - grabX, e.clientY - grabY);
  }

  function endDrag(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    el.classList.remove("is-dragging");
    if (bar.hasPointerCapture(dragPointerId)) {
      bar.releasePointerCapture(dragPointerId);
    }
    dragPointerId = -1;
  }

  bar.addEventListener("pointerdown", onPointerDown);
  bar.addEventListener("pointermove", onPointerMove);
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);

  // -------------------------------------------------------------------------
  // Open / close
  // -------------------------------------------------------------------------

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    el.style.display = "";
    syncPosition();
    closeBtn.focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    el.style.display = "none";
    opts.onClose?.();
  }

  function toggle(): void {
    if (isOpen) close();
    else open();
  }

  closeBtn.addEventListener("click", close);

  // Escape closes; clicking the desk behind it deliberately does not — the
  // panel explains how the desk works, so it has to survive using the desk.
  const dismiss = bindDismiss({
    isOpen: () => isOpen,
    close,
    isInside: (target) => el.contains(target),
    outsideClick: false,
  });

  function onViewportChange(): void {
    if (isOpen) syncPosition();
  }

  window.addEventListener("resize", onViewportChange);
  compact.addEventListener("change", onViewportChange);

  return {
    el,
    body,
    open,
    close,
    toggle,
    isOpen: () => isOpen,
    dispose(): void {
      dismiss.dispose();
      window.removeEventListener("resize", onViewportChange);
      compact.removeEventListener("change", onViewportChange);
      bar.removeEventListener("pointerdown", onPointerDown);
      bar.removeEventListener("pointermove", onPointerMove);
      bar.removeEventListener("pointerup", endDrag);
      bar.removeEventListener("pointercancel", endDrag);
      el.remove();
    },
  };
}
