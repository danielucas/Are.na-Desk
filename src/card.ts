// ---------------------------------------------------------------------------
// card.ts — PixiJS v8 card rendering (no app/world knowledge)
// ---------------------------------------------------------------------------

import {
  Container,
  Graphics,
  Text,
  TextStyle,
  Sprite,
  Texture,
} from "pixi.js";
import type { DeskBlock } from "./types";
import type { CardState } from "./scatter";
import { truncate } from "./truncate";

// ---------------------------------------------------------------------------
// CardHandle
// ---------------------------------------------------------------------------

export interface CardHandle {
  container: Container;
  block: DeskBlock;
  baseWidth: number;
  baseHeight: number;
  /** The loaded image sprite, or null for non-image / not-yet-loaded cards. */
  sprite: Sprite | null;
  /**
   * Swap the sprite's texture to the full-resolution image (imageLargeUrl ??
   * imageUrl). No-op for non-image cards or if the full texture is already
   * loaded. Called on resize-up when zoom exceeds threshold.
   */
  loadFullTexture(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_CARD_WIDTH = 240;
const TEXT_CARD_WIDTH = 260;
const TEXT_CARD_MAX_HEIGHT = 300;
const ATTACHMENT_CARD_WIDTH = 200;
const ATTACHMENT_CARD_HEIGHT = 80;
const TEXT_PADDING = 16;
const BORDER_COLOR = 0xcccccc;
const PLACEHOLDER_BORDER_COLOR = 0xcccccc;
const PLACEHOLDER_FILL = 0xffffff;
const TEXT_COLOR = 0x000000;
const MUTED_COLOR = 0x888888;
const FONT_FAMILY = "ui-monospace, Menlo, monospace";
const FONT_SIZE = 11;
const STROKE_WIDTH = 0.5;

/** Effective on-screen scale above which full-resolution textures are loaded. */
export const FULL_TEXTURE_SCALE_THRESHOLD = 1.25;

export function shouldLoadFullTexture(worldScale: number, cardScale: number): boolean {
  return worldScale * cardScale > FULL_TEXTURE_SCALE_THRESHOLD;
}

// Attachment label max chars before truncation (fits in 200px card)
const ATTACHMENT_MAX_CHARS = 24;

// ---------------------------------------------------------------------------
// Per-channel texture cache (evictable)
// ---------------------------------------------------------------------------

const textureCache = new Map<string, Promise<Texture>>();

const MAX_CONCURRENT_LOADS = 8;
let activeLoads = 0;
const loadQueue: Array<() => void> = [];

function runQueuedLoad<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = (): void => {
      activeLoads++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeLoads--;
          const next = loadQueue.shift();
          if (next) next();
        });
    };

    if (activeLoads < MAX_CONCURRENT_LOADS) {
      run();
    } else {
      loadQueue.push(run);
    }
  });
}

/**
 * Load a texture from a URL using a plain HTMLImageElement so that PixiJS v8
 * doesn't reject URLs without a recognised file extension (Are.na thumbs are
 * Base64-encoded cloudfront paths with no extension).
 */
function loadTexture(url: string): Promise<Texture> {
  const cached = textureCache.get(url);
  if (cached) return cached;

  const p = runQueuedLoad(
    () =>
      new Promise<Texture>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const tex = Texture.from(img);
            resolve(tex);
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => {
          textureCache.delete(url);
          reject(new Error(`Failed to load image: ${url}`));
        };
        img.src = url;
      }),
  );

  textureCache.set(url, p);
  return p;
}

/**
 * Destroy every settled resolved texture in the cache and clear it.
 * Called when cards are destroyed so Pixi's global Cache is pruned between channels.
 */
export function evictTextures(): void {
  for (const promise of textureCache.values()) {
    void promise.then((texture) => {
      try {
        texture.destroy(true);
      } catch {
        // already destroyed — ignore
      }
    });
  }
  textureCache.clear();
}

// ---------------------------------------------------------------------------
// Text style helpers
// ---------------------------------------------------------------------------

function makeTextStyle(opts: {
  fontSize?: number;
  fill?: number;
  wordWrap?: boolean;
  wordWrapWidth?: number;
}): TextStyle {
  return new TextStyle({
    fontFamily: FONT_FAMILY,
    fontSize: opts.fontSize ?? FONT_SIZE,
    fill: opts.fill ?? TEXT_COLOR,
    wordWrap: opts.wordWrap ?? false,
    wordWrapWidth: opts.wordWrapWidth ?? 200,
    breakWords: true,
  });
}

