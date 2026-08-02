import "./style.css";
import { mountChrome } from "./ui/chrome";
import { initLogin } from "./ui/login";
import { initPrompt } from "./ui/prompt";
import { initHeader } from "./ui/header";
import { initPopup } from "./ui/popup";
import { initAbout, hasSeenAbout } from "./ui/about";
import { restoreSession, getToken } from "./auth";
import { readChannelParam } from "./urlChannel";
import { createDesk } from "./desk";
import { initInteractions } from "./interactions";
import { bindDismiss } from "./ui/dismiss";
import { bindShortcuts } from "./ui/shortcuts";
import { createChannelController } from "./channelController";

// ---------------------------------------------------------------------------
// Desk (Pixi canvas) — init before chrome so canvas is underneath
// ---------------------------------------------------------------------------

const desk = createDesk();

const disposeHandles: Array<{ dispose(): void }> = [];

function registerDispose(handle: { dispose(): void }): void {
  disposeHandles.push(handle);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const handle of disposeHandles) {
      handle.dispose();
    }
  });
}

(async () => {
  await desk.init(document.body);

  const refs = mountChrome(document.body);
  const popup = initPopup(document.body, { onDispose: registerDispose });

  function setBackdropVisible(visible: boolean): void {
    refs.promptBackdrop.classList.toggle("is-visible", visible);
    refs.promptBackdrop.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function showPromptOverlay(dimDesk: boolean): void {
    refs.promptWrap.style.display = "";
    setBackdropVisible(dimDesk);
  }

  function hidePromptOverlay(): void {
    refs.promptWrap.style.display = "none";
    setBackdropVisible(false);
  }

  // Mutable ref — avoids TDZ when wiring circular chrome ↔ controller deps.
  const app: {
    channel: ReturnType<typeof createChannelController> | null;
  } = { channel: null };

  const prompt = initPrompt(refs, {
    onSelect: (slug) => {
      void app.channel?.handleSelect(slug);
    },
    onDispose: registerDispose,
  });

  const header = initHeader(document.body, {
    onLayoutModeChange: (mode) => app.channel?.applyLayoutMode(mode),
    onLoadMore: () => {
      void app.channel?.handleLoadMore();
    },
    onFilterChange: () => app.channel?.applyTypeFilter(),
    onResetLayout: () => app.channel?.resetLayout(),
    onDispose: registerDispose,
  });

  const about = initAbout(document.body);
  registerDispose(about);
  refs.about.addEventListener("click", () => about.toggle());

  const loginUi = initLogin(refs, {
    onChannelSelect: (slug) => {
      void app.channel?.handleSelect(slug);
    },
    setBackdropVisible,
    onDispose: registerDispose,
  });

  app.channel = createChannelController({
    desk,
    refs,
    header,
    popup,
    loginUi,
    prompt,
    getToken,
    showPromptOverlay,
    hidePromptOverlay,
  });

  initInteractions(desk, {
    onCardChange: (blockId, state) => app.channel?.onCardChange(blockId, state),
    onCardClick: (block, screenX, screenY) => {
      popup.show(block, screenX, screenY);
    },
  });

  registerDispose(
    bindDismiss({
      isOpen: () => app.channel?.isDeskSearchOpen() ?? false,
      close: () => app.channel?.closeDeskSearch(),
      isInside: (target) => refs.promptWrap.contains(target),
    }),
  );

  registerDispose({
    dispose: bindShortcuts({
      onSearch: () => app.channel?.openSearch(),
      onScatter: () => app.channel?.applyLayoutMode("scatter"),
      onDate: () => app.channel?.applyLayoutMode("date"),
      onFilter: () => header.toggleFilter(),
      onAbout: () => about.toggle(),
    }),
  });

  refs.logo.addEventListener("click", () => app.channel?.openSearch());

  await restoreSession();

  const urlSlug = readChannelParam();
  if (urlSlug) {
    void app.channel?.handleSelect(urlSlug);
  }

  // First run: introduce the thing before anyone has to guess at it. Arriving
  // via a shared ?channel= link is someone else's tour — don't interrupt it
  // with a panel, and don't burn the first-run flag either.
  if (!urlSlug && !hasSeenAbout()) {
    about.open();
  }
})();
