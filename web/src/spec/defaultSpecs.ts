import type {
  AssetSpec,
  FlowSpec,
  ParityCase,
  RenderSpec,
  SectorOutcomeSpec,
  SectorReactionSpec,
  TurnPhase,
} from './types.ts';

const spriteIds = {
  FORTUNE_WHEEL0: 0,
  FORTUNE_WHEEL1: 1,
  FORTUNE_WHEEL2: 2,
  FORTUNE_WHEEL3: 3,
  ICON_PLUS: 4,
  ICON_5: 5,
  ICON_10: 6,
  ICON_15: 7,
  ICON_20: 8,
  ICON_DEATH: 9,
  ICON_X2: 10,
  ICON_X4: 11,
  ICON_ZERO: 12,
  ICON_PRIZE: 13,
  ICON_25: 14,
  ICON_50: 15,
  ARROW: 16,
  LETTER_BACK0: 17,
  LETTER_BACK1: 18,
  LETTER_BACK2: 19,
  LETTER_BACK3: 20,
  PLAYER_CHOOSE_LEFT: 21,
  PLAYER_LEFT: 22,
  ASSIST_STAY: 23,
  ASSIST_MOVE1: 24,
  ASSIST_MOVE2: 25,
  ASSIST_MOVE3: 26,
  YAKUBOVICH_BASE: 27,
  SNIKERS: 28,
  HAND: 29,
  MONEY: 30,
  BRICK1: 31,
  BRICK2: 32,
  BRICK3: 33,
  LAMP: 34,
  SPEECH_BUBBLE: 35,
  BOX_CLOSED: 36,
  BOX_OPENED: 37,
  BOX_MONEY: 38,
  SPEECH_BUBBLE2: 39,
  WALL_LEFT: 40,
  WALL_RIGHT: 41,
  YAKUBOVICH_ACTIVE: 42,
  YAKUBOVICH_EYES_OPEN: 43,
  YAKUBOVICH_EYES_CLOSE: 44,
  YAKUBOVICH_PASSIVE: 45,
  LOGO_POLE: 46,
  LOGO_CHUDES: 47,
  CHARACTER_IA: 48,
  CHARACTER_CARLSEN: 49,
  CHARACTER_OWL: 50,
  CHARACTER_RABBIT: 51,
  ADWARE_BACKGROUND: 52,
  CHARACTER_PYATACHOK: 53,
  CHARACTER_VINNY: 54,
  CHARACTER_FREKEN: 55,
  CHARACTER_BAGIRA: 56,
  PLAYER_CHOOSE_RIGHT: 57,
  PLAYER_RIGHT: 58,
  PLAYER: 59,
  RUB: 60,
} as const;

const turnPhases = ['loading', 'await_spin', 'await_letter', 'round_over', 'game_over'] as const satisfies readonly TurnPhase[];

const wheelSectorOutcomes = [
  { kind: 'multiplier', label: 'x2', multiplier: 2, icon: spriteIds.ICON_X2 },
  { kind: 'value', label: '15', value: 15, icon: spriteIds.ICON_15 },
  { kind: 'bankrupt', label: 'БАНКРОТ', icon: spriteIds.ICON_DEATH },
  { kind: 'value', label: '20', value: 20, icon: spriteIds.ICON_20 },
  { kind: 'lose', label: 'ПРОПУСК', icon: spriteIds.ICON_PLUS },
  { kind: 'value', label: '5', value: 5, icon: spriteIds.ICON_5 },
  { kind: 'prize', label: 'ПРИЗ', icon: spriteIds.ICON_PRIZE },
  { kind: 'value', label: '10', value: 10, icon: spriteIds.ICON_10 },
  { kind: 'value', label: '25', value: 25, icon: spriteIds.ICON_25 },
  { kind: 'value', label: '15', value: 15, icon: spriteIds.ICON_15 },
  { kind: 'lose', label: 'ПРОПУСК', icon: spriteIds.ICON_ZERO },
  { kind: 'value', label: '10', value: 10, icon: spriteIds.ICON_10 },
  { kind: 'plus', label: '+БУКВА', icon: spriteIds.ICON_ZERO },
  { kind: 'value', label: '20', value: 20, icon: spriteIds.ICON_20 },
  { kind: 'multiplier', label: 'x4', multiplier: 4, icon: spriteIds.ICON_X4 },
  { kind: 'value', label: '5', value: 5, icon: spriteIds.ICON_5 },
] as const satisfies readonly SectorOutcomeSpec[];

