// ---------------------------------------------------------------------------
// channelController.ts — channel load, layout, filter, and persistence
// ---------------------------------------------------------------------------

import {
  getChannel,
  getChannelContents,
  loadMoreChannelContents,
  pollChannelNewBlocks,
  ApiError,
} from "./api";
import type { ChannelContentsCursor } from "./api";
import { loadLayout, saveLayout, clearLayout, reconcileLayout } from "./persistence";
import type { ChannelLayout } from "./persistence";
import { scatterLayout } from "./scatter";
import { saveLastChannel, clearLastChannel } from "./lastChannel";
import { writeChannelParam, clearChannelParam } from "./urlChannel";
import { isLoggedIn, onAuthChange } from "./auth";
import { dateLayout, dateLayoutForNewBlocks } from "./dateLayout";
import { debounce } from "./debounce";
import { formatApiError, formatChannelNotFound } from "./formatApiError";
import type { Desk } from "./desk";
import type { DeskBlock, DeskChannel, LayoutMode } from "./types";
import type { ChromeRefs } from "./ui/chrome";
import type { CardState } from "./scatter";

const REFRESH_INTERVAL_MS = 30_000;

export interface ChannelControllerDeps {
  desk: Desk;
  refs: ChromeRefs;
  header: {
    show(ch: DeskChannel, showing: number, opts?: object): void;
    hide(): void;
    setLayoutMode(mode: LayoutMode): void;
    setBlockTypes(blocks: DeskBlock[]): void;
    refreshBlockTypes(blocks: DeskBlock[]): void;
    closeFilter(): void;
    getHiddenTypes(): ReadonlySet<import("./types").DeskBlockType>;
    setRefreshLoading(count: number | null): void;
  };
  popup: { hide(): void };
  loginUi: { closeChannels: () => void };
  prompt: {
    reset(): void;
    focus(): void;
    closeResults(): void;
    refreshLastChannelBtn(): void;
    setWelcomeVisible(visible: boolean): void;
  };
  getToken: () => string | null;
  showPromptOverlay: (dimDesk: boolean) => void;
  hidePromptOverlay: () => void;
}

