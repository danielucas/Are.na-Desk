// ---------------------------------------------------------------------------
// ui/about.ts — the about / first-run panel (left-hand tabs)
// ---------------------------------------------------------------------------

import { createPanel } from "./panel";
import type { PanelHandle } from "./panel";
import { getStorage } from "../storage";
import { REPO_URL, TOKENS_URL } from "../links";

const SEEN_KEY = "arena-desk:seen-about";

// ---------------------------------------------------------------------------
// First-run flag
// ---------------------------------------------------------------------------

function hasSeenAbout(): boolean {
  const storage = getStorage();
  if (!storage) return true; // no storage → don't nag on every load
  try {
    return storage.getItem(SEEN_KEY) !== null;
  } catch {
    return true;
  }
}

function markAboutSeen(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(SEEN_KEY, "1");
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// DOM helpers — kept small so the content below reads as content
// ---------------------------------------------------------------------------

function para(parent: HTMLElement, text: string): void {
  const p = document.createElement("p");
  p.className = "desk-panel-para";
  p.textContent = text;
  parent.appendChild(p);
}

function link(parent: HTMLElement, text: string, href: string): void {
  const a = document.createElement("a");
  a.className = "desk-panel-link";
  a.textContent = text;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  parent.appendChild(a);
}

/**
 * Definition-style rows: a term column and a description.
 *
 * `stack` puts the description on its own line at narrow widths — right for
 * long terms like storage keys, wrong for "1" or "esc", which look orphaned.
 */
function defs(
  parent: HTMLElement,
  rows: Array<[string, string]>,
  opts: { stack?: boolean } = {},
): void {
  const list = document.createElement("dl");
  list.className = "desk-panel-defs";
  if (opts.stack) list.classList.add("desk-panel-defs--stack");

  for (const [term, desc] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = desc;
    list.appendChild(dt);
    list.appendChild(dd);
  }

  parent.appendChild(list);
}

// ---------------------------------------------------------------------------
// Tab content
// ---------------------------------------------------------------------------

interface TabSpec {
  id: string;
  label: string;
  render(el: HTMLElement): void;
}

const TABS: TabSpec[] = [
  {
    id: "about",
    label: "about",
    render(el) {
      para(
        el,
        "Are.na Desk lays out a channel as a set of draggable " +
          "cards, so you can explore them spatially. " +
          "Spread things out, cluster what belongs together, and come back " +
          "to it later.",
      );
      defs(el, [
        ["1", "Paste a channel url or slug in field in the center of the page. Public channels work by default, Private ones require a login."],
        ["2", "Once a channel loads, you can drag and resize blocks. Click a block for its details."],
        ["3", "On a channel you can switch between scatter and date modes, or use the filter to hide block types."],
      ]);
      para(
        el,
        "Each channel layout is saved in this browser, so your arrangements " +
          "are here when you come back.",
      );
      para(
        el,
        "For performance reasons, channels load 500 blocks at a time.",
      );
    },
  },
  {
    id: "arena",
    label: "your Are.na",
    render(el) {
      para(
        el,
        "To view a private channel, or browse your channels, " +
          "you need a personal access token from " +
          "Are.na. When you create one, choose Read as the permission.",
      );
      link(el, "Create a read-only token ↗", TOKENS_URL);
      para(el, "Click on Log In to paste your token.");
      para(
        el,
        "Are.na Desk only ever reads - it does not create, edit, or delete " +
          "anything in your account or channels.",
      );
    },
  },
  {
    id: "privacy",
    label: "privacy & data",
    render(el) {
      para(
        el,
        "The site is hosted on DigitalOcean, with no analytics, tracking, "+
        "or third-party scripts."
      );
      para(
        el,
        "Are.na Desk only communicates with the Are.na API at api.are.na. " +
        "Everything is kept in this browser's local storage."
      );
      defs(
        el,
        [
          ["arena-desk:token", "your access token"],
          ["arena-desk:layout:…", "where you put the cards, per channel"],
          ["arena-desk:last-channel", "the last channel you opened"],
          ["arena-desk:seen-about", "whether you've seen this panel"],
        ],
        { stack: true },
      );
      para(
        el,
        "log out removes the token from this browser. To revoke the token entirely, " +
          "delete it on Are.na. "
      );
      link(el, "manage your tokens on are.na ↗", TOKENS_URL);
    },
  },
  {
    id: "keyboard",
    label: "keyboard",
    render(el) {
      defs(el, [
        ["/", "search channels"],
        ["s", "scatter layout"],
        ["d", "by date layout"],
        ["f", "filter block types"],
        ["?", "this panel"],
        ["esc", "close whatever is open"],
      ]);
    },
  },
  {
    id: "credits",
    label: "credits",
    render(el) {
      para(el, "Made by Daniel Lucas, this is an independent project, not affiliated with Are.na... yet");
      para(
        el,
        "Built with TypeScript, Vite, and Pixi.js, talking to the Are.na API.",
      );
      link(el, "source and bug reports on github ↗", REPO_URL);
      link(el, "danielucas.com ↗", "https://danielucas.com");
    },
  },
];

// ---------------------------------------------------------------------------
// initAbout
// ---------------------------------------------------------------------------

export interface AboutHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function initAbout(root: HTMLElement): AboutHandle {
  const panel: PanelHandle = createPanel(root, {
    title: "about are.na desk",
    className: "desk-panel--about",
    // Keep the centre prompt clear on first open — this panel tells you to use
    // it, so covering it would be a poor first impression. 412px matches
    // .chrome-prompt's width in style.css.
    reserveCentreWidth: 412,
    onClose: markAboutSeen,
  });

  panel.body.classList.add("desk-panel-body--tabs");

  const tablist = document.createElement("div");
  tablist.className = "desk-panel-tabs";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-orientation", "vertical");

  const panels = document.createElement("div");
  panels.className = "desk-panel-tabpanels";

  const tabButtons: HTMLButtonElement[] = [];
  const tabPanels: HTMLDivElement[] = [];

  TABS.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "desk-panel-tab";
    btn.textContent = tab.label;
    btn.id = `about-tab-${tab.id}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", `about-panel-${tab.id}`);
    // Roving tabindex: the tablist is one stop, arrows move within it
    btn.tabIndex = i === 0 ? 0 : -1;
    btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
    btn.addEventListener("click", () => select(i));
    tablist.appendChild(btn);
    tabButtons.push(btn);

    const body = document.createElement("div");
    body.className = "desk-panel-tabpanel";
    body.id = `about-panel-${tab.id}`;
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-labelledby", btn.id);
    body.hidden = i !== 0;
    tab.render(body);
    panels.appendChild(body);
    tabPanels.push(body);
  });

  function select(index: number, focus = false): void {
    tabButtons.forEach((btn, i) => {
      const active = i === index;
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
      const tabPanel = tabPanels[i];
      if (tabPanel) tabPanel.hidden = !active;
    });
    // Switching tabs shouldn't inherit the previous tab's scroll offset
    panels.scrollTop = 0;
    if (focus) tabButtons[index]?.focus();
  }

  tablist.addEventListener("keydown", (e: KeyboardEvent) => {
    const current = tabButtons.findIndex(
      (btn) => btn.getAttribute("aria-selected") === "true",
    );
    if (current === -1) return;

    let next = current;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (current + 1) % tabButtons.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (current - 1 + tabButtons.length) % tabButtons.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabButtons.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    select(next, true);
  });

  panel.body.appendChild(tablist);
  panel.body.appendChild(panels);

  // Mark on open, not only on close — someone who reads it and navigates away
  // without closing has still seen it, and shouldn't be greeted again.
  function open(): void {
    markAboutSeen();
    select(0);
    panel.open();
  }

  function toggle(): void {
    if (panel.isOpen()) panel.close();
    else open();
  }

  return {
    open,
    close: panel.close,
    toggle,
    isOpen: panel.isOpen,
    dispose: panel.dispose,
  };
}

export { hasSeenAbout, markAboutSeen };