/**
 * Oracle-exact sector dispatch table indexed by i = CurSector shr 1
 * (dpr:1245-1364): 14 БАНКРОТ; 4,10 ноль; 12 ПЛЮС; 0/2 x2/x4; 6 ПРИЗ;
 * otherwise +SectorValues[i] (dpr:804).
 *
 * iconSpriteId is the icon under the arrow when reaction i fires:
 * DrawFortuneWheel draws SectorIcons[k] at offset[(a + 2k) and 31] and
 * offset[0] is the arrow slot (dpr:463-482), so a wheel stopped at
 * CurSector = 2i shows SectorIcons[(16 - i) mod 16] under the arrow when the
 * dispatch on i = CurSector shr 1 runs (dpr:1245-1249).
 */
const wheelSectorReactions = [
  { kind: 'x2', iconSpriteId: spriteIds.ICON_X2 }, // i=0  -> SectorIcons[0]
  { kind: 'value', value: 5, iconSpriteId: spriteIds.ICON_5 }, // i=1  -> SectorIcons[15]
  { kind: 'x4', iconSpriteId: spriteIds.ICON_X4 }, // i=2  -> SectorIcons[14]
  { kind: 'value', value: 20, iconSpriteId: spriteIds.ICON_20 }, // i=3  -> SectorIcons[13]
  { kind: 'zero', iconSpriteId: spriteIds.ICON_ZERO }, // i=4  -> SectorIcons[12]
  { kind: 'value', value: 10, iconSpriteId: spriteIds.ICON_10 }, // i=5  -> SectorIcons[11]
  { kind: 'prize', iconSpriteId: spriteIds.ICON_PRIZE }, // i=6  -> SectorIcons[10]
  { kind: 'value', value: 15, iconSpriteId: spriteIds.ICON_15 }, // i=7  -> SectorIcons[9]
  { kind: 'value', value: 25, iconSpriteId: spriteIds.ICON_25 }, // i=8  -> SectorIcons[8]
  { kind: 'value', value: 10, iconSpriteId: spriteIds.ICON_10 }, // i=9  -> SectorIcons[7]
  { kind: 'zero', iconSpriteId: spriteIds.ICON_ZERO }, // i=10 -> SectorIcons[6]
  { kind: 'value', value: 5, iconSpriteId: spriteIds.ICON_5 }, // i=11 -> SectorIcons[5]
  { kind: 'plus', iconSpriteId: spriteIds.ICON_PLUS }, // i=12 -> SectorIcons[4]
  { kind: 'value', value: 20, iconSpriteId: spriteIds.ICON_20 }, // i=13 -> SectorIcons[3]
  { kind: 'bankrupt', iconSpriteId: spriteIds.ICON_DEATH }, // i=14 -> SectorIcons[2]
  { kind: 'value', value: 15, iconSpriteId: spriteIds.ICON_15 }, // i=15 -> SectorIcons[1]
] as const satisfies readonly SectorReactionSpec[];