export function createChannelController(deps: ChannelControllerDeps) {
  const {
    desk,
    refs,
    header,
    popup,
    loginUi,
    prompt,
    getToken,
    showPromptOverlay,
    hidePromptOverlay,
  } = deps;

  let currentSlug = "";
  let currentDeskChannel: DeskChannel | null = null;
  let currentBlocks: DeskBlock[] = [];
  let currentLayout: ChannelLayout = {};
  let layoutMode: LayoutMode = "scatter";
  let selectSeq = 0;
  let loadMoreSeq = 0;
  let refreshSeq = 0;
  let lastPolledBlockCount = 0;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let contentsCursor: ChannelContentsCursor | null = null;
  let contentsCanLoadMore = false;

  const debouncedSave = debounce((slug: string, layout: ChannelLayout) => {
    saveLayout(slug, layout);
  }, 500);

  function stopRefreshPoll(): void {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    header.setRefreshLoading(null);
  }

  function startRefreshPoll(): void {
    stopRefreshPoll();
    refreshTimer = setInterval(() => {
      void handleRefresh();
    }, REFRESH_INTERVAL_MS);
  }

  function goHome(): void {
    selectSeq++;
    loadMoreSeq++;
    refreshSeq++;
    stopRefreshPoll();
    if (currentSlug) {
      debouncedSave.cancel();
    }

    currentSlug = "";
    currentDeskChannel = null;
    currentBlocks = [];
    currentLayout = {};
    contentsCursor = null;
    contentsCanLoadMore = false;
    lastPolledBlockCount = 0;

    desk.showChannel([], {});
    header.hide();
    clearChannelParam();
    popup.hide();
    loginUi.closeChannels();
    header.closeFilter();

    prompt.reset();
    prompt.setWelcomeVisible(true);
    showPromptOverlay(false);
    refs.promptFeedback.textContent = "";
  }

  function isPrivateChannel(ch: DeskChannel | null): boolean {
    return ch !== null && ch.visibility !== "public";
  }

  onAuthChange((user) => {
    if (user) return;
    clearLastChannel();
    prompt.refreshLastChannelBtn();
    if (isPrivateChannel(currentDeskChannel)) {
      goHome();
    }
  });

  function applyTypeFilter(): void {
    desk.setTypeFilter(header.getHiddenTypes());
  }

  function updateHeader(
    showing: number,
    opts?: { canLoadMore?: boolean; loadingMore?: boolean },
  ): void {
    if (!currentDeskChannel) return;
    const canLoadMore =
      (opts?.canLoadMore ?? contentsCanLoadMore) &&
      showing < currentDeskChannel.blockCount;
    header.show(currentDeskChannel, showing, {
      canLoadMore,
      loadingMore: opts?.loadingMore,
    });
  }

  function buildLayout(mode: LayoutMode): ChannelLayout {
    const blockIds = currentBlocks.map((b) => b.id);
    if (mode === "date") {
      return dateLayout(currentBlocks, currentSlug);
    }
    return reconcileLayout(loadLayout(currentSlug), blockIds, currentSlug);
  }

  function showChannelOnDesk(blocks: DeskBlock[], slug: string, ch: DeskChannel): void {
    currentBlocks = blocks;
    currentSlug = slug;
    currentDeskChannel = ch;
    lastPolledBlockCount = ch.blockCount;
    layoutMode = "scatter";
    currentLayout = buildLayout("scatter");
    header.setLayoutMode("scatter");
    header.setBlockTypes(blocks);
    saveLayout(currentSlug, currentLayout);
    desk.showChannel(currentBlocks, currentLayout);
    applyTypeFilter();
    prompt.setWelcomeVisible(false);
    updateHeader(blocks.length);
    startRefreshPoll();
  }

  function applyBlocksToDesk(newBlocks: DeskBlock[]): void {
    if (newBlocks.length === 0) return;

    const priorBlocks = currentBlocks;
    currentBlocks = [...currentBlocks, ...newBlocks];

    let delta: ChannelLayout = {};

    if (layoutMode === "date") {
      delta = dateLayoutForNewBlocks(
        newBlocks,
        priorBlocks,
        currentLayout,
        currentSlug,
      );
      currentLayout = { ...currentLayout, ...delta };
    } else {
      currentLayout = reconcileLayout(
        currentLayout,
        currentBlocks.map((b) => b.id),
        currentSlug,
      );
      for (const block of newBlocks) {
        const state = currentLayout[String(block.id)];
        if (state) delta[String(block.id)] = state;
      }
    }

    desk.addBlocks(newBlocks, delta);

    if (layoutMode === "scatter") {
      saveLayout(currentSlug, currentLayout);
    }

    header.refreshBlockTypes(currentBlocks);
    applyTypeFilter();
  }

  function applyLayoutMode(mode: LayoutMode): void {
    if (!currentSlug || currentBlocks.length === 0) return;

    layoutMode = mode;
    currentLayout = buildLayout(mode);
    header.setLayoutMode(mode);
    desk.showChannel(currentBlocks, currentLayout);

    if (mode === "scatter") {
      debouncedSave.cancel();
      saveLayout(currentSlug, currentLayout);
    }

    applyTypeFilter();
  }

  /**
   * Throw out the saved arrangement and re-scatter.
   *
   * The seed gets a random suffix because scatterLayout is deterministic —
   * reusing currentSlug would rebuild the exact same desk and look broken.
   * The new positions are saved immediately, so they survive a reload even
   * though the seed itself doesn't.
   */
  function resetLayout(): void {
    if (!currentSlug || currentBlocks.length === 0) return;
    if (layoutMode !== "scatter") return;

    debouncedSave.cancel();
    clearLayout(currentSlug);
    popup.hide();

    const seed = `${currentSlug}#${Math.random().toString(36).slice(2)}`;
    currentLayout = scatterLayout(currentBlocks.map((b) => b.id), seed);
    saveLayout(currentSlug, currentLayout);

    desk.showChannel(currentBlocks, currentLayout);
    applyTypeFilter();
  }

  function onCardChange(blockId: number, state: CardState): void {
    currentLayout[String(blockId)] = state;
    if (currentSlug && layoutMode === "scatter") {
      debouncedSave(currentSlug, currentLayout);
    }
  }

  function openSearch(): void {
    popup.hide();
    loginUi.closeChannels();
    header.closeFilter();

    if (currentSlug && currentBlocks.length > 0) {
      prompt.reset();
      prompt.setWelcomeVisible(false);
      showPromptOverlay(true);
      prompt.focus();
      return;
    }

    prompt.reset();
    prompt.setWelcomeVisible(true);
    showPromptOverlay(false);
    prompt.focus();
  }

  async function handleSelect(slugOrId: string): Promise<void> {
    const thisSeq = ++selectSeq;
    loadMoreSeq++;
    refreshSeq++;
    stopRefreshPoll();

    if (currentSlug) {
      debouncedSave.cancel();
      saveLayout(currentSlug, currentLayout);
    }

    popup.hide();
    showPromptOverlay(currentBlocks.length > 0);
    refs.promptFeedback.textContent = `loading ${slugOrId}…`;

    try {
      const ch = await getChannel(slugOrId, getToken());
      if (thisSeq !== selectSeq) return;

      refs.promptFeedback.textContent = `loading blocks… 0/${ch.blockCount}`;

      const contents = await getChannelContents(
        slugOrId,
        getToken(),
        (loaded) => {
          if (thisSeq !== selectSeq) return;
          refs.promptFeedback.textContent = `loading blocks… ${loaded}/${ch.blockCount}`;
        },
      );

      if (thisSeq !== selectSeq) return;

      contentsCursor = contents.cursor;
      contentsCanLoadMore =
        contents.canLoadMore && contents.blocks.length < ch.blockCount;

      hidePromptOverlay();
      refs.promptFeedback.textContent = "";

      if (isLoggedIn()) {
        saveLastChannel(ch.slug);
      }
      writeChannelParam(ch.slug);
      prompt.refreshLastChannelBtn();

      showChannelOnDesk(contents.blocks, ch.slug, ch);
    } catch (err) {
      if (thisSeq !== selectSeq) return;

      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 403) &&
        !isLoggedIn()
      ) {
        goHome();
        return;
      }

      hidePromptOverlay();

      if (err instanceof ApiError) {
        if (err.status === 404 || err.status === 403) {
          refs.promptFeedback.textContent = formatChannelNotFound(
            isLoggedIn(),
          );
          if (currentBlocks.length === 0) {
            showPromptOverlay(false);
          }
        } else {
          refs.promptFeedback.textContent = err.message;
        }
      } else {
        refs.promptFeedback.textContent = formatApiError(err);
      }
    }
  }

  async function handleLoadMore(): Promise<void> {
    if (
      !currentSlug ||
      !currentDeskChannel ||
      !contentsCanLoadMore ||
      !contentsCursor
    ) {
      return;
    }

    const thisLoad = ++loadMoreSeq;
    updateHeader(currentBlocks.length, { loadingMore: true });

    try {
      const result = await loadMoreChannelContents(
        currentSlug,
        getToken(),
        contentsCursor,
        currentBlocks,
        (loaded) => {
          if (thisLoad !== loadMoreSeq) return;
          refs.promptFeedback.textContent = `loading blocks… ${loaded}/${currentDeskChannel!.blockCount}`;
        },
      );

      if (thisLoad !== loadMoreSeq) return;

      const { newBlocks } = result;
      contentsCursor = result.cursor;
      contentsCanLoadMore =
        result.canLoadMore && result.blocks.length < currentDeskChannel.blockCount;

      if (newBlocks.length > 0) {
        applyBlocksToDesk(newBlocks);
      }

      updateHeader(currentBlocks.length);
    } catch (err) {
      if (thisLoad !== loadMoreSeq) return;
      updateHeader(currentBlocks.length);
      popup.hide();
      if (err instanceof ApiError) {
        refs.promptFeedback.textContent = err.message;
        showPromptOverlay(false);
      }
    }
  }

  async function handleRefresh(): Promise<void> {
    if (
      !currentSlug ||
      !currentDeskChannel ||
      currentBlocks.length === 0 ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    const thisRefresh = ++refreshSeq;

    try {
      const knownIds = new Set(currentBlocks.map((b) => b.id));
      const { newBlocks, channel } = await pollChannelNewBlocks(
        currentSlug,
        getToken(),
        knownIds,
        lastPolledBlockCount,
      );

      if (thisRefresh !== refreshSeq) return;

      if (!channel || newBlocks.length === 0) {
        if (channel) {
          lastPolledBlockCount = channel.blockCount;
          if (channel.blockCount !== currentDeskChannel.blockCount) {
            currentDeskChannel = {
              ...currentDeskChannel,
              blockCount: channel.blockCount,
            };
          }
        }
        header.setRefreshLoading(null);
        return;
      }

      header.setRefreshLoading(newBlocks.length);

      lastPolledBlockCount = channel.blockCount;
      currentDeskChannel = {
        ...currentDeskChannel,
        blockCount: channel.blockCount,
      };

      applyBlocksToDesk(newBlocks);
      updateHeader(currentBlocks.length);
      header.setRefreshLoading(null);
    } catch {
      if (thisRefresh !== refreshSeq) return;
      header.setRefreshLoading(null);
    }
  }

  function isDeskSearchOpen(): boolean {
    return (
      currentBlocks.length > 0 &&
      refs.promptBackdrop.classList.contains("is-visible") &&
      refs.promptWrap.style.display !== "none"
    );
  }

  function closeDeskSearch(): void {
    prompt.closeResults();
    prompt.reset();
    hidePromptOverlay();
  }

  return {
    handleSelect,
    handleLoadMore,
    applyLayoutMode,
    resetLayout,
    openSearch,
    onCardChange,
    isDeskSearchOpen,
    closeDeskSearch,
    applyTypeFilter,
    goHome,
    hasBlocks: () => currentBlocks.length > 0,
  };
}
