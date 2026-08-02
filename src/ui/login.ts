// ---------------------------------------------------------------------------
// ui/login.ts — top-right login widget + user channel picker
// ---------------------------------------------------------------------------

import type { ChromeRefs } from "./chrome";
import { logIn, logOut, getUser, getToken, restoreSession, onAuthChange } from "../auth";
import { ApiError, getUserChannels } from "../api";
import type { UserChannelItem, ChannelVisibility } from "../types";
import { bindDismiss } from "./dismiss";
import { TOKENS_URL } from "../links";

export interface LoginOpts {
  onChannelSelect: (slug: string) => void;
  setBackdropVisible: (visible: boolean) => void;
  onDispose?: (handle: { dispose(): void }) => void;
}

function visibilityBadge(visibility: ChannelVisibility): string {
  switch (visibility) {
    case "private":
      return "pr";
    case "public":
      return "pu";
    case "closed":
      return "c";
    default: {
      const _exhaustive: never = visibility;
      void _exhaustive;
      return "pu";
    }
  }
}

function visibilityClass(visibility: ChannelVisibility): string {
  switch (visibility) {
    case "private":
      return "channel-vis--private";
    case "public":
      return "channel-vis--public";
    case "closed":
      return "channel-vis--collab";
    default: {
      const _exhaustive: never = visibility;
      void _exhaustive;
      return "channel-vis--public";
    }
  }
}