export const defaultAssetSpec = {
  canonicalEvidenceOrder: [
    'CLAUDE.md',
    'Pole Chudes 2/POLE2.EXE',
    'Pole Chudes 2/POLE2.LIB',
    'Pole Chudes 2/POLE.FNT',
    'Pole Chudes 2/POLE.OVL',
    'Pole Chudes 2/POLE.PIC',
    'Pole2/PoleWin32.dpr',
    'Pole2/imHex/*.hexpat',
  ],
  oracle: {
    executableFile: 'Pole Chudes 2/POLE2.EXE',
    executableFormat: 'MZ',
    executableBits: 16,
    executableSizeBytes: 56528,
    requiredAssetFiles: ['POLE2.LIB', 'POLE.FNT', 'POLE.OVL', 'POLE.PIC'],
    optionalAssetFiles: ['POLE.LIB'],
  },
  spriteIds,
  spriteLibrary: {
    file: 'POLE2.LIB',
    spriteCount: 61,
    headerSizeBytes: 128,
    blockSizeBytes: 128,
    spriteHeaderBytes: 6,
    rowLengthFieldBytes: 2,
    compression: 'row-rle',
  },
  fontFile: {
    file: 'POLE.FNT',
    totalSizeBytes: 0x1c00,
    glyphWidthPixels: 8,
    planes: [
      { height: 6, sizeBytes: 0x600 },
      { height: 8, sizeBytes: 0x800 },
      { height: 14, sizeBytes: 0xe00 },
    ],
  },
  questionFile: {
    file: 'POLE.OVL',
    recordSizeBytes: 21,
    maxTextBytes: 20,
    headerEncoding: 'plain-decimal-cp866',
    bodyEncoding: 'cp866-plus-32',
    storedAsPairs: true,
  },
  leaderboardFile: {
    file: 'POLE.PIC',
    recordCount: 8,
    recordSizeBytes: 13,
    maxNameBytes: 10,
    scoreEncoding: 'u16le',
  },
  cp866: {
    decoderLabel: 'ibm866',
    preserveBinaryRoundTrip: true,
    gameplayNormalizesYoToYe: true,
  },
  transcodedAssets: {
    files: [
      {
        original: 'POLE2.LIB',
        transcoded: 'POLE2.LIB.json',
        imageFiles: { dir: 'sprites', count: 61, format: 'webp-lossless' },
        originalSizeBytes: 86144,
        originalSha256: 'd08dba757a2245f1f6c3135135a52d03b7f7db420caf52e68aef2b223ed1fd52',
      },
      {
        original: 'POLE.FNT',
        transcoded: 'POLE.FNT.json',
        imageFiles: { dir: 'fonts', count: 3, format: 'webp-lossless' },
        originalSizeBytes: 7168,
        originalSha256: 'c97a2a69ebe88577d7453408bf92a1739ed6d7b5a8c010f1d3078b5b9c9dd364',
      },
      {
        original: 'POLE.OVL',
        transcoded: 'POLE.OVL.json',
        originalSizeBytes: 28833,
        originalSha256: '21e8a114b8f1e832ef83cc5f13ef393fa9b48e95c7e7cb008210f9d8769b6074',
      },
      {
        original: 'POLE.PIC',
        transcoded: 'POLE.PIC.json',
        originalSizeBytes: 104,
        originalSha256: '55beab877d9e379844b7767ef4278d7529b825ac89f7395cdcb9904ee53c5a0e',
      },
    ],
    libRowRle: {
      emitRunMinLength: 3,
      emitRunPairOnEmptyLiteral: true,
      maxRunLength: 127,
      maxLiteralLength: 127,
      rowTerminator: 'empty-literal',
      spriteHeaderWord4: 0,
    },
  },
} satisfies AssetSpec;

