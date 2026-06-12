import { bytesEqual, bytesToHex, hexToBytes } from './bytes.ts';

export interface PoleSprite {
  index: number;
  offset: number;
  sizeBlocks: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface PoleLib {
  spriteCount: number;
  spriteSizes: number[];
  sprites: PoleSprite[];
}

function readU16LE(buffer: Uint8Array, offset: number): number {
  if (offset + 1 >= buffer.length) {
    throw new Error(`u16 read out of bounds at ${offset}`);
  }

  return buffer[offset] | (buffer[offset + 1] << 8);
}

function decodeSpriteBlock(block: Uint8Array, index: number, offset: number, sizeBlocks: number): PoleSprite {
  const width = readU16LE(block, 0);
  const height = readU16LE(block, 2);
  const pixels = new Uint8Array(width * height);

  let i = 6;
  for (let row = 0; row < height; row += 1) {
    if (i + 2 >= block.length) {
      throw new Error(`Sprite ${index}: row ${row} header exceeds block bounds`);
    }

    const rowLen = readU16LE(block, i);
    const rowEnd = i + rowLen + 2;
    if (rowEnd > block.length) {
      throw new Error(`Sprite ${index}: row ${row} exceeds block bounds`);
    }

    // The DOS routine advances by 3 so `i - 1` points at the first run-length byte.
    i += 3;
    let x = 0;

    while (i < rowEnd && x < width) {
      let k = block[i - 1];

      if (k > 127) {
        k -= 128;
        const color = block[i];
        i += 1;

        while (k > 0 && x < width) {
          pixels[row * width + x] = color;
          x += 1;
          k -= 1;
        }
      } else {
        while (k > 0 && x < width) {
          pixels[row * width + x] = block[i];
          i += 1;
          x += 1;
          k -= 1;
        }
      }

      i += 1;
    }

    if (i !== rowEnd) {
      throw new Error(`Sprite ${index}: row ${row} decoder stopped at ${i}, expected ${rowEnd}`);
    }
  }

  return {
    index,
    offset,
    sizeBlocks,
    width,
    height,
    pixels,
  };
}

export function parseLib(input: Uint8Array | ArrayBuffer): PoleLib {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (data.length < 128) {
    throw new Error('LIB file is too small');
  }

  const spriteCount = data[0];
  if (spriteCount === 0 || spriteCount > 127) {
    throw new Error(`Invalid sprite count: ${spriteCount}`);
  }

  const spriteSizes: number[] = [];
  const sprites: PoleSprite[] = [];

  let offset = 128;
  for (let i = 0; i < spriteCount; i += 1) {
    const sizeBlocks = data[i + 1];
    const sizeBytes = sizeBlocks << 7;

    if (sizeBytes === 0) {
      throw new Error(`Sprite ${i} has zero-sized block`);
    }

    if (offset + sizeBytes > data.length) {
      throw new Error(`Sprite ${i} exceeds LIB bounds`);
    }

    const block = data.subarray(offset, offset + sizeBytes);
    sprites.push(decodeSpriteBlock(block, i, offset, sizeBlocks));
    spriteSizes.push(sizeBlocks);

    offset += sizeBytes;
  }

  return {
    spriteCount,
    spriteSizes,
    sprites,
  };
}

// --------------------------------------------------------- transcoded format
//
// POLE2.LIB expressed as editable sources: one lossless WebP image per sprite
// (pixels as opaque EGA palette colors — see spriteImage.ts) plus a JSON
// manifest holding only what an image cannot carry: sprite order and the
// verbatim tail bytes that pad each sprite to its 128-byte block boundary.
// Everything else (sizeBlocks, row encodings, the 128-byte file header) is
// derived, which `rebuildLib` proves by reproducing the original file
// byte-for-byte.

export interface LibJsonSprite {
  index: number;
  /** Sprite image path relative to the assets dir, e.g. 'sprites/00-fortune-wheel0.webp'. */
  file: string;
  width: number;
  height: number;
  /**
   * Raw bytes (hex) between the end of the encoded rows and the 128-byte
   * block boundary. The original packer left stale buffer garbage there —
   * fragments of neighboring sprite data — so it cannot be derived.
   */
  padding: string;
}

export interface LibJson {
  format: 'pole2-lib';
  version: 2;
  sprites: LibJsonSprite[];
}

/** Indexed pixels of one sprite, decoded from its WebP image. */
export interface SpritePixels {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * Re-encodes one pixel row with the original packer's RLE strategy, inferred
 * from POLE2.LIB itself (the oracle only contains the decoder, dpr:268-296):
 * greedy run scan capped at 127; a run is emitted as an RLE token when it is
 * 3+ pixels long, or exactly 2 with no literal pending (an RLE pair costs the
 * same 2 bytes appended to an open literal, but beats opening a new 3-byte
 * literal); every row ends with a flush plus an unconditional empty-literal
 * 0x00 terminator. Reproduces all 3851 rows of the original byte-for-byte.
 */
export function encodeLibRow(pixels: Uint8Array): number[] {
  const out: number[] = [];
  let literal: number[] = [];

  const flushLiteral = (): void => {
    while (literal.length > 0) {
      const take = Math.min(literal.length, 127);
      out.push(take, ...literal.slice(0, take));
      literal = literal.slice(take);
    }
  };

  let x = 0;
  while (x < pixels.length) {
    let run = 1;
    while (x + run < pixels.length && pixels[x + run] === pixels[x] && run < 127) {
      run += 1;
    }

    if (run >= 3 || (run === 2 && literal.length === 0)) {
      flushLiteral();
      out.push(128 + run, pixels[x]);
      x += run;
    } else {
      literal.push(pixels[x]);
      x += 1;
    }
  }

  flushLiteral();
  out.push(0);
  return out;
}

function assertLibJson(json: LibJson): void {
  if (json.format !== 'pole2-lib' || json.version !== 2) {
    throw new Error('Not a pole2-lib v2 JSON asset');
  }
}

function spritePixelsAt(json: LibJson, spritePixels: readonly SpritePixels[], i: number): Uint8Array {
  const sprite = json.sprites[i];
  const decoded = spritePixels[i];
  if (!decoded) {
    throw new Error(`Sprite ${sprite.index}: no decoded image for ${sprite.file}`);
  }
  if (decoded.width !== sprite.width || decoded.height !== sprite.height) {
    throw new Error(
      `Sprite ${sprite.index}: ${sprite.file} is ${decoded.width}x${decoded.height}, ` +
        `manifest expects ${sprite.width}x${sprite.height}`,
    );
  }
  if (decoded.pixels.length !== sprite.width * sprite.height) {
    throw new Error(`Sprite ${sprite.index}: decoded ${decoded.pixels.length} pixels, expected ${sprite.width * sprite.height}`);
  }
  return decoded.pixels;
}

/**
 * Rebuilds the exact original POLE2.LIB bytes from the manifest plus the
 * decoded sprite images (in manifest order).
 */
export function rebuildLib(json: LibJson, spritePixels: readonly SpritePixels[]): Uint8Array {
  assertLibJson(json);

  const blocks: Uint8Array[] = [];
  const sizeBlocksList: number[] = [];

  for (let i = 0; i < json.sprites.length; i += 1) {
    const sprite = json.sprites[i];
    const pixels = spritePixelsAt(json, spritePixels, i);
    const rows: number[][] = [];
    let usedBytes = 6;
    for (let row = 0; row < sprite.height; row += 1) {
      const encoded = encodeLibRow(pixels.subarray(row * sprite.width, (row + 1) * sprite.width));
      rows.push(encoded);
      usedBytes += 2 + encoded.length;
    }

    const sizeBlocks = Math.ceil(usedBytes / 128);
    const padding = hexToBytes(sprite.padding);
    if (padding.length !== (sizeBlocks << 7) - usedBytes) {
      throw new Error(
        `Sprite ${sprite.index}: padding is ${padding.length} bytes, expected ${(sizeBlocks << 7) - usedBytes}`,
      );
    }

    const block = new Uint8Array(sizeBlocks << 7);
    block[0] = sprite.width & 0xff;
    block[1] = sprite.width >> 8;
    block[2] = sprite.height & 0xff;
    block[3] = sprite.height >> 8;
    // Bytes 4-5 are always zero in the original file.

    let cursor = 6;
    for (const encoded of rows) {
      block[cursor] = encoded.length & 0xff;
      block[cursor + 1] = encoded.length >> 8;
      block.set(encoded, cursor + 2);
      cursor += 2 + encoded.length;
    }
    block.set(padding, cursor);

    blocks.push(block);
    sizeBlocksList.push(sizeBlocks);
  }

  const out = new Uint8Array(128 + blocks.reduce((sum, block) => sum + block.length, 0));
  out[0] = json.sprites.length;
  for (let i = 0; i < sizeBlocksList.length; i += 1) {
    out[1 + i] = sizeBlocksList[i];
  }

  let offset = 128;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }

