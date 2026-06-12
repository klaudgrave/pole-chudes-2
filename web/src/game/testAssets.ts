import { loadTranscodedFnt, loadTranscodedLib, readJsonAsset } from '../assets/assets.node';
import type { PoleFonts } from '../assets/fnt';
import type { PoleLib } from '../assets/lib';
import { ovlFromJson, type OvlFile, type OvlJson } from '../assets/ovl';
import { picFromJson, type PicJson, type TopPlayerRecord } from '../assets/pic';

/**
 * Game-test fixtures loaded from the checked-in asset sources — WebP images
 * plus JSON manifests for graphics, JSON for data (proven byte-equivalent to
 * the original DOS binaries in transcoded.test.ts).
 */
export const lib: PoleLib = await loadTranscodedLib();
export const fonts: PoleFonts = await loadTranscodedFnt();
export const ovl: OvlFile = ovlFromJson(readJsonAsset<OvlJson>('POLE.OVL.json'));
export const pic: TopPlayerRecord[] = picFromJson(readJsonAsset<PicJson>('POLE.PIC.json'));