export const defaultRenderSpec = {
  internalSurface: {
    width: 640,
    height: 350,
  },
  scaling: {
    nearestNeighbor: true,
    cssImageRendering: 'pixelated',
  },
  palette: [
    [0x00, 0x00, 0x00],
    [0x00, 0x00, 0xaa],
    [0x00, 0xaa, 0x00],
    [0x00, 0xaa, 0xaa],
    [0xaa, 0x55, 0x00],
    [0xff, 0xaa, 0xaa],
    [0xff, 0xaa, 0x55],
    [0xaa, 0xaa, 0xaa],
    [0x55, 0x55, 0x55],
    [0x55, 0x55, 0xff],
    [0x55, 0xff, 0x55],
    [0x55, 0xff, 0xff],
    [0xff, 0x55, 0x55],
    [0xff, 0x55, 0xff],
    [0xff, 0xff, 0x55],
    [0xff, 0xff, 0xff],
  ],
  spriteTransparency: {
    playerCharacters: 2,
    wheelBase: 3,
    wheelIcons: 7,
    yakubovichOverlay: 16,
    scenery: 1,
  },
  playerPositions: [
    { x: 208, y: 118 },
    { x: 8, y: 219 },
    { x: 360, y: 219 },
  ],
  stage: {
    backgroundBands: [
      { x: 0, y: 0, width: 640, height: 10, fillColor: 3 },
      { x: 0, y: 10, width: 640, height: 2, fillColor: 8 },
      { x: 0, y: 13, width: 640, height: 94, fillColor: 1 },
      { x: 0, y: 108, width: 640, height: 2, fillColor: 8 },
      { x: 0, y: 331, width: 640, height: 1, fillColor: 8 },
    ],
    floorRect: { x: 0, y: 111, width: 640, height: 238, fillColor: 7 },
    board: {
      rect: { x: 120, y: 15, width: 400, height: 80, fillColor: 7 },
      horizontalLineYs: [15, 35, 55, 75, 95],
      verticalLineXs: Array.from({ length: 26 }, (_, index) => 120 + index * 16),
      lineColor: 0,
    },
    yakubovich: {
      basePosition: { x: 0x1e0, y: 0xac },
      passivePosition: { x: 0x1ff, y: 0xad },
      activePosition: { x: 0x1ff, y: 0xad },
      passiveEyesPosition: { x: 0x214, y: 0xd1 },
      activeEyesPosition: { x: 0x214, y: 0xc9 },
      bubblePosition: { x: 0x1df, y: 0x8e },
      bubbleTextCenterX: 0x22e,
      bubbleLineYs: [0x91, 0x9e],
      animation: {
        talkFrameMs: 150,
        idleBlinkPeriodMs: 3200,
        idleBlinkFrameMs: 150,
      },
    },
  },
  wheel: {
    baseSpriteStart: spriteIds.FORTUNE_WHEEL0,
    frameCount: 4,
    basePosition: { x: 128, y: 154 },
    clearRect: { x: 128, y: 154, width: 223, height: 172, fillColor: 7 },
    arrowSpriteId: spriteIds.ARROW,
    arrowPosition: { x: 235, y: 191 },
    iconOrder: [
      spriteIds.ICON_X2,
      spriteIds.ICON_15,
      spriteIds.ICON_DEATH,
      spriteIds.ICON_20,
      spriteIds.ICON_PLUS,
      spriteIds.ICON_5,
      spriteIds.ICON_ZERO,
      spriteIds.ICON_10,
      spriteIds.ICON_25,
      spriteIds.ICON_15,
      spriteIds.ICON_PRIZE,
      spriteIds.ICON_10,
      spriteIds.ICON_ZERO,
      spriteIds.ICON_20,
      spriteIds.ICON_X4,
      spriteIds.ICON_5,
    ],
    iconOffsets: [
      0x1aee5, 0x1b175, 0x1bb85, 0x1ca94, 0x1dc20, 0x1f52b, 0x210b3, 0x22eb7,
      0x24cb9, 0x26ab7, 0x288b3, 0x2a42b, 0x2bd20, 0x2ce94, 0x2dd85, 0x2e775,
      0x2e9e5, 0x2e755, 0x2dd45, 0x2ce36, 0x2bcaa, 0x2a39f, 0x28817, 0x26a13,
      0x24c11, 0x22e13, 0x21017, 0x1f49f, 0x1dbaa, 0x1ca36, 0x1bb45, 0x1b155,
    ],
    iconOffsetStride: 2,
  },
  text: {
    glyphHeights: [6, 8, 14],
    defaultSpan: 8,
    stageSpan: 16,
    alphabetSpan: 20,
    wordCellSpacing: 16,
  },
  // DOS boots with sound OFF; the Delphi port enables it at startup (dpr:837),
  // a documented deviation (#13). The port follows DOS: muted until toggled.
  soundDefaultEnabled: false,
  drawOrder: [
    'background fills',
    'brick wall',
    'lamps',
    'wall side sprites',
    'players 2 and 3',
    'wheel clear rect',
    'player 1 overlap sprite',
    'fortune wheel base animation',
    'wheel sector icons',
    'wheel arrow',
    'yakubovich base and overlay',
    'theme and word text',
    'HUD overlays',
  ],
  inputMappings: {
    prototypeWeb: {
      spin: ['Space', 'Spin button'],
      solve: ['Enter', 'Solve button'],
      chooseLetter: ['Keyboard letter', 'Letter grid button'],
      changeTab: ['Play tab', 'Admin Panel tab'],
    },
    originalDos: {
      moveCursor: ['Left', 'Right'],
      confirm: ['Space', 'Left mouse button'],
      enterText: ['Enter'],
      muteOrToggleSound: ['Ctrl+S', 'Tab in Delphi port'],
      fullscreen: ['Alt+Enter in Delphi port'],
      exit: ['Esc'],
    },
  },
} satisfies RenderSpec;

