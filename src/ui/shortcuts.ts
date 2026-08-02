// ---------------------------------------------------------------------------
// ui/shortcuts.ts — global keyboard shortcuts
// ---------------------------------------------------------------------------

export interface ShortcutHandlers {
  onSearch(): void;
  onScatter(): void;
  onDate(): void;
  onFilter(): void;
  onAbout(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function bindShortcuts(handlers: ShortcutHandlers): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;

    switch (e.key) {
      case "/":
        e.preventDefault();
        handlers.onSearch();
        break;
      case "s":
        handlers.onScatter();
        break;
      case "d":
        handlers.onDate();
        break;
      case "f":
        handlers.onFilter();
        break;
      // Shift is deliberately not filtered above, so "?" (shift + /) arrives here
      case "?":
        e.preventDefault();
        handlers.onAbout();
        break;
    }
  }

  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}
