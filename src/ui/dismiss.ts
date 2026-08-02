// ---------------------------------------------------------------------------
// ui/dismiss.ts — close overlays on outside click or Escape
// ---------------------------------------------------------------------------

export interface DismissHandle {
  dispose(): void;
}

export function bindDismiss(opts: {
  isOpen: () => boolean;
  close: () => void;
  isInside: (target: Node) => boolean;
  /**
   * Close when the user clicks outside. Default true.
   *
   * Panels that stay open while you use the desk behind them (the about panel)
   * set this false and rely on Escape or their own close button.
   */
  outsideClick?: boolean;
}): DismissHandle {
  const outsideClick = opts.outsideClick !== false;

  function onMouseDown(e: MouseEvent): void {
    if (!opts.isOpen()) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (opts.isInside(target)) return;
    opts.close();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && opts.isOpen()) {
      opts.close();
    }
  }

  if (outsideClick) {
    document.addEventListener("mousedown", onMouseDown);
  }
  document.addEventListener("keydown", onKeyDown);

  return {
    dispose(): void {
      if (outsideClick) {
        document.removeEventListener("mousedown", onMouseDown);
      }
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
