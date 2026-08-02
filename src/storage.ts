// ---------------------------------------------------------------------------
// storage.ts — safe localStorage access (SSR / privacy-mode tolerant)
// ---------------------------------------------------------------------------

/** Returns globalThis.localStorage if available, or null. */
export function getStorage(): Storage | null {
  try {
    const ls = (globalThis as Record<string, unknown>)["localStorage"];
    if (ls && typeof (ls as Storage).getItem === "function") {
      return ls as Storage;
    }
    return null;
  } catch {
    return null;
  }
}