export const defaultFlowSpec = {
  researchOrder: [
    'binary-and-asset-inventory',
    'rendering-text-and-input-primitives',
    'main-game-flow',
    'npc-audio-and-timing',
  ],
  totalRounds: 8,
  phases: turnPhases,
  russianAlphabet: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split(''),
  npc: {
    // Characters array, verbatim pairing (dpr:141): КРОЛИК uses CHARACTER_RABBIT (51)
    // and comes BEFORE СОВА/CHARACTER_OWL (50) — name order is not sprite-id order.
    names: ['ИА-ИА', 'КАРЛСОН', 'КРОЛИК', 'СОВА', 'ПЯТАЧОК', 'ВИННИ-ПУХ', 'ФРЕКЕН БОК', 'БАГИРА'],
    spriteIds: [
      spriteIds.CHARACTER_IA,
      spriteIds.CHARACTER_CARLSEN,
      spriteIds.CHARACTER_RABBIT,
      spriteIds.CHARACTER_OWL,
      spriteIds.CHARACTER_PYATACHOK,
      spriteIds.CHARACTER_VINNY,
      spriteIds.CHARACTER_FREKEN,
      spriteIds.CHARACTER_BAGIRA,
    ],
    prototypeCorrectLetterBias: 0.62,
    prototypePoolPolicy: 'unique-until-exhausted-then-random-reuse',
    originalHeuristicStatus: 'needs-dos-capture',
  },
  questionEditor: {
    sessionOnly: true,
    maxVisibleRows: 120,
    maxTextBytes: 20,
    exportFileName: 'POLE.OVL',
  },
  questionSelection: {
    avoidRepeatWithinSession: true,
    sourceFile: 'POLE.OVL',
  },
  leaderboard: {
    maxEntries: 8,
    defaultPersistence: 'session-only',
    originalPersistence: 'rewrite-POLE.PIC',
  },
  wheel: {
    sectorOutcomes: wheelSectorOutcomes,
    sectorReactions: wheelSectorReactions,
    solveAllowedDuring: ['await_spin', 'await_letter'],
    bankruptResetsScore: true,
  },
  // MainThread StageNames (dpr:803); totalRounds above stays for the old sandbox.
  stages: {
    count: 8,
    names: [
      '1/64 ФИНАЛА',
      '1/32 ФИНАЛА',
      '1/16 ФИНАЛА',
      '1/8 ФИНАЛА',
      '1/4 ФИНАЛА',
      'ПОЛУФИНАЛ',
      'ФИНАЛ',
      'СУПЕРФИНАЛ',
    ],
  },
  host: {
    scripts: {
      gameStart: { line1: 'НАЧИНАЕМ ИГРУ!', line2: 'ВРАЩАЙТЕ БАРАБАН!', bubbleMs: 1900, talkMs: 1100 },
      nextRound: { line1: 'НОВЫЙ РАУНД!', line2: 'ВРАЩАЙТЕ БАРАБАН!', bubbleMs: 1800, talkMs: 1000 },
      promptLetter: { line1: 'НАЗОВИТЕ', line2: 'БУКВУ!', bubbleMs: 1500, talkMs: 900 },
      bonusLetter: { line1: '+БУКВА!', line2: 'НАЗОВИТЕ БУКВУ.', bubbleMs: 1600, talkMs: 900 },
      multiplier: { line1: 'МНОЖИТЕЛЬ!', line2: 'НАЗОВИТЕ БУКВУ.', bubbleMs: 1700, talkMs: 950 },
      prize: { line1: 'ПРИЗОВОЙ ХОД!', line2: 'НАЗОВИТЕ БУКВУ.', bubbleMs: 1700, talkMs: 950 },
      bankrupt: { line1: 'БАНКРОТ!', line2: 'СЧЕТ ОБНУЛЕН.', bubbleMs: 1700, talkMs: 1000 },
      loseTurn: { line1: 'ПРОПУСК ХОДА.', line2: 'ДАЛЬШЕ СЛЕДУЮЩИЙ.', bubbleMs: 1700, talkMs: 1000 },
      correctLetter: { line1: 'ЕСТЬ ТАКАЯ', line2: 'БУКВА!', bubbleMs: 1500, talkMs: 900 },
      wrongLetter: { line1: 'НЕТ ТАКОЙ', line2: 'БУКВЫ.', bubbleMs: 1500, talkMs: 900 },
      wrongSolve: { line1: 'НЕВЕРНО!', line2: 'ХОД ПЕРЕХОДИТ.', bubbleMs: 1600, talkMs: 900 },
      roundWin: { line1: 'ПРАВИЛЬНО!', line2: 'РАУНД ВЗЯТ.', bubbleMs: 1800, talkMs: 1000 },
      finalWin: { line1: 'ПОБЕДИТЕЛЬ!', line2: 'ФИНАЛ ЗАВЕРШЕН.', bubbleMs: 1900, talkMs: 1100 },
    },
  },
  roundSequence: [
    'splash',
    'stage banner',
    'player presentation',
    'word selection',
    'stage loop',
    'adware interstitial',
    'final summary',
    'top-8 update',
  ],
  eliminationRules: [
    'Prize acceptance can remove the player from the round flow in the original code path.',
    'Bankrupt resets the active player score to zero.',
    'Skip sector passes the turn immediately.',
    'Three correctly opened letters unlock the box sequence in the original flow.',
    'Current web runtime keeps leaderboard state in-session only and does not rewrite POLE.PIC.',
  ],
} satisfies FlowSpec;

