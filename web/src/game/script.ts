import type { OvlQuestion } from '../assets/ovl';
import type { TopPlayerRecord } from '../assets/pic';
import { decodeCp866, encodeCp866 } from '../encoding/cp866';
import type { Machine } from '../engine/types';
import { BACKBUF, BACKBUF2, INFINITE, SCREEN_W } from '../engine/types';
import { defaultAssetSpec } from '../spec';
import {
  CHARACTERS,
  DECISION_ANIM,
  MONEY_VALUES,
  PLAYER_ROUND_NAMES,
  PRIZES,
  SEATS,
  SECTOR_ICONS,
  SECTOR_VALUES,
  STAGE_NAMES,
  WHEEL_OFFSETS,
} from './constants';

/**
 * Direct port of the original game's MainThread (dpr:792-1647) plus its
 * drawing/dialogue helpers (dpr:463-637). `dpr:NNN` refers to
 * reference/delphi/PoleWin32.cp866.txt (public-domain reconstruction
 * of POLE2.EXE; line numbers match Pole2/PoleWin32.dpr).
 *
 * Deviations from the literal Delphi code follow the DOS-first policy in
 * docs/architecture.md and are marked with `DOS:` or `WEB:`
 * comments at each site.
 */

const SPRITE = defaultAssetSpec.spriteIds;

export type Scene =
  | 'splash'
  | 'stage-setup'
  | 'presentation'
  | 'word-select'
  | 'turn'
  | 'word-solve'
  | 'letter-pick'
  | 'letter-open'
  | 'box-game'
  | 'prize'
  | 'adware'
  | 'round-end'
  | 'endgame'
  | 'top-players'
  | 'done';

export interface SeatDebug {
  name: string;
  score: number;
  isHuman: boolean;
  removed: boolean;
}

/** Mutable snapshot consumed by window.__poleDebug and the smoke harness. */
export interface GameDebugState {
  scene: Scene;
  stage: number;
  currentPlayer: number;
  currentSector: number;
  word: string;
  theme: string;
  opened: boolean[];
  usedLetters: string[];
  seats: SeatDebug[];
  winner: number;
  movesForBox: number;
}

export interface GameOptions {
  /**
   * Seats offered to humans. 1 (default web mode): only seat 2 ('2-ой ИГРОК')
   * is prompted, and an empty name keeps it HUMAN with the default name
   * «ИГРОК» — guaranteeing the 1-player + 2-NPC setup. 2 (original
   * behavior): seats 2 and 3 are both prompted and an empty name hands the
   * seat to an NPC (dpr:1055-1078 + Delphi deviation #2).
   */
  humanSeats: 1 | 2;
}

export interface GameContext {
  machine: Machine;
  /** Live, session-edited question list (admin panel edits apply immediately). */
  questions: readonly OvlQuestion[];
  /** Session-only top-8 list, mutated in place (CLAUDE.md: no persistent state). */
  topPlayers: TopPlayerRecord[];
  state: GameDebugState;
  /** Omitted → the web default: 1 human + 2 NPCs. */
  options?: GameOptions;
}

interface Seat {
  /** null = removed from the round (the original's Sprite.ptr = nil). */
  spriteId: number | null;
  nameBytes: Uint8Array;
  score: number;
}

export function createDebugState(): GameDebugState {
  return {
    scene: 'splash',
    stage: 0,
    currentPlayer: 0,
    currentSector: 0,
    word: '',
    theme: '',
    opened: [],
    usedLetters: [],
    seats: [],
    winner: 3,
    movesForBox: 0,
  };
}

class Game {
  private readonly m: Machine;
  private readonly ctx: GameContext;
  private readonly seats: Seat[] = SEATS.map(() => ({ spriteId: null, nameBytes: new Uint8Array(0), score: 0 }));
  /** Per-run copy of the character table (dpr:141 is a static global, fresh each program launch). */
  private readonly characters = CHARACTERS.map((c) => ({ ...c }));
  /** Scratch PWM buffer, the original's AudioBuf (dpr:152). */
  private readonly audioBuf = new Int16Array(8192);
  /** CP866 bytes 0x80..0x9F or 0x20 once used (dpr:820, 1024-1031). */
  private readonly available = new Uint8Array(32);

  private charId = 0;
  private curSector = 0;
  private winner = 3;
  private stage = 0;
  private curPlayer = 0;
  /** DOS: successful MOVES toward the box game (Delphi counted letters; deviation #4). */
  private movesForBox = 0;
  private readonly prevWords: number[] = new Array(8).fill(-1);

  private guessedWord: Uint8Array = new Uint8Array(0);
  private remaindLetters = 0;
  private wordPos = 0;
  private opened: boolean[] = [];
  private readonly humanSeats: 1 | 2;

  constructor(ctx: GameContext) {
    this.humanSeats = ctx.options?.humanSeats ?? 1;
    this.ctx = ctx;
    this.m = ctx.machine;
  }

  // ---------------------------------------------------------------- helpers

  private get screen() {
    return this.m.screen;
  }

  private setScene(scene: Scene): void {
    this.ctx.state.scene = scene;
    this.syncDebug();
  }

  private syncDebug(): void {
    const s = this.ctx.state;
    s.stage = this.stage;
    s.currentPlayer = this.curPlayer;
    s.currentSector = this.curSector;
    s.word = decodeCp866(this.guessedWord);
    s.opened = [...this.opened];
    s.usedLetters = [];
    for (let i = 0; i < 32; i += 1) {
      if (this.available[i] === 0x20) {
        s.usedLetters.push(decodeCp866(new Uint8Array([0x80 + i])));
      }
    }
    s.seats = this.seats.map((seat) => ({
      name: decodeCp866(seat.nameBytes),
      score: seat.score,
      isHuman: seat.spriteId === SPRITE.PLAYER,
      removed: seat.spriteId === null,
    }));
    s.winner = this.winner;
    s.movesForBox = this.movesForBox;
  }

  private isHuman(seatIdx: number): boolean {
    return this.seats[seatIdx].spriteId === SPRITE.PLAYER;
  }

  private delay(ms: number): Promise<void> {
    return this.m.clock.delay(ms);
  }

  private waitKey(timeoutMs: number): Promise<boolean> {
    return this.m.input.waitKeyPressed(timeoutMs);
  }

  private random(n: number): number {
    return this.m.rng.random(n);
  }

  private len(text: string): number {
    return encodeCp866(text).length;
  }

  // ------------------------------------------------------- drawing routines

  /** dpr:463-482 */
  private drawFortuneWheel(a: number): void {
    const s = this.screen;
    s.fillRect(0x3030 * 8, 172, 223, 7);
    const seat0 = this.seats[0];
    if (seat0.spriteId !== null) {
      s.drawSprite(seat0.spriteId, SEATS[0].spriteOfs, 2);
    }
    s.drawSprite((a + 3) & 3, 0x80 + 0x9a * SCREEN_W, 3);
    let icon = a;
    for (let i = 0; i < 16; i += 1) {
      s.drawSprite(SECTOR_ICONS[i], WHEEL_OFFSETS[icon & 31], 7);
      icon += 2;
    }
    s.drawSprite(SPRITE.ARROW, 0xeb + 0xbf * SCREEN_W, 7);
  }

