import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(webDir, '..');
const outputDir = path.resolve(repoDir, 'output', 'playwright');
const serverLogPath = path.join(outputDir, 'smoke-harness-server.log');
const reportPath = path.join(outputDir, 'smoke-harness-report.json');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.POLE_SMOKE_PORT ?? '4173', 10);
const baseUrl = `http://${host}:${port}`;
const headed = process.argv.includes('--headed');

/** Speed factor passed as ?fast= — every in-game delay is divided by this. */
const FAST = 25;
/** Main state-machine poll cadence (real ms). */
const POLL_MS = 150;
/** Overall budget for driving splash → name entry → spin → letter → solve. */
const DRIVE_TIMEOUT_MS = 120_000;
/** Name typed at the first presentation prompt — makes seat index 1 human. */
const HUMAN_NAME = 'ТЕСТ';

let reportWritten = false;

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function startDevServer() {
  const stdout = [];
  const stderr = [];
  const child = spawn(npmCommand(), ['run', 'dev', '--', '--host', host, '--port', String(port), '--strictPort'], {
    cwd: webDir,
    env: {
      ...process.env,
      BROWSER: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    stdout.push(String(chunk));
  });
  child.stderr.on('data', (chunk) => {
    stderr.push(String(chunk));
  });

  return {
    child,
    stdout,
    stderr,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await delay(500);
      }
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      await writeFile(serverLogPath, `${stdout.join('')}\n${stderr.join('')}`.trimStart(), 'utf8');
    },
  };
}

