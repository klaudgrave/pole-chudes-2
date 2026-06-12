// Node-only loader for the checked-in transcoded assets under
// web/public/assets/ — the same manifest + WebP pipeline the browser runtime
// uses in main.ts, but decoding via sharp. Used by tests and scripts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fntFromPlanes, type FntJson, type PoleFonts } from './fnt.ts';
import { libFromSprites, type LibJson, type PoleLib, type SpritePixels } from './lib.ts';
import { fontPlaneFromRgba, rgbaToIndexed } from './spriteImage.ts';
import { decodeWebp } from './webp.node.ts';
import { defaultRenderSpec } from '../spec/defaultSpecs.ts';

function assetPath(fileName: string): string {
  return fileURLToPath(new URL(`../../public/assets/${fileName}`, import.meta.url));
}

export function readJsonAsset<T>(fileName: string): T {
  return JSON.parse(readFileSync(assetPath(fileName), 'utf8')) as T;
}

export async function loadLibSprites(json: LibJson): Promise<SpritePixels[]> {
  return Promise.all(
    json.sprites.map(async (sprite) => {
      const image = await decodeWebp(new Uint8Array(readFileSync(assetPath(sprite.file))));
      return {
        width: image.width,
        height: image.height,
        pixels: rgbaToIndexed(image, defaultRenderSpec.palette),
      };
    }),
  );
}

export async function loadFntPlanes(json: FntJson): Promise<Uint8Array[]> {
  return Promise.all(
    json.planes.map(async (plane) => {
      const image = await decodeWebp(new Uint8Array(readFileSync(assetPath(plane.file))));
      return fontPlaneFromRgba(image, plane.height);
    }),
  );
}

export async function loadTranscodedLib(): Promise<PoleLib> {
  const json = readJsonAsset<LibJson>('POLE2.LIB.json');
  return libFromSprites(json, await loadLibSprites(json));
}

export async function loadTranscodedFnt(): Promise<PoleFonts> {
  const json = readJsonAsset<FntJson>('POLE.FNT.json');
  return fntFromPlanes(json, await loadFntPlanes(json));
}
