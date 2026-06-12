import { encodeCp866 } from '../encoding/cp866';
import type { GlyphHeight, ScreenApi, TextEntryState } from './types';
import { BUFFER_H, SCREEN_W, VISIBLE_H } from './types';

interface SpriteData {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface FontPlanes {
  font6: Uint8Array;
  font8: Uint8Array;
  font14: Uint8Array;
}

/**
 * The DOS framebuffer: a single linear byte array of 640x750 indexed pixels.
 * Rows 0..349 are visible; the rest is scratch space (BACKBUF/BACKBUF2) used
 * by the game's save/restore idiom. Primitives intentionally do NOT clip to
 * row rectangles — writes run linearly and wrap across row edges exactly like
 * the original (dpr:247-281, 392-457); only out-of-buffer writes are ignored.
 */
export class Screen implements ScreenApi {
  readonly buffer = new Uint8Array(SCREEN_W * BUFFER_H);

  private sprites: readonly SpriteData[] = [];
  private fonts: FontPlanes | null = null;

  setSprites(sprites: readonly SpriteData[]): void {
    this.sprites = sprites;
  }

  setFonts(fonts: FontPlanes): void {
    this.fonts = fonts;
  }

  /** dpr:247-281 — decoded-pixel equivalent of the row-RLE DrawSprite. */
  drawSprite(spriteId: number, ofs: number, transparentColor: number): void {
    const sprite = this.sprites[spriteId];
    if (!sprite) {
      return;
    }

    const { buffer } = this;
    const { width, height, pixels } = sprite;

    for (let row = 0; row < height; row += 1) {
      let dst = ofs + row * SCREEN_W;
      const src = row * width;

      for (let x = 0; x < width; x += 1, dst += 1) {
        const value = pixels[src + x];
        if (value !== transparentColor && dst >= 0 && dst < buffer.length) {
          buffer[dst] = value;
        }
      }
    }
  }

  /** dpr:342-390 — MSB-first 8px glyphs; set bits painted, clear bits left intact. */
  print(text: string | Uint8Array, ofs: number, color: number, glyphHeight: GlyphHeight, span: number): void {
    const fonts = this.fonts;
    if (!fonts) {
      return;
    }

    const font = glyphHeight === 6 ? fonts.font6 : glyphHeight === 8 ? fonts.font8 : fonts.font14;
    const bytes = typeof text === 'string' ? encodeCp866(text) : text;
    const { buffer } = this;

    for (let i = 0; i < bytes.length; i += 1) {
      const glyphBase = bytes[i] * glyphHeight;

      for (let row = 0; row < glyphHeight; row += 1) {
        const bits = font[glyphBase + row];
        if (bits === 0) {
          continue;
        }

        const rowOfs = ofs + i * span + row * SCREEN_W;
        for (let col = 0; col < 8; col += 1) {
          if ((bits & (0x80 >> col)) !== 0) {
            const dst = rowOfs + col;
            if (dst >= 0 && dst < buffer.length) {
              buffer[dst] = color;
            }
          }
        }
      }
    }
  }

  /** dpr:392-400 — `height` runs of `width` bytes at 640-byte stride. */
  fillRect(ofs: number, height: number, width: number, color: number): void {
    for (let row = 0; row < height; row += 1) {
      this.fillChar(ofs + row * SCREEN_W, width, color);
    }
  }

  /** Linear run fill (the raw `fillchar` idiom of the splash/board code). */
  fillChar(ofs: number, count: number, color: number): void {
    const start = Math.max(0, ofs);
    const end = Math.min(this.buffer.length, ofs + count);
    if (end > start) {
      this.buffer.fill(color, start, end);
    }
  }

  /** dpr:449-457 — row-strided copy between buffer regions. */
  screenCopy(width: number, height: number, dstOfs: number, srcOfs: number): void {
    const { buffer } = this;
    for (let row = 0; row < height; row += 1) {
      const src = srcOfs + row * SCREEN_W;
      const dst = dstOfs + row * SCREEN_W;
      if (src >= 0 && dst >= 0 && src + width <= buffer.length && dst + width <= buffer.length) {
        buffer.copyWithin(dst, src, src + width);
      }
    }
  }

