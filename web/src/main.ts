import './style.css';
import { fntFromPlanes, type FntJson, type PoleFonts } from './assets/fnt';
import { libFromSprites, type LibJson, type PoleLib, type SpritePixels } from './assets/lib';
import { ovlFromJson, parseOvl, serializeOvl, type OvlFile, type OvlJson, type OvlQuestion } from './assets/ovl';
import { picFromJson, type PicJson, type TopPlayerRecord } from './assets/pic';
import { cp866Length, decodeCp866 } from './encoding/cp866';
import { PwmAudio, WebAudioOutput } from './engine/audio';
import { GameInput } from './engine/input';
import { BorlandRng } from './engine/rng';
import { CanvasPresenter, Screen } from './engine/screen';
import { RealClock } from './engine/timing';
import type { Machine } from './engine/types';
import { fontPlaneFromRgba, rgbaToIndexed, type RgbaImage } from './assets/spriteImage';
import { createDebugState, runGame, type GameDebugState } from './game/script';
import { defaultFlowSpec, defaultRenderSpec } from './spec';

const MAX_EDIT_ROWS = defaultFlowSpec.questionEditor.maxVisibleRows;

interface PoleDebugSnapshot {
  activeTab: 'play' | 'admin';
  assetsReady: boolean;
  soundEnabled: boolean;
  questionCount: number;
  /** True while the game is collecting typed text (name or word entry). */
  textEntryActive: boolean;
  /** Live hand-cursor state during decision/letter scenes. */
  hand: { ofs: number; min: number; max: number; step: number } | null;
  game: GameDebugState | null;
}

interface PoleDebugApi {
  getSnapshot(): PoleDebugSnapshot;
  /** Synthetic input for the smoke harness (bypasses the DOM guards). */
  injectKey(key: string, mods?: { alt?: boolean; ctrl?: boolean }): void;
  injectKeyUp(key: string): void;
  injectClick(): void;
}