async function waitForServer(server, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`Vite dev server exited early with code ${server.child.exitCode}`);
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the timeout expires.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for dev server at ${baseUrl}`);
}

// ------------------------------------------------------------ debug helpers

function getSnapshot(page) {
  return page.evaluate(() => window.__poleDebug?.getSnapshot?.() ?? null);
}

/**
 * DOS-style key tap: keydown latches the auto-reset event, the game's poll
 * loops (decision/letter cursors run every ~4 real ms at fast=25) consume it,
 * then keyup clears any leftover latch so stray presses cannot leak into a
 * later wait.
 */
async function pressKey(page, key, holdMs = 45) {
  await page.evaluate(
    async ({ key, holdMs }) => {
      const dbg = window.__poleDebug;
      if (!dbg) {
        return;
      }
      dbg.injectKey(key);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      dbg.injectKeyUp(key);
    },
    { key, holdMs },
  );
}

/** Type characters into the active text entry (name or word), then Enter. */
async function typeTextAndEnter(page, text, backspaces = 0) {
  await page.evaluate(
    async ({ text, backspaces }) => {
      const dbg = window.__poleDebug;
      if (!dbg) {
        return;
      }
      const tap = async (key) => {
        dbg.injectKey(key);
        dbg.injectKeyUp(key);
        await new Promise((resolve) => setTimeout(resolve, 8));
      };
      for (let i = 0; i < backspaces; i += 1) {
        await tap('Backspace');
      }
      for (const ch of text) {
        await tap(ch);
      }
      dbg.injectKey('Enter');
      await new Promise((resolve) => setTimeout(resolve, 30));
      dbg.injectKeyUp('Enter');
    },
    { text, backspaces },
  );
}

/** Poll snapshots until the predicate holds; resolves null on timeout. */
async function waitForState(page, predicate, timeoutMs, pollMs = 80) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await getSnapshot(page);
    if (snap && predicate(snap)) {
      return snap;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await delay(pollMs);
  }
}

/** Alphabet row index → the А..Я character usedLetters reports. */
function alphabetLetter(index) {
  return String.fromCharCode(0x0410 + index);
}

// --------------------------------------------------------- the state machine

/**
 * Drives one round end-to-end via window.__poleDebug snapshots:
 *   splash → stage-setup → presentation (name entry: seat 2 = ТЕСТ, seat 3 =
 *   NPC) → word-select → human turns: decision (Space@ofs4 = spin) →
 *   letter-pick (Space on an unused letter, ArrowRight past buzzes) → once a
 *   spin AND a letter are evidenced, the next primary decision goes
 *   ArrowLeft+Space ('Скажу слово') → word-solve text entry (type the word,
 *   Enter) → round-end. Everything else (pauses, NPC turns, adware, box/prize
 *   ceremonies) is skipped with generic Space taps.
 */
async function driveGame(page) {
  const startedAt = Date.now();
  const evidence = {
    splashSeen: false,
    splashExited: false,
    humanSpinSeen: false,
    humanLetterPicked: false,
    wordSolveSeen: false,
    roundWon: false,
  };
  const counters = {
    polls: 0,
    genericSpacePresses: 0,
    namePrompts: 0,
    decisionsHandled: 0,
    primaryDecisions: 0,
    solveAttempts: 0,
    letterPickActions: 0,
  };
  const sceneLog = [];

  let prevScene = null;
  let prevTextEntry = false;
  let humanSeatIndex = -1;
  let presentationPrompts = 0;
  let sectorAtLastDecision = -1;
  let spinWatchSector = null;
  let letterBaseline = null;
  let solveStage = -1;
  let solvedWord = null;
  let lastEntryActionAt = 0;

  const deadline = startedAt + DRIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    counters.polls += 1;
    const snap = await getSnapshot(page);
    if (!snap || !snap.game) {
      await delay(POLL_MS);
      continue;
    }
    const g = snap.game;

    if (g.scene !== prevScene) {
      sceneLog.push({ tMs: Date.now() - startedAt, scene: g.scene, stage: g.stage });
      if (g.scene === 'presentation') {
        // New presentation: prompts restart (seat order 2 then 3, winner skipped).
        presentationPrompts = 0;
      }
      prevScene = g.scene;
    }

    if (g.scene === 'splash') {
      evidence.splashSeen = true;
    }
    if (evidence.splashSeen && g.scene !== 'splash' && !evidence.splashExited) {
      evidence.splashExited = true;
      await page.screenshot({ path: path.join(outputDir, 'smoke-harness-initial.png') });
    }

    const foundHuman = g.seats.findIndex((seat) => seat.isHuman && !seat.removed);
    if (foundHuman >= 0) {
      humanSeatIndex = foundHuman;
    }
    const humanTurn =
      humanSeatIndex >= 0 && g.currentPlayer === humanSeatIndex && g.seats[humanSeatIndex]?.isHuman === true;

    // (3) human spin: sector moved after our spin choice, or a human pick scene.
    if (spinWatchSector !== null && humanTurn && g.currentSector !== spinWatchSector) {
      evidence.humanSpinSeen = true;
      spinWatchSector = null;
    }
    if (humanTurn && (g.scene === 'letter-pick' || g.scene === 'letter-open')) {
      evidence.humanSpinSeen = true;
    }

    // (4) human letter: usedLetters grew past the baseline taken at pick start.
    if (!evidence.humanLetterPicked && letterBaseline !== null && humanTurn && g.usedLetters.length > letterBaseline) {
      evidence.humanLetterPicked = true;
      await page.screenshot({ path: path.join(outputDir, 'smoke-harness-after-letter.png') });
    }

    // (5) word-solve seen and the round won afterwards.
    if (evidence.wordSolveSeen && !evidence.roundWon) {
      const seat = g.seats[humanSeatIndex];
      if (seat && seat.removed) {
        throw new Error(
          `Word solve was rejected (human seat removed). Typed "${solvedWord}" for word "${g.word}" at stage ${solveStage}.`,
        );
      }
      if (
        g.winner === humanSeatIndex ||
        g.scene === 'round-end' ||
        g.scene === 'adware' ||
        (g.scene === 'stage-setup' && g.stage > solveStage)
      ) {
        evidence.roundWon = true;
        await page.screenshot({ path: path.join(outputDir, 'smoke-harness-after-solve.png') });
      }
    }

    if (Object.values(evidence).every(Boolean)) {
      break;
    }

    // ---- text entry (name entry during presentation, word during word-solve)
    if (snap.textEntryActive) {
      const rising = !prevTextEntry;
      prevTextEntry = true;
      const stalled = Date.now() - lastEntryActionAt > 2500;
      if (g.scene === 'presentation') {
        if (rising) {
          const text = presentationPrompts === 0 ? HUMAN_NAME : '';
          presentationPrompts += 1;
          counters.namePrompts += 1;
          lastEntryActionAt = Date.now();
          await typeTextAndEnter(page, text);
        } else if (stalled) {
          lastEntryActionAt = Date.now();
          await typeTextAndEnter(page, '');
        }
      } else if (g.scene === 'word-solve') {
        if (rising) {
          solvedWord = g.word;
          solveStage = g.stage;
          evidence.wordSolveSeen = true;
          counters.solveAttempts += 1;
          lastEntryActionAt = Date.now();
          await typeTextAndEnter(page, g.word);
        } else if (stalled) {
          counters.solveAttempts += 1;
          lastEntryActionAt = Date.now();
          await typeTextAndEnter(page, g.word, g.word.length + 2);
        }
      }
      await delay(POLL_MS);
      continue;
    }
    prevTextEntry = false;

    // ---- human letter pick (alphabet row step=20, ПЛЮС positions step=16)
    if (g.scene === 'letter-pick' && humanTurn) {
      const hand = snap.hand;
      if (hand && (hand.step === 20 || hand.step === 16)) {
        if (letterBaseline === null) {
          letterBaseline = g.usedLetters.length;
        }
        let letter = null;
        if (hand.step === 20) {
          letter = alphabetLetter(Math.round((hand.ofs - hand.min) / 20));
        } else {
          const n = (hand.ofs - hand.min + 16) >> 4;
          letter = g.word[n - 1] ?? null;
        }
        counters.letterPickActions += 1;
        if (letter !== null && g.usedLetters.includes(letter)) {
          // Would buzz: step the hand to the next cell instead.
          await pressKey(page, hand.ofs >= hand.max ? 'ArrowLeft' : 'ArrowRight', 10);
        } else {
          const base = letterBaseline;
          await pressKey(page, ' ');
          await waitForState(
            page,
            (s) => s.game?.scene !== 'letter-pick' || (s.game?.usedLetters.length ?? 0) > base,
            2500,
          );
        }
      }
      // Never generic-press while the human pick cursor is live.
      await delay(POLL_MS);
      continue;
    }

    // ---- live human decision (hand min=0 max=4 step=4, ofs 4/0 until chosen)
    const hand = snap.hand;
    const liveDecision =
      hand !== null &&
      hand.step === 4 &&
      hand.max === 4 &&
      hand.min === 0 &&
      hand.ofs !== 2 &&
      humanTurn &&
      (g.scene === 'turn' || g.scene === 'box-game' || g.scene === 'prize');

    if (liveDecision) {
      counters.decisionsHandled += 1;
      const sectorNow = g.currentSector;
      // The ПРИЗ follow-up decision runs in scene 'turn' right after a spin
      // landed on sector 12/13; the spin always moves the sector, so a changed
      // prize sector means "Беру ПРИЗ / Буду ИГРАТЬ", not "Слово / Барабан".
      const looksLikePrizeDecision = sectorNow >> 1 === 6 && sectorNow !== sectorAtLastDecision;
      const isPrimary = g.scene === 'turn' && !looksLikePrizeDecision;
      let wantSolve = false;
      if (isPrimary) {
        counters.primaryDecisions += 1;
        wantSolve = evidence.humanSpinSeen && evidence.humanLetterPicked && counters.primaryDecisions >= 3;
      }
      sectorAtLastDecision = sectorNow;

      if (wantSolve) {
        // 'Скажу слово': ArrowLeft moves the hand 4 → 0, Space confirms.
        if (hand.ofs === 4) {
          await pressKey(page, 'ArrowLeft', 10);
        }
        const ready = await waitForState(page, (s) => s.hand?.ofs === 0 || s.hand?.ofs === 2, 1500);
        if (ready?.hand?.ofs === 0) {
          await pressKey(page, ' ');
          // Either word-solve engages (textEntry in scene word-solve) or the
          // decision resolved some other way — the main loop retries then.
          await waitForState(
            page,
            (s) => (s.textEntryActive && s.game?.scene === 'word-solve') || s.hand?.ofs === 2,
            4000,
          );
        }
      } else {
        // Right-hand option: spin the wheel / play on ПРИЗ / right box / money.
        if (hand.ofs === 0) {
          await pressKey(page, 'ArrowRight', 10);
        }
        if (isPrimary) {
          spinWatchSector = sectorNow;
        }
        await pressKey(page, ' ');
        await waitForState(page, (s) => s.hand?.ofs === 2 || s.game?.scene !== g.scene || s.textEntryActive, 3000);
      }
      await delay(POLL_MS);
      continue;
    }

    // ---- generic driver: Space skips every timed/INFINITE pause. Suppressed
    // during a human 'turn' so a stray latch cannot pre-empt the decision.
    if (!(g.scene === 'turn' && humanTurn)) {
      counters.genericSpacePresses += 1;
      await pressKey(page, ' ');
    }
    await delay(POLL_MS);
  }

  return {
    evidence,
    counters,
    sceneLog,
    humanSeatIndex,
    solvedWord,
    solveStage,
    durationMs: Date.now() - startedAt,
  };
}

// -------------------------------------------------------------------- main

async function captureSmokeFlow() {
  await mkdir(outputDir, { recursive: true });

  const server = startDevServer();
  const consoleErrors = [];
  let browser;

  try {
    await waitForServer(server);

    browser = await chromium.launch({ headless: !headed });
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1200 },
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure();
      consoleErrors.push(`requestfailed: ${request.url()} ${failure?.errorText ?? ''}`.trim());
    });

    await page.goto(`${baseUrl}/?fast=${FAST}`, { waitUntil: 'domcontentloaded' });

    const initial = await waitForState(
      page,
      (s) => s.assetsReady && s.activeTab === 'play' && s.game !== null,
      30000,
      150,
    );
    if (!initial) {
      throw new Error('Timed out waiting for assets to load and the game loop to start');
    }

    const drive = await driveGame(page);
    const finalSnapshot = await getSnapshot(page);

    const assertions = [
      {
        name: 'assets-ready-on-play-tab',
        pass: Boolean(initial.assetsReady && initial.activeTab === 'play'),
      },
      {
        name: 'splash-reached-then-left',
        pass: drive.evidence.splashSeen && drive.evidence.splashExited,
      },
      {
        name: 'human-spin-occurred',
        pass: drive.evidence.humanSpinSeen,
      },
      {
        name: 'human-letter-selected',
        pass: drive.evidence.humanLetterPicked,
      },
      {
        name: 'word-solve-entered-and-round-won',
        pass: drive.evidence.wordSolveSeen && drive.evidence.roundWon,
      },
      {
        name: 'no-console-page-or-request-errors',
        pass: consoleErrors.length === 0,
      },
    ];

    const report = {
      baseUrl: `${baseUrl}/?fast=${FAST}`,
      fast: FAST,
      durationMs: drive.durationMs,
      assertions,
      evidence: drive.evidence,
      counters: drive.counters,
      humanSeatIndex: drive.humanSeatIndex,
      solvedWord: drive.solvedWord,
      solveStage: drive.solveStage,
      sceneLog: drive.sceneLog,
      finalSnapshot,
      consoleErrors,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    reportWritten = true;

    const failed = assertions.filter((assertion) => !assertion.pass);
    if (failed.length > 0) {
      throw new Error(
        `Smoke assertions failed: ${failed.map((assertion) => assertion.name).join(', ')}` +
          (consoleErrors.length > 0 ? `\n${consoleErrors.join('\n')}` : ''),
      );
    }

    console.log(`Smoke OK in ${(drive.durationMs / 1000).toFixed(1)}s — all ${assertions.length} assertions passed.`);
    for (const assertion of assertions) {
      console.log(`  PASS ${assertion.name}`);
    }
    console.log(`Report: ${reportPath}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    await server.stop();
  }
}

captureSmokeFlow().catch(async (error) => {
  const summary = {
    baseUrl: `${baseUrl}/?fast=${FAST}`,
    error: error instanceof Error ? error.message : String(error),
  };
  await mkdir(outputDir, { recursive: true });
  if (!reportWritten) {
    await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  console.error(summary.error);
  process.exitCode = 1;
});