// ---------------------------------------------------------------------------
// Draw a bordered rectangle on a Graphics object
// ---------------------------------------------------------------------------

function drawCard(
  g: Graphics,
  w: number,
  h: number,
  fillColor: number,
  strokeColor: number
): void {
  g.rect(-w / 2, -h / 2, w, h).fill(fillColor);
  g.rect(-w / 2, -h / 2, w, h).stroke({ width: STROKE_WIDTH, color: strokeColor });
}

// ---------------------------------------------------------------------------
// Image / Link / Embed cards
// ---------------------------------------------------------------------------

function createImageCard(
  block: DeskBlock,
  state: CardState,
  opts?: { onRenderable?: () => void },
): CardHandle {
  const aspectRatio = block.aspectRatio ?? 1;
  const baseWidth = IMAGE_CARD_WIDTH;
  const baseHeight = baseWidth / aspectRatio;

  const container = new Container();
  applyState(container, { ...state, rotation: 0 });

  // Placeholder — hold direct refs for surgical removal
  const placeholder = new Graphics();
  drawCard(placeholder, baseWidth, baseHeight, PLACEHOLDER_FILL, PLACEHOLDER_BORDER_COLOR);
  container.addChild(placeholder);

  // Title text on placeholder (if any) — hold direct ref
  let titleLabel: Text | null = null;
  if (block.title) {
    titleLabel = new Text({
      text: truncate(block.title, 40),
      style: makeTextStyle({ fill: MUTED_COLOR, wordWrap: true, wordWrapWidth: baseWidth - 20 }),
    });
    titleLabel.anchor.set(0.5, 0.5);
    container.addChild(titleLabel);
  }

  let currentTextureUrl: string | null = null;

  // The mutable handle — `sprite` will be patched when texture arrives
  const handle: CardHandle = {
    container,
    block,
    baseWidth,
    baseHeight,
    sprite: null,
    loadFullTexture,
  };

  function swapTexture(url: string): Promise<void> {
    return loadTexture(url).then((texture) => {
      // Guard: container may have been destroyed (user switched channel)
      if (container.destroyed) return;

      if (handle.sprite) {
        // Already have a sprite — just swap the texture
        handle.sprite.texture = texture;
        currentTextureUrl = url;
        return;
      }

      // First load: remove placeholder + title (preserves interaction children)
      container.removeChild(placeholder);
      placeholder.destroy();

      if (titleLabel) {
        container.removeChild(titleLabel);
        titleLabel.destroy();
        titleLabel = null;
      }

      // Draw border background
      const bg = new Graphics();
      drawCard(bg, baseWidth, baseHeight, 0xffffff, BORDER_COLOR);
      container.addChild(bg);

      // Sprite sized to card
      const sprite = new Sprite(texture);
      sprite.width = baseWidth;
      sprite.height = baseHeight;
      sprite.anchor.set(0.5, 0.5);
      container.addChild(sprite);

      // Border on top of sprite
      const border = new Graphics();
      border.rect(-baseWidth / 2, -baseHeight / 2, baseWidth, baseHeight)
        .stroke({ width: STROKE_WIDTH, color: BORDER_COLOR });
      container.addChild(border);

      // Patch handle so interactions can read handle.sprite
      handle.sprite = sprite;
      currentTextureUrl = url;
      opts?.onRenderable?.();
    });
  }

  // Async image load (thumbnail first)
  const imageUrl = block.imageThumbUrl ?? block.imageUrl;
  if (imageUrl) {
    void swapTexture(imageUrl).catch(() => {
      // Keep gray placeholder on failure — already showing
    });
  }

  const fullUrl = block.imageLargeUrl ?? block.imageUrl ?? null;

  function loadFullTexture(): Promise<void> {
    if (!fullUrl) return Promise.resolve();
    if (currentTextureUrl === fullUrl) return Promise.resolve();
    return swapTexture(fullUrl).catch(() => {
      // best-effort — ignore network errors on full-res load
    });
  }

  return handle;
}

// ---------------------------------------------------------------------------
// Text cards
// ---------------------------------------------------------------------------

