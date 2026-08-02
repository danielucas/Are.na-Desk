// ---------------------------------------------------------------------------
// popup.ts — metadata popup DOM panel
// ---------------------------------------------------------------------------

import type { DeskBlock } from "../types";
import { formatUtcDate } from "../dateFormat";
import { truncate } from "../truncate";
import { bindDismiss } from "./dismiss";

export interface PopupOpts {
  onDispose?: (handle: { dispose(): void }) => void;
}

export function initPopup(
  root: HTMLElement,
  opts: PopupOpts = {},
): {
  show(block: DeskBlock, x: number, y: number): void;
  hide(): void;
} {
  const el = document.createElement("div");
  el.className = "desk-popup";
  el.style.display = "none";
  root.appendChild(el);

  // Track whether the popup is currently shown, so we can avoid false dismissals
  let visible = false;

  function hide(): void {
    visible = false;
    el.style.display = "none";
  }

  const escDismiss = bindDismiss({
    isOpen: () => visible,
    close: hide,
    isInside: (target) => el.contains(target),
  });
  opts.onDispose?.(escDismiss);

  // Click-away: capture-phase pointerdown fires before Pixi's bubble.

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!visible) return;
      // If the click is inside the popup itself, don't close
      if (el.contains(e.target as Node)) return;
      hide();
    },
    true // capture so it fires before Pixi's bubble
  );

  // ---------------------------------------------------------------------------
  // show
  // ---------------------------------------------------------------------------

  function show(block: DeskBlock, x: number, y: number): void {
    visible = true;

    // Build rows
    el.textContent = ""; // clear — safe, no innerHTML

    // Title row (bold-ish via font-weight; if no title, show "untitled" in gray)
    const titleEl = document.createElement("div");
    titleEl.className = "desk-popup-title";
    if (block.title) {
      titleEl.textContent = block.title;
    } else {
      titleEl.textContent = "untitled";
      titleEl.className += " desk-popup-muted";
    }
    el.appendChild(titleEl);

    // Type
    appendRow(el, "type", block.type.toLowerCase());

    // Connected by / date
    if (block.connectedBy || block.connectedAt) {
      let val = "";
      if (block.connectedBy) val += block.connectedBy;
      if (block.connectedAt) {
        const date = formatUtcDate(block.connectedAt);
        val += val ? ` · ${date}` : date;
      }
      appendRow(el, "connected by", val);
    }

    // Source URL
    if (block.sourceUrl) {
      const row = document.createElement("div");
      row.className = "desk-popup-row";

      const labelEl = document.createElement("span");
      labelEl.className = "desk-popup-label";
      labelEl.textContent = "source";

      // Only make it a link when the URL starts with http(s); otherwise render
      // as plain text to avoid javascript: or data: URLs in an href.
      const isHttpUrl = /^https?:\/\//i.test(block.sourceUrl);
      if (isHttpUrl) {
        const linkEl = document.createElement("a");
        linkEl.textContent = truncate(block.sourceUrl, 40);
        linkEl.href = block.sourceUrl;
        linkEl.target = "_blank";
        linkEl.rel = "noopener noreferrer";
        row.appendChild(labelEl);
        row.appendChild(document.createTextNode(" "));
        row.appendChild(linkEl);
      } else {
        const valueEl = document.createElement("span");
        valueEl.className = "desk-popup-value";
        valueEl.textContent = truncate(block.sourceUrl, 40);
        row.appendChild(labelEl);
        row.appendChild(document.createTextNode(" "));
        row.appendChild(valueEl);
      }

      el.appendChild(row);
    }

    // Description (truncated, text only)
    if (block.description) {
      appendRow(el, "description", truncate(block.description, 200));
    }

    // Open on Are.na (always last)
    const arenaRow = document.createElement("div");
    arenaRow.className = "desk-popup-row desk-popup-arena-link";
    const arenaLink = document.createElement("a");
    arenaLink.textContent = "open on are.na ↗";
    arenaLink.href = block.arenaUrl;
    arenaLink.target = "_blank";
    arenaLink.rel = "noopener noreferrer";
    arenaRow.appendChild(arenaLink);
    el.appendChild(arenaRow);

    // ---------------------------------------------------------------------------
    // Position: near (x, y), clamped to viewport
    // ---------------------------------------------------------------------------

    el.style.display = "block";

    const POPUP_MAX_WIDTH = 300;
    const PADDING = 12;
    const OFFSET = 8; // pixels from the cursor

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Measure after showing
    const rect = el.getBoundingClientRect();
    const pw = Math.min(rect.width, POPUP_MAX_WIDTH);
    const ph = rect.height;

    // Default: open below-right of cursor
    let left = x + OFFSET;
    let top = y + OFFSET;

    // Flip horizontal if it would overflow right
    if (left + pw > vw - PADDING) {
      left = x - pw - OFFSET;
    }
    // Clamp left
    left = Math.max(PADDING, left);

    // Flip vertical if it would overflow bottom
    if (top + ph > vh - PADDING) {
      top = y - ph - OFFSET;
    }
    // Clamp top
    top = Math.max(PADDING, top);

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  return { show, hide };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appendRow(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement("div");
  row.className = "desk-popup-row";

  const labelEl = document.createElement("span");
  labelEl.className = "desk-popup-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "desk-popup-value";
  valueEl.textContent = value;

  row.appendChild(labelEl);
  row.appendChild(document.createTextNode(" "));
  row.appendChild(valueEl);
  parent.appendChild(row);
}
