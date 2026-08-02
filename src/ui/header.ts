// ---------------------------------------------------------------------------
// ui/header.ts — channel header bar + arena link + block type filter
// ---------------------------------------------------------------------------

import type { DeskBlock, DeskBlockType, DeskChannel, LayoutMode } from "../types";
import { blockTypeLabel, typesPresentInChannel } from "../blockFilter";
import { bindDismiss } from "./dismiss";

export interface HeaderShowOpts {
  canLoadMore?: boolean;
  loadingMore?: boolean;
}

export interface HeaderOpts {
  onLayoutModeChange: (mode: LayoutMode) => void;
  onLoadMore: () => void;
  onFilterChange: () => void;
  onResetLayout: () => void;
  onDispose?: (handle: { dispose(): void }) => void;
}

function formatMetaText(ch: DeskChannel, showing: number): string {
  const base = `${ch.title}, ${ch.blockCount} blocks`;
  if (showing > 0 && showing < ch.blockCount) {
    return `${base}, showing ${showing} of ${ch.blockCount}`;
  }
  return base;
}

export function initHeader(
  root: HTMLElement,
  opts: HeaderOpts,
): {
  show(ch: DeskChannel, showing: number, showOpts?: HeaderShowOpts): void;
  hide(): void;
  setLayoutMode(mode: LayoutMode): void;
  setBlockTypes(blocks: DeskBlock[]): void;
  refreshBlockTypes(blocks: DeskBlock[]): void;
  closeFilter(): void;
  toggleFilter(): void;
  getHiddenTypes(): ReadonlySet<DeskBlockType>;
  setRefreshLoading(count: number | null): void;
} {
  const bar = document.createElement("div");
  bar.className = "channel-header";
  bar.style.display = "none";
  root.appendChild(bar);

  const meta = document.createElement("div");
  meta.className = "channel-header-meta";
  bar.appendChild(meta);

  const toolbar = document.createElement("div");
  toolbar.className = "channel-header-toolbar";
  bar.appendChild(toolbar);

  const layoutRow = document.createElement("div");
  layoutRow.className = "channel-header-layout";
  layoutRow.setAttribute("role", "group");
  layoutRow.setAttribute("aria-label", "layout mode");
  toolbar.appendChild(layoutRow);

  const filterWrap = document.createElement("div");
  filterWrap.className = "channel-header-filter-wrap";
  toolbar.appendChild(filterWrap);

  const filterBtn = document.createElement("button");
  filterBtn.type = "button";
  filterBtn.className = "channel-header-filter-btn";
  filterBtn.textContent = "filter";
  filterBtn.setAttribute("aria-expanded", "false");
  filterBtn.setAttribute("aria-haspopup", "listbox");
  filterWrap.appendChild(filterBtn);

  const filterDropdown = document.createElement("div");
  filterDropdown.className = "channel-header-filter-dropdown chrome-prompt-results";
  filterDropdown.setAttribute("role", "listbox");
  filterDropdown.setAttribute("aria-label", "filter block types");
  filterWrap.appendChild(filterDropdown);

  // Only meaningful in scatter mode — the date layout is computed, not arranged
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "channel-header-reset-btn";
  resetBtn.textContent = "reset";
  resetBtn.title = "re-scatter the cards and forget the saved arrangement";
  resetBtn.addEventListener("click", () => {
    opts.onResetLayout();
  });
  toolbar.appendChild(resetBtn);

  const arenaRow = document.createElement("div");
  arenaRow.className = "channel-arena-row";

  const refreshStatus = document.createElement("span");
  refreshStatus.className = "channel-refresh-status";
  refreshStatus.hidden = true;
  arenaRow.appendChild(refreshStatus);

  const arenaLink = document.createElement("a");
  arenaLink.className = "channel-arena-link";
  arenaLink.target = "_blank";
  arenaLink.rel = "noopener noreferrer";
  arenaLink.textContent = "view on are.na ↗";
  arenaRow.appendChild(arenaLink);

  arenaRow.style.display = "none";
  root.appendChild(arenaRow);

  let layoutMode: LayoutMode = "scatter";
  let filterOpen = false;
  let presentTypes: DeskBlockType[] = [];
  const hiddenTypes = new Set<DeskBlockType>();

  function closeFilter(): void {
    filterOpen = false;
    filterBtn.setAttribute("aria-expanded", "false");
    filterDropdown.classList.remove("chrome-prompt-results--open");
  }

  function openFilter(): void {
    if (presentTypes.length === 0) return;
    filterOpen = true;
    filterBtn.setAttribute("aria-expanded", "true");
    filterDropdown.classList.add("chrome-prompt-results--open");
  }

  function toggleFilter(): void {
    if (filterOpen) {
      closeFilter();
    } else {
      openFilter();
    }
  }

  const filterDismiss = bindDismiss({
    isOpen: () => filterOpen,
    close: closeFilter,
    isInside: (target) => filterWrap.contains(target),
  });
  opts.onDispose?.(filterDismiss);

  function syncFilterButton(): void {
    filterBtn.classList.toggle("is-active", hiddenTypes.size > 0);
    filterBtn.disabled = presentTypes.length === 0;
  }

  function renderFilterOptions(): void {
    filterDropdown.innerHTML = "";

    for (const type of presentTypes) {
      const row = document.createElement("label");
      row.className = "channel-header-filter-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !hiddenTypes.has(type);

      const label = document.createElement("span");
      label.textContent = blockTypeLabel(type);

      row.appendChild(checkbox);
      row.appendChild(label);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          hiddenTypes.delete(type);
        } else {
          hiddenTypes.add(type);
        }
        syncFilterButton();
        opts.onFilterChange();
      });

      filterDropdown.appendChild(row);
    }

    syncFilterButton();
  }

  function syncResetButton(): void {
    resetBtn.hidden = layoutMode !== "scatter";
  }

  function rebuildLayoutToggle(): void {
    syncResetButton();
    layoutRow.innerHTML = "";

    for (const mode of ["scatter", "by date"] as const) {
      const value: LayoutMode = mode === "scatter" ? "scatter" : "date";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = mode;
      btn.className = "channel-header-layout-btn";
      if (layoutMode === value) {
        btn.classList.add("is-active");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.setAttribute("aria-pressed", "false");
      }
      btn.addEventListener("click", () => {
        if (layoutMode === value) return;
        opts.onLayoutModeChange(value);
      });
      layoutRow.appendChild(btn);
    }
  }

  rebuildLayoutToggle();

  filterBtn.addEventListener("click", () => {
    toggleFilter();
  });

  function updateMeta(
    ch: DeskChannel,
    showing: number,
    showOpts: HeaderShowOpts,
  ): void {
    meta.innerHTML = "";

    const metaText = document.createElement("span");
    metaText.className = "channel-header-meta-text";
    metaText.textContent = formatMetaText(ch, showing);
    meta.appendChild(metaText);

    const showLoadMore =
      showOpts.canLoadMore === true &&
      showing > 0 &&
      showing < ch.blockCount;

    if (showLoadMore) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.type = "button";
      loadMoreBtn.className = "channel-header-load-more";
      loadMoreBtn.textContent = showOpts.loadingMore ? "loading…" : "load more";
      loadMoreBtn.disabled = showOpts.loadingMore === true;
      loadMoreBtn.addEventListener("click", () => {
        opts.onLoadMore();
      });
      meta.appendChild(loadMoreBtn);
    }
  }

  function show(
    ch: DeskChannel,
    showing: number,
    showOpts: HeaderShowOpts = {},
  ): void {
    updateMeta(ch, showing, showOpts);
    bar.style.display = "";

    arenaLink.href = ch.arenaUrl;
    arenaRow.style.display = "";
  }

  function setRefreshLoading(count: number | null): void {
    if (count === null || count <= 0) {
      refreshStatus.hidden = true;
      refreshStatus.textContent = "";
      return;
    }
    const label = count === 1 ? "1 new block loading…" : `${count} new blocks loading…`;
    refreshStatus.textContent = label;
    refreshStatus.hidden = false;
  }

  function setLayoutMode(mode: LayoutMode): void {
    layoutMode = mode;
    rebuildLayoutToggle();
  }

  function setBlockTypes(blocks: DeskBlock[]): void {
    closeFilter();
    hiddenTypes.clear();
    presentTypes = typesPresentInChannel(blocks);
    renderFilterOptions();
    opts.onFilterChange();
  }

  function refreshBlockTypes(blocks: DeskBlock[]): void {
    const next = typesPresentInChannel(blocks);
    const unchanged =
      next.length === presentTypes.length &&
      next.every((type, i) => presentTypes[i] === type);
    if (unchanged) return;

    presentTypes = next;
    for (const type of [...hiddenTypes]) {
      if (!presentTypes.includes(type)) {
        hiddenTypes.delete(type);
      }
    }
    renderFilterOptions();
    opts.onFilterChange();
  }

  function hide(): void {
    closeFilter();
    bar.style.display = "none";
    meta.innerHTML = "";
    arenaRow.style.display = "none";
    arenaLink.removeAttribute("href");
    setRefreshLoading(null);
    layoutMode = "scatter";
    presentTypes = [];
    hiddenTypes.clear();
    filterDropdown.innerHTML = "";
    rebuildLayoutToggle();
    syncFilterButton();
  }

  function getHiddenTypes(): ReadonlySet<DeskBlockType> {
    return hiddenTypes;
  }

  syncFilterButton();

  return {
    show,
    hide,
    setLayoutMode,
    setBlockTypes,
    refreshBlockTypes,
    closeFilter,
    toggleFilter,
    getHiddenTypes,
    setRefreshLoading,
  };
}
