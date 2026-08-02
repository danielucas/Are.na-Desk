export type DeskBlockType =
  | "Text"
  | "Image"
  | "Link"
  | "Attachment"
  | "Embed"
  | "Pending";

export interface DeskBlock {
  id: number;
  type: DeskBlockType;
  title: string | null;
  description: string | null; // plain-text rendering of description, if any
  textContent: string | null; // plain-text content for Text blocks
  imageUrl: string | null; // medium version src, null if imageless
  imageThumbUrl: string | null; // small version src
  imageLargeUrl: string | null; // large version src
  aspectRatio: number | null; // width/height when known (from BlockImage.aspect_ratio)
  sourceUrl: string | null; // original source / link URL if any
  filename: string | null; // attachments
  extension: string | null; // attachments, lowercase without dot
  connectedAt: string | null; // ISO timestamp of connection to this channel
  connectedBy: string | null; // display name of user who connected it
  arenaUrl: string; // https://www.are.na/block/{id}
}

export interface DeskChannel {
  id: number;
  slug: string;
  title: string;
  author: string; // owner display name
  blockCount: number; // from counts.blocks
  visibility: ChannelVisibility;
  arenaUrl: string; // https://www.are.na/channels/{slug}
}

export interface ChannelSearchResult {
  id: number;
  slug: string;
  title: string;
  author: string;
  blockCount: number;
}

export type ChannelVisibility = "public" | "private" | "closed";

export interface UserChannelItem {
  id: number;
  slug: string;
  title: string;
  blockCount: number;
  visibility: ChannelVisibility;
}

export type LayoutMode = "scatter" | "date";
