# Are.na Desk

**[are.na-desk.online](https://are.na-desk.online/)**

A single-page app that lays out one [Are.na](https://www.are.na/) channel at a time as a messy desk of draggable, resizable cards on a PixiJS canvas.

Paste a channel URL or slug, explore blocks spatially, drag them around, and come back later — your layout is saved in the browser.

## Privacy

The site is hosted so it's reachable on the web, but there's no application server behind it. No accounts, no database, no analytics, no tracking, no third-party scripts.

Nothing you do goes anywhere but Are.na. The complete list of hosts this app talks to:

| Host | Why |
|---|---|
| `api.are.na` | every channel, block, and auth request |
| `images.are.na` | block images |
| `d2w9rnfcy7mm78.cloudfront.net` | block images (Are.na's CDN) |

There is exactly one `fetch` call in the codebase ([`api.ts`](src/api.ts)) and it only ever targets `api.are.na`. The image hosts are reached by the canvas loading textures. Verify it in your network tab.

Everything lives in your browser's `localStorage`:

| Key | What it holds |
|---|---|
| `arena-desk:token` | your Are.na access token |
| `arena-desk:layout:<slug>` | where you put the cards, per channel |
| `arena-desk:last-channel` | the last channel you opened |
| `arena-desk:seen-about` | whether you've seen the about panel |

Clearing your browser data removes all of it.

## Logging in

Public channels work without an account. Log in to open your private channels and browse your own channel list.

1. Create a personal access token at [are.na/developers/personal-access-tokens](https://www.are.na/developers/personal-access-tokens). **Choose Read.**
2. Click **log in** (top right) and paste it.

A read-only token cannot create, edit, or delete anything in your account — that limit is enforced by Are.na, not a promise from this app. Are.na Desk only ever issues `GET` requests. To revoke a token, delete it on Are.na; logging out only removes it from this browser.

Live channel search additionally requires an Are.na Premium account. Without it, paste a URL or slug.

## What it does

- **Desk** — fullscreen PixiJS canvas with pan (drag empty space) and zoom (scroll wheel or pinch, cursor-anchored).
- **Cards** — images, links, embeds, text, and attachments each render as a bordered card. Text is monospace; images load progressively (thumb first, full res on zoom/resize).
- **Interactions** — drag to move (brings card to front), resize from the bottom-right handle, click to open a metadata popup.
- **Layouts** — scatter (saved per channel) or by date (hour clusters, chronological). **reset** re-scatters and forgets the saved arrangement.
- **Filter** — hide block types on the desk without removing them from layout.
- **Persistence** — scatter positions saved per channel, debounced after drag/resize. New blocks scatter into free space; removed blocks are pruned.
- **Keyboard** — `/` search, `s` scatter, `d` date, `f` filter, `?` about, `esc` close.
- **Resilience** — rate limits (429), server faults (5xx), and network blips are retried with jittered backoff, honouring `Retry-After`. Auth and not-found errors surface immediately.

## Limits

- Channels load 500 blocks per batch; larger channels show a **load more** control.
- Read-only by design. Editing or connecting blocks, multi-channel desks, and OAuth are deliberately out of scope.
- Built for a desktop-sized screen. Pan, drag, and pinch-to-zoom work on touch, but it isn't a phone-first experience.

### Install as an app (PWA)

- **Chrome / Arc:** address bar install icon, or ⋮ → "Install Are.na Desk…"
- **Safari (macOS):** File → Add to Dock

Static assets are cached for faster loads and checked for updates on each visit. Are.na API requests always go to the network.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`), paste a public channel slug or URL, and go.

## Stack

Vite · vanilla TypeScript · PixiJS v8 · DOM for chrome (login, prompt, header, popup, panels). No framework.

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and production build |
| `npm test` | Run pure-logic unit tests (Vitest) |

Canvas interactions are verified manually in the browser — not unit-tested.

## Project layout

```
src/
  main.ts              App bootstrap + wiring
  channelController.ts Channel load, layout, filter, persistence
  api.ts               Are.na v3 fetch client + retry + mappers
  auth.ts              Token + session state
  links.ts             External URLs used in more than one place
  desk.ts              Pixi canvas (pan, wheel + pinch zoom, cards)
  card.ts              Card rendering + texture loading
  interactions.ts      Drag, resize, click
  scatter.ts           Seeded scatter layout
  dateLayout.ts        Date-grouped layout
  persistence.ts       localStorage layout merge
  blockFilter.ts       Block type filter helpers
  lastChannel.ts       Last-opened channel slug
  urlChannel.ts        ?channel= deep link
  ui/                  DOM chrome
    chrome.ts          Logo, prompt, login area, about button
    prompt.ts          Centre search prompt
    login.ts           Token login + user channel picker
    header.ts          Channel header, layout toggle, filter, reset
    popup.ts           Block metadata popup
    panel.ts           Draggable panel primitive
    about.ts           About / first-run panel
    shortcuts.ts       Global keyboard shortcuts
    dismiss.ts         Escape / click-away binding
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, ideas, and PRs welcome.

## License

[MIT](LICENSE) · An independent project, not affiliated with Are.na.