  return out;
}

/** Converts the manifest plus decoded sprite images into the same structure `parseLib` returns. */
export function libFromSprites(json: LibJson, spritePixels: readonly SpritePixels[]): PoleLib {
  assertLibJson(json);

  const spriteSizes: number[] = [];
  const sprites: PoleSprite[] = [];

  let offset = 128;
  for (let i = 0; i < json.sprites.length; i += 1) {
    const sprite = json.sprites[i];
    const pixels = spritePixelsAt(json, spritePixels, i);
    let usedBytes = 6;
    for (let row = 0; row < sprite.height; row += 1) {
      usedBytes += 2 + encodeLibRow(pixels.subarray(row * sprite.width, (row + 1) * sprite.width)).length;
    }
    const sizeBlocks = Math.ceil(usedBytes / 128);

    sprites.push({
      index: sprite.index,
      offset,
      sizeBlocks,
      width: sprite.width,
      height: sprite.height,
      pixels,
    });
    spriteSizes.push(sizeBlocks);
    offset += sizeBlocks << 7;
  }

  return {
    spriteCount: json.sprites.length,
    spriteSizes,
    sprites,
  };
}

/**
 * Transcodes the original POLE2.LIB bytes into the manifest plus per-sprite
 * indexed pixels (which the caller encodes as lossless WebP images, named by
 * `fileNameFor`). Throws if any pixel byte exceeds 0x0f or if the result does
 * not rebuild the input byte-for-byte, so an unfaithful transcode can never
 * be produced.
 */
export function libToTranscoded(
  input: Uint8Array | ArrayBuffer,
  fileNameFor: (index: number) => string,
): { json: LibJson; spritePixels: SpritePixels[] } {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parsed = parseLib(data);

  const sprites: LibJsonSprite[] = [];
  const spritePixels: SpritePixels[] = [];
  let offset = 128;
  for (const sprite of parsed.sprites) {
    const blockSize = sprite.sizeBlocks << 7;
    const block = data.subarray(offset, offset + blockSize);

    let usedBytes = 6;
    for (let row = 0; row < sprite.height; row += 1) {
      usedBytes += 2 + (block[usedBytes] | (block[usedBytes + 1] << 8));
    }

    for (const value of sprite.pixels) {
      if (value > 0x0f) {
        throw new Error(`Sprite ${sprite.index}: pixel byte ${value} is outside the 16-color palette`);
      }
    }

    sprites.push({
      index: sprite.index,
      file: fileNameFor(sprite.index),
      width: sprite.width,
      height: sprite.height,
      padding: bytesToHex(block.subarray(usedBytes)),
    });
    spritePixels.push({ width: sprite.width, height: sprite.height, pixels: sprite.pixels });
    offset += blockSize;
  }

  const json: LibJson = { format: 'pole2-lib', version: 2, sprites };
  if (!bytesEqual(rebuildLib(json, spritePixels), data)) {
    throw new Error('POLE2.LIB transcode failed to round-trip byte-for-byte');
  }
  return { json, spritePixels };
}