declare global {
  interface Window {
    __poleDebug?: PoleDebugApi;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root element');
}

app.innerHTML = `
  <main class="studio">
    <header class="masthead">
      <h1 class="wordmark" aria-label="Поле Чудес 2">ПОЛЕ&nbsp;ЧУДЕС&nbsp;<span class="wordmark-2">2</span></h1>
      <p class="tagline">КАПИТАЛ-ШОУ&nbsp;·&nbsp;DOS&nbsp;1993&nbsp;→&nbsp;TypeScript</p>
      <nav class="mode-tabs" role="tablist">
        <button id="tab-play" class="active" type="button" role="tab">Игра</button>
        <button id="tab-admin" type="button" role="tab">Настройки</button>
      </nav>
    </header>

    <section id="play-view" class="play-panel">
      <div class="crt-frame">
        <canvas id="screen" width="640" height="350" aria-label="Игровой экран"></canvas>
      </div>

      <div id="touch-controls" aria-label="Сенсорное управление">
        <button id="btn-left" type="button" class="key key-arrow" aria-label="Рука влево">◀</button>
        <button id="btn-space" type="button" class="key key-space">ПРОБЕЛ&nbsp;·&nbsp;ОК</button>
        <button id="btn-right" type="button" class="key key-arrow" aria-label="Рука вправо">▶</button>
        <button id="btn-enter" type="button" class="key key-enter">ВВОД</button>
      </div>

      <form id="entry-bar" autocomplete="off">
        <label for="entry-input" class="entry-label">Набор:</label>
        <input id="entry-input" type="text" autocapitalize="characters" autocorrect="off"
          spellcheck="false" enterkeyhint="done" lang="ru" placeholder="имя или слово…" />
        <button type="submit" class="key key-enter">ОК</button>
      </form>

      <div class="deck">
        <button id="restart-btn" type="button">Новая игра</button>
        <button id="sound-toggle" type="button">Звук: ВЫКЛ</button>
        <button id="fullscreen-btn" type="button">На весь экран</button>
      </div>

      <p class="hint keys-hint">ПРОБЕЛ / клик — подтвердить и пропустить паузы · ←/→ — рука ·
        ENTER — ввод имени/слова · буквы — набор текста · Ctrl+S — звук · TAB — выключить звук · ESC — новая игра</p>
      <pre id="game-status" class="statusline">Загрузка ресурсов...</pre>
    </section>

    <section id="admin-view" class="admin-view is-hidden">
      <section class="panel">
        <h2>Режим игры</h2>
        <div class="controls">
          <label class="radio-option"><input type="radio" name="player-mode" value="1" checked />
            1 игрок + 2 НПС</label>
          <label class="radio-option"><input type="radio" name="player-mode" value="2" />
            2 игрока (как в оригинале)</label>
        </div>
        <p class="hint">В режиме «2 игрока» имя запрашивается у обоих; пустое имя отдаёт место НПС,
          как в оригинале. Смена режима сразу начинает новую игру.</p>
      </section>

      <section class="panel">
        <h2>Ресурсы</h2>
        <div class="controls">
          <button id="load-default" type="button">Перезагрузить оригинальные файлы</button>
          <label class="file-label">Загрузить свой OVL <input id="ovl-input" type="file" accept=".OVL" /></label>
        </div>
        <pre id="asset-status">Not loaded.</pre>
      </section>

      <section class="panel">
        <h2>Редактор вопросов <small>(только на эту сессию)</small></h2>
        <div class="controls">
          <input id="search" type="search" placeholder="Фильтр по слову или теме" />
          <button id="add-question" type="button">Добавить вопрос</button>
          <button id="download-ovl" type="button" disabled>Скачать POLE.OVL</button>
          <label class="answers-toggle"><input id="answers-toggle" type="checkbox" />
            Показать и редактировать ответы</label>
        </div>
        <p class="hint">Показываются первые ${MAX_EDIT_ROWS} совпадений. Каждое поле — до 20 байт CP866.
          Ответы скрыты, чтобы не подсматривать; изменения действуют со следующего раунда.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Слово</th><th>Тема</th><th></th></tr>
            </thead>
            <tbody id="questions-body"></tbody>
          </table>
        </div>
      </section>
    </section>
  </main>
`;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>('#screen');
const tabPlayBtn = requireElement<HTMLButtonElement>('#tab-play');
const tabAdminBtn = requireElement<HTMLButtonElement>('#tab-admin');
const playView = requireElement<HTMLElement>('#play-view');
const adminView = requireElement<HTMLElement>('#admin-view');
const restartBtn = requireElement<HTMLButtonElement>('#restart-btn');
const soundToggleBtn = requireElement<HTMLButtonElement>('#sound-toggle');
const fullscreenBtn = requireElement<HTMLButtonElement>('#fullscreen-btn');
const gameStatus = requireElement<HTMLPreElement>('#game-status');
const loadDefaultBtn = requireElement<HTMLButtonElement>('#load-default');
const downloadOvlBtn = requireElement<HTMLButtonElement>('#download-ovl');
const addQuestionBtn = requireElement<HTMLButtonElement>('#add-question');
const ovlInput = requireElement<HTMLInputElement>('#ovl-input');
const searchInput = requireElement<HTMLInputElement>('#search');
const statusEl = requireElement<HTMLPreElement>('#asset-status');
const questionsBody = requireElement<HTMLTableSectionElement>('#questions-body');
const answersToggle = requireElement<HTMLInputElement>('#answers-toggle');
const btnLeft = requireElement<HTMLButtonElement>('#btn-left');
const btnRight = requireElement<HTMLButtonElement>('#btn-right');
const btnSpace = requireElement<HTMLButtonElement>('#btn-space');
const btnEnter = requireElement<HTMLButtonElement>('#btn-enter');
const entryBar = requireElement<HTMLFormElement>('#entry-bar');
const entryInput = requireElement<HTMLInputElement>('#entry-input');

// ------------------------------------------------------------ session state

/** Stable array instances: the running game holds references to these. */
const sessionQuestions: OvlQuestion[] = [];
const sessionTopPlayers: TopPlayerRecord[] = [];

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const speedFactor = Math.max(0.1, Number.parseFloat(params.get('fast') ?? '1') || 1);

let assetsReady = false;
let spriteLib: PoleLib | null = null;
let fontPlanes: PoleFonts | null = null;
let ovlHeaderValue = 0;

// One audio output for the whole session (its AudioContext unlocks on first gesture).
const audioOutput = new WebAudioOutput();
let soundEnabled: boolean = defaultRenderSpec.soundDefaultEnabled;

interface RunHandle {
  controller: AbortController;
  input: GameInput;
  audio: PwmAudio;
  state: GameDebugState;
}

let currentRun: RunHandle | null = null;
let runCounter = 0;
/** Game-mode setting (session-only): 1 = human + 2 NPCs (default), 2 = original prompts. */
let humanSeats: 1 | 2 = 1;

function setActiveTab(mode: 'play' | 'admin'): void {
  const playActive = mode === 'play';
  tabPlayBtn.classList.toggle('active', playActive);
  tabAdminBtn.classList.toggle('active', !playActive);
  playView.classList.toggle('is-hidden', !playActive);
  adminView.classList.toggle('is-hidden', playActive);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function updateSoundButton(): void {
  soundToggleBtn.textContent = `Звук: ${soundEnabled ? 'ВКЛ' : 'ВЫКЛ'}`;
}

function setSoundEnabled(value: boolean): void {
  soundEnabled = value;
  if (currentRun) {
    currentRun.audio.enabled = value;
  }
  if (value) {
    audioOutput.unlock().catch(() => {});
  }
  updateSoundButton();
}

// --------------------------------------------------------------- admin view

function summarizeState(): void {
  const lines = [
    `POLE2.LIB sprites: ${spriteLib ? spriteLib.spriteCount : 0}`,
    `POLE.FNT loaded: ${fontPlanes ? 'yes' : 'no'}`,
    `POLE.OVL header: ${ovlHeaderValue}`,
    `POLE.OVL question pairs: ${sessionQuestions.length}`,
    'POLE.PIC top players (session):',
    ...sessionTopPlayers.map((p, idx) => `${idx + 1}. ${p.name} - ${p.score}`),
  ];
  statusEl.textContent = lines.join('\n');
}

function makeInput(value: string, questionIndex: number, field: 'word' | 'theme'): string {
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return `<input data-question-index="${questionIndex}" data-field="${field}" value="${escaped}" />`;
}

function renderQuestions(): void {
  const filter = searchInput.value.trim().toUpperCase();
  const showAnswers = answersToggle.checked;
  const rows: string[] = [];

  for (let i = 0; i < sessionQuestions.length; i += 1) {
    const q = sessionQuestions[i];
    const haystack = `${q.word} ${q.theme}`.toUpperCase();
    if (filter.length > 0 && !haystack.includes(filter)) {
      continue;
    }
    const wordTooLong = cp866Length(q.word) > 20;
    const themeTooLong = cp866Length(q.theme) > 20;
    // Answers are hidden by default (spoiler safety); editing is opt-in.
    const wordCell = showAnswers
      ? makeInput(q.word, i, 'word')
      : `<span class="masked-word" title="Ответ скрыт">${'•'.repeat(Math.min(q.word.length, 20))}<small>${q.word.length}</small></span>`;
    rows.push(`
      <tr>
        <td>${i + 1}</td>
        <td class="${wordTooLong ? 'invalid' : ''}">${wordCell}</td>
        <td class="${themeTooLong ? 'invalid' : ''}">${makeInput(q.theme, i, 'theme')}</td>
        <td><button data-delete-index="${i}" type="button">✕</button></td>
      </tr>
    `);
    if (rows.length >= MAX_EDIT_ROWS) {
      break;
    }
  }

  questionsBody.innerHTML = rows.join('');
  downloadOvlBtn.disabled = sessionQuestions.length === 0;
}

function normalizeWord(input: string): string {
  return input.toUpperCase().replaceAll('Ё', 'Е').trim();
}

/**
 * Words must be pure А..Я (CP866 0x80..0x9F): the engine derives alphabet
 * indices as byte-0x80, and a word with any other character can never be
 * completed or solved (dpr:1027, 1276-1290, 1393-1396).
 */
function sanitizeGameWord(input: string): string {
  return normalizeWord(input).replace(/[^А-Я]/gu, '');
}

// ---------------------------------------------------------------- game loop

function abortCurrentRun(reason: string): void {
  currentRun?.controller.abort(new DOMException(reason, 'AbortError'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function gameLoop(): Promise<void> {
  for (;;) {
    while (sessionQuestions.length === 0) {
      gameStatus.textContent = 'Нет вопросов — загрузите POLE.OVL в админ-панели.';
      await sleep(500);
    }
    runCounter += 1;
    const controller = new AbortController();
    const { signal } = controller;

    const screen = new Screen();
    if (spriteLib) {
      screen.setSprites(spriteLib.sprites);
    }
    if (fontPlanes) {
      screen.setFonts(fontPlanes);
    }

    const clock = new RealClock(speedFactor, signal);
    const rng = new BorlandRng(Number.isNaN(seedParam) ? (Date.now() ^ (runCounter << 16)) >>> 0 : seedParam >>> 0);
    const input = new GameInput(screen, clock, signal);
    const audio = new PwmAudio(clock, rng, audioOutput);
    audio.enabled = soundEnabled;

    input.onEscape = () => {
      // WEB: the original Esc called ExitProcess (dpr:725); we restart to the splash.
      abortCurrentRun('escape-restart');
    };
    input.onBossKey = () => {
      setSoundEnabled(false);
    };
    input.onToggleSound = () => {
      setSoundEnabled(!soundEnabled);
    };

    const machine: Machine = { screen, input, audio, clock, rng, signal };
    const state = createDebugState();
    currentRun = { controller, input, audio, state };

    const presenter = new CanvasPresenter(screen, canvas, defaultRenderSpec.palette, () => input.textEntry);
    presenter.start();
    gameStatus.textContent = `Запуск №${runCounter}. Seed: ${Number.isNaN(seedParam) ? 'случайный' : seedParam}. Скорость: x${speedFactor}.`;

    try {
      await runGame({
        machine,
        questions: sessionQuestions,
        topPlayers: sessionTopPlayers,
        state,
        options: { humanSeats },
      });
      gameStatus.textContent = 'Игра завершена. Перезапуск...';
    } catch (error) {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        gameStatus.textContent = `Ошибка игры: ${message} — перезапуск через 2 с.`;
        console.error(error);
        await sleep(1700);
      } else {
        gameStatus.textContent = 'Перезапуск...';
      }
    } finally {
      presenter.stop();
      currentRun = null;
    }
    summarizeState();
    await sleep(300);
  }
}

// ------------------------------------------------------------------ wiring

function unlockAudio(): void {
  audioOutput.unlock().catch(() => {
    // Autoplay policy may reject before the first gesture; harmless.
  });
}

function toggleFullscreen(): void {
  // WEB: the original's Alt+Enter hotkey (dpr:1653, 692-705).
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  } else {
    void canvas.requestFullscreen().catch(() => {});
  }
}

document.addEventListener('keydown', (event) => {
  const run = currentRun;
  if (!run || playView.classList.contains('is-hidden') || isTypingTarget(event.target)) {
    return;
  }
  // Layout-independent like the original VK_S hotkey (dpr:1652) — on a
  // Cyrillic layout event.key for the physical S key is 'ы'.
  if (event.ctrlKey && (event.code === 'KeyS' || event.key === 's' || event.key === 'S')) {
    event.preventDefault();
    setSoundEnabled(!soundEnabled);
    return;
  }
  if (event.altKey && event.key === 'Enter') {
    event.preventDefault();
    toggleFullscreen();
    return;
  }
  if (event.key === 'Escape') {
    run.input.onEscape?.();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    run.input.onBossKey?.();
    return;
  }
  if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Backspace') {
    // Enter included so a previously clicked (still focused) button is not re-activated.
    event.preventDefault();
  }
  unlockAudio();
  run.input.handleKey(event.key, { alt: event.altKey, ctrl: event.ctrlKey });
});

document.addEventListener('keyup', (event) => {
  currentRun?.input.handleKeyUp(event.key);
});

canvas.addEventListener('pointerdown', () => {
  unlockAudio();
  currentRun?.input.pointerDown();
});

canvas.addEventListener('pointerup', () => {
  currentRun?.input.pointerUp();
});

tabPlayBtn.addEventListener('click', () => {
  setActiveTab('play');
});
tabAdminBtn.addEventListener('click', () => {
  setActiveTab('admin');
});

restartBtn.addEventListener('click', () => {
  abortCurrentRun('manual-restart');
});

soundToggleBtn.addEventListener('click', () => {
  setSoundEnabled(!soundEnabled);
});

fullscreenBtn.addEventListener('click', () => {
  toggleFullscreen();
});
if (typeof document.documentElement.requestFullscreen !== 'function') {
  // iPhone Safari has no element fullscreen API.
  fullscreenBtn.classList.add('is-hidden');
}

// --------------------------------------------------- touch controls (Safari)

// Reveal the on-screen keys once a real touch happens (plus the CSS
// pointer:coarse media query for first paint).
window.addEventListener(
  'pointerdown',
  (event) => {
    if (event.pointerType === 'touch') {
      document.body.classList.add('touch');
    }
  },
  { capture: true },
);

/**
 * On-screen key with HOLD semantics: pointer down = key held (the game's
 * hand loops POLL the KeyPressed event, so a fire-and-release tap would be
 * consumed by nothing), pointer up/cancel = key released. Arrows auto-repeat
 * like a held keyboard key.
 */
function bindHoldKey(button: HTMLButtonElement, key: string, autoRepeat = false): void {
  let repeatTimer: number | null = null;
  const stopRepeat = (): void => {
    if (repeatTimer !== null) {
      window.clearTimeout(repeatTimer);
      repeatTimer = null;
    }
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    unlockAudio();
    currentRun?.input.handleKey(key);
    if (autoRepeat) {
      stopRepeat();
      const tick = (): void => {
        currentRun?.input.handleKey(key);
        repeatTimer = window.setTimeout(tick, 130);
      };
      repeatTimer = window.setTimeout(tick, 380);
    }
  });
  const release = (): void => {
    stopRepeat();
    currentRun?.input.handleKeyUp(key);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}

bindHoldKey(btnLeft, 'ArrowLeft', true);
bindHoldKey(btnRight, 'ArrowRight', true);
bindHoldKey(btnSpace, ' ');
bindHoldKey(btnEnter, 'Enter');

// ------------------------------------------- mobile text entry (iOS Safari)

/** Mirrors what the game has actually accepted into its CP866 buffer. */
let entryForwarded = '';

window.setInterval(() => {
  const entry = currentRun?.input.textEntry ?? null;
  const active = entry !== null;
  entryBar.classList.toggle('active', active);
  if (!active) {
    if (entryInput.value.length > 0) {
      entryInput.value = '';
    }
    entryForwarded = '';
    return;
  }
  entryInput.maxLength = entry.maxLen;
  if (document.activeElement !== entryInput) {
    const accepted = decodeCp866(new Uint8Array(entry.bytes));
    entryInput.value = accepted;
    entryForwarded = accepted;
  }
}, 150);

entryInput.addEventListener('input', () => {
  const run = currentRun;
  const entry = run?.input.textEntry;
  if (!run || !entry) {
    return;
  }
  const next = entryInput.value;
  let common = 0;
  while (common < entryForwarded.length && common < next.length && entryForwarded[common] === next[common]) {
    common += 1;
  }
  for (let i = entryForwarded.length; i > common; i -= 1) {
    run.input.handleKey('Backspace');
  }
  for (const ch of next.slice(common)) {
    run.input.handleKey(ch);
  }
  // The game is authoritative (uppercase, CP866 filter, max length).
  const accepted = decodeCp866(new Uint8Array(entry.bytes));
  entryForwarded = accepted;
  if (entryInput.value !== accepted) {
    entryInput.value = accepted;
  }
});

entryBar.addEventListener('submit', (event) => {
  event.preventDefault();
  currentRun?.input.handleKey('Enter');
  currentRun?.input.handleKeyUp('Enter');
  entryInput.blur();
});

answersToggle.addEventListener('change', () => {
  renderQuestions();
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="player-mode"]')) {
  radio.addEventListener('change', () => {
    const mode = radio.value === '2' ? 2 : 1;
    if (mode !== humanSeats) {
      humanSeats = mode;
      gameStatus.textContent = `Режим: ${mode === 1 ? '1 игрок + 2 НПС' : '2 игрока'}. Новая игра...`;
      abortCurrentRun('mode-change');
    }
  });
}

searchInput.addEventListener('input', () => {
  renderQuestions();
});

questionsBody.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.tagName !== 'INPUT') {
    return;
  }
  const idx = Number.parseInt(target.dataset.questionIndex ?? '', 10);
  const field = target.dataset.field;
  if (Number.isNaN(idx) || (field !== 'word' && field !== 'theme')) {
    return;
  }
  if (field === 'word') {
    const clean = sanitizeGameWord(target.value);
    if (clean.length === 0) {
      target.value = sessionQuestions[idx].word;
      return;
    }
    sessionQuestions[idx].word = clean;
  } else {
    sessionQuestions[idx].theme = normalizeWord(target.value);
  }
});

