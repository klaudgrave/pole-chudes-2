// Node-only lossless WebP codec (sharp). Used by the transcode script and
// tests; the browser runtime decodes WebP natively (see main.ts). Excluded
// from the tsc build pass like the other node-only modules.
import sharp from 'sharp';

import type { RgbaImage } from './spriteImage.ts';

export async function encodeWebpLossless(image: RgbaImage): Promise<Uint8Array> {
  const data = await sharp(Buffer.from(image.rgba), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  return new Uint8Array(data);
}

export async function decodeWebp(bytes: Uint8Array): Promise<RgbaImage> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error(`Decoded WebP has ${info.channels} channels, expected 4`);
  }
  return { width: info.width, height: info.height, rgba: new Uint8Array(data) };
}
