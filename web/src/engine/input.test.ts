import { describe, expect, it } from 'vitest';

import { AutoResetEvent, GameInput } from './input';
import { VirtualClock } from './timing';
import { INFINITE } from './types';
import type { ScreenApi } from './types';

type ScreenCall = [op: string, ...args: (number | number[] | string)[]];

function makeScreen(): { screen: ScreenApi; calls: ScreenCall[] } {
  const calls: ScreenCall[] = [];
  const screen: ScreenApi = {
    buffer: new Uint8Array(0),
    setSprites: () => {},
    setFonts: () => {},
    drawSprite: () => {},
    print: (text, ofs, color, glyphHeight, span) => {
      calls.push(['print', text instanceof Uint8Array ? Array.from(text) : text, ofs, color, glyphHeight, span]);
    },
    fillRect: (ofs, height, width, color) => {
      calls.push(['fillRect', ofs, height, width, color]);
    },
    fillChar: () => {},
    screenCopy: () => {},
    line: () => {},
  };
  return { screen, calls };
}

function makeInput(): {
  input: GameInput;
  clock: VirtualClock;
  controller: AbortController;
  calls: ScreenCall[];
} {
  const controller = new AbortController();
  const clock = new VirtualClock();
  const { screen, calls } = makeScreen();
  const input = new GameInput(screen, clock, controller.signal);
  return { input, clock, controller, calls };
}

describe('AutoResetEvent', () => {
  it('resolves immediately and consumes when set before wait', async () => {
    const clock = new VirtualClock();
    const event = new AutoResetEvent(clock);
    event.set();
    await expect(event.wait(INFINITE)).resolves.toBe(true);

    // Consumed: the next finite wait times out.
    const second = event.wait(100);
    await clock.advance(100);
    await expect(second).resolves.toBe(false);
  });

  it('poll consumes a single set', () => {
    const event = new AutoResetEvent();
    event.set();
    expect(event.poll()).toBe(true);
    expect(event.poll()).toBe(false);
  });

  it('reset clears a latched signal', () => {
    const event = new AutoResetEvent();
    event.set();
    event.reset();
    expect(event.poll()).toBe(false);
  });

  it('INFINITE wait resolves when set() arrives and never times out', async () => {
    const clock = new VirtualClock();
    const event = new AutoResetEvent(clock);
    let value: boolean | null = null;
    const pending = event.wait(INFINITE).then((v) => {
      value = v;
    });

    await clock.advance(1000000);
    expect(value).toBeNull();

    event.set();
    await pending;
    expect(value).toBe(true);
    expect(event.poll()).toBe(false); // consumed by the waiter
  });

  it('set wakes exactly one waiter in FIFO order', async () => {
    const event = new AutoResetEvent();
    const order: string[] = [];
    const a = event.wait(INFINITE).then(() => order.push('a'));
    const b = event.wait(INFINITE).then(() => order.push('b'));

    event.set();
    await a;
    expect(order).toEqual(['a']);

    event.set();
    await b;
    expect(order).toEqual(['a', 'b']);
  });

  it('times out with false through the VirtualClock', async () => {
    const clock = new VirtualClock();
    const event = new AutoResetEvent(clock);
    const pending = event.wait(250);
    await clock.advance(249);
    await clock.advance(1);
    await expect(pending).resolves.toBe(false);
  });

  it('zero timeout polls without blocking', async () => {
    const event = new AutoResetEvent();
    await expect(event.wait(0)).resolves.toBe(false);
    event.set();
    await expect(event.wait(0)).resolves.toBe(true);
  });

  it('rejects with the abort reason', async () => {
    const clock = new VirtualClock();
    const event = new AutoResetEvent(clock);
    const controller = new AbortController();
    const pending = event.wait(INFINITE, controller.signal);
    const reason = new Error('abort');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const event = new AutoResetEvent();
    const controller = new AbortController();
    const reason = new Error('gone');
    controller.abort(reason);
    await expect(event.wait(INFINITE, controller.signal)).rejects.toBe(reason);
  });
});