function createTextCard(block: DeskBlock, state: CardState): CardHandle {
  const raw = block.textContent ?? block.title ?? String(block.id);
  const content = truncate(raw, 300);

  const wrapWidth = TEXT_CARD_WIDTH - TEXT_PADDING * 2;
  // Build style once — reused for both measurement and rendering
  const style = makeTextStyle({ wordWrap: true, wordWrapWidth: wrapWidth });

  // Measure text height with a temporary Text node; destroy immediately
  const tempText = new Text({ text: content, style });
  const measuredHeight = tempText.height + TEXT_PADDING * 2;
  tempText.destroy();

  const baseWidth = TEXT_CARD_WIDTH;
  const baseHeight = Math.min(measuredHeight, TEXT_CARD_MAX_HEIGHT);

  const container = new Container();
  applyState(container, state);

  // Background card
  const bg = new Graphics();
  drawCard(bg, baseWidth, baseHeight, PLACEHOLDER_FILL, BORDER_COLOR);
  container.addChild(bg);

  // Text label — reuse the already-constructed style
  const label = new Text({ text: content, style });
  label.x = -baseWidth / 2 + TEXT_PADDING;
  label.y = -baseHeight / 2 + TEXT_PADDING;

  // Clip label to card
  const mask = new Graphics();
  mask.rect(-baseWidth / 2, -baseHeight / 2, baseWidth, baseHeight).fill(0xffffff);
  container.addChild(mask);
  label.mask = mask;
  container.addChild(label);

  return {
    container,
    block,
    baseWidth,
    baseHeight,
    sprite: null,
    loadFullTexture: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// Attachment / imageless cards
// ---------------------------------------------------------------------------

function createAttachmentCard(block: DeskBlock, state: CardState): CardHandle {
  const baseWidth = ATTACHMENT_CARD_WIDTH;
  const baseHeight = ATTACHMENT_CARD_HEIGHT;

  const container = new Container();
  applyState(container, state);

  // Background card
  const bg = new Graphics();
  drawCard(bg, baseWidth, baseHeight, PLACEHOLDER_FILL, BORDER_COLOR);
  container.addChild(bg);

  // Main label: filename or title or block id — truncate to fit 200px card
  const mainText = block.filename ?? block.title ?? String(block.id);
  const label = new Text({
    text: truncate(mainText, ATTACHMENT_MAX_CHARS),
    style: makeTextStyle({}),
  });
  label.x = -baseWidth / 2 + TEXT_PADDING;
  label.y = -baseHeight / 2 + TEXT_PADDING;
  container.addChild(label);

  // Extension label (muted, below)
  if (block.extension) {
    const extLabel = new Text({
      text: block.extension,
      style: makeTextStyle({ fill: MUTED_COLOR }),
    });
    extLabel.x = -baseWidth / 2 + TEXT_PADDING;
    extLabel.y = label.y + label.height + 4;
    container.addChild(extLabel);
  }

  return {
    container,
    block,
    baseWidth,
    baseHeight,
    sprite: null,
    loadFullTexture: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// applyState: position, rotation, scale, zIndex — all centered on origin
// ---------------------------------------------------------------------------

function applyState(
  container: Container,
  state: CardState,
): void {
  container.x = state.x;
  container.y = state.y;
  container.rotation = state.rotation;
  container.scale.set(state.scale);
  container.zIndex = state.z;
  // Card content is drawn centered around (0,0) so pivot is naturally at center
}

// ---------------------------------------------------------------------------
// createCard — entry point
// ---------------------------------------------------------------------------

export function createCard(
  block: DeskBlock,
  state: CardState,
  opts?: { onRenderable?: () => void },
): CardHandle {
  let handle: CardHandle;

  if (
    (block.type === "Image" || block.type === "Link" || block.type === "Embed") &&
    block.imageUrl !== null
  ) {
    handle = createImageCard(block, state, opts);
  } else if (block.type === "Text") {
    handle = createTextCard(block, state);
  } else {
    handle = createAttachmentCard(block, state);
  }

  return wireCardEvents(handle);
}

function wireCardEvents(handle: CardHandle): CardHandle {
  handle.container.eventMode = "static";
  handle.container.on("pointerdown", (e) => {
    e.stopPropagation();
  });
  return handle;
}
