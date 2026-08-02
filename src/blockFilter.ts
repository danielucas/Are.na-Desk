// ---------------------------------------------------------------------------
// blockFilter.ts — block type filter helpers
// ---------------------------------------------------------------------------

import type { DeskBlock, DeskBlockType } from "./types";

const TYPE_ORDER: DeskBlockType[] = [
  "Image",
  "Link",
  "Embed",
  "Text",
  "Attachment",
  "Pending",
];

export function blockTypeLabel(type: DeskBlockType): string {
  switch (type) {
    case "Image":
    case "Link":
    case "Embed":
    case "Text":
    case "Attachment":
    case "Pending":
      return type.toLowerCase();
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return type;
    }
  }
}

export function typesPresentInChannel(blocks: DeskBlock[]): DeskBlockType[] {
  const seen = new Set<DeskBlockType>();
  for (const block of blocks) {
    seen.add(block.type);
  }
  return TYPE_ORDER.filter((type) => seen.has(type));
}
