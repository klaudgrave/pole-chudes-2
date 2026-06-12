import { encodeCp866 } from '../encoding/cp866';
import { INFINITE } from './types';
import type { ClockApi, HandState, InputApi, ScreenApi, TextEntryState } from './types';

/** WM_KEYDOWN/WM_CHAR dispatch result (result=0 vs result=1 in WndProc, dpr:656). */
export type KeyDispatch = 'consumed' | 'ignored';

export interface KeyMods {
  alt?: boolean;
  ctrl?: boolean;
}

/** First CP866 byte accepted by the text-entry filter (dpr:749 `C >= '0'`). */
const MIN_TEXT_BYTE = 0x30;
/** Text-entry cell geometry: 8 px wide, 14 px tall, erased with grey 7 (dpr:744-755). */
const CELL_WIDTH = 8;
const CELL_HEIGHT = 14;
const CELL_ERASE_COLOR = 7;
const TEXT_COLOR = 0;

type Waiter = () => void;

/**
 * Win32 auto-reset event (CreateEvent(..., false, false, ...), dpr:97-98).
 * set() wakes exactly one waiter (consuming the signal) or latches the
 * signaled state; a successful wait/poll consumes it; reset() clears it.
 *
 * Finite wait timeouts run through the injected ClockApi so VirtualClock
 * tests and the speed factor apply; INFINITE waits never schedule a timer.
 */
export class AutoResetEvent {
  private signaled = false;
  private readonly waiters: Waiter[] = [];
  private readonly clock: ClockApi | undefined;

  constructor(clock?: ClockApi) {
    this.clock = clock;
  }

