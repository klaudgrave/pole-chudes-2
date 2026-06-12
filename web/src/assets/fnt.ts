import { bytesEqual } from './bytes.ts';

const FONT6_SIZE = 0x600;
const FONT8_SIZE = 0x800;
const FONT14_SIZE = 0xe00;
const EXPECTED_TOTAL_SIZE = FONT6_SIZE + FONT8_SIZE + FONT14_SIZE;

export interface PoleFonts {
  font6: Uint8Array;
  font8: Uint8Array;
  font14: Uint8Array;
}

export function parseFnt(input: Uint8Array | ArrayBuffer): PoleFonts {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (data.length !== EXPECTED_TOTAL_SIZE) {
    throw new Error(`Unexpected FNT size: ${data.length}, expected ${EXPECTED_TOTAL_SIZE}`);
  }

  return {
    font6: data.slice(0, FONT6_SIZE),
    font8: data.slice(FONT6_SIZE, FONT6_SIZE + FONT8_SIZE),
    font14: data.slice(FONT6_SIZE + FONT8_SIZE, EXPECTED_TOTAL_SIZE),
  };
}

export function getGlyphRows(fontData: Uint8Array, glyphHeight: 6 | 8 | 14, codePoint: number): Uint8Array {
  if (codePoint < 0 || codePoint > 255) {
    throw new Error(`Glyph code point out of range: ${codePoint}`);
  }

  const offset = codePoint * glyphHeight;
  return fontData.slice(offset, offset + glyphHeight);
}

// --------------------------------------------------------- transcoded format
//
// POLE.FNT expressed as editable sources: one lossless WebP glyph atlas per
// plane (16x16 glyphs, white = bit set, black = clear — see spriteImage.ts)
// plus a JSON manifest listing the planes. The decoded planes concatenated in
// manifest order are the file, byte-for-byte.

export interface FntJsonPlane {
  height: number;
  /** Atlas image path relative to the assets dir, e.g. 'fonts/font-8.webp'. */
  file: string;
}

export interface FntJson {
  format: 'pole-fnt';
  version: 2;
  planes: FntJsonPlane[];
}

export const FNT_PLANE_HEIGHTS = [6, 8, 14] as const;

function assertFntJson(json: FntJson): void {
  if (json.format !== 'pole-fnt' || json.version !== 2) {
    throw new Error('Not a pole-fnt v2 JSON asset');
  }
  if (json.planes.length !== FNT_PLANE_HEIGHTS.length) {
    throw new Error(`Expected ${FNT_PLANE_HEIGHTS.length} font planes, got ${json.planes.length}`);
  }
  for (let i = 0; i < FNT_PLANE_HEIGHTS.length; i += 1) {
    if (json.planes[i].height !== FNT_PLANE_HEIGHTS[i]) {
      throw new Error(`Font plane ${i} has height ${json.planes[i].height}, expected ${FNT_PLANE_HEIGHTS[i]}`);
    }
  }
}

function checkPlaneBytes(json: FntJson, planes: readonly Uint8Array[]): void {
  assertFntJson(json);
  for (let i = 0; i < FNT_PLANE_HEIGHTS.length; i += 1) {
    const expected = 256 * FNT_PLANE_HEIGHTS[i];
    if (!planes[i] || planes[i].length !== expected) {
      throw new Error(`Font plane ${json.planes[i].file} is ${planes[i]?.length ?? 0} bytes, expected ${expected}`);
    }
  }
}

/**
 * Rebuilds the exact original POLE.FNT bytes from the manifest plus the
 * decoded atlas planes (in manifest order).
 */
export function rebuildFnt(json: FntJson, planes: readonly Uint8Array[]): Uint8Array {
  checkPlaneBytes(json, planes);

  const out = new Uint8Array(EXPECTED_TOTAL_SIZE);
  let offset = 0;
  for (const plane of planes) {
    out.set(plane, offset);
    offset += plane.length;
  }
  return out;
}

/** Converts the manifest plus decoded atlas planes into the same structure `parseFnt` returns. */
export function fntFromPlanes(json: FntJson, planes: readonly Uint8Array[]): PoleFonts {
  return parseFnt(rebuildFnt(json, planes));
}

/**
 * Transcodes the original POLE.FNT bytes into the manifest plus per-plane
 * glyph bytes (which the caller encodes as lossless WebP atlases, named by
 * `fileNameFor`). Throws if the result does not rebuild the input
 * byte-for-byte.
 */
export function fntToTranscoded(
  input: Uint8Array | ArrayBuffer,
  fileNameFor: (height: number) => string,
): { json: FntJson; planes: Uint8Array[] } {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parsed = parseFnt(data);

  const planes = [parsed.font6, parsed.font8, parsed.font14];
  const json: FntJson = {
    format: 'pole-fnt',
    version: 2,
    planes: FNT_PLANE_HEIGHTS.map((height) => ({ height, file: fileNameFor(height) })),
  };

  if (!bytesEqual(rebuildFnt(json, planes), data)) {
    throw new Error('POLE.FNT transcode failed to round-trip byte-for-byte');
  }
  return { json, planes };
}
