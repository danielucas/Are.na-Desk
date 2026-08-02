# Contributing

Thanks for your interest in Are.na Desk. This is a small personal project kept intentionally lean — contributions that match that spirit are most welcome.

## Getting started

```bash
git clone <your-fork-url>
cd Are.na-Desk
npm install
npm run dev
```

You'll need an Are.na account to test private channels and search. A **Read** personal access token from [are.na/developers/personal-access-tokens](https://www.are.na/developers/personal-access-tokens) is enough — no OAuth setup required. The app only issues `GET` requests, so a read/write token buys you nothing and risks more.

## Before you open a PR

1. **Run the checks:**
   ```bash
   npm test
   npm run build
   ```
2. **Test in the browser.** Most behaviour (Pixi rendering, drag, resize, popup) is manual-only. Click through your change in `npm run dev` before submitting.
3. **Keep diffs focused.** This project avoids frameworks and heavy abstractions on purpose. Match the existing style: typed vanilla TS, small modules, no unnecessary dependencies.

## What to work on

Good first contributions:

- Bug fixes with a clear repro
- Block type rendering improvements
- Accessibility or keyboard handling
- Performance (texture loading, large channels)
- Documentation clarifications

Please open an issue first for larger features (new persistence backends, multi-channel desks, OAuth, etc.) — those are currently out of scope and may not merge.

## Code notes

- **Tests** cover pure logic only (`src/logic.test.ts`): layout algorithms, input parsing, camera math. Don't add fixture-heavy API integration tests unless there's a strong reason.
- **TypeScript** is used throughout but the bar is pragmatic, not enterprise. Prefer readable code over clever types.
- **Imports** stay at the top of each file.

## Questions

Open a GitHub issue for bugs, ideas, or "is this in scope?" questions. No formal process beyond that.
