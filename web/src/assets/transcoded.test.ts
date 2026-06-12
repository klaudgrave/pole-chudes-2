import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadFntPlanes, loadLibSprites, readJsonAsset } from './assets.node';
import { fntFromPlanes, fntToTranscoded, parseFnt, rebuildFnt, type FntJson } from './fnt';
import { encodeLibRow, libFromSprites, libToTranscoded, parseLib, rebuildLib, type LibJson } from './lib';
import { ovlFromJson, ovlToJson, parseOvl, rebuildOvl, type OvlJson } from './ovl';
import { parsePic, picFromJson, picToJson, rebuildPic, type PicJson } from './pic';
import { defaultAssetSpec } from '../spec';

// The shipped asset sources — WebP images plus JSON manifests for graphics,
// JSON for data — must rebuild the original DOS binaries byte-for-byte. The
// sha256 pins in defaultAssetSpec prove fidelity without the originals; when
// the gitignored _local fixtures are present, the rebuilt bytes are
// additionally compared against them directly.

function originalFixturePath(fileName: string): string {
  return fileURLToPath(new URL(`../../../_local/Pole Chudes 2/${fileName}`, import.meta.url));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function specEntry(original: string) {
  const entry = defaultAssetSpec.transcodedAssets.files.find((file) => file.original === original);
  if (!entry) {
    throw new Error(`No transcodedAssets spec entry for ${original}`);
  }
  return entry;
}

function spriteFileName(index: number): string {
  const entry = Object.entries(defaultAssetSpec.spriteIds).find(([, id]) => id === index);
  const name = entry ? entry[0].toLowerCase().replaceAll('_', '-') : 'sprite';
  return `sprites/${String(index).padStart(2, '0')}-${name}.webp`;
}

interface AssetCase {
  original: string;
  rebuild(): Promise<Uint8Array>;
  /** Checked-in manifest/JSON must equal what the transcoder emits from the original bytes. */
  canonical(data: Uint8Array): Promise<void>;
}

const cases: AssetCase[] = [
  {
    original: 'POLE2.LIB',
    rebuild: async () => {
      const json = readJsonAsset<LibJson>('POLE2.LIB.json');
      return rebuildLib(json, await loadLibSprites(json));
    },
    canonical: async (data) => {
      const expected = libToTranscoded(data, spriteFileName);
      expect(readJsonAsset<LibJson>('POLE2.LIB.json')).toEqual(expected.json);
      // The WebP bytes may differ across encoder versions; the decoded pixels
      // are the source of truth and must match the original exactly.
      expect(await loadLibSprites(expected.json)).toEqual(expected.spritePixels);
    },
  },
  {
    original: 'POLE.FNT',
    rebuild: async () => {
      const json = readJsonAsset<FntJson>('POLE.FNT.json');
      return rebuildFnt(json, await loadFntPlanes(json));
    },
    canonical: async (data) => {
      const expected = fntToTranscoded(data, (height) => `fonts/font-${height}.webp`);
      expect(readJsonAsset<FntJson>('POLE.FNT.json')).toEqual(expected.json);
      expect(await loadFntPlanes(expected.json)).toEqual(expected.planes);
    },
  },
  {
    original: 'POLE.OVL',
    rebuild: async () => rebuildOvl(readJsonAsset<OvlJson>('POLE.OVL.json')),
    canonical: async (data) => {
      expect(readJsonAsset<OvlJson>('POLE.OVL.json')).toEqual(ovlToJson(data));
    },
  },
  {
    original: 'POLE.PIC',
    rebuild: async () => rebuildPic(readJsonAsset<PicJson>('POLE.PIC.json')),
    canonical: async (data) => {
      expect(readJsonAsset<PicJson>('POLE.PIC.json')).toEqual(picToJson(data));
    },
  },
];

describe.each(cases)('transcoded $original', ({ original, rebuild, canonical }) => {
  it('rebuilds the original binary (pinned sha256 and size)', async () => {
    const entry = specEntry(original);
    const rebuilt = await rebuild();
    expect(rebuilt.length).toBe(entry.originalSizeBytes);
    expect(sha256(rebuilt)).toBe(entry.originalSha256);
  });

  const fixture = originalFixturePath(original);
  it.skipIf(!existsSync(fixture))('matches the _local fixture byte-for-byte and in canonical form', async () => {
    const originalBytes = new Uint8Array(readFileSync(fixture));
    expect(await rebuild()).toEqual(originalBytes);
    // The checked-in sources are exactly what the transcoder emits — no hand edits.
    await canonical(originalBytes);
  });
});

describe('runtime equivalence over the rebuilt binaries', () => {
  it('libFromSprites matches parseLib', async () => {
    const json = readJsonAsset<LibJson>('POLE2.LIB.json');
    const sprites = await loadLibSprites(json);
    expect(libFromSprites(json, sprites)).toEqual(parseLib(rebuildLib(json, sprites)));
  });

  it('fntFromPlanes matches parseFnt', async () => {
    const json = readJsonAsset<FntJson>('POLE.FNT.json');
    const planes = await loadFntPlanes(json);
    expect(fntFromPlanes(json, planes)).toEqual(parseFnt(rebuildFnt(json, planes)));
  });

  it('ovlFromJson matches parseOvl over the rebuilt binary', () => {
    const json = readJsonAsset<OvlJson>('POLE.OVL.json');
    expect(ovlFromJson(json)).toEqual(parseOvl(rebuildOvl(json)));
  });

  it('picFromJson matches parsePic over the rebuilt binary', () => {
    const json = readJsonAsset<PicJson>('POLE.PIC.json');
    expect(picFromJson(json)).toEqual(parsePic(rebuildPic(json)));
  });
});

describe('LIB row-RLE packer rule', () => {
  const spec = defaultAssetSpec.transcodedAssets.libRowRle;

  it('emits a pair run only when no literal is pending', () => {
    expect(spec.emitRunPairOnEmptyLiteral).toBe(true);
    // 10,10,2 at a token boundary: the pair becomes an RLE token.
    expect(encodeLibRow(Uint8Array.of(10, 10, 2))).toEqual([128 + 2, 10, 1, 2, 0]);
    // 10,2,2: the pair lands inside the open literal instead.
    expect(encodeLibRow(Uint8Array.of(10, 2, 2))).toEqual([3, 10, 2, 2, 0]);
  });

  it('emits runs of three and longer even mid-literal', () => {
    expect(spec.emitRunMinLength).toBe(3);
    expect(encodeLibRow(Uint8Array.of(9, 0, 0, 0))).toEqual([1, 9, 128 + 3, 0, 0]);
  });

  it('caps runs at 127 and terminates rows with an empty literal', () => {
    expect(spec.maxRunLength).toBe(127);
    expect(spec.rowTerminator).toBe('empty-literal');
    const row = new Uint8Array(130).fill(7);
    expect(encodeLibRow(row)).toEqual([128 + 127, 7, 128 + 3, 7, 0]);
  });
});
