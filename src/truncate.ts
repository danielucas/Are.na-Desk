// ---------------------------------------------------------------------------
// truncate.ts — display string truncation
// ---------------------------------------------------------------------------

export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}