  set(): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter();
    } else {
      this.signaled = true;
    }
  }

  reset(): void {
    this.signaled = false;
  }

  /** WaitForSingleObject(event, 0): consume the signal if present. */
  poll(): boolean {
    if (this.signaled) {
      this.signaled = false;
      return true;
    }
    return false;
  }

  /**
   * WaitForSingleObject(event, timeoutMs). Resolves true when signaled
   * (consuming the event), false on timeout, rejects with signal.reason
   * on abort. timeoutMs === INFINITE never times out.
   */
  wait(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.signaled) {
      this.signaled = false;
      return Promise.resolve(true);
    }
    if (timeoutMs <= 0) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        settled = true;
        const index = this.waiters.indexOf(onSet);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        signal?.removeEventListener('abort', onAbort);
      };
      const onSet: Waiter = () => {
        if (settled) {
          return;
        }
        finish();
        resolve(true);
      };
      const onAbort = (): void => {
        if (settled) {
          return;
        }
        finish();
        reject(signal?.reason);
      };

      this.waiters.push(onSet);
      signal?.addEventListener('abort', onAbort, { once: true });

      if (timeoutMs !== INFINITE) {
        this.delayFor(timeoutMs).then(
          () => {
            if (settled) {
              return;
            }
            finish();
            resolve(false);
          },
          () => {
            // Clock aborted; the abort listener above settles this wait.
          },
        );
      }
    });
  }

  private delayFor(ms: number): Promise<void> {
    if (this.clock) {
      return this.clock.delay(ms);
    }
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

interface MutableTextEntry {
  bytes: number[];
  maxLen: number;
  ofs: number;
  span: number;
}

/**
 * Keyboard/mouse front end replicating the WndProc input cases
 * (dpr:709-766): two auto-reset events, the shared hand cursor and the
 * UserInput text-entry record. handleKey/handleKeyUp are pure of the DOM;
 * attachDom() wires real listeners and is the only DOM-touching method.
 */
export class GameInput implements InputApi {
  readonly hand: HandState = { ofs: 0, prev: 0, min: 0, max: 0, step: 0 };

  /** Esc keydown (original: ExitProcess; web: abort to splash, dpr:726). */
  onEscape?: () => void;
  /** Tab boss key (original: mute + minimize, dpr:722-725). */
  onBossKey?: () => void;
  /** Ctrl+S sound toggle (WM_HOTKEY path, dpr:707-708). */
  onToggleSound?: () => void;

  private readonly screen: ScreenApi;
  private readonly signal: AbortSignal;
  private readonly keyPressed: AutoResetEvent;
  private readonly enter: AutoResetEvent;
  private entry: MutableTextEntry | null = null;

  constructor(screen: ScreenApi, clock: ClockApi, signal: AbortSignal) {
    this.screen = screen;
    this.signal = signal;
    this.keyPressed = new AutoResetEvent(clock);
    this.enter = new AutoResetEvent(clock);
  }

  waitKeyPressed(timeoutMs: number): Promise<boolean> {
    return this.keyPressed.wait(timeoutMs, this.signal);
  }

  pollKeyPressed(): boolean {
    return this.keyPressed.poll();
  }

  waitEnter(timeoutMs: number): Promise<boolean> {
    return this.enter.wait(timeoutMs, this.signal);
  }

  get textEntry(): TextEntryState | null {
    return this.entry;
  }

  beginTextEntry(maxLen: number, ofs: number, span: number): TextEntryState {
    this.entry = { bytes: [], maxLen, ofs, span };
    return this.entry;
  }

  endTextEntry(): void {
    this.entry = null;
  }

  /**
   * Pure WM_KEYDOWN + WM_CHAR dispatch. NOTE: space both sets KeyPressed
   * (dpr:719) and reaches the text filter where CP866 0x20 < '0' rejects it
   * (dpr:749) — the two paths of the original message loop.
   */
  handleKey(key: string, mods: KeyMods = {}): KeyDispatch {
    // Alt-held keys arrived as WM_SYSKEYDOWN (or the Alt+Enter hotkey) in the
    // original and never reached the game's key cases (dpr:696-706, 1653).
    if (mods.alt && (key === ' ' || key === 'Enter' || key === 'Backspace')) {
      return 'ignored';
    }
    switch (key) {
      case ' ':
        this.keyPressed.set();
        return 'consumed';
      case 'Enter':
        this.enter.set();
        return 'consumed';
      case 'ArrowLeft':
        if (this.hand.ofs > this.hand.min) {
          this.hand.prev = this.hand.ofs;
          this.hand.ofs -= this.hand.step;
        }
        return 'consumed';
      case 'ArrowRight':
        if (this.hand.ofs < this.hand.max) {
          this.hand.prev = this.hand.ofs;
          this.hand.ofs += this.hand.step;
        }
        return 'consumed';
      case 'Backspace':
        return this.handleBackspace();
      default:
        if (key.length === 1) {
          return this.handleTextChar(key, mods);
        }
        return 'ignored';
    }
  }

  /** WM_KEYUP: releasing the key un-latches the event (dpr:730-733). */
  handleKeyUp(key: string): void {
    if (key === ' ') {
      this.keyPressed.reset();
    } else if (key === 'Enter') {
      this.enter.reset();
    }
  }

  /** WM_LBUTTONDOWN (dpr:764). */
  pointerDown(): void {
    this.keyPressed.set();
  }

  /** WM_LBUTTONUP (dpr:765). */
  pointerUp(): void {
    this.keyPressed.reset();
  }

  /** Wire real DOM listeners. Returns a detach function. */
  attachDom(target: HTMLElement | Document): () => void {
    const onKeyDown = (event: Event): void => {
      const e = event as KeyboardEvent;
      // Layout-independent like the original VK_S hotkey (dpr:1652) — the
      // player is typically on a Cyrillic layout where e.key is 'ы'.
      if (e.ctrlKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.onToggleSound?.();
        return;
      }
      if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab' || e.key === 'Backspace') {
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        this.onEscape?.();
        return;
      }
      if (e.key === 'Tab') {
        this.onBossKey?.();
        return;
      }
      this.handleKey(e.key, { alt: e.altKey, ctrl: e.ctrlKey });
    };
    const onKeyUp = (event: Event): void => {
      this.handleKeyUp((event as KeyboardEvent).key);
    };
    const onPointerDown = (): void => {
      this.pointerDown();
    };
    const onPointerUp = (): void => {
      this.pointerUp();
    };

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointerup', onPointerUp);

    return () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerup', onPointerUp);
    };
  }

  /** WM_CHAR #8: double-clear erase, pop, step back (dpr:741-747). */
  private handleBackspace(): KeyDispatch {
    const entry = this.entry;
    if (!entry) {
      return 'ignored';
    }
    if (entry.bytes.length > 0) {
      this.screen.fillRect(entry.ofs, CELL_HEIGHT, CELL_WIDTH, CELL_ERASE_COLOR);
      entry.bytes.pop();
      entry.ofs -= entry.span;
      this.screen.fillRect(entry.ofs, CELL_HEIGHT, CELL_WIDTH, CELL_ERASE_COLOR);
    }
    return 'consumed';
  }

  /** WM_CHAR printable filter: uppercase, CP866, byte >= '0', no Alt (dpr:748-760). */
  private handleTextChar(key: string, mods: KeyMods): KeyDispatch {
    const entry = this.entry;
    if (!entry || mods.alt || mods.ctrl) {
      return 'ignored';
    }
    const upper = key.toUpperCase();
    if (upper.length !== 1) {
      return 'ignored';
    }
    const byte = encodeCp866(upper)[0];
    if (byte < MIN_TEXT_BYTE || entry.bytes.length >= entry.maxLen) {
      return 'ignored';
    }
    this.screen.fillRect(entry.ofs, CELL_HEIGHT, CELL_WIDTH, CELL_ERASE_COLOR);
    this.screen.print(Uint8Array.of(byte), entry.ofs, TEXT_COLOR, CELL_HEIGHT, CELL_WIDTH);
    entry.bytes.push(byte);
    entry.ofs += entry.span;
    return 'consumed';
  }
}
