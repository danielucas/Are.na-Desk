// ---------------------------------------------------------------------------
// urlChannel.ts — ?channel=slug deep linking
// ---------------------------------------------------------------------------

const PARAM = "channel";

export function readChannelParam(): string | null {
  const slug = new URLSearchParams(window.location.search).get(PARAM);
  if (!slug) return null;
  const trimmed = slug.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function writeChannelParam(slug: string): void {
  const trimmed = slug.trim();
  if (!trimmed) return;

  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, trimmed);
  window.history.replaceState(null, "", url);
}

export function clearChannelParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  const next = url.search ? `${url.pathname}${url.search}${url.hash}` : `${url.pathname}${url.hash}`;
  window.history.replaceState(null, "", next);
}