export function initLogin(
  refs: ChromeRefs,
  opts: LoginOpts,
): { closeChannels: () => void } {
  const { login, loginArea } = refs;

  let channelDropdown: HTMLDivElement | null = null;
  let nameButton: HTMLButtonElement | null = null;
  let nameWrap: HTMLDivElement | null = null;
  let channelsOpen = false;
  let channelsCache: UserChannelItem[] | null = null;
  let loadToken = 0;
  let loginFormOpen = false;

  function onLoginClick(): void {
    void handleLoginClick();
  }

  // -------------------------------------------------------------------------
  // Channel picker
  // -------------------------------------------------------------------------

  function ensureDropdown(): HTMLDivElement {
    if (channelDropdown) return channelDropdown;
    const el = document.createElement("div");
    el.className = "chrome-login-dropdown chrome-prompt-results";
    el.setAttribute("role", "listbox");
    el.setAttribute("aria-label", "your channels");
    if (!nameWrap) return el;
    nameWrap.appendChild(el);
    channelDropdown = el;
    return el;
  }

  function closeChannels(): void {
    channelsOpen = false;
    opts.setBackdropVisible(false);
    if (channelDropdown) {
      channelDropdown.classList.remove("chrome-prompt-results--open");
      channelDropdown.innerHTML = "";
    }
    if (nameButton) {
      nameButton.setAttribute("aria-expanded", "false");
    }
  }

  function renderChannelRows(channels: UserChannelItem[]): void {
    const dropdown = ensureDropdown();
    dropdown.innerHTML = "";

    for (const ch of channels) {
      const row = document.createElement("div");
      row.className = "chrome-prompt-result-row chrome-login-channel-row";
      row.setAttribute("role", "option");

      const badge = document.createElement("span");
      badge.className = `channel-vis ${visibilityClass(ch.visibility)}`;
      badge.textContent = visibilityBadge(ch.visibility);
      badge.setAttribute("aria-hidden", "true");

      const title = document.createElement("span");
      title.className = "chrome-login-channel-title";
      title.textContent = ch.title;

      const count = document.createElement("span");
      count.className = "chrome-login-channel-count";
      count.textContent = String(ch.blockCount);

      row.appendChild(badge);
      row.appendChild(title);
      row.appendChild(count);

      row.addEventListener("click", () => {
        closeChannels();
        opts.onChannelSelect(ch.slug);
      });

      dropdown.appendChild(row);
    }

    dropdown.classList.add("chrome-prompt-results--open");
  }

  function renderDropdownMessage(text: string): void {
    const dropdown = ensureDropdown();
    dropdown.innerHTML = "";
    const row = document.createElement("div");
    row.className = "chrome-login-dropdown-status";
    row.textContent = text;
    dropdown.appendChild(row);
    dropdown.classList.add("chrome-prompt-results--open");
  }

  async function openChannels(): Promise<void> {
    const token = getToken();
    if (!token || !nameButton) return;

    if (channelsOpen) {
      closeChannels();
      return;
    }

    channelsOpen = true;
    nameButton.setAttribute("aria-expanded", "true");
    opts.setBackdropVisible(true);

    if (channelsCache) {
      renderChannelRows(channelsCache);
      return;
    }

    const thisLoad = ++loadToken;
    renderDropdownMessage("loading…");

    try {
      const channels = await getUserChannels(token);
      if (thisLoad !== loadToken || !channelsOpen) return;
      channelsCache = channels;
      if (channels.length === 0) {
        renderDropdownMessage("no channels");
      } else {
        renderChannelRows(channels);
      }
    } catch (err) {
      if (thisLoad !== loadToken || !channelsOpen) return;
      channelsCache = null;
      const msg = err instanceof ApiError ? err.message : "failed to load";
      renderDropdownMessage(msg);
    }
  }

  const channelDismiss = bindDismiss({
    isOpen: () => channelsOpen,
    close: closeChannels,
    isInside: (target) => nameWrap !== null && nameWrap.contains(target),
  });
  opts.onDispose?.(channelDismiss);

  // -------------------------------------------------------------------------
  // Render helpers — operate ONLY on loginArea's children
  // -------------------------------------------------------------------------

  function clearLoginAreaExtras(): void {
    closeChannels();
    channelsCache = null;
    loadToken++;

    const toRemove: ChildNode[] = [];
    let node = loginArea.firstChild;
    while (node) {
      if (node !== login) toRemove.push(node);
      node = node.nextSibling;
    }
    for (const n of toRemove) {
      if (n.parentNode === loginArea) loginArea.removeChild(n);
    }
    nameButton = null;
    nameWrap = null;
    channelDropdown = null;
  }

  function renderLoggedOut(): void {
    loginFormOpen = false;
    clearLoginAreaExtras();
    login.textContent = "log in";
    login.disabled = false;
    login.style.display = "";
    login.removeEventListener("click", onLoginClick);
    login.addEventListener("click", onLoginClick);
  }

  function renderLoggedIn(name: string): void {
    loginFormOpen = false;
    clearLoginAreaExtras();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chrome-login-name";
    btn.textContent = name;
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.addEventListener("click", () => {
      void openChannels();
    });
    nameButton = btn;

    const wrap = document.createElement("div");
    wrap.className = "chrome-login-name-wrap";
    wrap.appendChild(btn);
    nameWrap = wrap;

    const logOutBtn = document.createElement("button");
    logOutBtn.className = "chrome-login-logout";
    logOutBtn.textContent = "log out";
    logOutBtn.onclick = () => {
      closeChannels();
      logOut();
    };

    login.style.display = "none";
    login.removeEventListener("click", onLoginClick);
    loginArea.appendChild(wrap);
    loginArea.appendChild(logOutBtn);
  }

  // -------------------------------------------------------------------------
  // Login form flow
  // -------------------------------------------------------------------------

  function openLoginForm(): void {
    loginFormOpen = true;
    login.textContent = "";
    login.style.display = "none";

    const form = document.createElement("div");
    form.className = "chrome-login-form";

    const row = document.createElement("div");
    row.className = "chrome-login-row";

    const tokenInput = document.createElement("input");
    tokenInput.type = "password";
    tokenInput.placeholder = "access token";
    tokenInput.className = "chrome-login-input";

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "chrome-login-submit";
    submitBtn.textContent = "→";
    submitBtn.setAttribute("aria-label", "log in");

    row.appendChild(tokenInput);
    row.appendChild(submitBtn);

    // Point at the tokens page, not generic settings — the read/write choice
    // is made there, and "Read" is the one we want people picking.
    const hint = document.createElement("a");
    hint.href = TOKENS_URL;
    hint.target = "_blank";
    hint.rel = "noopener noreferrer";
    hint.textContent = "create a read-only token ↗";
    hint.className = "chrome-login-hint";

    const storageNote = document.createElement("span");
    storageNote.className = "chrome-login-note";
    storageNote.textContent = "stored in this browser only";

    const feedback = document.createElement("span");
    feedback.className = "chrome-login-feedback";

    form.appendChild(row);
    form.appendChild(hint);
    form.appendChild(storageNote);
    form.appendChild(feedback);
    loginArea.appendChild(form);

    tokenInput.focus();

    async function submit(): Promise<void> {
      const val = tokenInput.value.trim();
      if (!val) return;

      tokenInput.disabled = true;
      submitBtn.disabled = true;
      feedback.textContent = "checking…";

      try {
        await logIn(val);
        loginFormOpen = false;
        cleanup();
      } catch (err) {
        tokenInput.disabled = false;
        submitBtn.disabled = false;
        feedback.textContent =
          err instanceof ApiError ? err.message : "login failed";
        tokenInput.focus();
      }
    }

    function cleanup(): void {
      if (form.parentNode === loginArea) {
        loginArea.removeChild(form);
      }
    }

    submitBtn.addEventListener("click", () => {
      void submit();
    });

    tokenInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        void submit();
      } else if (e.key === "Escape") {
        cleanup();
        renderLoggedOut();
      }
    });
  }

  async function handleLoginClick(): Promise<void> {
    if (getToken() && !getUser()) {
      const user = await restoreSession();
      if (user) return;
    }
    openLoginForm();
  }

  onAuthChange((user) => {
    if (user) {
      renderLoggedIn(user.name);
    } else if (!loginFormOpen) {
      renderLoggedOut();
    }
  });

  const existing = getUser();
  if (existing) {
    renderLoggedIn(existing.name);
  } else {
    renderLoggedOut();
  }

  return { closeChannels };
}
