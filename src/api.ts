import type {
  DeskBlock,
  DeskBlockType,
  DeskChannel,
  ChannelSearchResult,
  UserChannelItem,
  ChannelVisibility,
} from "./types";

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function statusMessage(status: number): string {
  switch (status) {
    case 401:
      return "invalid token";
    case 403:
      return "not allowed";
    case 404:
      return "not found";
    case 429:
      return "rate limited — try again in a moment";
    default:
      return `request failed (${status})`;
  }
}

// ---------------------------------------------------------------------------
// Internal request helper
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.are.na";

/** Retries after the initial attempt. Three total tries at most. */
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

/**
 * Rate limits and server faults are transient — worth another try.
 * 401/403/404 are answers, not failures, and must surface immediately.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Backoff for the given attempt, honouring Retry-After when the server sends it. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }
  // 500ms, then 1500ms — plus jitter so concurrent page fetches don't sync up
  const backoff = BASE_BACKOFF_MS * 3 ** attempt;
  return Math.min(backoff, MAX_BACKOFF_MS) + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  path: string,
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${BASE_URL}${path}`;
  let lastError = new ApiError(0, "network error — check your connection");

  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;

    try {
      res = await fetch(url, { headers });
    } catch {
      lastError = new ApiError(0, "network error — check your connection");
    }

    if (res !== null) {
      if (res.ok) {
        try {
          return await res.json() as T;
        } catch {
          // The request succeeded; the body is malformed. Retrying won't help.
          throw new ApiError(0, "network error — check your connection");
        }
      }

      if (!isRetryableStatus(res.status)) {
        throw new ApiError(res.status, statusMessage(res.status));
      }

      lastError = new ApiError(res.status, statusMessage(res.status));
    }

    if (attempt >= MAX_RETRIES) throw lastError;

    await sleep(retryDelayMs(attempt, res?.headers.get("Retry-After") ?? null));
  }
}

// ---------------------------------------------------------------------------
// parseChannelInput
// ---------------------------------------------------------------------------

export function parseChannelInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Normalise: strip protocol, then check for are.na host
  const withoutProto = trimmed.replace(/^https?:\/\//i, "");

  // Check if it starts with are.na (with optional www.)
  const arenaMatch = /^(?:www\.)?are\.na\/(.+)/i.exec(withoutProto);
  if (arenaMatch) {
    // arenaMatch[1] is the path after are.na/
    const path = arenaMatch[1];
    if (!path) return null;
    // Strip query string AND fragment, then trailing slashes, take the last path segment
    const cleanPath = path.split("?")[0]?.split("#")[0] ?? "";
    const segments = cleanPath.split("/").filter((s) => s.length > 0);
    const slug = segments[segments.length - 1];
    return slug ?? null;
  }

  // Not an are.na URL — treat as bare slug or numeric id only if no slash present.
  // Any input with a slash that isn't an are.na URL is rejected
  // (slugs never contain slashes; a path like /user/chan or example.com/foo/bar is not a slug).
  if (trimmed.includes("/")) {
    return null;
  }

  // Reject if it looks like a bare domain (no slash, contains a dot)
  if (trimmed.includes(".")) {
    return null;
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Raw API response shapes (internal — only what we read)
// ---------------------------------------------------------------------------

interface RawImageVersion {
  src: string;
  src_2x: string;
}

interface RawBlockImage {
  aspect_ratio?: number | null;
  small?: RawImageVersion;
  medium?: RawImageVersion;
  large?: RawImageVersion;
  square?: RawImageVersion;
}

interface RawMarkdownContent {
  markdown: string;
  html: string;
  plain: string;
}

interface RawEmbeddedUser {
  id: number;
  name: string;
  slug: string;
}

interface RawEmbeddedConnection {
  id: number;
  position: number;
  pinned: boolean;
  connected_at: string;
  connected_by: RawEmbeddedUser | null;
}

interface RawBlockAttachment {
  filename?: string | null;
  file_extension?: string | null;
  url: string;
}

interface RawBlockEmbed {
  source_url?: string | null;
  url?: string | null;
}

interface RawBlockSource {
  url: string;
}

interface RawBaseBlock {
  id: number;
  type: string;
  title?: string | null;
  description?: RawMarkdownContent | null;
  visibility: string;
  source?: RawBlockSource | null;
  connection?: RawEmbeddedConnection | null;
  // type-specific fields
  content?: RawMarkdownContent | null;
  image?: RawBlockImage | null;
  attachment?: RawBlockAttachment | null;
  embed?: RawBlockEmbed | null;
}

interface RawChannelCounts {
  blocks: number;
  channels: number;
  contents: number;
  collaborators: number;
}

interface RawChannelOwner {
  name: string;
}

interface RawChannel {
  id: number;
  type: "Channel";
  slug: string;
  title: string;
  visibility: string;
  owner: RawChannelOwner;
  counts: RawChannelCounts;
}

type RawConnectable = RawBaseBlock | RawChannel;

interface RawPaginationMeta {
  current_page: number;
  per_page: number;
  total_pages: number;
  total_count: number;
  has_more_pages: boolean;
}

interface RawConnectableListResponse {
  data: RawConnectable[];
  meta: RawPaginationMeta;
}

interface RawMe {
  id: number;
  name: string;
}

interface RawSearchResponse {
  data: Array<RawChannel | RawBaseBlock | Record<string, unknown>>;
  meta: RawPaginationMeta;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapBlock(raw: RawBaseBlock): DeskBlock {
  const image = raw.image ?? null;

  // Determine type
  let blockType: DeskBlockType;
  switch (raw.type) {
    case "Text":
      blockType = "Text";
      break;
    case "Image":
      blockType = "Image";
      break;
    case "Link":
      blockType = "Link";
      break;
    case "Attachment":
      blockType = "Attachment";
      break;
    case "Embed":
      blockType = "Embed";
      break;
    default:
      blockType = "Pending";
  }

  // Image URLs — guard inner version access in case the image object has missing version keys
  const imageUrl = image?.medium?.src ?? null;
  const imageThumbUrl = image?.small?.src ?? null;
  const imageLargeUrl = image?.large?.src ?? null;
  const aspectRatio = image?.aspect_ratio ?? null;

  // Source URL: prefer source.url; for Embed prefer embed.source_url
  let sourceUrl: string | null = raw.source?.url ?? null;
  if (blockType === "Embed" && raw.embed != null) {
    const embedSrc = raw.embed.source_url ?? raw.embed.url ?? null;
    if (embedSrc) sourceUrl = embedSrc;
  }

  // Attachment fields
  const filename = raw.attachment?.filename ?? null;
  const rawExt = raw.attachment?.file_extension ?? null;
  const extension = rawExt != null ? rawExt.toLowerCase().replace(/^\./, "") : null;

  // Connection info
  const conn = raw.connection ?? null;
  const connectedAt = conn?.connected_at ?? null;
  const connectedBy = conn?.connected_by?.name ?? null;

  return {
    id: raw.id,
    type: blockType,
    title: raw.title ?? null,
    description: raw.description?.plain ?? null,
    textContent: raw.content?.plain ?? null,
    imageUrl,
    imageThumbUrl,
    imageLargeUrl,
    aspectRatio,
    sourceUrl,
    filename,
    extension,
    connectedAt,
    connectedBy,
    arenaUrl: `https://www.are.na/block/${raw.id}`,
  };
}

function mapChannel(raw: RawChannel): DeskChannel {
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    author: raw.owner.name,
    blockCount: raw.counts.blocks,
    visibility: mapChannelVisibility(raw.visibility),
    arenaUrl: `https://www.are.na/channels/${raw.slug}`,
  };
}

function mapRawChannelToSearchResult(ch: RawChannel): ChannelSearchResult {
  return {
    id: ch.id,
    slug: ch.slug,
    title: ch.title,
    author: ch.owner.name,
    blockCount: ch.counts.blocks,
  };
}

function isRawChannel(item: RawConnectable): item is RawChannel {
  return item.type === "Channel";
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export async function getChannel(
  slugOrId: string,
  token?: string | null
): Promise<DeskChannel> {
  const raw = await request<RawChannel>(
    `/v3/channels/${encodeURIComponent(slugOrId)}`,
    token
  );
  return mapChannel(raw);
}

const CONTENTS_PER_PAGE = 100;
/** Maximum number of raw items (blocks + nested channels) to scan per batch. */
const CONTENTS_SCAN_MAX = 500;

