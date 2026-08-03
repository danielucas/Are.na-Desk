// ---------------------------------------------------------------------------
// storageKeys.ts — every localStorage key this app writes, in one place
// ---------------------------------------------------------------------------
//
// The about panel publishes this list as a privacy claim, so it has to stay
// true. Modules import their key from here rather than spelling it out, and
// STORAGE_KEY_DOCS is built from the same constants — rename a key and the
// panel follows automatically.
//
// A test in logic.test.ts fails if an "arena-desk:" literal appears anywhere
// else in src/, or if a key exported here is missing from the docs list.
// ---------------------------------------------------------------------------

export const TOKEN_KEY = "arena-desk:token";
export const LAYOUT_KEY_PREFIX = "arena-desk:layout:";
export const LAST_CHANNEL_KEY = "arena-desk:last-channel";
export const SEEN_ABOUT_KEY = "arena-desk:seen-about";

/** [displayed key, what it holds] — rendered verbatim in the about panel. */
export const STORAGE_KEY_DOCS: ReadonlyArray<readonly [string, string]> = [
  [TOKEN_KEY, "your access token"],
  // one key per channel, so the prefix is what's worth showing
  [`${LAYOUT_KEY_PREFIX}…`, "where you put the cards, per channel"],
  [LAST_CHANNEL_KEY, "the last channel you opened"],
  [SEEN_ABOUT_KEY, "whether you've seen this panel"],
];
