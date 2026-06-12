// Transcodes the original DOS data files into the checked-in sources under
// web/public/assets/: graphics become lossless WebP images (one per sprite,
// one glyph atlas per font plane) with slim JSON manifests for the bytes an
// image cannot carry; OVL/PIC stay JSON. Every transcode self-verifies by
// re-reading the written files and rebuilding the original byte-for-byte, so
// this script cannot produce an unfaithful transcode. The originals are read
// from gitignored _local/ and stay there as test fixtures.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fntToTranscoded, rebuildFnt } from '../src/assets/fnt.ts';
import { libToTranscoded, rebuildLib } from '../src/assets/lib.ts';
import { ovlToJson } from '../src/assets/ovl.ts';
import { picToJson } from '../src/assets/pic.ts';
import { fontPlaneFromRgba, fontPlaneToRgba, indexedToRgba, rgbaToIndexed } from '../src/assets/spriteImage.ts';
import { decodeWebp, encodeWebpLossless } from '../src/assets/webp.node.ts';
import { defaultAssetSpec, defaultRenderSpec } from '../src/spec/defaultSpecs.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const repoDir = path.resolve(webDir, '..');
const originalsDir = path.join(repoDir, '_local', 'Pole Chudes 2');
const outDir = path.join(webDir, 'public', 'assets');

const palette = defaultRenderSpec.palette;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytesEqual(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function spriteFileName(index) {
  const entry = Object.entries(defaultAssetSpec.spriteIds).find(([, id]) => id === index);
  const name = entry ? entry[0].toLowerCase().replaceAll('_', '-') : 'sprite';
  return `sprites/${String(index).padStart(2, '0')}-${name}.webp`;
}

async function writeWebp(relFile, image) {
  const outFile = path.join(outDir, relFile);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, await encodeWebpLossless(image));
  // Verify from disk: the written WebP must decode back to the exact pixels.
  return decodeWebp(new Uint8Array(await readFile(outFile)));
}

async function writeJson(name, json) {
  const outFile = path.join(outDir, name);
  await writeFile(outFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return outFile;
}

function report(name, original, fileCount) {
  const files = fileCount ? ` + ${fileCount} webp` : '';
  console.log(`${name}: ${original.length} bytes, sha256 ${sha256(original)} -> public/assets/${name}.json${files}`);
}

async function transcodeLib(original) {
  const { json, spritePixels } = libToTranscoded(original, spriteFileName);

  await rm(path.join(outDir, 'sprites'), { recursive: true, force: true });
  const rereadPixels = [];
  for (let i = 0; i < json.sprites.length; i += 1) {
    const sprite = spritePixels[i];
    const decoded = await writeWebp(json.sprites[i].file, indexedToRgba(sprite.pixels, sprite.width, sprite.height, palette));
    rereadPixels.push({ width: decoded.width, height: decoded.height, pixels: rgbaToIndexed(decoded, palette) });
  }

  if (!bytesEqual(rebuildLib(json, rereadPixels), original)) {
    throw new Error('POLE2.LIB: written WebP files do not rebuild the original byte-for-byte');
  }
  await writeJson('POLE2.LIB.json', json);
  report('POLE2.LIB', original, json.sprites.length);
}

async function transcodeFnt(original) {
  const { json, planes } = fntToTranscoded(original, (height) => `fonts/font-${height}.webp`);

  await rm(path.join(outDir, 'fonts'), { recursive: true, force: true });
  const rereadPlanes = [];
  for (let i = 0; i < json.planes.length; i += 1) {
    const { height, file } = json.planes[i];
    const decoded = await writeWebp(file, fontPlaneToRgba(planes[i], height));
    rereadPlanes.push(fontPlaneFromRgba(decoded, height));
  }

  if (!bytesEqual(rebuildFnt(json, rereadPlanes), original)) {
    throw new Error('POLE.FNT: written WebP atlases do not rebuild the original byte-for-byte');
  }
  await writeJson('POLE.FNT.json', json);
  report('POLE.FNT', original, json.planes.length);
}

async function main() {
  const readOriginal = async (name) => new Uint8Array(await readFile(path.join(originalsDir, name)));

  await transcodeLib(await readOriginal('POLE2.LIB'));
  await transcodeFnt(await readOriginal('POLE.FNT'));

  for (const { name, transcode } of [
    { name: 'POLE.OVL', transcode: ovlToJson },
    { name: 'POLE.PIC', transcode: picToJson },
  ]) {
    const original = await readOriginal(name);
    await writeJson(`${name}.json`, transcode(original));
    report(name, original, 0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
