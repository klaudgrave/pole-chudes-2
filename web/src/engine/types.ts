/**
 * Frozen contracts for the DOS-faithful engine layer.
 *
 * The behavioral oracle is the public-domain Delphi reconstruction of the
 * original POLE2.EXE (`Pole2/PoleWin32.dpr`; UTF-8 copy with matching line
 * numbers at `reference/delphi/PoleWin32.cp866.txt`). Line references
 * below (`dpr:NNN`) point there. Architecture and deviation policy:
 * `docs/architecture.md`.
 */

/** Width of the framebuffer in pixels/bytes (dpr:101-102). */
export const SCREEN_W = 640;
/** Visible rows presented to the canvas (dpr:107). */
export const VISIBLE_H = 350;
/** Total framebuffer rows including scratch space (dpr:142 `Screen: array[0..750*640-1]`). */
export const BUFFER_H = 750;
/** Scratch region used to save/restore full-screen and dialogue areas (dpr:102). */
export const BACKBUF = 400 * 640;
/** Scratch region used by PlayerTalk/PlayerDecision save/restore (dpr:101). */
export const BACKBUF2 = 350 * 640;
/** Timeout value meaning "wait forever" (WaitForSingleObject INFINITE). */
export const INFINITE = Number.POSITIVE_INFINITY;

/** Linear framebuffer offset for (x, y), the universal addressing mode of the original. */
export function ofs(x: number, y: number): number {
  return y * SCREEN_W + x;
}

export type GlyphHeight = 6 | 8 | 14;

/**
 * Indexed-color framebuffer plus the DOS drawing primitives.
 *
 * Semantics that MUST hold (all observable in the original):
 * - The buffer is LINEAR. Primitives take byte offsets, not (x, y); drawing
 *   past a row edge wraps into the next row (e.g. the money-stack jitter at
 *   dpr:573 relies on this). Do not clip rectangles to rows; only ignore
 *   writes outside [0, buffer.length).
 * - Sprite transparency compares the FULL byte value of the decoded pixel
 *   (transparentColor 16 is meaningful and distinct from 0..15, dpr:507-508).
 * - print() paints set bits with `color`, leaves clear bits untouched
 *   (read-modify-write, dpr:342-390), glyph row = font[code*height + row],
 *   MSB-first (leftmost pixel = bit 0x80), 8 px wide, advances `span` bytes
 *   per character. Strings are encoded to CP866 first.
 */
export interface ScreenApi {
  /** The 640x750 indexed framebuffer. Rows 0..349 are presented. */
  readonly buffer: Uint8Array;
  /** Register decoded POLE2.LIB sprites for drawSprite(). */
  setSprites(sprites: readonly { width: number; height: number; pixels: Uint8Array }[]): void;
  /** Register POLE.FNT planes for print(). */
  setFonts(fonts: { font6: Uint8Array; font8: Uint8Array; font14: Uint8Array }): void;
  /** Draw sprite by library index at linear offset, skipping transparentColor pixels (dpr:247-281). */
  drawSprite(spriteId: number, ofs: number, transparentColor: number): void;
  /** Draw CP866 text (dpr:342-390). `text` as JS string is CP866-encoded first. */
  print(text: string | Uint8Array, ofs: number, color: number, glyphHeight: GlyphHeight, span: number): void;
  /** Fill `height` rows of `width` bytes starting at `ofs`, 640-byte stride (dpr:392-400). */
  fillRect(ofs: number, height: number, width: number, color: number): void;
  /** Raw linear run fill, the `fillchar` idiom of the splash/board code (dpr:874, 1002). */
  fillChar(ofs: number, count: number, color: number): void;
  /** Copy a rectangle between buffer regions, 640-byte stride (dpr:449-457). */
  screenCopy(width: number, height: number, dstOfs: number, srcOfs: number): void;
  /** 3-px-wide grey (color 7) splash line (dpr:403-447). Endpoint gets a single pixel of 7. */
  line(x1: number, y1: number, x2: number, y2: number): void;
}

/** Mutable hand-cursor state; arrow keys move ofs by step within [min, max] (dpr:709-718). */
export interface HandState {
  ofs: number;
  prev: number;
  min: number;
  max: number;
  step: number;
}

