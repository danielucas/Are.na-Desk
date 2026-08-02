// ---------------------------------------------------------------------------
// dateFormat.ts — UTC date formatting (matches dateLayout hour buckets)
// ---------------------------------------------------------------------------

/** Format an ISO timestamp as YYYY-MM-DD in UTC. */
export function formatUtcDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return iso;
  }
}
