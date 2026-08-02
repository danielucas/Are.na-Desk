// ---------------------------------------------------------------------------
// ui/prompt.ts — center prompt behavior
// ---------------------------------------------------------------------------

import type { ChromeRefs } from "./chrome";
import {
  parseChannelInput,
  searchChannels,
  getRandomPublicChannel,
  ApiError,
} from "../api";
import { getToken, isLoggedIn, onAuthChange } from "../auth";
import { debounce } from "../debounce";
import { bindDismiss } from "./dismiss";
import { loadLastChannel } from "../lastChannel";
import { PREMIUM_SEARCH_MSG } from "../formatApiError";

export function initPrompt(
  refs: ChromeRefs,
  opts: {
    onSelect: (slugOrId: string) => void;
    onDispose?: (handle: { dispose(): void }) => void;
  },
): {
  reset(): void;
  focus(): void;
  closeResults(): void;
  refreshLastChannelBtn(): void;
  setWelcomeVisible(visible: boolean): void;
} {
  const {
    promptInput,
    promptFeedback,
    promptSearchRow,
    promptInputWrap,
    promptLastBtn,
    promptRandomBtn,
    promptWelcome,
  } = refs;

  // -------------------------------------------------------------------------
  // Search results container (absolute below input — does not shift layout)
  // -------------------------------------------------------------------------

  const resultsContainer = document.createElement("div");
  resultsContainer.className = "chrome-prompt-results";
  resultsContainer.setAttribute("role", "listbox");
  promptInputWrap.appendChild(resultsContainer);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  let searchToken = 0;
  let highlightedIndex = -1;
  let randomToken = 0;
  let welcomeVisible = true;

  // -------------------------------------------------------------------------
  // Shared reset helpers
  // -------------------------------------------------------------------------

  function getResultRows(): HTMLElement[] {
    return Array.from(
      resultsContainer.querySelectorAll<HTMLElement>(".chrome-prompt-result-row")
    );
  }

  function setHighlightedIndex(index: number): void {
    const rows = getResultRows();
    if (rows.length === 0) {
      highlightedIndex = -1;
      return;
    }

    highlightedIndex = Math.max(0, Math.min(index, rows.length - 1));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const active = i === highlightedIndex;
      row.classList.toggle("is-highlighted", active);
      row.setAttribute("aria-selected", active ? "true" : "false");
    }

    const activeRow = rows[highlightedIndex];
    if (activeRow) {
      activeRow.scrollIntoView({ block: "nearest" });
    }
  }

  function clearHighlight(): void {
    highlightedIndex = -1;
    for (const row of getResultRows()) {
      row.classList.remove("is-highlighted");
      row.setAttribute("aria-selected", "false");
    }
  }

  function clearResults(): void {
    resultsContainer.innerHTML = "";
    resultsContainer.classList.remove("chrome-prompt-results--open");
    highlightedIndex = -1;
  }

  function isResultsOpen(): boolean {
    return resultsContainer.classList.contains("chrome-prompt-results--open");
  }

  function resetSearch(): void {
    searchToken++;
    doSearch.cancel();
    clearResults();
  }

  function selectHighlighted(): boolean {
    const rows = getResultRows();
    if (highlightedIndex < 0 || highlightedIndex >= rows.length) return false;
    rows[highlightedIndex]?.click();
    return true;
  }

  const resultsDismiss = bindDismiss({
    isOpen: isResultsOpen,
    close: clearResults,
    isInside: (target) => promptSearchRow.contains(target),
  });
  opts.onDispose?.(resultsDismiss);

  // -------------------------------------------------------------------------
  // Placeholder + auth-gated controls
  // -------------------------------------------------------------------------

  function updateWelcome(): void {
    promptWelcome.hidden = !welcomeVisible;
  }

  function setWelcomeVisible(visible: boolean): void {
    welcomeVisible = visible;
    updateWelcome();
  }

  function updatePlaceholder(): void {
    promptInput.placeholder = isLoggedIn()
      ? "channel slug, url, or search"
      : "public channel url or slug";
  }

  function refreshAuthUI(): void {
    const loggedIn = isLoggedIn();
    promptLastBtn.hidden = !loggedIn;
    promptRandomBtn.hidden = !loggedIn;
    updatePlaceholder();
    if (!loggedIn) {
      resetSearch();
      promptFeedback.textContent = "";
    } else {
      refreshLastChannelBtn();
    }
  }

  function refreshLastChannelBtn(): void {
    if (!isLoggedIn()) return;
    promptLastBtn.disabled = loadLastChannel() === null;
  }

  promptLastBtn.addEventListener("click", () => {
    const slug = loadLastChannel();
    if (!slug) return;
    resetSearch();
    promptInput.value = "";
    promptFeedback.textContent = "";
    opts.onSelect(slug);
  });

  // -------------------------------------------------------------------------
  // Results rendering
  // -------------------------------------------------------------------------

  function renderResults(
    results: Array<{ slug: string; title: string; author: string; blockCount: number }>
  ): void {
    clearResults();
    for (const r of results) {
      const row = document.createElement("div");
      row.className = "chrome-prompt-result-row";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      row.textContent = `${r.title} — ${r.author} · ${r.blockCount}`;
      row.addEventListener("click", () => {
        promptInput.value = "";
        resetSearch();
        promptFeedback.textContent = "";
        opts.onSelect(r.slug);
      });
      resultsContainer.appendChild(row);
    }
    resultsContainer.classList.add("chrome-prompt-results--open");
  }

  // -------------------------------------------------------------------------
  // Live search (logged in only, debounced 300ms)
  // -------------------------------------------------------------------------

  const doSearch = debounce(async (query: string) => {
    const token = getToken();
    if (!token) return;

    const thisToken = ++searchToken;

    promptFeedback.textContent = "searching…";
    clearResults();

    try {
      const results = await searchChannels(query, token);
      if (thisToken !== searchToken) return;
      promptFeedback.textContent = "";
      if (results.length === 0) {
        promptFeedback.textContent = "no results";
      } else {
        renderResults(results);
      }
    } catch (err) {
      if (thisToken !== searchToken) return;
      if (err instanceof ApiError && err.status === 403) {
        promptFeedback.textContent = PREMIUM_SEARCH_MSG;
      } else if (err instanceof ApiError) {
        promptFeedback.textContent = err.message;
      } else {
        promptFeedback.textContent = "search failed";
      }
      clearResults();
    }
  }, 300);

  onAuthChange(() => {
    refreshAuthUI();
  });

  refreshAuthUI();
  updateWelcome();

  // -------------------------------------------------------------------------
  // Random public channel
  // -------------------------------------------------------------------------

  async function pickRandomChannel(): Promise<void> {
    const token = getToken();
    if (!token) return;

    const thisRandom = ++randomToken;
    resetSearch();
    promptRandomBtn.disabled = true;
    promptFeedback.textContent = "picking…";

    try {
      const channel = await getRandomPublicChannel(token);
      if (thisRandom !== randomToken) return;
      promptInput.value = "";
      promptFeedback.textContent = "";
      opts.onSelect(channel.slug);
    } catch (err) {
      if (thisRandom !== randomToken) return;
      if (err instanceof ApiError && err.status === 403) {
        promptFeedback.textContent = PREMIUM_SEARCH_MSG;
      } else if (err instanceof ApiError) {
        promptFeedback.textContent = err.message;
      } else {
        promptFeedback.textContent = "random pick failed";
      }
    } finally {
      if (thisRandom === randomToken) {
        promptRandomBtn.disabled = false;
      }
    }
  }

  promptRandomBtn.addEventListener("click", () => {
    void pickRandomChannel();
  });

  // -------------------------------------------------------------------------
  // Input event — live search trigger
  // -------------------------------------------------------------------------

  promptInput.addEventListener("input", () => {
    const val = promptInput.value;

    if (!val.trim()) {
      resetSearch();
      promptFeedback.textContent = "";
      return;
    }

    if (!isLoggedIn()) return;

    const looksLikeUrl = val.trim().includes(".");
    if (looksLikeUrl) {
      resetSearch();
      promptFeedback.textContent = "";
      return;
    }

    if (val.trim().length < 2) {
      resetSearch();
      promptFeedback.textContent = "";
      return;
    }

    doSearch(val.trim());
  });

  // -------------------------------------------------------------------------
  // Keyboard — arrow navigation + enter
  // -------------------------------------------------------------------------

  promptInput.addEventListener("keydown", (e) => {
    const rows = getResultRows();

    if (e.key === "ArrowDown" && rows.length > 0) {
      e.preventDefault();
      if (highlightedIndex < 0) {
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex(highlightedIndex + 1);
      }
      return;
    }

    if (e.key === "ArrowUp" && rows.length > 0) {
      e.preventDefault();
      if (highlightedIndex <= 0) {
        clearHighlight();
      } else {
        setHighlightedIndex(highlightedIndex - 1);
      }
      return;
    }

    if (e.key !== "Enter") return;

    // When results are open, Enter always picks from the list — not the raw query.
    // Search text (e.g. "design") would otherwise pass parseChannelInput as a slug.
    if (rows.length > 0) {
      if (selectHighlighted()) return;
      rows[0]?.click();
      return;
    }

    const val = promptInput.value.trim();
    const slug = parseChannelInput(val);

    if (slug) {
      resetSearch();
      promptFeedback.textContent = "";
      promptInput.value = "";
      opts.onSelect(slug);
      return;
    }

    promptFeedback.textContent = "not a channel url or slug";
  });

  return {
    reset(): void {
      randomToken++;
      resetSearch();
      promptFeedback.textContent = "";
      promptInput.value = "";
      if (isLoggedIn()) {
        promptRandomBtn.disabled = false;
      }
    },
    focus(): void {
      promptInput.focus();
      promptInput.select();
    },
    closeResults(): void {
      clearResults();
    },
    refreshLastChannelBtn,
    setWelcomeVisible,
  };
}
