import type { PaletteColor } from '../spec/types.ts';

/**
 * Conversions between the editable image assets (lossless WebP, RGBA) and the
 * indexed pixel data the engine and the byte-exact rebuilders work with. The
 * mapping is exact in both directions: every sprite pixel is a palette index
 * 0..15, every image pixel is the opaque palette color of that index, and the
 * 16 palette entries are pairwise distinct — so no information is lost and an
 * off-palette edit fails loudly instead of being silently quantized.
 */
export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA8888, row-major, width*height*4 bytes. */
  rgba: Uint8Array;
}

export function indexedToRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: readonly PaletteColor[],
): RgbaImage {
  if (pixels.length !== width * height) {
    throw new Error(`Indexed image is ${pixels.length} pixels, expected ${width}x${height}`);
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const color = palette[pixels[i]];
    if (!color) {
      throw new Error(`Pixel ${i} has index ${pixels[i]}, outside the ${palette.length}-color palette`);
    }
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = 0xff;
  }

  return { width, height, rgba };
}

export function rgbaToIndexed(image: RgbaImage, palette: readonly PaletteColor[]): Uint8Array {
  const { width, height, rgba } = image;
  if (rgba.length !== width * height * 4) {
    throw new Error(`RGBA buffer is ${rgba.length} bytes, expected ${width}x${height}x4`);
  }

  const indexByRgb = new Map<number, number>();
  for (let i = 0; i < palette.length; i += 1) {
    indexByRgb.set((palette[i][0] << 16) | (palette[i][1] << 8) | palette[i][2], i);
  }

  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    if (rgba[i * 4 + 3] !== 0xff) {
      throw new Error(
        `Pixel (${i % width},${Math.floor(i / width)}) has alpha ${rgba[i * 4 + 3]}; sprite images must be fully opaque`,
      );
    }
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    const index = indexByRgb.get(key);
    if (index === undefined) {
      const hex = key.toString(16).padStart(6, '0');
      throw new Error(
        `Pixel (${i % width},${Math.floor(i / width)}) color #${hex} is not one of the ${palette.length} palette colors`,
      );
    }
    pixels[i] = index;
  }

  return pixels;
}

// ------------------------------------------------------------- font atlases
//
// Each POLE.FNT plane (256 glyphs of 8x`height` 1-bit pixels) is stored as a
// 16x16-glyph atlas image: 128 pixels wide, 16*height tall, glyph for code
// point N at column N%16, row N>>4. White = bit set, black = bit clear.

export const FONT_ATLAS_COLUMNS = 16;
export const FONT_ATLAS_ROWS = 16;
export const GLYPH_WIDTH = 8;

export function fontPlaneToRgba(plane: Uint8Array, glyphHeight: number): RgbaImage {
  if (plane.length !== 256 * glyphHeight) {
    throw new Error(`Font plane is ${plane.length} bytes, expected ${256 * glyphHeight}`);
  }

  const width = FONT_ATLAS_COLUMNS * GLYPH_WIDTH;
  const height = FONT_ATLAS_ROWS * glyphHeight;
  const rgba = new Uint8Array(width * height * 4);

  for (let codePoint = 0; codePoint < 256; codePoint += 1) {
    const originX = (codePoint % FONT_ATLAS_COLUMNS) * GLYPH_WIDTH;
    const originY = (codePoint >> 4) * glyphHeight;
    for (let row = 0; row < glyphHeight; row += 1) {
      const byte = plane[codePoint * glyphHeight + row];
      for (let bit = 0; bit < GLYPH_WIDTH; bit += 1) {
        const value = byte & (0x80 >> bit) ? 0xff : 0x00;
        const i = ((originY + row) * width + originX + bit) * 4;
        rgba[i] = value;
        rgba[i + 1] = value;
        rgba[i + 2] = value;
        rgba[i + 3] = 0xff;
      }
    }
  }

  return { width, height, rgba };
}

export function fontPlaneFromRgba(image: RgbaImage, glyphHeight: number): Uint8Array {
  const width = FONT_ATLAS_COLUMNS * GLYPH_WIDTH;
  const height = FONT_ATLAS_ROWS * glyphHeight;
  if (image.width !== width || image.height !== height) {
    throw new Error(
      `Font atlas is ${image.width}x${image.height}, expected ${width}x${height} for glyph height ${glyphHeight}`,
    );
  }
  if (image.rgba.length !== width * height * 4) {
    throw new Error(`Font atlas RGBA buffer is ${image.rgba.length} bytes, expected ${width * height * 4}`);
  }

  const plane = new Uint8Array(256 * glyphHeight);
  for (let codePoint = 0; codePoint < 256; codePoint += 1) {
    const originX = (codePoint % FONT_ATLAS_COLUMNS) * GLYPH_WIDTH;
    const originY = (codePoint >> 4) * glyphHeight;
    for (let row = 0; row < glyphHeight; row += 1) {
      let byte = 0;
      for (let bit = 0; bit < GLYPH_WIDTH; bit += 1) {
        const i = ((originY + row) * width + originX + bit) * 4;
        const r = image.rgba[i];
        const g = image.rgba[i + 1];
        const b = image.rgba[i + 2];
        const a = image.rgba[i + 3];
        if (a !== 0xff || r !== g || g !== b || (r !== 0x00 && r !== 0xff)) {
          throw new Error(
            `Font atlas pixel (${originX + bit},${originY + row}) must be opaque black or white, ` +
              `got rgba(${r},${g},${b},${a})`,
          );
        }
        if (r === 0xff) {
          byte |= 0x80 >> bit;
        }
      }
      plane[codePoint * glyphHeight + row] = byte;
    }
  }

  return plane;
}
