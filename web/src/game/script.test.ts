import { describe, expect, it } from 'vitest';

import type { TopPlayerRecord } from '../assets/pic';
import { PwmAudio, SilentOutput } from '../engine/audio';
import { GameInput } from '../engine/input';
import { BorlandRng } from '../engine/rng';
import { Screen } from '../engine/screen';
import { VirtualClock } from '../engine/timing';
import type { Machine } from '../engine/types';
import { createDebugState, runGame, type GameContext, type Scene } from './script';
import { fonts, lib, ovl, pic } from './testAssets';

interface Harness {
  machine: Machine;
  clock: VirtualClock;
  input: GameInput;
  ctx: GameContext;
  sceneHistory: Scene[];
  topPlayers: TopPlayerRecord[];
  controller: AbortController;
}

function buildHarness(seed: number, humanSeats: 1 | 2 = 2): Harness {
  const controller = new AbortController();
  const { signal } = controller;
  const screen = new Screen();
  screen.setSprites(lib.sprites);
  screen.setFonts(fonts);
  const clock = new VirtualClock(signal);
  const rng = new BorlandRng(seed);
  const input = new GameInput(screen, clock, signal);
  const audio = new PwmAudio(clock, rng, new SilentOutput());

  const machine: Machine = { screen, input, audio, clock, rng, signal };
  const state = createDebugState();

  // Record every scene transition without touching the script.
  const sceneHistory: Scene[] = [];
  let scene: Scene = state.scene;
  Object.defineProperty(state, 'scene', {
    get: () => scene,
    set: (value: Scene) => {
      scene = value;
      if (sceneHistory[sceneHistory.length - 1] !== value) {
        sceneHistory.push(value);
      }
    },
  });

  const topPlayers = pic.map((entry) => ({ ...entry }));
  // humanSeats: 2 = the original prompt behavior, where empty names hand
  // every seat to an NPC — the self-playing setup these tests rely on.
  const ctx: GameContext = {
    machine,
    questions: ovl.questions,
    topPlayers,
    state,
    options: { humanSeats },
  };
  return { machine, clock, input, ctx, sceneHistory, topPlayers, controller };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Drive a full game: drain all virtual-time delays, and whenever the script
 * parks on an input wait (queue empty), press Space then Enter. With no name
 * typed every seat becomes an NPC, so the game plays itself to the finale.
 */
async function driveFullGame(h: Harness, maxRounds = 6000, until?: () => boolean): Promise<void> {
  let finished = false;
  let failure: unknown = null;
  const run = runGame(h.ctx).then(
    () => {
      finished = true;
    },
    (error: unknown) => {
      finished = true;
      if (!h.controller.signal.aborted) {
        failure = error;
      }
    },
  );

  for (let round = 0; round < maxRounds; round += 1) {
    await h.clock.runAll(5_000_000);
    await flush();
    if (finished || until?.()) {
      break;
    }
    h.input.handleKey(' ');
    await flush();
    h.input.handleKeyUp(' ');
    h.input.handleKey('Enter');
    await flush();
    h.input.handleKeyUp('Enter');
    await flush();
  }

  if (until?.()) {
    h.controller.abort(new DOMException('test-done', 'AbortError'));
    await h.clock.advance(0);
    await run;
    return;
  }
  if (!finished) {
    throw new Error(`driver exhausted ${maxRounds} rounds; stuck in scene "${h.ctx.state.scene}"`);
  }
  await run;
  if (failure) {
    throw failure;
  }
}

describe('full game script (headless, virtual time, real assets)', () => {
  it('plays an entire 8-stage all-NPC game to the finale (seed 1)', async () => {
    const h = buildHarness(1);
    await driveFullGame(h);

    const { state } = h.ctx;
    expect(state.scene).toBe('done');
    expect(state.stage).toBeGreaterThanOrEqual(7);

    // Every structural scene must have been visited.
    for (const expected of ['splash', 'stage-setup', 'presentation', 'word-select', 'turn', 'letter-pick', 'letter-open', 'adware', 'top-players', 'done'] as Scene[]) {
      expect(h.sceneHistory).toContain(expected);
    }
    // DOS policy: NPCs never enter the box game, prize ceremony, or word solve.
    expect(h.sceneHistory).not.toContain('box-game');
    expect(h.sceneHistory).not.toContain('prize');
    expect(h.sceneHistory).not.toContain('word-solve');

    // 8 stage setups, one per tournament stage.
    expect(h.sceneHistory.filter((s) => s === 'stage-setup')).toHaveLength(8);

    // Session leaderboard stays within the original bounds.
    expect(h.topPlayers.length).toBeLessThanOrEqual(8);
    for (const entry of h.topPlayers) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(0xffff);
    }

    // All seats are NPCs (seat 0 is never prompted; empty names fall back).
    for (const seat of state.seats) {
      expect(seat.isHuman).toBe(false);
      expect(seat.name.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('is deterministic for a fixed seed', async () => {
    const a = buildHarness(42);
    await driveFullGame(a);
    const b = buildHarness(42);
    await driveFullGame(b);

    expect(a.sceneHistory).toEqual(b.sceneHistory);
    expect(a.ctx.state.seats).toEqual(b.ctx.state.seats);
    expect(a.topPlayers).toEqual(b.topPlayers);
  }, 240_000);

  it('different seeds explore different games but still finish (seed sweep)', async () => {
    for (const seed of [7, 1993, 0xdeadbeef]) {
      const h = buildHarness(seed);
      await driveFullGame(h);
      expect(h.ctx.state.scene).toBe('done');
    }
  }, 360_000);

  it('1-player mode (web default): empty name keeps seat 1 human as «ИГРОК», others are NPCs', async () => {
    const h = buildHarness(5, 1);
    // Stop right after the first presentation completes (theme announce parks
    // in word-select, before any human turn could block the driver).
    await driveFullGame(h, 6000, () => h.ctx.state.scene === 'word-select');

    const seats = h.ctx.state.seats;
    expect(seats[1].isHuman).toBe(true);
    expect(seats[1].name).toBe('ИГРОК');
    expect(seats[0].isHuman).toBe(false);
    expect(seats[2].isHuman).toBe(false);
    expect(seats[0].name.length).toBeGreaterThan(0);
    expect(seats[2].name.length).toBeGreaterThan(0);
  }, 60_000);
});
