import type { ClockApi } from './types';

/** Let chained `await` continuations run between virtual-time settlements. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Wall-clock implementation of ClockApi. Every delay is divided by the
 * machine speed factor (`?fast=`); aborting the signal rejects pending
 * delays with the signal's reason and clears their timers.
 */
export class RealClock implements ClockApi {
  private readonly speedFactor: number;
  private readonly signal: AbortSignal | undefined;

  constructor(speedFactor = 1, signal?: AbortSignal) {
    this.speedFactor = speedFactor;
    this.signal = signal;
  }

  delay(ms: number): Promise<void> {
    const signal = this.signal;
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    const waitMs = Math.max(0, ms / this.speedFactor);
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

interface PendingDelay {
  deadline: number;
  seq: number;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

/**
 * Deterministic test clock. delay() queues a pending entry; advance(ms)
 * settles entries whose deadlines fall inside the advanced window in
 * (deadline, insertion) order, flushing microtasks between settlements so
 * chained awaits can queue follow-up delays inside the same window.
 */
export class VirtualClock implements ClockApi {
  private currentTime = 0;
  private nextSeq = 0;
  private readonly pending: PendingDelay[] = [];
  private readonly signal: AbortSignal | undefined;

  constructor(signal?: AbortSignal) {
    this.signal = signal;
    signal?.addEventListener(
      'abort',
      () => {
        const aborted = this.pending.splice(0, this.pending.length);
        for (const entry of aborted) {
          entry.reject(signal.reason);
        }
      },
      { once: true },
    );
  }

  /** Current virtual time in ms (monotonic, starts at 0). */
  get now(): number {
    return this.currentTime;
  }

  /** Number of unsettled delays. */
  get pendingCount(): number {
    return this.pending.length;
  }

  delay(ms: number): Promise<void> {
    if (this.signal?.aborted) {
      return Promise.reject(this.signal.reason);
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.push({
        deadline: this.currentTime + Math.max(0, ms),
        seq: this.nextSeq,
        resolve,
        reject,
      });
      this.nextSeq += 1;
    });
  }

  async advance(ms: number): Promise<void> {
    const target = this.currentTime + Math.max(0, ms);
    for (;;) {
      const next = this.takeNextDue(target);
      if (!next) {
        break;
      }
      this.currentTime = Math.max(this.currentTime, next.deadline);
      next.resolve();
      await flushMicrotasks();
    }
    this.currentTime = target;
    await flushMicrotasks();
  }

  /** Advance to each earliest pending deadline until the queue drains. */
  async runAll(maxSteps = 10000): Promise<void> {
    let steps = 0;
    while (this.pending.length > 0) {
      if (steps >= maxSteps) {
        throw new Error(`VirtualClock.runAll: exceeded ${maxSteps} steps`);
      }
      steps += 1;
      let earliest = this.pending[0];
      for (const entry of this.pending) {
        if (entry.deadline < earliest.deadline || (entry.deadline === earliest.deadline && entry.seq < earliest.seq)) {
          earliest = entry;
        }
      }
      await this.advance(earliest.deadline - this.currentTime);
    }
  }

  private takeNextDue(target: number): PendingDelay | null {
    let bestIndex = -1;
    for (let i = 0; i < this.pending.length; i += 1) {
      const entry = this.pending[i];
      if (entry.deadline > target) {
        continue;
      }
      if (bestIndex < 0) {
        bestIndex = i;
        continue;
      }
      const best = this.pending[bestIndex];
      if (entry.deadline < best.deadline || (entry.deadline === best.deadline && entry.seq < best.seq)) {
        bestIndex = i;
      }
    }
    if (bestIndex < 0) {
      return null;
    }
    return this.pending.splice(bestIndex, 1)[0];
  }
}
