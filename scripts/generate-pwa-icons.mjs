import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import toIco from "to-ico";

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

const ico = await toIco(await Promise.all([16, 32, 48].map(pngBuffer)));
writeFileSync(join(publicDir, "favicon.ico"), ico);
