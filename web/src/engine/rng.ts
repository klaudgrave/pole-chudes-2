import type { RngApi } from './types';

/** Borland/Delphi LCG multiplier (dpr behavioral contract, engine/types.ts:156-159). */
const MULTIPLIER = 134775813;
/** random(n) arguments in the game are tiny; below 2^20 the float path is exact. */
const MAX_N = 2 ** 20;
const TWO_32 = 2 ** 32;

/**
 * Borland Pascal compatible LCG:
 *   state := (state * 134775813 + 1) mod 2^32
 *   random(n) = floor(state * n / 2^32)   // upper 32 bits of the 64-bit product
 *
 * With n < 2^20 the product state * n stays below 2^52, so plain float
 * arithmetic reproduces the 64-bit integer product exactly.
 */
export class BorlandRng implements RngApi {
  private state: number;

  constructor(seedValue = 0) {
    this.state = seedValue >>> 0;
  }

  seed(value: number): void {
    this.state = value >>> 0;
  }

  random(n: number): number {
    if (!Number.isInteger(n) || n <= 0 || n >= MAX_N) {
      throw new RangeError(`random(n): n must be an integer in (0, 2^20), got ${n}`);
    }
    this.state = (Math.imul(this.state, MULTIPLIER) + 1) >>> 0;
    return Math.floor((this.state * n) / TWO_32);
  }
}