  /** dpr:503-509 */
  private async yakubovichSetSilent(): Promise<void> {
    const s = this.screen;
    s.screenCopy(161, 40, 0x164df, BACKBUF + 0x164df);
    await this.m.audio.speechSound();
    s.drawSprite(SPRITE.YAKUBOVICH_PASSIVE, 0x1ff + 0xad * SCREEN_W, 16);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, 0xd1 * SCREEN_W + 0x214, 16);
  }

  /** dpr:511-544 */
  private async yakubovichTalk(line1: string, line2: string): Promise<void> {
    const s = this.screen;
    const eyesLow = 0x214 + 0xd1 * SCREEN_W;
    const eyesHigh = 0x214 + 0xc9 * SCREEN_W;
    const body = 0x1ff + 0xad * SCREEN_W;

    await this.m.audio.speechSound();
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_CLOSE, eyesLow, 16);
    await this.delay(200);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, eyesLow, 16);
    await this.delay(150);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_CLOSE, eyesLow, 16);
    await this.delay(150);
    s.drawSprite(SPRITE.YAKUBOVICH_ACTIVE, body, 16);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_CLOSE, eyesHigh, 16);

    for (let i = 2; i >= 0; i -= 1) {
      await this.m.audio.speechSound();
      s.drawSprite(SPRITE.YAKUBOVICH_PASSIVE, body, 16);
      s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, eyesLow, 16);
      await this.delay(this.random(2) * 200 + 100);
      s.drawSprite(SPRITE.YAKUBOVICH_ACTIVE, body, 16);
      await this.delay(this.random(2) * 50 + 100);
    }

    s.screenCopy(161, 40, BACKBUF + 0x164df, 0x164df);
    s.drawSprite(SPRITE.SPEECH_BUBBLE, 0x164df, 1);
    s.print(line1, 0x91 * SCREEN_W + 0x22e - (this.len(line1) << 2), 0, 14, 8);
    s.print(line2, 0x9e * SCREEN_W + 0x22e - (this.len(line2) << 2), 0, 14, 8);
    await this.m.audio.speechSound();
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, eyesHigh, 16);
    await this.delay(100);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_CLOSE, eyesHigh, 16);
    await this.delay(100);
  }

  /**
   * dpr:546-558. DOS: only NPC seats speak (Delphi deviation #10 gave the
   * human a bubble too) — callers guard on isHuman.
   */
  private async playerTalk(bubbleOfs: number, text: string): Promise<void> {
    const s = this.screen;
    s.screenCopy(84, 39, BACKBUF2, bubbleOfs);
    s.drawSprite(SPRITE.SPEECH_BUBBLE2, bubbleOfs, 2);
    s.print(text, bubbleOfs + 8 * SCREEN_W + 44 - (this.len(text) << 2), 0, 14, 8);
    await this.waitKey(1000);
    s.screenCopy(84, 39, bubbleOfs, BACKBUF2);
  }

  /** dpr:560-587 */
  private async updateMoney(seatIdx: number): Promise<void> {
    const s = this.screen;
    const seat = this.seats[seatIdx];
    const { moneyOfs } = SEATS[seatIdx];
    s.fillRect(moneyOfs - 644, 30, 84, 7);
    if (seat.score === 0) {
      s.drawSprite(SPRITE.SNIKERS, moneyOfs, 2);
      return;
    }
    for (let i = 1; i <= seat.score; i += 1) {
      s.drawSprite(SPRITE.MONEY, moneyOfs + this.random(7) * SCREEN_W - SCREEN_W + this.random(12) - 4, 1);
      await this.m.audio.sound(this.random(10) + 50, 2);
    }
    s.drawSprite(SPRITE.MONEY, moneyOfs, 1);
    const text = String(seat.score);
    const center = moneyOfs + 0x22 - (text.length << 2) + 4 * SCREEN_W;
    s.print(text, center - 641, 0, 14, 8);
    s.print(text, center - 639, 0, 14, 8);
    s.print(text, center + 639, 0, 14, 8);
    s.print(text, center + 641, 0, 14, 8);
    s.print(text, center, 15, 14, 8);
  }

  /**
   * dpr:589-637. Returns 0 (left option) or 1 (right option).
   * `forced` substitutes the NPC's random(2) when a deviation policy fixes
   * the answer (e.g. NPCs never take the prize) while keeping the full
   * save/restore + setSilent + speech-bubble tail of the original.
   */
  private async playerDecision(label1: string, label2: string, phrase0: string, phrase1: string, forced?: number): Promise<number> {
    const s = this.screen;
    const { input } = this.m;
    const seatIdx = this.curPlayer;
    const { moneyOfs, spriteOfs, talkBubbleOfs } = SEATS[seatIdx];

    s.screenCopy(125, 30, BACKBUF2, moneyOfs - 30 * SCREEN_W - 24);
    s.screenCopy(125, 30, BACKBUF2 + 125, moneyOfs - 24);
    if (label1.length > 0) {
      s.fillRect(moneyOfs - 644, 30, 84, 7);
      s.drawSprite(SPRITE.SNIKERS, moneyOfs - 24, 2);
      s.drawSprite(SPRITE.SNIKERS, moneyOfs + 40, 2);
      s.print(label1, moneyOfs - 30 * SCREEN_W - 16, 0, 14, 8);
      s.print(label2, moneyOfs - 16 * SCREEN_W - 16, 0, 14, 8);
    }

    let result = 0;
    if (this.isHuman(seatIdx)) {
      const hand = input.hand;
      hand.min = 0;
      hand.max = 4;
      hand.ofs = 4;
      hand.step = 4;
      let i = 2;
      for (;;) {
        if (i > hand.ofs) {
          i -= 1;
        } else if (i < hand.ofs) {
          i += 1;
        }
        s.fillRect(spriteOfs, 83, 99, 7);
        s.drawSprite(DECISION_ANIM[i], spriteOfs, 2);
        await this.delay(100);
        if (hand.ofs !== 2 && input.pollKeyPressed()) {
          result = hand.ofs >> 2;
          hand.ofs = 2;
        }
        if (i === 2 && hand.ofs === 2) {
          break;
        }
      }
    } else {
      result = forced ?? this.random(2);
    }

    s.screenCopy(125, 30, moneyOfs - 30 * SCREEN_W - 24, BACKBUF2);
    s.screenCopy(125, 30, moneyOfs - 24, BACKBUF2 + 125);
    await this.yakubovichSetSilent();
    // DOS: deviation #10 — the human player did not speak.
    if (!this.isHuman(seatIdx)) {
      await this.playerTalk(talkBubbleOfs, result === 0 ? phrase0 : phrase1);
    }
    return result;
  }

  // ----------------------------------------------------------------- scenes

  /** dpr:869-947 */
  private async splash(): Promise<void> {
    this.setScene('splash');
    const s = this.screen;

    let j = 0x159 * SCREEN_W + 20;
    let k = 0x26c - 20;
    for (let i = 0; i <= 0xa0; i += 1) {
      s.fillChar(j, k, 7);
      j -= 639;
      k -= 2;
      await this.delay(10);
    }
    await this.waitKey(2000);

    j = 185 * SCREEN_W + 180;
    k = 280;
    for (let i = 0; i <= 0xa0; i += 1) {
      s.fillChar(j, k, 7);
      s.line(20, 345, 180 - i, 185 - i);
      s.line(460 + i, 185 - i, 620, 345);
      j -= 641;
      k += 2;
      await this.delay(10);
    }

    j = 25 * SCREEN_W + 20;
    do {
      k = j;
      for (let i = 0; i <= 8; i += 1) {
        s.fillRect(k, 3, 10, 4);
        k += 40 * SCREEN_W;
      }
      await this.delay(10);
      j += 10;
    } while (j <= 25 * SCREEN_W + 610);

    j = 25 * SCREEN_W + 19;
    do {
      k = j;
      for (let i = 0; i <= 12; i += 1) {
        s.fillRect(k, 8, 3, 4);
        k += 50;
      }
      await this.delay(10);
      j += 8 * SCREEN_W;
    } while (j <= 337 * SCREEN_W + 19);

    await this.waitKey(2500);
    s.drawSprite(SPRITE.LOGO_POLE, 60 * SCREEN_W + 0x5a, 7);
    s.drawSprite(SPRITE.LOGO_CHUDES, 60 * SCREEN_W + 0x118, 7);
    await this.waitKey(2500);

    const title = encodeCp866(' КАПИТАЛШОУ ');
    j = 0;
    k = 0xee * SCREEN_W - 15;
    for (let i = 1; i <= 12; i += 1) {
      const ch = title.subarray(i - 1, i);
      k += 50;
      if (i === 9) {
        k += 15;
      }
      s.print(ch, k - 641, 0, 14, 8);
      s.print(ch, k - 639, 0, 14, 8);
      s.print(ch, k + 639, 0, 14, 8);
      s.print(ch, k + 641, 0, 14, 8);
      s.print(ch, k + 640 + 639, 0, 14, 8);
      s.print(ch, k + 640 + 641, 0, 14, 8);
      s.print(ch, k, 15, 14, 8);
      s.print(ch, k + 640, 15, 14, 8);
      j += 100;
      await this.m.audio.sound(j, 10);
      await this.delay(250);
    }

    s.print('Сделал Дима Башуров из Арзамаса-16 (E-Mail: 0669@RFNC.NNOV.SU )', 2 * SCREEN_W + 0x44, 7, 8, 8);
    s.print('Телефон в Арзамасе-16: (83130) 5-92-73', 12 * SCREEN_W + 0xb0, 7, 8, 8);
    s.print('Посвящается друзьям', 0x1b * SCREEN_W + 0x50, 0, 14, 0x19);
    s.print('Посвящается друзьям', 0x1c * SCREEN_W + 0x50, 0, 14, 0x19);
    s.fillRect(0x6040 * 8, 0x46, SCREEN_W, 0);
    s.print('СПРАВКА: Для перемещения своей руки использйте клавиши со стрелками или', 0x136 * SCREEN_W + 0x1b, 7, 8, 8);
    s.print('"мышку". Ввод осуществляется нажатием на клавишу ПРОБЕЛ или на', 0x140 * SCREEN_W + 0x63, 7, 8, 8);
    s.print('левую кнопку"мышки". Нажатие <Ctrl+S> включает/выключает звук,', 0x14a * SCREEN_W + 0x63, 7, 8, 8);
    s.print('если пришел начальник, нажми клавишу TAB, ESC - выход из игры!', 0x154 * SCREEN_W + 0x63, 7, 8, 8);
    await this.waitKey(INFINITE);
  }

  /** dpr:955-982 — one-time background, bricks, lamps, character shuffle. */
  private drawStaticBackground(): void {
    const s = this.screen;
    s.fillRect(0, 10, SCREEN_W, 3);
    s.fillRect(0x320 * 8, 2, SCREEN_W, 8);
    s.fillRect(0x410 * 8, 0x5e, SCREEN_W, 1);
    s.fillRect(0x21c0 * 8, 2, SCREEN_W, 8);
    s.fillRect(0x6770 * 8, 1, SCREEN_W, 8);

    for (let i = 35; i >= 0; i -= 1) {
      s.drawSprite(SPRITE.BRICK1 + this.random(3), (i % 12) * 52 + 5 + (Math.floor(i / 12) * 31 + 15) * SCREEN_W, 1);
    }
    s.drawSprite(SPRITE.LAMP, 69 + 3 * SCREEN_W, 1);
    s.drawSprite(SPRITE.LAMP, 559 + 3 * SCREEN_W, 1);

    const chars = this.characters;
    for (let i = 100; i >= 0; i -= 1) {
      const a = this.random(chars.length);
      const b = this.random(chars.length);
      [chars[a], chars[b]] = [chars[b], chars[a]];
    }
  }

  /** dpr:990-1037 */
  private async stageSetup(): Promise<void> {
    this.setScene('stage-setup');
    const s = this.screen;

    s.fillRect(0x11580, 238, SCREEN_W, 7);
    s.drawSprite(SPRITE.WALL_LEFT, 25 * SCREEN_W, 7);
    s.drawSprite(SPRITE.WALL_RIGHT, 600 + 25 * SCREEN_W, 7);

    s.fillRect(15 * SCREEN_W + 120, 80, 400, 7);
    let k = 0xedf8;
    for (let i = 4; i >= 0; i -= 1) {
      s.fillChar(k, 400, 0);
      k -= 20 * SCREEN_W;
    }
    k = 520;
    for (let j = 25; j >= 0; j -= 1) {
      let n = 0x2580 + k;
      for (let i = 80; i >= 0; i -= 1) {
        s.fillChar(n, 1, 0);
        n += SCREEN_W;
      }
      k -= 16;
    }
    const stageName = STAGE_NAMES[this.stage];
    s.print(stageName, 78 * SCREEN_W + 125 + 12 * 16 - ((this.len(stageName) >> 1) << 4), 0, 14, 16);

    s.drawSprite(SPRITE.YAKUBOVICH_BASE, 0x1e0 + 0xac * SCREEN_W, 7);
    s.drawSprite(SPRITE.YAKUBOVICH_PASSIVE, 0x1ff + 0xad * SCREEN_W, 16);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, 0x214 + 0xd1 * SCREEN_W, 16);

    let j = 332 * SCREEN_W + 31 * 20;
    for (let i = 31; i >= 0; i -= 1) {
      this.available[i] = 0x80 + i;
      s.drawSprite(SPRITE.LETTER_BACK0, j, 8);
      j -= 20;
    }
    s.print(this.available, 334 * SCREEN_W + 4, 0, 14, 20);

    const saved = this.seats[0].spriteId;
    this.seats[0].spriteId = null; // dpr:1034 — avoid drawing seat 0 before presentation
    this.drawFortuneWheel(0);
    this.seats[0].spriteId = saved;
    await this.yakubovichTalk('Представляю', 'участников!');
  }

  /** dpr:1040-1087 */
  private async presentation(): Promise<void> {
    this.setScene('presentation');
    const s = this.screen;
    const { input } = this.m;

    for (let j = 0; j <= 2; j += 1) {
      const seat = this.seats[j];
      const layout = SEATS[j];
      s.fillRect(layout.labelOfs - 641, 30, 110, 0);
      s.fillRect(layout.labelOfs, 28, 108, 7);
      for (let i = 3; i >= 0; i -= 1) {
        s.print(layout.caption, layout.labelOfs + 14, (i & 1) * 7, 14, 8);
        await this.m.audio.sound(i * 10 + 100, 20);
        await this.delay(120);
      }
      await this.m.audio.sound(50, 100);

      if (j !== this.winner) {
        seat.nameBytes = new Uint8Array(0);
        seat.score = 0;
        // Seat 0 is never prompted (dpr:1057); in 1-player web mode only
        // seat 1 is, in the original mode seats 1 and 2 both are.
        const prompted = j > 0 && j <= this.humanSeats;
        if (prompted) {
          await this.yakubovichSetSilent();
          await this.yakubovichTalk('Пожалуйста,', 'представьтесь!');
          seat.spriteId = SPRITE.PLAYER;
          const entry = input.beginTextEntry(10, layout.labelOfs + SCREEN_W * 14, 8);
          await input.waitEnter(INFINITE);
          input.endTextEntry();
          s.fillRect(layout.labelOfs + SCREEN_W * 14, 14, 80, 7);
          seat.nameBytes = new Uint8Array(entry.bytes);
        }
        if (seat.nameBytes.length === 0) {
          if (prompted && this.humanSeats === 1) {
            // WEB: 1-player mode guarantees a human seat — an empty name
            // keeps the seat human under a default name instead of the
            // original's NPC fallback.
            seat.nameBytes = encodeCp866('ИГРОК');
          } else {
            // Empty name (or an unprompted seat): NPC takes it (dpr:1070-1077).
            const character = this.characters[this.charId];
            seat.spriteId = character.spriteId;
            seat.nameBytes = encodeCp866(character.name);
            this.charId = (this.charId + 1) % this.characters.length;
          }
        }
      }

      if (seat.spriteId !== null) {
        s.drawSprite(seat.spriteId, layout.spriteOfs, 2);
      }
      s.print(seat.nameBytes, layout.labelOfs + 54 - (seat.nameBytes.length << 2) + 14 * SCREEN_W, 0, 14, 8);
      this.drawFortuneWheel(0);
      await this.updateMoney(j);
      this.syncDebug();
      await this.delay(500);
    }
    this.winner = 3;
  }

  /** dpr:1091-1115 */
  private async selectWord(): Promise<void> {
    this.setScene('word-select');
    const s = this.screen;
    const { questions } = this.ctx;
    if (questions.length === 0) {
      throw new Error('No questions loaded');
    }

    let curWord: number;
    if (questions.length >= 8) {
      // dpr:1091-1096 — retry until unused this session (Delphi deviation #12, kept).
      do {
        curWord = this.random(questions.length) + 1;
      } while (this.prevWords.slice(0, this.stage).includes(curWord));
    } else {
      // WEB: pools smaller than 8 would soft-lock the retry loop; allow repeats.
      curWord = this.random(questions.length) + 1;
    }
    this.prevWords[this.stage] = curWord;

    // Evidence-corrected OVL pairing: pair w = (word, theme) = parser questions[w-1]
    // (the literal Delphi indexing mispairs and overruns; see architecture.md).
    const question = questions[curWord - 1];
    this.guessedWord = encodeCp866(question.word);
    this.remaindLetters = this.guessedWord.length;
    this.opened = new Array(this.guessedWord.length).fill(false);
    this.ctx.state.theme = question.theme;
    this.wordPos = 0x19 * SCREEN_W + 121 + 12 * 16 - ((this.remaindLetters >> 1) << 4);
    for (let i = this.remaindLetters - 1; i >= 0; i -= 1) {
      s.fillRect((i << 4) + this.wordPos + 11 * SCREEN_W, 19, 14, 8);
    }

    await this.yakubovichSetSilent();
    await this.yakubovichTalk('Начинаем игру!', 'Загадано слово:');
    await this.waitKey(2500);
    await this.yakubovichSetSilent();
    await this.yakubovichTalk('Тема:', question.theme);
    await this.waitKey(INFINITE);
    await this.yakubovichSetSilent();
    this.syncDebug();
  }

  /** dpr:1125-1189. DOS: offered to human seats only (deviation #5). */
  private async boxGame(): Promise<void> {
    this.setScene('box-game');
    const s = this.screen;
    const seat = this.seats[this.curPlayer];
    const { talkBubbleOfs } = SEATS[this.curPlayer];
    const areaOfs = talkBubbleOfs - 60 * SCREEN_W - 32;

    await this.yakubovichTalk('За 3 буквы ПРЕМИЯ!', 'Внесите шкатулки!');
    s.screenCopy(104, 121, BACKBUF + areaOfs, areaOfs);

    let k = 61;
    let j = talkBubbleOfs + 60 * SCREEN_W;
    for (let i = 30; i >= 0; i -= 1) {
      await this.m.audio.sound(1000 - i * 20, 10);
      s.screenCopy(104, 121, areaOfs, BACKBUF + areaOfs);
      s.drawSprite(SPRITE.BOX_OPENED, j - 46 * SCREEN_W - 32, 7);
      s.drawSprite(SPRITE.BOX_OPENED, j - 46 * SCREEN_W + 24, 7);
      s.drawSprite(SPRITE.BOX_MONEY, j - 60 * SCREEN_W + 26, 7);
      s.screenCopy(104, k, talkBubbleOfs - 32, BACKBUF + talkBubbleOfs - 32);
      k -= 2;
      j -= 1280;
      await this.delay(i);
    }
    await this.waitKey(5000);

    s.screenCopy(104, 121, areaOfs, BACKBUF + areaOfs);
    await this.m.audio.sound(1000, 10);
    s.drawSprite(SPRITE.BOX_CLOSED, talkBubbleOfs - 41 * SCREEN_W - 32, 7);
    await this.m.audio.sound(100, 10);
    s.drawSprite(SPRITE.BOX_CLOSED, talkBubbleOfs - 41 * SCREEN_W + 24, 7);
    await this.m.audio.sound(500, 10);
    await this.waitKey(2000);

    k = this.random(20) + 10;
    for (let i = k; i >= 0; i -= 1) {
      await this.m.audio.sound(this.random(100) + 50, 10);
      await this.delay(50);
      s.screenCopy(104, 121, areaOfs, BACKBUF + areaOfs);
      if ((i & 1) === 0) {
        s.drawSprite(SPRITE.BOX_CLOSED, talkBubbleOfs - 41 * SCREEN_W - 32, 7);
        s.drawSprite(SPRITE.BOX_CLOSED, talkBubbleOfs - 41 * SCREEN_W + 24, 7);
      } else {
        s.drawSprite(SPRITE.BOX_CLOSED, talkBubbleOfs - 36 * SCREEN_W - 6, 7);
        s.drawSprite(SPRITE.BOX_CLOSED, talkBubbleOfs - 46 * SCREEN_W + 4, 7);
      }
    }
    await this.yakubovichSetSilent();
    await this.yakubovichTalk('Где деньги?', 'Выбирайте!');
    const choice = await this.playerDecision('', '', 'Левая', 'Правая');
    await this.yakubovichSetSilent();
    s.screenCopy(104, 121, areaOfs, BACKBUF + areaOfs);
    s.drawSprite(SPRITE.BOX_OPENED, talkBubbleOfs - 46 * SCREEN_W - 32, 7);
    s.drawSprite(SPRITE.BOX_OPENED, talkBubbleOfs - 46 * SCREEN_W + 24, 7);
    k &= 1;
    s.drawSprite(SPRITE.BOX_MONEY, talkBubbleOfs - 60 * SCREEN_W - 30 + 56 * k, 7);
    if (choice === k) {
      await this.yakubovichTalk('Браво!!!', 'Вы отгадали!');
      seat.score += 100;
    } else {
      await this.yakubovichTalk('Увы! Эта', 'шкатулка пуста!');
    }
    await this.waitKey(INFINITE);
    await this.yakubovichSetSilent();
    s.screenCopy(104, 121, areaOfs, BACKBUF + areaOfs);
    await this.updateMoney(this.curPlayer);
    this.movesForBox = 0;
  }

  /** dpr:1196-1224. Returns 'won' | 'removed'. */
  private async tellWord(): Promise<'won' | 'removed'> {
    this.setScene('word-solve');
    const s = this.screen;
    const { input } = this.m;

    const maxLen = this.guessedWord.length;
    const entry = input.beginTextEntry(maxLen, this.wordPos + 13 * SCREEN_W + 4, 16);
    const k = maxLen << 4;
    s.screenCopy(k, 31, BACKBUF + this.wordPos, this.wordPos);
    let j = entry.ofs - 2 * SCREEN_W - 4;
    for (let i = maxLen; i >= 1; i -= 1) {
      s.fillRect(j, 19, 14, 7);
      j += 16;
    }
    await input.waitEnter(INFINITE);
    input.endTextEntry();

    const typed = new Uint8Array(entry.bytes);
    const match = typed.length === this.guessedWord.length && typed.every((b, idx) => b === this.guessedWord[idx]);
    if (match) {
      await this.yakubovichTalk('Вы совершенно', 'правы!!');
      await this.waitKey(2500);
      await this.yakubovichSetSilent();
      return 'won';
    }
    s.screenCopy(k, 31, this.wordPos, BACKBUF + this.wordPos);
    await this.yakubovichTalk('Неправильно! Вы', 'покидаете игру!');
    this.removePlayer();
    return 'removed';
  }

  /** dpr:1352-1358 */
  private removePlayer(): void {
    const s = this.screen;
    const layout = SEATS[this.curPlayer];
    this.seats[this.curPlayer].spriteId = null;
    s.fillRect(layout.moneyOfs - 644, 30, 84, 7);
    s.fillRect(layout.spriteOfs, 83, 87, 7);
    s.fillRect(layout.labelOfs - 641, 30, 110, 7);
    this.drawFortuneWheel(this.curSector);
    this.syncDebug();
  }

  /** dpr:1229-1244 — wheel rotation and final sound. */
  private async spinWheel(): Promise<void> {
    // DIFF #18: the oracle travels (random(10)+5) shl 1 = 10..28 half-steps —
    // under one revolution, which the symmetric 16-wedge art makes read as
    // the same two-segment nudge every spin. Two full extra revolutions
    // (+64 ≡ 0 mod 32) run at constant speed before the original
    // deceleration: same single random(10) draw, same landing sector, same
    // RNG stream — only the animation is longer.
    const decelSteps = (this.random(10) + 5) << 1;
    let i = decelSteps + 64;
    let j = 10;
    do {
      this.curSector = (this.curSector + 1) & 31;
      this.drawFortuneWheel(this.curSector);
      await this.m.audio.sound(Math.min(i, decelSteps) * 10 + 55, 10);
      await this.delay(j);
      if (i <= decelSteps) {
        j += 3;
      }
      i -= 1;
    } while (i > 0);

    let k = 0;
    for (let n = 1; n <= 30; n += 1) {
      k = this.m.audio.pwm(this.audioBuf, k, 1000 - n * 30, Math.floor(n / 5) + Math.floor(n / 3));
    }
    await this.m.audio.playWav(this.audioBuf.subarray(0, k));
    this.syncDebug();
  }

  /**
   * dpr:1265-1291 (ПЛЮС) — pick a POSITION in the word. Returns the 1-based
   * position n; the letter index is derived from the word byte there.
   */
  private async pickPlusPosition(): Promise<number> {
    this.setScene('letter-pick');
    const s = this.screen;
    const { input } = this.m;

    if (!this.isHuman(this.curPlayer)) {
      let n: number;
      do {
        n = this.random(this.guessedWord.length) + 1;
      } while (this.available[this.guessedWord[n - 1] - 0x80] === 0x20);
      return n;
    }

    s.screenCopy(SCREEN_W, 60, BACKBUF + 0x320 * 8, 0x320 * 8);
    const hand = input.hand;
    hand.step = 16;
    hand.ofs = this.wordPos - 13 * SCREEN_W;
    hand.min = hand.ofs;
    hand.max = hand.ofs + (this.guessedWord.length << 4) - 16;
    hand.prev = 12 * SCREEN_W + 0xc8;
    let n = 1;
    for (;;) {
      s.screenCopy(15, 26, hand.prev, BACKBUF + hand.prev);
      s.drawSprite(SPRITE.HAND, hand.ofs, 2);
      n = (hand.ofs - hand.min + 16) >> 4;
      const letterIdx = this.guessedWord[n - 1] - 0x80;
      if (input.pollKeyPressed()) {
        if (this.available[letterIdx] === 0x20) {
          await this.m.audio.sound(1000, 32);
        } else {
          break;
        }
      }
      // WEB: the original busy-waits here; yield so the browser can deliver input.
      await this.delay(10);
    }
    s.screenCopy(15, 26, hand.ofs, BACKBUF + hand.ofs);
    return n;
  }

  /** dpr:1366-1396 — pick a letter from the alphabet row. Returns letter index 0..31. */
  private async pickLetter(): Promise<number> {
    this.setScene('letter-pick');
    const s = this.screen;
    const { input } = this.m;
    s.screenCopy(SCREEN_W, 60, BACKBUF + 0x59b0 * 8, 0x59b0 * 8);

    if (this.isHuman(this.curPlayer)) {
      const hand = input.hand;
      hand.step = 20;
      hand.ofs = 0x13a * SCREEN_W;
      hand.min = hand.ofs;
      hand.max = hand.ofs + 31 * 20;
      hand.prev = hand.min + 20;
      let i = 0;
      for (;;) {
        s.screenCopy(15, 26, hand.prev, BACKBUF + hand.prev);
        s.drawSprite(SPRITE.HAND, hand.ofs, 2);
        i = Math.floor((hand.ofs - hand.min) / 20);
        if (input.pollKeyPressed()) {
          if (this.available[i] === 0x20) {
            await this.m.audio.sound(1000, 32);
          } else {
            break;
          }
        }
        // WEB: yield (original busy-loop).
        await this.delay(10);
      }
      s.screenCopy(20, 26, hand.ofs, BACKBUF + hand.ofs);
      return i;
    }

    // dpr:1389-1396 — the original NPC heuristic.
    if (this.remaindLetters << 1 < this.guessedWord.length && this.random(this.stage + 2) > 0) {
      let i: number;
      do {
        i = this.guessedWord[this.random(this.guessedWord.length)] - 0x80;
      } while (this.available[i] === 0x20);
      return i;
    }
    let i: number;
    do {
      i = this.random(32);
    } while (this.available[i] === 0x20);
    return i;
  }

  /**
   * dpr:1398-1497 — open the chosen letter. `letterIdx` 0..31; `n` is the
   * 1-based word position for the ПЛЮС sector, else 0. `size` is the score
   * the player receives if the letter is present. Returns true if found.
   */
  private async openLetter(letterIdx: number, n: number, size: number): Promise<boolean> {
    this.setScene('letter-open');
    const s = this.screen;
    const seat = this.seats[this.curPlayer];

    await this.m.audio.sound(100, 32);
    const letterByte = this.available[letterIdx];
    const letterChar = decodeCp866(new Uint8Array([letterByte]));
    this.available[letterIdx] = 0x20;

    // DOS: deviation #10 — only NPCs announce their letter.
    if (!this.isHuman(this.curPlayer)) {
      const text = n === 0 ? `Буква ${letterChar}` : `${n}-я буква`;
      await this.playerTalk(SEATS[this.curPlayer].talkBubbleOfs, text);
    }

    // Letter disappear effect on the alphabet row (dpr:1410-1424).
    const cell = 0x14c * SCREEN_W + letterIdx * 20;
    for (let i = 0; i <= 3; i += 1) {
      if (i < 3) {
        s.drawSprite(SPRITE.LETTER_BACK1 + i, cell, 16);
      } else {
        s.fillRect(cell, 18, 19, 7);
      }
      let k = 0;
      for (let j = 1; j <= 10; j += 1) {
        k = this.m.audio.pwm(this.audioBuf, k, i * 0x64 + j * 10 + 0x32, 1);
        k = this.m.audio.pwm(this.audioBuf, k, 0, Math.floor(j / 5) + (i << 2));
      }
      await this.m.audio.playWav(this.audioBuf.subarray(0, k));
    }
    await this.yakubovichSetSilent();

    // Count matches and assistant stop positions (dpr:1427-1437).
    const assistPos: number[] = new Array(20).fill(0);
    assistPos[0] = 0x19 * SCREEN_W + 639;
    let k = 0;
    for (let j = this.guessedWord.length - 1; j >= 0; j -= 1) {
      if (this.guessedWord[j] === letterByte) {
        k += 1;
        assistPos[k] = this.wordPos + (j << 4);
        this.opened[j] = true;
      }
    }
    this.remaindLetters -= k;
    this.syncDebug();

    if (k === 0) {
      await this.yakubovichTalk('Нет такой буквы!', 'Переход хода..');
      return false;
    }

    if (n === 0) {
      await this.yakubovichTalk('Есть такая буква!', 'Браво!!');
      await this.waitKey(2000);
    }
    s.screenCopy(SCREEN_W, 120, BACKBUF, 0);
    let j2 = 0;
    for (let i = 20; i <= 0x64; i += 1) {
      j2 = this.m.audio.pwm(this.audioBuf, j2, i, 1);
      j2 = this.m.audio.pwm(this.audioBuf, j2, 0, Math.floor((100 - i) / 5));
    }
    await this.m.audio.playWav(this.audioBuf.subarray(0, j2));
    await this.yakubovichSetSilent();

    // Assistant walk (dpr:1456-1480).
    const stepDelta = [3, 10, 0, 12];
    const stepSprite = [SPRITE.ASSIST_MOVE1, SPRITE.ASSIST_MOVE3, SPRITE.ASSIST_MOVE2, SPRITE.ASSIST_MOVE3];
    let i3 = 0;
    let walk = 0x19 * SCREEN_W + 0x28;
    do {
      if (walk >= assistPos[k]) {
        s.drawSprite(SPRITE.ASSIST_STAY, walk, 2);
        await this.waitKey(500);
        const f = BACKBUF + assistPos[k] + 11 * SCREEN_W;
        k -= 1;
        s.fillRect(f, 19, 15, 7);
        s.print(letterChar, f + 4 + 2 * SCREEN_W, 0, 14, 8);
        s.screenCopy(15, 19, f - BACKBUF, f);
        s.drawSprite(SPRITE.ASSIST_STAY, walk, 2);
        await this.waitKey(150);
      } else {
        i3 = (i3 + 1) & 3;
        walk += stepDelta[i3];
        s.drawSprite(stepSprite[i3], walk, 2);
        await this.m.audio.sound(this.random(100) + 1000, 7);
      }
      await this.delay(50);
      s.screenCopy(48, 90, walk, BACKBUF + walk);
    } while (walk < 0x19 * SCREEN_W + 0x246);

    let k2 = 0;
    for (let i = 0x64; i >= 20; i -= 1) {
      k2 = this.m.audio.pwm(this.audioBuf, k2, i, Math.floor((0x64 - i) / 10));
      k2 = this.m.audio.pwm(this.audioBuf, k2, 0, 1);
    }
    await this.m.audio.playWav(this.audioBuf.subarray(0, k2));

    seat.score = size;
    await this.updateMoney(this.curPlayer);
    this.syncDebug();
    return true;
  }

  /** dpr:1300-1359 — the ПРИЗ sector ceremony (human only under DOS policy). */
  private async prizeCeremony(): Promise<void> {
    this.setScene('prize');
    const s = this.screen;
    const seat = this.seats[this.curPlayer];
    const layout = SEATS[this.curPlayer];

    s.screenCopy(SCREEN_W, 350, BACKBUF, 0);
    s.fillRect(0, 350, SCREEN_W, 7);
    s.drawSprite(SPRITE.LOGO_POLE, 10 + 10 * SCREEN_W, 7);
    s.drawSprite(SPRITE.LOGO_CHUDES, 0xc8 + 10 * SCREEN_W, 7);
    s.drawSprite(SPRITE.YAKUBOVICH_BASE, 0x1e0 + 0xac * SCREEN_W, 7);
    s.drawSprite(SPRITE.YAKUBOVICH_PASSIVE, 0x1ff + 0xad * SCREEN_W, 16);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, 0x214 + 0xd1 * SCREEN_W, 16);
    if (seat.spriteId !== null) {
      s.drawSprite(seat.spriteId, layout.spriteOfs, 2);
    }

    let i = 3;
    let j = 100;
    for (;;) {
      await this.yakubovichTalk('ПРИЗ или', `${MONEY_VALUES[i]} рублей?`);
      const takeMoney = (await this.playerDecision('Беру    Беру', 'ПРИЗ   ДЕНЬГИ', 'Приз!', 'Деньги.')) > 0;
      if (takeMoney) {
        await this.yakubovichTalk('Забирайте', 'свои ДЕНЬГИ!');
        do {
          await this.m.audio.sound(this.random(50), 10);
          s.drawSprite(SPRITE.RUB, this.random(295) * SCREEN_W + this.random(400), 2);
          j -= 100;
        } while (j > 0);
        break;
      }
      // DOS: deviation #7 — Yakubovich always bargains up to МИЛЛИОН (i = 0).
      if (i === 0) {
        await this.yakubovichTalk('Забирайте', 'свой ПРИЗ!');
        s.print('Вы выбрали ПРИЗ и мы Вас поздравляем!', 208 * SCREEN_W + 92, 0, 14, 8);
        s.print('Фирма ИНТЕРМОДА и ПОЛЕ ЧУДЕС дарит Вам', 226 * SCREEN_W + 88, 0, 14, 8);
        const prize = `${PRIZES[this.random(10)]} компании PROCTER & GAMBLE!`;
        s.print(prize, 244 * SCREEN_W + 240 - (this.len(prize) << 2), 0, 14, 8);
        s.print('За ПРИЗОМ обращайтесь по адресу:', 262 * SCREEN_W + 112, 0, 14, 8);
        s.print('101000-Ц, Москва, проезд Серова, 11', 280 * SCREEN_W + 100, 0, 14, 8);
        s.print('На конверте сделайте пометку КОМПЬЮТЕРНЫЙ ПРИЗ', 298 * SCREEN_W + 56, 0, 14, 8);
        s.print('Автор Дима Башуров из Российского Федерального Ядерного Центра', 0x14c * SCREEN_W + 72, 0, 8, 8);
        s.print('Телефон в Арзамасе-16 : (831-30) 5-92-73   E-mail: 0669 @ RFNC. NNOV. SU', 0x155 * SCREEN_W + 32, 0, 8, 8);
        break;
      }
      j *= 10;
      i -= 1;
    }
    await this.waitKey(INFINITE);
    s.screenCopy(SCREEN_W, 350, 0, BACKBUF);
    this.removePlayer();
  }

  /**
   * One player's turn (dpr:1120-1500). Returns:
   * 'again' — same player continues; 'next' — pass the turn;
   * 'won' — round solved by the current player.
   */
  private async takeTurn(): Promise<'again' | 'next' | 'won'> {
    this.setScene('turn');
    const seat = this.seats[this.curPlayer];
    const layout = SEATS[this.curPlayer];
    const human = this.isHuman(this.curPlayer);

    // DOS: box game after 3 successful MOVES, human seats only (deviations #4, #5).
    if (this.movesForBox > 2 && human) {
      await this.boxGame();
    }

    await this.yakubovichTalk(layout.caption, 'Вращайте барабан!');
    if (human && (await this.playerDecision('Скажу   Кручу', 'СЛОВО  БАРАБАН', 'Слово!', 'Поехали!')) === 0) {
      const result = await this.tellWord();
      return result === 'won' ? 'won' : 'next';
    }

    await this.yakubovichSetSilent();
    await this.spinWheel();

    const r = this.curSector >> 1;
    let size = seat.score;

    switch (r) {
      case 14: {
        // БАНКРОТ (dpr:1251-1256)
        await this.yakubovichTalk('Все деньги сгорели!', 'Увы! Переход хода..');
        seat.score = 0;
        await this.updateMoney(this.curPlayer);
        return 'next';
      }
      case 4:
      case 10: {
        // Ноль (dpr:1258-1261)
        await this.yakubovichTalk('У вас 0 очков!', 'Увы! Переход хода..');
        return 'next';
      }
      case 12: {
        // ПЛЮС (dpr:1263-1292)
        await this.yakubovichTalk('Сектор ПЛЮС!', 'Открой любую букву!');
        const n = await this.pickPlusPosition();
        const letterIdx = this.guessedWord[n - 1] - 0x80;
        const found = await this.openLetter(letterIdx, n, size);
        if (found) {
          if (human) {
            this.movesForBox += 1;
          }
          return 'again';
        }
        return 'next';
      }
      case 0:
      case 2: {
        // x2 / x4 (dpr:1294-1298)
        await this.yakubovichTalk('Деньги удваиваются!', 'Назовите букву!');
        size = seat.score << ((r >> 1) + 1);
        break;
      }
      case 6: {
        // ПРИЗ (dpr:1300-1360)
        await this.yakubovichTalk('Сектор ПРИЗ!', 'ПРИЗ или играем?');
        // DOS: deviation #5 — NPCs never take the prize (decision forced to
        // 'Играем!' but the full save/setSilent/bubble tail still runs).
        const play = (await this.playerDecision('Беру   Буду', 'ПРИЗ  ИГРАТЬ', 'Приз!', 'Играем!', human ? undefined : 1)) > 0;
        if (play) {
          await this.yakubovichTalk('Если так, то', 'назовите букву.');
          break;
        }
        await this.prizeCeremony();
        return 'next';
      }
      default: {
        // Value sector (dpr:1361-1365)
        size = seat.score + SECTOR_VALUES[r];
        await this.yakubovichTalk(`У вас ${SECTOR_VALUES[r]} очков!`, 'Назовите букву!');
        break;
      }
    }

    const letterIdx = await this.pickLetter();
    const found = await this.openLetter(letterIdx, 0, size);
    if (found) {
      if (human) {
        this.movesForBox += 1;
      }
      return 'again';
    }
    return 'next';
  }

  /**
   * dpr:1501-1514. Returns false when every seat is removed (→ adware path).
   */
  private async nextPlayer(): Promise<boolean> {
    await this.waitKey(2000);
    await this.yakubovichSetSilent();
    this.movesForBox = 0;
    const start = this.curPlayer;
    for (;;) {
      this.curPlayer = (this.curPlayer + 1) % 3;
      if (this.seats[this.curPlayer].spriteId !== null) {
        return true;
      }
      if (this.curPlayer === start) {
        return false;
      }
    }
  }

  /** dpr:1521-1554 */
  private async adware(): Promise<void> {
    if (this.stage >= 7) {
      return;
    }
    this.setScene('adware');
    const s = this.screen;
    await this.yakubovichSetSilent();
    await this.yakubovichTalk('РЕКЛАМНАЯ', 'ПАУЗА!');
    await this.waitKey(INFINITE);
    await this.yakubovichSetSilent();

    s.screenCopy(168, 170, BACKBUF + 0x1afd8, 0x1afd8);
    s.drawSprite(SPRITE.ADWARE_BACKGROUND, BACKBUF + 0x1b261, 16);
    s.print('Компьютерная игра', BACKBUF + 0x1b4e9, 14, 8, 8);
    s.print('продается по адресу', BACKBUF + 0x26de1, 14, 8, 8);
    s.print('101000-Ц, МОСКВА,', BACKBUF + 0x281e9, 14, 8, 8);
    s.print('проезд Серова, 11.', BACKBUF + 0x295e5, 14, 8, 8);
    s.print('25 самых первых', BACKBUF + 0x2a9f1, 14, 8, 8);
    s.print('покупателей будут', BACKBUF + 0x2bde9, 14, 8, 8);
    s.print('приглашены со', BACKBUF + 0x2d1f9, 14, 8, 8);
    s.print('своими семьями', BACKBUF + 0x2e5f5, 14, 8, 8);
    s.print('на съемки телеигры', BACKBUF + 0x2f9e5, 14, 8, 8);
    s.print('ПОЛЕ ЧУДЕС!', BACKBUF + 0x31301, 14, 8, 8);

    let j = 0x33d58;
    let k = 120;
    for (let i = 79; i >= 0; i -= 1) {
      s.screenCopy(168, 160 - i - i, j, BACKBUF + 0x1b258);
      await this.m.audio.sound(k, 10);
      j -= 1280;
      k += 20;
      await this.delay(i >> 1);
    }
    await this.waitKey(INFINITE);
    s.drawSprite(SPRITE.YAKUBOVICH_BASE, 0xac * SCREEN_W + 0x1e0, 7);
    s.drawSprite(SPRITE.YAKUBOVICH_PASSIVE, 0xad * SCREEN_W + 0x1ff, 16);
    s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, 0xd1 * SCREEN_W + 0x214, 16);
  }

  /** dpr:1558-1646 */
  private async endgame(): Promise<void> {
    const s = this.screen;
    const seat = this.seats[this.curPlayer];
    const name = decodeCp866(seat.nameBytes);

    if (this.winner < 3) {
      this.setScene('endgame');
      s.fillRect(0, 350, SCREEN_W, 7);
      s.drawSprite(SPRITE.LOGO_POLE, 10 * SCREEN_W + 10, 7);
      s.drawSprite(SPRITE.LOGO_CHUDES, 10 * SCREEN_W + 0xc8, 7);
      s.drawSprite(SPRITE.YAKUBOVICH_BASE, 0xac * SCREEN_W + 0x1e0, 7);
      s.drawSprite(SPRITE.YAKUBOVICH_PASSIVE, 0xad * SCREEN_W + 0x1ff, 16);
      s.drawSprite(SPRITE.YAKUBOVICH_EYES_OPEN, 0xd1 * SCREEN_W + 0x214, 16);

      const line1 = `Товарищ ${name}!`;
      s.print(line1, 0xbe * SCREEN_W + 0xf0 - (this.len(line1) << 2), 0, 14, 8);
      const line2 = `Вы выиграли в ФИНАЛЕ и набрали ${seat.score} очков!`;
      s.print(line2, (0xbe + 0x12) * SCREEN_W + 0xf0 - (this.len(line2) << 2), 0, 14, 8);
      s.print('Торговый дом ТУСАР и ПОЛЕ ЧУДЕС дарит Вам', 0x2354c, 0, 14, 8);
      const prize = `${PRIZES[this.random(PRIZES.length)]} компании PROCTER & GAMBLE!`;
      s.print(prize, (0xbe + 0x12 + 0x12 + 0x12) * SCREEN_W + 0xf0 - (this.len(prize) << 2), 0, 14, 8);
      s.print('За ПРИЗОМ обращайтесь по адресу:', 0x28f70, 0, 14, 8);
      s.print('101000-Ц, Москва, проезд Серова, 11', 0x2bc64, 0, 14, 8);
      s.print('На конверте сделайте пометку КОМПЬЮТЕРНЫЙ ПРИЗ', 0x2e938, 0, 14, 8);
      s.print('Автор Дима Башуров из Российского Федерального Ядерного Центра', 0x33e48, 0, 8, 8);
      s.print('Телефон в Арзамасе-16 : (831-30) 5-92-73   E-mail: 0669 @ RFNC. NNOV. SU', 0x354a0, 0, 8, 8);
      await this.yakubovichTalk('Поздравляю! Вы', 'выиграли финал!');
      await this.waitKey(INFINITE);
      await this.yakubovichSetSilent();
    }

    // Top-8 update — session-only (the original rewrote POLE.PIC, dpr:1591-1609).
    this.setScene('top-players');
    const top = this.ctx.topPlayers;
    let inserted = 8;
    for (let i = 0; i < 8; i += 1) {
      if ((top[i]?.score ?? 0) < seat.score) {
        top.splice(i, 0, { name: decodeCp866(seat.nameBytes.subarray(0, 10)), score: seat.score & 0xffff });
        top.length = Math.min(top.length, 8);
        inserted = i;
        break;
      }
    }

    s.fillRect(0xb25c * 8, 0xa0, 160, 0);
    s.print('8 лучших игроков,', BACKBUF + 0xaa * SCREEN_W + 0x1e9, 15, 14, 8);
    s.print('8 лучших игроков,', BACKBUF + 0xaa * SCREEN_W + 0x1e8, 15, 14, 8);
    s.print('выигравших ФИНАЛ!', BACKBUF + 0xb8 * SCREEN_W + 0x1e8, 15, 14, 8);
    s.print('выигравших ФИНАЛ!', BACKBUF + 0xb8 * SCREEN_W + 0x1e8, 15, 14, 8);
    let j = BACKBUF + 0x20a80;
    for (let i = 0; i < 8; i += 1) {
      const entry = top[i] ?? { name: '', score: 0 };
      const rank = `${i} ${entry.name}`; // 0-based ranks, as in the original (dpr:1623)
      s.print(rank, j + 0x1e1, 8, 14, 8);
      s.print(rank, j + 0x1e0, 8, 14, 8);
      const scoreText = `${entry.score}$`;
      const color = (i === inserted ? 2 : 0) + 3;
      s.print(scoreText, j + 0x24f, color, 14, 8);
      s.print(scoreText, j + 0x24e, color, 14, 8);
      j += 14 * SCREEN_W;
    }
    j = 0x32960;
    let k = 20;
    for (let i = 79; i >= 0; i -= 1) {
      await this.m.audio.sound(k, 10);
      s.screenCopy(152, 160 - i - i, j, BACKBUF + 0x19e60);
      j -= 1280;
      k += 20;
      await this.delay(i);
    }
    await this.waitKey(INFINITE);
    this.setScene('done');
  }

  // ------------------------------------------------------------------- run

  async run(): Promise<void> {
    await this.splash();
    this.drawStaticBackground();

    this.charId = 0;
    this.curSector = 0;
    this.winner = 3;
    this.stage = 0;

    // Stage loop (dpr:989-1556).
    do {
      await this.stageSetup();
      await this.presentation();
      await this.selectWord();

      this.curPlayer = 0;
      this.movesForBox = 0;
      let roundWon = false;
      let allRemoved = false;

      // Turn loop (dpr:1120-1515).
      while (this.remaindLetters > 0) {
        const outcome = await this.takeTurn();
        if (outcome === 'won') {
          roundWon = true;
          break;
        }
        if (outcome === 'next') {
          if (!(await this.nextPlayer())) {
            allRemoved = true;
            break;
          }
        }
        this.syncDebug();
      }

      if (!allRemoved) {
        this.setScene('round-end');
        if (!roundWon) {
          // Word completed letter-by-letter: current player wins (dpr:1515-1518).
        }
        await this.yakubovichTalk(PLAYER_ROUND_NAMES[this.curPlayer], 'выиграл раунд!');
        await this.waitKey(1000);
        this.winner = this.curPlayer;
      }

      await this.adware();
      this.stage += 1;
    } while (this.stage <= 7);

    await this.endgame();
  }
}

/** Run one full game (splash → finale). Rejects on abort. */
export async function runGame(ctx: GameContext): Promise<void> {
  await new Game(ctx).run();
}