describe('GameInput events', () => {
  it('space keydown sets KeyPressed; poll consumes once', () => {
    const { input } = makeInput();
    expect(input.handleKey(' ')).toBe('consumed');
    expect(input.pollKeyPressed()).toBe(true);
    expect(input.pollKeyPressed()).toBe(false);
  });

  it('space keyup resets a latched KeyPressed', () => {
    const { input } = makeInput();
    input.handleKey(' ');
    input.handleKeyUp(' ');
    expect(input.pollKeyPressed()).toBe(false);
  });

  it('Enter sets and Enter keyup resets the Enter event', async () => {
    const { input, clock } = makeInput();
    input.handleKey('Enter');
    await expect(input.waitEnter(INFINITE)).resolves.toBe(true);

    input.handleKey('Enter');
    input.handleKeyUp('Enter');
    const pending = input.waitEnter(50);
    await clock.advance(50);
    await expect(pending).resolves.toBe(false);
  });

  it('pointer down/up mirror space down/up', () => {
    const { input } = makeInput();
    input.pointerDown();
    expect(input.pollKeyPressed()).toBe(true);
    input.pointerDown();
    input.pointerUp();
    expect(input.pollKeyPressed()).toBe(false);
  });

  it('waitKeyPressed times out via the machine clock', async () => {
    const { input, clock } = makeInput();
    const pending = input.waitKeyPressed(120);
    await clock.advance(120);
    await expect(pending).resolves.toBe(false);
  });

  it('waits reject with the machine abort reason', async () => {
    const { input, controller } = makeInput();
    const pending = input.waitKeyPressed(INFINITE);
    const reason = new Error('new game');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

describe('GameInput hand cursor', () => {
  it('moves by step within [min, max] and tracks prev', () => {
    const { input } = makeInput();
    Object.assign(input.hand, { ofs: 100, prev: 0, min: 80, max: 120, step: 10 });

    expect(input.handleKey('ArrowLeft')).toBe('consumed');
    expect(input.hand.ofs).toBe(90);
    expect(input.hand.prev).toBe(100);

    input.handleKey('ArrowLeft');
    expect(input.hand.ofs).toBe(80);
    expect(input.hand.prev).toBe(90);

    // Clamped at min: no movement, prev untouched.
    input.handleKey('ArrowLeft');
    expect(input.hand.ofs).toBe(80);
    expect(input.hand.prev).toBe(90);

    input.handleKey('ArrowRight');
    expect(input.hand.ofs).toBe(90);
    expect(input.hand.prev).toBe(80);

    input.handleKey('ArrowRight');
    input.handleKey('ArrowRight');
    input.handleKey('ArrowRight');
    expect(input.hand.ofs).toBe(120);
    expect(input.hand.prev).toBe(110);

    // Clamped at max.
    input.handleKey('ArrowRight');
    expect(input.hand.ofs).toBe(120);
    expect(input.hand.prev).toBe(110);
  });
});

describe('GameInput text entry', () => {
  it('accepts uppercased CP866 chars and echoes erase+print per cell', () => {
    const { input, calls } = makeInput();
    const entry = input.beginTextEntry(3, 1000, 8);
    expect(input.textEntry).toBe(entry);

    expect(input.handleKey('п')).toBe('consumed'); // П = CP866 0x8f
    expect(calls).toEqual([
      ['fillRect', 1000, 14, 8, 7],
      ['print', [0x8f], 1000, 0, 14, 8],
    ]);
    expect(entry.bytes).toEqual([0x8f]);
    expect(entry.ofs).toBe(1008);

    expect(input.handleKey('a')).toBe('consumed'); // A = 0x41
    expect(calls.slice(2)).toEqual([
      ['fillRect', 1008, 14, 8, 7],
      ['print', [0x41], 1008, 0, 14, 8],
    ]);
    expect(entry.bytes).toEqual([0x8f, 0x41]);
    expect(entry.ofs).toBe(1016);
  });

  it('rejects bytes below 0x30, Alt chords, and unmappable chars', () => {
    const { input, calls } = makeInput();
    const entry = input.beginTextEntry(3, 1000, 8);

    expect(input.handleKey('!')).toBe('ignored'); // 0x21 < '0'
    expect(input.handleKey('b', { alt: true })).toBe('ignored');
    expect(input.handleKey('s', { ctrl: true })).toBe('ignored');
    expect(input.handleKey('€')).toBe('ignored'); // unmappable
    expect(entry.bytes).toEqual([]);
    expect(entry.ofs).toBe(1000);
    expect(calls).toEqual([]);
  });

  it('space during text entry sets KeyPressed and is rejected as a char', () => {
    const { input, calls } = makeInput();
    const entry = input.beginTextEntry(3, 1000, 8);

    expect(input.handleKey(' ')).toBe('consumed');
    expect(input.pollKeyPressed()).toBe(true);
    expect(entry.bytes).toEqual([]);
    expect(entry.ofs).toBe(1000);
    expect(calls).toEqual([]);
  });

  it('ignores accepted chars once the buffer is full', () => {
    const { input, calls } = makeInput();
    const entry = input.beginTextEntry(2, 1000, 8);
    input.handleKey('1');
    input.handleKey('2');
    const before = calls.length;

    expect(input.handleKey('3')).toBe('ignored');
    expect(entry.bytes).toEqual([0x31, 0x32]);
    expect(entry.ofs).toBe(1016);
    expect(calls.length).toBe(before);
  });

  it('backspace erases the next cell, pops, steps back, erases again', () => {
    const { input, calls } = makeInput();
    const entry = input.beginTextEntry(3, 1000, 8);
    input.handleKey('A');
    input.handleKey('B');
    calls.length = 0;

    expect(input.handleKey('Backspace')).toBe('consumed');
    expect(calls).toEqual([
      ['fillRect', 1016, 14, 8, 7],
      ['fillRect', 1008, 14, 8, 7],
    ]);
    expect(entry.bytes).toEqual([0x41]);
    expect(entry.ofs).toBe(1008);

    input.handleKey('Backspace');
    expect(entry.bytes).toEqual([]);
    expect(entry.ofs).toBe(1000);

    // Empty buffer: consumed by the WM_CHAR case but draws nothing.
    calls.length = 0;
    expect(input.handleKey('Backspace')).toBe('consumed');
    expect(calls).toEqual([]);
    expect(entry.ofs).toBe(1000);
  });

  it('ignores text keys when no entry is active', () => {
    const { input, calls } = makeInput();
    expect(input.handleKey('A')).toBe('ignored');
    expect(input.handleKey('Backspace')).toBe('ignored');

    input.beginTextEntry(3, 1000, 8);
    input.endTextEntry();
    expect(input.textEntry).toBeNull();
    expect(input.handleKey('A')).toBe('ignored');
    expect(calls).toEqual([]);
  });
});