export interface ChannelContentsCursor {
  page: number;
  scanned: number;
}

export interface ChannelContentsResult {
  blocks: DeskBlock[];
  cursor: ChannelContentsCursor;
  totalItems: number;
  canLoadMore: boolean;
}

async function scanChannelContents(
  slugOrId: string,
  token: string | null | undefined,
  opts: {
    startPage?: number;
    startScanned?: number;
    maxScan?: number;
    onProgress?: (loaded: number, total: number) => void;
  } = {}
): Promise<ChannelContentsResult> {
  const startScanned = opts.startScanned ?? 0;
  const maxScan = opts.maxScan ?? CONTENTS_SCAN_MAX;
  const batchLimit = startScanned + maxScan;
  const blocks: DeskBlock[] = [];
  let page = opts.startPage ?? 1;
  let scanned = startScanned;
  let totalCount = 0;
  let hasMore = true;

  while (hasMore && scanned < batchLimit) {
    const path = `/v3/channels/${encodeURIComponent(slugOrId)}/contents?per=${CONTENTS_PER_PAGE}&page=${page}`;
    const resp = await request<RawConnectableListResponse>(path, token);
    totalCount = resp.meta.total_count;

    if (resp.data.length === 0) break;

    for (const item of resp.data) {
      if (scanned >= batchLimit) break;
      scanned++;
      if (!isRawChannel(item)) {
        if (typeof item.id !== "number") continue;
        try {
          blocks.push(mapBlock(item));
        } catch {
          // Malformed block — skip
        }
      }
    }

    opts.onProgress?.(blocks.length, totalCount);

    hasMore = resp.meta.has_more_pages;
    page++;
  }

  const hitCap = scanned >= batchLimit && hasMore;
  const canLoadMore = hasMore && (hitCap || blocks.length > 0);

  return {
    blocks,
    cursor: { page, scanned },
    totalItems: totalCount,
    canLoadMore,
  };
}

