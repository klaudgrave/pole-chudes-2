import { describe, expect, it } from 'vitest';

import { PwmAudio, SilentOutput } from '../engine/audio';
import { GameInput } from '../engine/input';
import { BorlandRng } from '../engine/rng';
import { Screen } from '../engine/screen';
import { VirtualClock } from '../engine/timing';
import type { Machine } from '../engine/types';
import { createDebugState, runGame, type GameContext, type Scene } from './script';
import { fonts, lib, ovl, pic } from './testAssets';

interface Harness {
  controller: AbortController;
  clock: VirtualClock;
  input: GameInput;
  ctx: GameContext;
  sceneHistory: Scene[];
}

function buildHarness(seed: number): Harness {
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

  const ctx: GameContext = {
    machine,
    questions: ovl.questions,
    topPlayers: pic.map((entry) => ({ ...entry })),
    state,
    // Original prompt behavior: these tests type the name themselves and
    // rely on the empty-name → NPC fallback for seat 2.
    options: { humanSeats: 2 },
  };
  return { controller, clock, input, ctx, sceneHistory };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

function tap(h: Harness, key: string): void {
  h.input.handleKey(key);
  h.input.handleKeyUp(key);
}

/**
 * Hold Space across a virtual-time window so poll-based loops (the decision
 * hand at 100 ms and the letter hand at 10 ms, dpr:623/1381) can consume it —
 * an instant tap would latch and immediately clear the auto-reset event.
 */
async function holdSpace(h: Harness, ms = 150): Promise<void> {
  h.input.handleKey(' ');
  await h.clock.advance(ms);
  await flush();
  h.input.handleKeyUp(' ');
}

interface DrivePolicy {
  /** 'correct' types the real word on solve; 'wrong' flips the first letter. */
  solveMode: 'spin-only' | 'solve-correct' | 'solve-wrong';
}

interface DriveLog {
  humanLetterPicks: number;
  /** [reaction, scoreBefore, scoreAfter, openedBefore, openedAfter] per human letter turn. */
  letterTurns: Array<{ reaction: number; scoreBefore: number; scoreAfter: number; openedBefore: number; openedAfter: number }>;
}

/**
 * Scene-aware driver: makes seat 1 human (name ТЕСТ), then plays per policy.
 * Human decisions: Space at hand.ofs=4 → 'Кручу барабан'; ArrowLeft to 0 then
 * Space → 'Скажу слово'. Letter pick: Space, ArrowRight past used letters.
 */
async function drive(h: Harness, policy: DrivePolicy, until: () => boolean, maxIterations = 12000): Promise<DriveLog> {
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

  const log: DriveLog = { humanLetterPicks: 0, letterTurns: [] };
  let named = false;
  let stuckLetterIters = 0;
  let lastUsedCount = -1;
  let pendingLetterTurn: { reaction: number; scoreBefore: number; openedBefore: number } | null = null;

  for (let iter = 0; iter < maxIterations && !finished && !until(); iter += 1) {
    await h.clock.advance(60);
    await flush();

    const state = h.ctx.state;
    const entry = h.input.textEntry;
    const humanTurn = state.seats[state.currentPlayer]?.isHuman === true;

    if (entry) {
      if (state.scene === 'word-solve') {
        const word = state.word;
        const typed = policy.solveMode === 'solve-wrong' ? (word[0] === 'А' ? 'Б' : 'А') + word.slice(1) : word;
        for (const ch of typed) {
          h.input.handleKey(ch);
        }
        await flush();
        tap(h, 'Enter');
      } else if (!named) {
        for (const ch of 'ТЕСТ') {
          h.input.handleKey(ch);
        }
        await flush();
        tap(h, 'Enter');
        named = true;
      } else {
        tap(h, 'Enter');
      }
      await flush();
      continue;
    }

    if (state.scene === 'turn' && humanTurn) {
      const wantSolve = policy.solveMode !== 'spin-only';
      const hand = h.input.hand;
      if (wantSolve) {
        if (hand.step === 4 && hand.max === 4) {
          if (hand.ofs !== 0) {
            tap(h, 'ArrowLeft');
            await flush();
          } else {
            await holdSpace(h);
          }
        }
      } else {
        await holdSpace(h);
      }
      continue;
    }

    if (state.scene === 'letter-pick' && humanTurn && h.input.hand.step === 20) {
      if (pendingLetterTurn === null) {
        pendingLetterTurn = {
          reaction: state.currentSector >> 1,
          scoreBefore: state.seats[state.currentPlayer].score,
          openedBefore: state.opened.filter(Boolean).length,
        };
        log.humanLetterPicks += 1;
      }
      if (state.usedLetters.length === lastUsedCount) {
        stuckLetterIters += 1;
      } else {
        stuckLetterIters = 0;
        lastUsedCount = state.usedLetters.length;
      }
      if (stuckLetterIters > 3) {
        tap(h, 'ArrowRight');
        stuckLetterIters = 0;
        await flush();
      }
      await holdSpace(h, 60);
      continue;
    }

    if (pendingLetterTurn && state.scene !== 'letter-pick' && state.scene !== 'letter-open') {
      log.letterTurns.push({
        ...pendingLetterTurn,
        scoreAfter: h.ctx.state.seats[1].score,
        openedAfter: state.opened.filter(Boolean).length,
      });
      pendingLetterTurn = null;
    }

    tap(h, ' ');
    await flush();
  }

  if (failure) {
    throw failure;
  }
  if (!finished && !until()) {
    throw new Error(`driver gave up in scene "${h.ctx.state.scene}" (stage ${h.ctx.state.stage})`);
  }

  h.controller.abort(new DOMException('test-done', 'AbortError'));
  await h.clock.advance(0);
  await run;
  return log;
}

describe('human seat paths (virtual time, real assets)', () => {
  it('human solves the word correctly: round won, identity and score carry over', async () => {
    const h = buildHarness(11);
    let scoreAtWin = -1;
    await drive(h, { solveMode: 'solve-correct' }, () => {
      const s = h.ctx.state;
      if (s.winner === 1 && scoreAtWin < 0) {
        scoreAtWin = s.seats[1].score;
      }
      // Stop once the next stage's word is selected: carry-over observable.
      return s.winner === 1 && s.stage >= 1 && s.scene === 'word-select';
    });

    expect(h.sceneHistory).toContain('word-solve');
    expect(h.sceneHistory).toContain('round-end');
    const seat = h.ctx.state.seats[1];
    expect(seat.isHuman).toBe(true);
    expect(seat.name).toBe('ТЕСТ');
    expect(seat.removed).toBe(false);
    expect(seat.score).toBe(scoreAtWin);
  }, 60_000);

  it('human solves the word incorrectly: player is removed, game continues', async () => {
    const h = buildHarness(11);
    // Note: before presentation assigns a sprite, a seat reads as "removed" —
    // require the solve attempt to have happened first.
    await drive(h, { solveMode: 'solve-wrong' }, () => h.sceneHistory.includes('word-solve') && h.ctx.state.seats[1]?.removed === true);

    expect(h.sceneHistory).toContain('word-solve');
    expect(h.ctx.state.seats[1].removed).toBe(true);
    // The other two seats stay in the round.
    expect(h.ctx.state.seats[0].removed).toBe(false);
    expect(h.ctx.state.seats[2].removed).toBe(false);
  }, 60_000);

  it('human picks letters: used letters grow and value sectors pay score+value', async () => {
    const h = buildHarness(11);
    const log = await drive(
      h,
      { solveMode: 'spin-only' },
      () => h.ctx.state.stage >= 1 && h.ctx.state.seats[1]?.isHuman === true,
    );

    expect(log.humanLetterPicks).toBeGreaterThan(0);
    expect(h.ctx.state.stage).toBeGreaterThanOrEqual(1);

    // Value-sector turns where letters opened must pay exactly score+value
    // (dpr:1363, 1488 — NOT multiplied by the number of opened letters).
    const SECTOR_VALUES = [0, 5, 0, 20, 0, 10, 0, 15, 25, 10, 0, 5, 0, 20, 0, 15];
    const valueTurns = log.letterTurns.filter(
      (t) => ![0, 2, 4, 6, 10, 12, 14].includes(t.reaction) && t.openedAfter > t.openedBefore,
    );
    for (const t of valueTurns) {
      expect(t.scoreAfter).toBe(t.scoreBefore + SECTOR_VALUES[t.reaction]);
    }
  }, 60_000);
});
