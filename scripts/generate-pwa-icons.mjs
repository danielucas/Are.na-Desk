import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const svg = readFileSync(join(publicDir, "icon.svg"));

function pngBuffer(size) {
  return sharp(svg)
    .resize(size, size, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
}

const pngSizes = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "pwa-192x192.png", size: 192 },
  { name: "pwa-512x512.png", size: 512 },
];

for (const { name, size } of pngSizes) {
  await pngBuffer(size).then((buffer) =>
    writeFileSync(join(publicDir, name), buffer),
  );
}

// ---------------------------------------------------------------------------
// ICO packing
//
// An .ico is a 6-byte header, one 16-byte directory entry per image, then the
// image payloads back to back. Entries may be PNG-encoded — every current
// browser reads that — so sharp's PNG buffers go in untouched.
//
// Done by hand rather than with to-ico, which pulls jimp and a deprecated
// `request` in order to resize images that sharp has already sized correctly.
// ---------------------------------------------------------------------------

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

function pngsToIco(images) {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(0, 0); // reserved, always 0
  header.writeUInt16LE(1, 2); // resource type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * images.length;

  const entries = images.map(({ size, buffer }) => {
    const entry = Buffer.alloc(ICO_ENTRY_BYTES);
    // A 256px icon is stored as 0 — the field is one byte, so 256 doesn't fit
    const dimension = size >= 256 ? 0 : size;
    entry.writeUInt8(dimension, 0); // width
    entry.writeUInt8(dimension, 1); // height
    entry.writeUInt8(0, 2); // palette entries; 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return entry;
  });

  return Buffer.concat([
    header,
    ...entries,
    ...images.map(({ buffer }) => buffer),
  ]);
}

const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(
  icoSizes.map(async (size) => ({ size, buffer: await pngBuffer(size) })),
);
writeFileSync(join(publicDir, "favicon.ico"), pngsToIco(icoImages));