/**
 * Load blocks from a channel (first batch, up to CONTENTS_SCAN_MAX items scanned).
 */
export async function getChannelContents(
  slugOrId: string,
  token?: string | null,
  onProgress?: (loaded: number, total: number) => void
): Promise<ChannelContentsResult> {
  return scanChannelContents(slugOrId, token, { onProgress });
}

/**
 * Load the next batch of blocks and merge with existing blocks (deduped by id).
 */
export async function loadMoreChannelContents(
  slugOrId: string,
  token: string | null | undefined,
  cursor: ChannelContentsCursor,
  existingBlocks: DeskBlock[],
  onProgress?: (loaded: number, total: number) => void
): Promise<{
  blocks: DeskBlock[];
  newBlocks: DeskBlock[];
  cursor: ChannelContentsCursor;
  totalItems: number;
  canLoadMore: boolean;
}> {
  const batch = await scanChannelContents(slugOrId, token, {
    startPage: cursor.page,
    startScanned: cursor.scanned,
    onProgress: (loaded, total) => {
      onProgress?.(existingBlocks.length + loaded, total);
    },
  });

  const seen = new Set(existingBlocks.map((b) => b.id));
  const newBlocks: DeskBlock[] = [];
  for (const block of batch.blocks) {
    if (seen.has(block.id)) continue;
    seen.add(block.id);
    newBlocks.push(block);
  }

  return {
    blocks: [...existingBlocks, ...newBlocks],
    newBlocks,
    cursor: batch.cursor,
    totalItems: batch.totalItems,
    canLoadMore: batch.canLoadMore,
  };
}

/**
 * Fetch blocks connected since last view — newest-first pages until no unknown ids.
 */
export async function pollChannelNewBlocks(
  slugOrId: string,
  token: string | null | undefined,
  knownIds: ReadonlySet<number>,
  lastBlockCount: number,
): Promise<{ newBlocks: DeskBlock[]; channel: DeskChannel | null }> {
  const channel = await getChannel(slugOrId, token);

  if (channel.blockCount <= lastBlockCount) {
    return { newBlocks: [], channel: null };
  }

  const newBlocks: DeskBlock[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      per: String(CONTENTS_PER_PAGE),
      page: String(page),
      sort: "created_at_desc",
    });
    const path = `/v3/channels/${encodeURIComponent(slugOrId)}/contents?${params.toString()}`;
    const resp = await request<RawConnectableListResponse>(path, token);

    if (resp.data.length === 0) break;

    let newOnPage = 0;
    for (const item of resp.data) {
      if (isRawChannel(item)) continue;
      if (typeof item.id !== "number") continue;
      if (knownIds.has(item.id)) continue;
      try {
        newBlocks.push(mapBlock(item));
        newOnPage++;
      } catch {
        // Malformed block — skip
      }
    }

    if (newOnPage === 0) break;

    hasMore = resp.meta.has_more_pages;
    page++;
  }

  return { newBlocks, channel };
}

