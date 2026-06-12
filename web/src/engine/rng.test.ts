import { describe, expect, it } from 'vitest';

import { BorlandRng } from './rng';

const MULTIPLIER = 134775813n;
const MASK = 0xffffffffn;

/** Exact 64-bit reference for the Borland LCG, independent of the float path. */
function referenceDraws(seed: number, ns: number[]): number[] {
  let state = BigInt(seed >>> 0);
  const out: number[] = [];
  for (const n of ns) {
    state = (state * MULTIPLIER + 1n) & MASK;
    out.push(Number((state * BigInt(n)) >> 32n));
  }
  return out;
}

describe('BorlandRng', () => {
  it('advances state per the LCG: seed 1 -> state 134775814 after one step', () => {
    const rng = new BorlandRng();
    rng.seed(1);
    // floor(134775814 * 1000 / 2^32) = 31, hand-computed.
    expect(rng.random(1000)).toBe(31);
    expect(Math.floor((134775814 * 1000) / 2 ** 32)).toBe(31);
  });

  it('matches a hand/BigInt-computed sequence from seed 1', () => {
    const rng = new BorlandRng(1);
    const ns = [6, 100, 33, 1000, 524287];
    const draws = ns.map((n) => rng.random(n));

    // States from seed 1: 134775814, 3698175007, 870078620, 1172187917, 2884733762.
    expect(draws).toEqual([0, 86, 6, 272, 352139]);
    expect(draws).toEqual(referenceDraws(1, ns));
  });

  it('float path matches the exact BigInt reference over a longer mixed run', () => {
    const rng = new BorlandRng();
    rng.seed(0xdeadbeef);
    const ns: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      ns.push((i % 3 === 0 ? 2 ** 20 - 1 : (i * 37) % 1000) || 1);
    }
    expect(ns.map((n) => rng.random(n))).toEqual(referenceDraws(0xdeadbeef, ns));
  });

  it('is deterministic after re-seeding', () => {
    const rng = new BorlandRng();
    rng.seed(42);
    const first = Array.from({ length: 20 }, () => rng.random(10));
    rng.seed(42);
    const second = Array.from({ length: 20 }, () => rng.random(10));

    expect(first).toEqual(second);
    expect(first.slice(0, 5)).toEqual([3, 8, 2, 1, 0]);
  });

  it('coerces seeds to 32 bits', () => {
    const a = new BorlandRng();
    const b = new BorlandRng();
    a.seed(1);
    b.seed(2 ** 32 + 1);
    expect(a.random(1000)).toBe(b.random(1000));
  });

  it('rejects out-of-domain n', () => {
    const rng = new BorlandRng(1);
    expect(() => rng.random(0)).toThrow(RangeError);
    expect(() => rng.random(-3)).toThrow(RangeError);
    expect(() => rng.random(2 ** 20)).toThrow(RangeError);
    expect(() => rng.random(1.5)).toThrow(RangeError);
  });
});