  /** dpr:403-447 — splash-only 3px-wide grey line (Bresenham over the linear buffer). */
  line(x1: number, y1: number, x2: number, y2: number): void {
    const { buffer } = this;
    let pos = y1 * SCREEN_W + x1;

    let dx = x2 - x1;
    const stepX = dx < 0 ? -1 : 1;
    dx = Math.abs(dx);
    let dy = y2 - y1;
    const stepY = dy < 0 ? -SCREEN_W : SCREEN_W;
    dy = Math.abs(dy);

    let major = dx;
    let minor = dy;
    let majorStep = stepX;
    let minorStep = stepY;
    if (major <= minor) {
      [major, minor] = [minor, major];
      [majorStep, minorStep] = [minorStep, majorStep];
    }

    let error = major;
    for (let i = major; i > 0; i -= 1) {
      // The asm ORs three consecutive bytes with 7 (`or dword[edi-1],$070707`).
      for (let k = -1; k <= 1; k += 1) {
        const dst = pos + k;
        if (dst >= 0 && dst < buffer.length) {
          buffer[dst] |= 7;
        }
      }
      error -= minor;
      if (error <= 0) {
        error += major;
        pos += minorStep;
      }
      pos += majorStep;
    }

    if (pos >= 0 && pos < buffer.length) {
      buffer[pos] = 7;
    }
  }
}

/**
 * 50 fps presenter replicating the WM_TIMER/WM_PAINT path (dpr:663-675):
 * advances the frame counter every 20 ms, draws the blinking text-entry caret
 * into the framebuffer (dpr:667-668), and blits rows 0..349 through the
 * 16-color palette.
 */
export class CanvasPresenter {
  frame = 0;

  private readonly screen: Screen;
  private readonly palette: ReadonlyArray<readonly number[]>;
  private readonly getTextEntry: () => TextEntryState | null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;

  constructor(
    screen: Screen,
    canvas: HTMLCanvasElement,
    palette: ReadonlyArray<readonly number[]>,
    getTextEntry: () => TextEntryState | null,
  ) {
    this.screen = screen;
    this.palette = palette;
    this.getTextEntry = getTextEntry;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D context not available');
    }
    this.ctx = ctx;
    this.imageData = new ImageData(SCREEN_W, VISIBLE_H);
  }

  start(): void {
    if (this.rafId !== null) {
      return;
    }
    const tick = (time: number) => {
      if (this.lastTime !== null) {
        this.accumulator += time - this.lastTime;
      }
      this.lastTime = time;
      // Cap catch-up so a background tab does not fast-forward thousands of frames.
      if (this.accumulator > 400) {
        this.accumulator = 400;
      }
      while (this.accumulator >= 20) {
        this.accumulator -= 20;
        this.frame += 1;
        this.drawCaret();
      }
      this.renderOnce();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.lastTime = null;
    }
  }

  /** dpr:667-668 — 8x2 underline at ofs+12*640, color alternating 7/0 every 25 frames. */
  private drawCaret(): void {
    const entry = this.getTextEntry();
    if (entry && entry.bytes.length < entry.maxLen) {
      this.screen.fillRect(entry.ofs + 12 * SCREEN_W, 2, 8, (Math.floor(this.frame / 25) & 1) * 7);
    }
  }

  renderOnce(): void {
    const { buffer } = this.screen;
    const rgba = this.imageData.data;
    for (let i = 0, j = 0; i < SCREEN_W * VISIBLE_H; i += 1, j += 4) {
      const color = this.palette[buffer[i] & 0x0f];
      rgba[j] = color[0];
      rgba[j + 1] = color[1];
      rgba[j + 2] = color[2];
      rgba[j + 3] = 255;
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