export async function getMe(token: string): Promise<{ id: number; name: string }> {
  const raw = await request<RawMe>("/v3/me", token);
  return { id: raw.id, name: raw.name };
}

export async function searchChannels(
  query: string,
  token: string
): Promise<ChannelSearchResult[]> {
  const [mine, all] = await Promise.all([
    fetchChannelSearch(query, token, "my"),
    fetchChannelSearch(query, token),
  ]);

  const seen = new Set<number>();
  const merged: ChannelSearchResult[] = [];

  for (const result of [...mine, ...all]) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    merged.push(result);
  }

  return merged;
}

const SEARCH_PER_PAGE = 50;

const RANDOM_PUBLIC_MAX_ATTEMPTS = 4;

/**
 * Pick a random public channel via search (requires auth + premium).
 */
export async function getRandomPublicChannel(
  token: string
): Promise<ChannelSearchResult> {
  for (let attempt = 0; attempt < RANDOM_PUBLIC_MAX_ATTEMPTS; attempt++) {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const page = Math.floor(Math.random() * 10) + 1;
    const params = new URLSearchParams({
      query: "*",
      type: "Channel",
      per: String(SEARCH_PER_PAGE),
      page: String(page),
      sort: "random",
      seed: String(seed),
    });
    const raw = await request<RawSearchResponse>(
      `/v3/search?${params.toString()}`,
      token
    );

    const publicChannels: RawChannel[] = [];
    for (const item of raw.data) {
      if (item.type !== "Channel") continue;
      const ch = item as RawChannel;
      if (ch.visibility === "public" && ch.counts.blocks > 0) {
        publicChannels.push(ch);
      }
    }

    if (publicChannels.length > 0) {
      const ch =
        publicChannels[Math.floor(Math.random() * publicChannels.length)]!;
      return mapRawChannelToSearchResult(ch);
    }
  }

  throw new ApiError(0, "no public channels found");
}

const USER_CHANNELS_MAX = 200;
const USER_CHANNELS_PER = 50;

function mapChannelVisibility(raw: string): ChannelVisibility {
  switch (raw) {
    case "public":
    case "private":
    case "closed":
      return raw;
    default: {
      const _exhaustive: never = raw as never;
      void _exhaustive;
      return "public";
    }
  }
}

/**
 * List the authenticated user's channels (owned + accessible via scope=my).
 * Paginates up to USER_CHANNELS_MAX, sorted by most recently updated.
 */
export async function getUserChannels(token: string): Promise<UserChannelItem[]> {
  const channels: UserChannelItem[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && channels.length < USER_CHANNELS_MAX) {
    const params = new URLSearchParams({
      query: "*",
      scope: "my",
      type: "Channel",
      per: String(USER_CHANNELS_PER),
      page: String(page),
      sort: "updated_at_desc",
    });
    const raw = await request<RawSearchResponse>(
      `/v3/search?${params.toString()}`,
      token
    );

    if (raw.data.length === 0) break;

    for (const item of raw.data) {
      if (item.type !== "Channel") continue;
      const ch = item as RawChannel;
      channels.push({
        id: ch.id,
        slug: ch.slug,
        title: ch.title,
        blockCount: ch.counts.blocks,
        visibility: mapChannelVisibility(ch.visibility),
      });
      if (channels.length >= USER_CHANNELS_MAX) break;
    }

    hasMore = raw.meta.has_more_pages;
    page++;
  }

  return channels;
}

async function fetchChannelSearch(
  query: string,
  token: string,
  scope?: "my"
): Promise<ChannelSearchResult[]> {
  const params = new URLSearchParams({
    query,
    type: "Channel",
    per: String(SEARCH_PER_PAGE),
  });
  if (scope) {
    params.set("scope", scope);
  }

  const raw = await request<RawSearchResponse>(
    `/v3/search?${params.toString()}`,
    token
  );

  const results: ChannelSearchResult[] = [];
  for (const item of raw.data) {
    if (item.type !== "Channel") continue;
    const ch = item as RawChannel;
    results.push(mapRawChannelToSearchResult(ch));
  }
  return results;
}
