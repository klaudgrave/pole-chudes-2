// Builds docs/wheel.gif — the four FORTUNE_WHEEL sprites as an infinite
// rotation loop (README eye-candy). The in-game spin shows the base frames in
// ascending order ((a+3) and 3 with a incrementing, dpr:475), so the loop is
// 0→1→2→3. The cyan surround (palette index 3, the in-game transparent key
// for the wheel base) becomes GIF transparency; pixels are 2x nearest.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { loadLibSprites, readJsonAsset } from '../src/assets/assets.node.ts';
import { defaultRenderSpec } from '../src/spec/defaultSpecs.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(here, '..', '..');
const outFile = path.join(repoDir, 'docs', 'wheel.gif');

const TRANSPARENT_INDEX = 3;
const SCALE = 2;
const FRAME_DELAY_MS = 110;

async function main() {
  const manifest = readJsonAsset('POLE2.LIB.json');
  const sprites = await loadLibSprites(manifest);
  const frames = [0, 1, 2, 3].map((id) => sprites[id]);
  const { width, height } = frames[0];

  const scaled = await Promise.all(
    frames.map((frame) => {
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < frame.pixels.length; i += 1) {
        const index = frame.pixels[i];
        if (index === TRANSPARENT_INDEX) {
          continue;
        }
        const color = defaultRenderSpec.palette[index];
        rgba[i * 4] = color[0];
        rgba[i * 4 + 1] = color[1];
        rgba[i * 4 + 2] = color[2];
        rgba[i * 4 + 3] = 0xff;
      }
      return sharp(rgba, { raw: { width, height, channels: 4 } })
        .resize(width * SCALE, height * SCALE, { kernel: 'nearest' })
        .png()
        .toBuffer();
    }),
  );

  await sharp(scaled, { join: { animated: true } })
    .gif({ delay: FRAME_DELAY_MS, loop: 0 })
    .toFile(outFile);

  console.log(`Wrote ${path.relative(repoDir, outFile)} (${width * SCALE}x${height * SCALE}, 4 frames)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