questionsBody.addEventListener('click', (event) => {
  const target = event.target as HTMLButtonElement;
  if (target.tagName !== 'BUTTON') {
    return;
  }
  const idx = Number.parseInt(target.dataset.deleteIndex ?? '', 10);
  if (Number.isNaN(idx)) {
    return;
  }
  sessionQuestions.splice(idx, 1);
  ovlHeaderValue = sessionQuestions.length;
  summarizeState();
  renderQuestions();
});

addQuestionBtn.addEventListener('click', () => {
  // The placeholder word must be pure А..Я — a space would make the round unwinnable.
  sessionQuestions.push({ word: 'НОВОЕСЛОВО', theme: 'НОВАЯ ТЕМА' });
  ovlHeaderValue = sessionQuestions.length;
  summarizeState();
  renderQuestions();
});

downloadOvlBtn.addEventListener('click', () => {
  try {
    const bytes = serializeOvl({ headerValue: sessionQuestions.length, questions: sessionQuestions });
    const outputBytes = new Uint8Array(bytes.byteLength);
    outputBytes.set(bytes);
    const blob = new Blob([outputBytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'POLE.OVL';
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.textContent = `Serialize error: ${message}`;
  }
});

// ------------------------------------------------------------ asset loading

async function fetchJsonAsset<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Fetches and decodes one of the lossless WebP asset images to raw RGBA.
 * Decoding must be exact for rgbaToIndexed to recover the palette indices;
 * createImageBitmap is asked to skip color-space conversion, with an
 * HTMLImageElement fallback for browsers that reject those options (the
 * images are untagged sRGB and fully opaque, so both paths decode 1:1).
 */
async function fetchWebpAsset(path: string): Promise<RgbaImage> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  const blob = await response.blob();

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(blob);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to decode ${path}`));
      };
      image.src = url;
    });
  }

  const width = source.width;
  const height = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('2d canvas context unavailable for asset decoding');
  }
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  return { width, height, rgba: new Uint8Array(imageData.data.buffer, 0, width * height * 4) };
}

async function fetchLibSprite(file: string): Promise<SpritePixels> {
  const image = await fetchWebpAsset(`/assets/${file}`);
  return {
    width: image.width,
    height: image.height,
    pixels: rgbaToIndexed(image, defaultRenderSpec.palette),
  };
}

function applyOvl(parsedOvl: OvlFile): void {
  sessionQuestions.length = 0;
  sessionQuestions.push(...parsedOvl.questions);
  ovlHeaderValue = parsedOvl.headerValue;
}

async function loadBundledAssets(): Promise<void> {
  statusEl.textContent = 'Loading bundled assets...';
  // The original data files, transcoded to editable sources — WebP images
  // plus JSON manifests for graphics, JSON for data (byte-equivalent to the
  // DOS binaries — see transcoded.test.ts).
  const [libJson, fntJson, ovlJson, picJson] = await Promise.all([
    fetchJsonAsset<LibJson>('/assets/POLE2.LIB.json'),
    fetchJsonAsset<FntJson>('/assets/POLE.FNT.json'),
    fetchJsonAsset<OvlJson>('/assets/POLE.OVL.json'),
    fetchJsonAsset<PicJson>('/assets/POLE.PIC.json'),
  ]);
  const [libSprites, fntAtlases] = await Promise.all([
    Promise.all(libJson.sprites.map((sprite) => fetchLibSprite(sprite.file))),
    Promise.all(fntJson.planes.map((plane) => fetchWebpAsset(`/assets/${plane.file}`))),
  ]);

  spriteLib = libFromSprites(libJson, libSprites);
  fontPlanes = fntFromPlanes(
    fntJson,
    fntJson.planes.map((plane, i) => fontPlaneFromRgba(fntAtlases[i], plane.height)),
  );
  applyOvl(ovlFromJson(ovlJson));
  sessionTopPlayers.length = 0;
  sessionTopPlayers.push(...picFromJson(picJson));

  summarizeState();
  renderQuestions();

  if (!assetsReady) {
    assetsReady = true;
    void gameLoop();
  } else {
    abortCurrentRun('assets-reloaded');
  }
}

loadDefaultBtn.addEventListener('click', () => {
  loadBundledAssets().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.textContent = `Load error: ${message}`;
  });
});

ovlInput.addEventListener('change', async (event) => {
  const inputEl = event.currentTarget as HTMLInputElement;
  const file = inputEl.files?.[0];
  if (!file) {
    return;
  }
  try {
    applyOvl(parseOvl(new Uint8Array(await file.arrayBuffer())));
    summarizeState();
    renderQuestions();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.textContent = `OVL load error: ${message}`;
  }
});

// ----------------------------------------------------------------- debug API

window.__poleDebug = {
  getSnapshot(): PoleDebugSnapshot {
    const run = currentRun;
    return {
      activeTab: playView.classList.contains('is-hidden') ? 'admin' : 'play',
      assetsReady,
      soundEnabled,
      questionCount: sessionQuestions.length,
      textEntryActive: run !== null && run.input.textEntry !== null,
      hand: run ? { ...run.input.hand } : null,
      game: run ? { ...run.state } : null,
    };
  },
  injectKey(key, mods) {
    currentRun?.input.handleKey(key, mods ?? {});
  },
  injectKeyUp(key) {
    currentRun?.input.handleKeyUp(key);
  },
  injectClick() {
    currentRun?.input.pointerDown();
    currentRun?.input.pointerUp();
  },
};

// -------------------------------------------------------------------- boot

updateSoundButton();
setActiveTab('play');
loadBundledAssets().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = `Load error: ${message}`;
  gameStatus.textContent = `Ошибка загрузки ресурсов: ${message}`;
});
