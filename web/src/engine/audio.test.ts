import { describe, expect, it } from 'vitest';

import { AUDIO_BUF_LEN, PwmAudio, SilentOutput, pwm } from './audio';
import type { ClockApi, RngApi } from './types';

interface FakeClock extends ClockApi {
  readonly delays: number[];
}

function fakeClock(): FakeClock {
  const delays: number[] = [];
  return {
    delays,
    async delay(ms: number): Promise<void> {
      delays.push(ms);
    },
  };
}

interface FakeRng extends RngApi {
  readonly calls: number[];
}

function fixedRng(values: number[]): FakeRng {
  const calls: number[] = [];
  let i = 0;
  return {
    calls,
    random(n: number): number {
      calls.push(n);
      const value = values[i % values.length];
      i += 1;
      return value;
    },
    seed(): void {},
  };
}

describe('pwm', () => {
  it('writes an exact square wave for freq=1000 (half-period 4 samples)', () => {
    const buf = new Int16Array(64);
    const next = pwm(buf, 0, 1000, 2);

    expect(next).toBe(16);
    const expected = [
      32767, 32767, 32767, 32767,
      -32767, -32767, -32767, -32767,
      32767, 32767, 32767, 32767,
      -32767, -32767, -32767, -32767,
    ];
    expect(Array.from(buf.subarray(0, 16))).toEqual(expected);
    expect(Array.from(buf.subarray(16))).toEqual(new Array<number>(48).fill(0));
  });

  it('writes silence for freq=0', () => {
    const buf = new Int16Array(64).fill(123);
    const next = pwm(buf, 0, 0, 3);

    expect(next).toBe(24);
    expect(Array.from(buf.subarray(0, 24))).toEqual(new Array<number>(24).fill(0));
    expect(buf[24]).toBe(123);
  });

  it('returns i + duration*8 even when writes wrap', () => {
    const buf = new Int16Array(8);
    expect(pwm(buf, 5, 440, 7)).toBe(5 + 56);
  });

  it('wraps writes at the buffer end with an AND mask', () => {
    const buf = new Int16Array(8);
    const next = pwm(buf, 6, 1000, 2);

    expect(next).toBe(22);
    // Samples 0..15 are [+x4, -x4, +x4, -x4]; sample n lands at (6+n)&7, so
    // the second wrap (n=8..15) wins everywhere.
    expect(Array.from(buf)).toEqual([
      32767, 32767, -32767, -32767, -32767, -32767, 32767, 32767,
    ]);
  });

  it('rejects buffers whose length is not a power of two', () => {
    expect(() => pwm(new Int16Array(100), 0, 1000, 1)).toThrow(/power of two/);
    expect(() => pwm(new Int16Array(0), 0, 1000, 1)).toThrow(/power of two/);
  });
});

describe('PwmAudio.sound', () => {
  it('starts muted and still awaits delay(duration)', async () => {
    const clock = fakeClock();
    const output = new SilentOutput();
    const audio = new PwmAudio(clock, fixedRng([0]), output);

    expect(audio.enabled).toBe(false);
    await audio.sound(440, 25);

    expect(output.played).toHaveLength(0);
    expect(clock.delays).toEqual([25]);
  });

  it('plays the pwm tone and awaits delay(duration) when enabled', async () => {
    const clock = fakeClock();
    const output = new SilentOutput();
    const audio = new PwmAudio(clock, fixedRng([0]), output);
    audio.enabled = true;

    await audio.sound(1000, 2);

    expect(clock.delays).toEqual([2]);
    expect(output.played).toHaveLength(1);
    const reference = new Int16Array(AUDIO_BUF_LEN);
    pwm(reference, 0, 1000, 2);
    expect(Array.from(output.played[0])).toEqual(Array.from(reference.subarray(0, 16)));
  });
});

describe('PwmAudio.playWav', () => {
  it('always delays samples.length/8 ms; play() only when enabled', async () => {
    const clock = fakeClock();
    const output = new SilentOutput();
    const audio = new PwmAudio(clock, fixedRng([0]), output);
    const samples = new Int16Array(80).fill(1234);

    await audio.playWav(samples);
    expect(output.played).toHaveLength(0);
    expect(clock.delays).toEqual([10]);

    audio.enabled = true;
    await audio.playWav(samples);
    expect(output.played).toHaveLength(1);
    expect(Array.from(output.played[0])).toEqual(Array.from(samples));
    expect(clock.delays).toEqual([10, 10]);
  });
});

describe('PwmAudio.speechSound', () => {
  // Burst i is (10-i)*8 samples followed by an 8-sample silence gap:
  // total = 8*(10+9+8+7+6+5+4) + 7*8 = 392 + 56 = 448 samples = 56 ms.
  const TOTAL = 448;

  it('produces 7 bursts with the expected layout and total length', async () => {
    const freqs = [99, 80, 60, 40, 20, 10, 5];
    const clock = fakeClock();
    const output = new SilentOutput();
    const rng = fixedRng(freqs);
    const audio = new PwmAudio(clock, rng, output);
    audio.enabled = true;

    await audio.speechSound();

    expect(rng.calls).toEqual([100, 100, 100, 100, 100, 100, 100]);
    expect(clock.delays).toEqual([TOTAL / 8]);
    expect(output.played).toHaveLength(1);
    const samples = output.played[0];
    expect(samples).toHaveLength(TOTAL);

    // Same synthesis through the pure pwm() must match sample-for-sample.
    const reference = new Int16Array(AUDIO_BUF_LEN);
    let k = 0;
    for (let i = 0; i <= 6; i += 1) {
      k = pwm(reference, k, freqs[i], 10 - i);
      k = pwm(reference, k, 0, 1);
    }
    expect(k).toBe(TOTAL);
    expect(Array.from(samples)).toEqual(Array.from(reference.subarray(0, TOTAL)));

    // Structural check: each burst starts at +32767 and ends with 8 zeros.
    let at = 0;
    for (let i = 0; i <= 6; i += 1) {
      const burstLen = (10 - i) * 8;
      expect(samples[at]).toBe(32767);
      expect(Array.from(samples.subarray(at + burstLen, at + burstLen + 8)))
        .toEqual(new Array<number>(8).fill(0));
      at += burstLen + 8;
    }
    expect(at).toBe(TOTAL);
  });

  it('consumes the RNG and delays even when muted', async () => {
    const clock = fakeClock();
    const output = new SilentOutput();
    const rng = fixedRng([50]);
    const audio = new PwmAudio(clock, rng, output);

    await audio.speechSound();

    expect(output.played).toHaveLength(0);
    expect(rng.calls).toHaveLength(7);
    expect(clock.delays).toEqual([TOTAL / 8]);
  });
});
