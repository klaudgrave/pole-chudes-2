import { describe, expect, it } from 'vitest';

import { loadFntPlanes, loadLibSprites, readJsonAsset } from './assets.node';
import { parseFnt, rebuildFnt, type FntJson } from './fnt';
import { parseLib, rebuildLib, type LibJson } from './lib';
import { parseOvl, serializeOvl, rebuildOvl, type OvlJson } from './ovl';
import { parsePic, serializePic, rebuildPic, type PicJson } from './pic';
import { defaultAssetSpec, defaultFlowSpec } from '../spec';

/**
 * The binary parsers stay exercised against the exact original bytes by
 * rebuilding them from the checked-in transcoded sources (proven
 * byte-identical to the originals in transcoded.test.ts).
 */
async function readAsset(fileName: string): Promise<Uint8Array> {
  switch (fileName) {
    case 'POLE2.LIB': {
      const json = readJsonAsset<LibJson>('POLE2.LIB.json');
      return rebuildLib(json, await loadLibSprites(json));
    }
    case 'POLE.FNT': {
      const json = readJsonAsset<FntJson>('POLE.FNT.json');
      return rebuildFnt(json, await loadFntPlanes(json));
    }
    case 'POLE.OVL':
      return rebuildOvl(readJsonAsset<OvlJson>('POLE.OVL.json'));
    case 'POLE.PIC':
      return rebuildPic(readJsonAsset<PicJson>('POLE.PIC.json'));
    default:
      throw new Error(`Unknown asset ${fileName}`);
  }
}

function sumBytes(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) {
    total += value;
  }
  return total;
}

describe('POLE2.LIB parser', () => {
  it('parses sprite metadata and pixel data', async () => {
    const parsed = parseLib(await readAsset('POLE2.LIB'));

    expect(parsed.spriteCount).toBe(defaultAssetSpec.spriteLibrary.spriteCount);
    expect(parsed.sprites[0].width).toBe(223);
    expect(parsed.sprites[0].height).toBe(172);
    expect(parsed.sprites[60].width).toBe(76);
    expect(parsed.sprites[60].height).toBe(37);

    expect(parsed.sprites[0].pixels.length).toBe(223 * 172);
    expect(sumBytes(parsed.sprites[0].pixels)).toBe(226914);
    expect(sumBytes(parsed.sprites[60].pixels)).toBe(14305);
    expect(Math.max(...parsed.sprites[0].pixels)).toBeLessThanOrEqual(15);
    expect(Math.max(...parsed.sprites[60].pixels)).toBeLessThanOrEqual(15);
  });
});

describe('POLE.FNT parser', () => {
  it('splits into three glyph planes', async () => {
    const parsed = parseFnt(await readAsset('POLE.FNT'));

    expect(parsed.font6.length).toBe(defaultAssetSpec.fontFile.planes[0].sizeBytes);
    expect(parsed.font8.length).toBe(defaultAssetSpec.fontFile.planes[1].sizeBytes);
    expect(parsed.font14.length).toBe(defaultAssetSpec.fontFile.planes[2].sizeBytes);
  });
});

describe('POLE.OVL parser', () => {
  it('parses and serializes question pairs', async () => {
    const parsed = parseOvl(await readAsset('POLE.OVL'));

    expect(parsed.headerValue).toBe(686);
    expect(parsed.questions.length).toBe(686);
    expect(parsed.questions[0]).toEqual({
      word: 'БИБЛИОГРАФИЯ',
      theme: 'НАУЧНЫЙ ТЕРМИН',
    });
    expect(parsed.questions.at(-1)).toEqual({
      word: 'ШАРТРЕЗ',
      theme: 'НАПИТКИ',
    });

    const roundTrip = parseOvl(serializeOvl(parsed));
    expect(roundTrip.headerValue).toBe(parsed.headerValue);
    expect(roundTrip.questions).toEqual(parsed.questions);
  });
});

describe('POLE.PIC parser', () => {
  it('parses top players and supports serialization', async () => {
    const parsed = parsePic(await readAsset('POLE.PIC'));

    expect(parsed.length).toBe(defaultFlowSpec.leaderboard.maxEntries);
    expect(parsed[0]).toEqual({ name: 'МАКС', score: 1440 });
    expect(parsed[1]).toEqual({ name: 'АЛЕКСЕЙ', score: 285 });

    const roundTrip = parsePic(serializePic(parsed));
    expect(roundTrip).toEqual(parsed);
  });
});
