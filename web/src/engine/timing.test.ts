import { describe, expect, it } from 'vitest';

import { RealClock, VirtualClock } from './timing';

describe('RealClock', () => {
  it('resolves after the scaled delay', async () => {
    const clock = new RealClock(1000);
    await clock.delay(1000); // 1 ms real time
  });

  it('clamps negative and accepts fractional/zero delays', async () => {
    const clock = new RealClock();
    await clock.delay(-100);
    await clock.delay(0);
    await clock.delay(0.25);
  });

  it('rejects with the abort reason while pending', async () => {
    const controller = new AbortController();
    const clock = new RealClock(1, controller.signal);
    const pending = clock.delay(60000);
    const reason = new Error('stop');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('gone');
    controller.abort(reason);
    const clock = new RealClock(1, controller.signal);
    await expect(clock.delay(1)).rejects.toBe(reason);
  });
});

describe('VirtualClock', () => {
  it('settles delays in deadline order regardless of creation order', async () => {
    const clock = new VirtualClock();
    const order: number[] = [];
    void clock.delay(30).then(() => order.push(30));
    void clock.delay(10).then(() => order.push(10));
    void clock.delay(20).then(() => order.push(20));

    await clock.advance(30);
    expect(order).toEqual([10, 20, 30]);
    expect(clock.now).toBe(30);
  });

  it('settles same-deadline delays in FIFO order', async () => {
    const clock = new VirtualClock();
    const order: string[] = [];
    void clock.delay(10).then(() => order.push('a'));
    void clock.delay(10).then(() => order.push('b'));

    await clock.advance(10);
    expect(order).toEqual(['a', 'b']);
  });

  it('does not settle delays beyond the advanced window', async () => {
    const clock = new VirtualClock();
    let done = false;
    void clock.delay(50).then(() => {
      done = true;
    });

    await clock.advance(30);
    expect(done).toBe(false);
    await clock.advance(20);
    expect(done).toBe(true);
  });

  it('progresses chained awaits within a single advance window', async () => {
    const clock = new VirtualClock();
    const steps: string[] = [];
    const run = (async () => {
      await clock.delay(10);
      steps.push('first');
      await clock.delay(10);
      steps.push('second');
    })();

    await clock.advance(20);
    expect(steps).toEqual(['first', 'second']);
    await run;
  });

  it('runAll drains chained delays to completion', async () => {
    const clock = new VirtualClock();
    const steps: number[] = [];
    const run = (async () => {
      for (let i = 0; i < 5; i += 1) {
        await clock.delay(100 + i);
        steps.push(i);
      }
    })();

    await clock.runAll();
    expect(steps).toEqual([0, 1, 2, 3, 4]);
    expect(clock.pendingCount).toBe(0);
    await run;
  });

  it('runAll throws when exceeding the step cap', async () => {
    const clock = new VirtualClock();
    const loop = (async () => {
      for (;;) {
        await clock.delay(10);
      }
    })();
    loop.catch(() => {
      // Left pending forever after the cap fires; silence unhandled tracking.
    });

    await expect(clock.runAll(5)).rejects.toThrow('exceeded 5 steps');
  });

  it('rejects pending delays with the abort reason', async () => {
    const controller = new AbortController();
    const clock = new VirtualClock(controller.signal);
    const pending = clock.delay(100);
    const reason = new Error('aborted');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('rejects new delays immediately when already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('late');
    controller.abort(reason);
    const clock = new VirtualClock(controller.signal);
    await expect(clock.delay(1)).rejects.toBe(reason);
  });
});