/**
 * Text-entry state replicating the WM_CHAR handler (dpr:735-763):
 * - characters are uppercased then converted to CP866;
 * - a char is accepted only if the CP866 byte >= 0x30 ('0') and Alt is not held
 *   (rejects space and punctuation below '0'; accepts digits, Latin, Cyrillic);
 * - on accept (while bytes.length < maxLen): erase cell (fillRect ofs,14,8,7),
 *   print the char (color 0, height 14, span 8), append byte, ofs += span;
 * - backspace (while bytes.length > 0): erase cell, pop byte, ofs -= span, erase cell;
 * - the caret (8x2 underline at ofs+12*640, blinking ~0.5 s, color 7/0) is drawn
 *   by the presenter only while bytes.length < maxLen (dpr:667-668).
 */
export interface TextEntryState {
  /** Accepted CP866 bytes so far. */
  readonly bytes: number[];
  readonly maxLen: number;
  /** Linear offset of the NEXT character cell (echo position). */
  ofs: number;
  readonly span: number;
}

/**
 * Keyboard/mouse mapped to the original's two auto-reset events plus the
 * shared hand cursor and text entry (dpr:656-770).
 *
 * Event semantics (Win32 auto-reset): Space keydown or mouse-down on the
 * canvas SETS KeyPressed; a successful wait CONSUMES it; keyup resets the
 * "held" state. Enter keydown sets the Enter event likewise. If the event is
 * already set when a wait starts, the wait resolves immediately and consumes it.
 *
 * All waits MUST reject with the machine's AbortSignal reason when aborted.
 */
export interface InputApi {
  /** WaitForSingleObject(KeyPressed, ms). Resolves true if signaled, false on timeout. */
  waitKeyPressed(timeoutMs: number): Promise<boolean>;
  /** WaitForSingleObject(KeyPressed, 0) — non-blocking poll, consumes the event if set. */
  pollKeyPressed(): boolean;
  /** WaitForSingleObject(Enter, ms). */
  waitEnter(timeoutMs: number): Promise<boolean>;
  /** Shared hand cursor; the game script assigns min/max/step/ofs before its loops. */
  readonly hand: HandState;
  /** Activate text entry (name/word input). Echo and erase write through ScreenApi. */
  beginTextEntry(maxLen: number, ofs: number, span: number): TextEntryState;
  /** Deactivate text entry (UserInput.MaxLen := 0). */
  endTextEntry(): void;
  /** Currently active text entry, if any (presenter reads it for the caret). */
  readonly textEntry: TextEntryState | null;
}

/**
 * The 8 kHz PWM square-wave synth (dpr:176-241, 484-501).
 *
 * pwm(): writes `duration*8` samples starting at index i (wrapping at
 * buf.length): square wave with half-period 4000/freq samples, amplitude
 * ±32767; freq 0 writes silence. Returns the next write index (unwrapped).
 * sound(): plays a single pwm tone, then ALWAYS awaits delay(durationMs)
 * even when muted (pacing is identical muted or not, dpr:239).
 * playWav(): plays raw samples, then awaits delay(samples.length / 8) ms
 * (the original delays byteLength >> 4 ms at 2 bytes/sample, dpr:193).
 * speechSound(): the 7-burst random mumble (dpr:484-501): k=0; for i in 0..6
 * { k = pwm(buf, k, random(100), 10-i); k = pwm(buf, k, 0, 1) } then
 * playWav of the first k samples. Uses the machine RNG.
 */
export interface AudioApi {
  /** Master mute (EnableSound). DOS default is OFF; Ctrl+S / UI button toggles. */
  enabled: boolean;
  sound(freq: number, durationMs: number): Promise<void>;
  playWav(samples: Int16Array): Promise<void>;
  speechSound(): Promise<void>;
  pwm(buf: Int16Array, i: number, freq: number, duration: number): number;
}

/**
 * Time source. Real implementation scales every delay by the machine speed
 * factor and rejects on abort; the test implementation is a virtual clock.
 */
export interface ClockApi {
  delay(ms: number): Promise<void>;
}

/**
 * Borland Pascal LCG, required for seed-reproducible runs:
 *   seed := (seed * 134775813 + 1) mod 2^32
 *   random(n) = floor(seed * n / 2^32)   // upper 32 bits of the 64-bit product
 */
export interface RngApi {
  random(n: number): number;
  /** Reset the sequence (tests / ?seed= URL parameter). */
  seed(value: number): void;
}

/** Everything the game script touches. One instance per game run. */
export interface Machine {
  screen: ScreenApi;
  input: InputApi;
  audio: AudioApi;
  clock: ClockApi;
  rng: RngApi;
  /** Aborting cancels every pending wait/delay; the script run rejects. */
  signal: AbortSignal;
}