export const defaultParityCases = [
  {
    id: 'ts-lib-row-decoder-corrected',
    subsystem: 'binary-assets',
    topic: 'Sprite row-RLE decoding now follows the DOS routine',
    evidenceSource: 'delphi-port',
    tsStatus: 'implemented',
    resolutionStatus: 'confirmed',
    summary:
      'The TypeScript LIB parser now advances rows the same way as DrawSprite in the Delphi reconstruction, eliminating impossible palette indices and restoring 0..15 sprite data.',
    sourceRefs: ['web/src/assets/lib.ts', 'Pole2/PoleWin32.dpr:200-234', 'Pole2/imHex/LIB.hexpat'],
    nextAction: 'Use DOS capture comparisons to validate transparency colors, draw order, and sprite placement on top of the corrected decode.',
  },
  {
    id: 'ts-dos-palette-byte-order-corrected',
    subsystem: 'rendering-text-input',
    topic: 'Runtime palette now matches the DIB color order used by the reconstructed port',
    evidenceSource: 'delphi-port',
    tsStatus: 'implemented',
    resolutionStatus: 'confirmed',
    summary:
      'The shared render palette now follows the BITMAPINFO bmiColors table from the Delphi reconstruction. The ImHex palette constants are not direct runtime RGB triples.',
    sourceRefs: ['web/src/spec/defaultSpecs.ts', 'Pole2/PoleWin32.dpr:127', 'Pole2/imHex/LIB.hexpat'],
    nextAction: 'Confirm the browser palette against DOS captures, then continue with transparency and layout mismatches.',
  },
  {
    id: 'ts-main-flow-simplified',
    subsystem: 'main-flow',
    topic: 'Full MainThread flow is now ported scene-for-scene',
    evidenceSource: 'delphi-port',
    tsStatus: 'implemented',
    resolutionStatus: 'confirmed',
    summary:
      'web/src/game/script.ts ports the complete MainThread: splash, player presentation with name entry, 8 tournament stages, hand-cursor letter/decision input, box minigame, prize bargaining, adware interstitial, endgame ceremony, and session-scoped top-8 semantics. Verified by headless full-game integration tests and the Playwright smoke flow.',
    sourceRefs: ['web/src/game/script.ts', 'web/src/game/script.test.ts', 'Pole2/PoleWin32.dpr:869-1646'],
    nextAction: 'Validate scene timing and layout against reproducible DOS captures when the capture lane exists.',
  },
  {
    id: 'ts-host-dialog-approximate',
    subsystem: 'main-flow',
    topic: 'Full Yakubovich dialogue call tree is now ported',
    evidenceSource: 'delphi-port',
    tsStatus: 'implemented',
    resolutionStatus: 'confirmed',
    summary:
      'Every YakubovichTalk/PlayerTalk/PlayerDecision call site from the reconstruction is ported with its exact strings, animation sequence, and save/restore regions; the compact sandbox cue set is gone.',
    sourceRefs: ['web/src/game/script.ts', 'Pole2/PoleWin32.dpr:503-637', 'Pole2/PoleWin32.dpr:1037-1587'],
    nextAction: 'Spot-check bubble timing against DOS captures.',
  },
  {
    id: 'ts-ovl-pairing-evidence-corrected',
    subsystem: 'binary-assets',
    topic: 'OVL word/theme pairing follows direct binary evidence, not the literal Delphi indexing',
    evidenceSource: 'manual-capture',
    tsStatus: 'implemented',
    resolutionStatus: 'confirmed',
    summary:
      'POLE.OVL has 1373 records (header "686"); odd records are words, even records their themes. The literal Delphi indexing (theme=2w, word=2w+1) pairs word w+1 with theme w and overruns the file at w=686, so the port keeps the parser pairing (word=2k-1, theme=2k).',
    sourceRefs: ['web/src/assets/ovl.ts', 'web/src/game/script.ts', 'Pole2/PoleWin32.dpr:949-953', 'Pole2/PoleWin32.dpr:1099-1113'],
    nextAction: 'None — verified against the original binary content.',
  },
  {
    id: 'ts-assets-transcoded-byte-exact',
    subsystem: 'binary-assets',
    topic: 'All four data files ship as JSON sources that rebuild the original binaries byte-for-byte',
    evidenceSource: 'dos-asset',
    tsStatus: 'implemented',
    resolutionStatus: 'confirmed',
    summary:
      'POLE2.LIB/POLE.OVL/POLE.FNT/POLE.PIC are transcoded to JSON (hex pixel rows, glyph bitmaps, question/leaderboard text) and rebuilt byte-exactly, sha256-pinned in transcodedAssets. The LIB row-RLE packer rule was inferred from the file itself — emit a run for 3+ equal pixels, or exactly 2 at a token boundary; 127 caps; empty-literal row terminator — and reproduces all 3851 sprite rows. Writer garbage (record residue, block padding) is preserved verbatim.',
    sourceRefs: ['web/src/assets/lib.ts', 'web/src/assets/transcoded.test.ts', 'web/scripts/transcode-assets.mjs'],
    nextAction: 'None — byte-identity is pinned by sha256 and checked against the _local fixtures when present.',
  },
  {
    id: 'ts-text-centering-provisional',
    subsystem: 'rendering-text-input',
    topic: 'Centered theme/word rendering follows the Delphi port note, not DOS proof',
    evidenceSource: 'delphi-port',
    tsStatus: 'mismatch',
    resolutionStatus: 'open',
    summary:
      'The port keeps the reconstruction’s centering formulas for the round title and masked word; the Delphi readme lists that centering as a deviation from DOS, whose exact placement is still unknown.',
    sourceRefs: ['Pole2/Readme.md', 'web/src/game/script.ts'],
    nextAction: 'Replace provisional centering with DOS-captured coordinates before calling text layout complete.',
  },
  {
    id: 'ts-audio-approximation',
    subsystem: 'npc-audio-timing',
    topic: 'Audio now reproduces the PWM synth; timbre still unvalidated against DOS captures',
    evidenceSource: 'delphi-port',
    tsStatus: 'implemented',
    resolutionStatus: 'open',
    summary:
      'web/src/engine/audio.ts replicates the 8 kHz PWM square-wave routine (half-period 4000/freq, duration*8 samples) and every Sound/PlayWAV/SpeechSound envelope with original pacing; output goes through WebAudio, so the final timbre still needs comparison against captured DOS PC-speaker output.',
    sourceRefs: ['web/src/engine/audio.ts', 'Pole2/PoleWin32.dpr:176-241', 'Pole2/PoleWin32.dpr:484-501'],
    nextAction: 'Capture DOS audio output and compare envelopes/timbre.',
  },
  {
    id: 'ts-npc-heuristics-unconfirmed',
    subsystem: 'npc-audio-timing',
    topic: 'NPC letter choice now matches the disassembly-derived branch; DOS captures still pending',
    evidenceSource: 'delphi-port',
    tsStatus: 'implemented',
    resolutionStatus: 'open',
    summary:
      'The port implements the original heuristic: pick from the hidden word when remaining*2 < length and random(stage+2) > 0, else a random unused letter. The invented 62%-bias prototype is gone. Capture-backed confirmation against the DOS binary remains open.',
    sourceRefs: ['web/src/game/script.ts', 'Pole2/PoleWin32.dpr:1389-1396'],
    nextAction: 'Confirm with DOS traces once the capture lane exists.',
  },
  {
    id: 'dos-capture-lane-unprovisioned',
    subsystem: 'binary-assets',
    topic: 'Parity cannot yet be proven from reproducible DOS captures',
    evidenceSource: 'manual-capture',
    tsStatus: 'research-only',
    resolutionStatus: 'planned',
    summary:
      'The repo has historical screenshots under output/playwright, but no checked-in, reproducible DOS capture workflow yet.',
    sourceRefs: ['output/playwright', 'reverse-engineering/README.md'],
    nextAction: 'Provision a DOS execution lane and store reproducible screenshots and traces before marking any subsystem parity-complete.',
  },
  {
    id: 'playwright-smoke-now-checked-in',
    subsystem: 'rendering-text-input',
    topic: 'Browser smoke flow now has a real harness',
    evidenceSource: 'automated-test',
    tsStatus: 'implemented',
    resolutionStatus: 'confirmed',
    summary:
      'The Playwright harness now drives the full DOS-style flow via window.__poleDebug (splash, name entry, human spin, letter pick, word solve) at ?fast=25, asserts six flow milestones plus zero console errors, and writes screenshots and a JSON report.',
    sourceRefs: ['web/scripts/playwright-smoke.mjs', 'web/src/main.ts', 'web/package.json'],
    nextAction: 'Keep the smoke harness in lockstep with the __poleDebug snapshot contract.',
  },
] as const satisfies readonly ParityCase[];
