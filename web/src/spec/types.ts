export type PaletteColor = readonly [number, number, number];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TurnPhase = 'loading' | 'await_spin' | 'await_letter' | 'round_over' | 'game_over';

export type SectorOutcomeSpec =
  | { kind: 'value'; label: string; value: number; icon: number }
  | { kind: 'bankrupt'; label: string; icon: number }
  | { kind: 'lose'; label: string; icon: number }
  | { kind: 'plus'; label: string; icon: number }
  | { kind: 'multiplier'; label: string; multiplier: number; icon: number }
  | { kind: 'prize'; label: string; icon: number };

/**
 * Sector dispatch table of the original MainThread, indexed by the reaction
 * index i = CurSector shr 1 (dpr:1245-1364): 14 БАНКРОТ; 4,10 ноль; 12 ПЛЮС;
 * 0/2 x2/x4; 6 ПРИЗ; otherwise +SectorValues[i]. `iconSpriteId` is the sector
 * icon resting under the arrow when reaction i fires.
 */
export type SectorReactionSpec =
  | { kind: 'value'; value: number; iconSpriteId: number }
  | { kind: 'zero' | 'plus' | 'x2' | 'x4' | 'prize' | 'bankrupt'; iconSpriteId: number };

export interface StageSpec {
  count: number;
  names: readonly string[];
}

export interface HostCueSpec {
  line1: string;
  line2: string;
  bubbleMs: number;
  talkMs: number;
}

export interface AssetSpec {
  canonicalEvidenceOrder: readonly string[];
  oracle: {
    executableFile: string;
    executableFormat: 'MZ';
    executableBits: 16;
    executableSizeBytes: number;
    requiredAssetFiles: readonly string[];
    optionalAssetFiles: readonly string[];
  };
  spriteIds: Record<string, number>;
  spriteLibrary: {
    file: string;
    spriteCount: number;
    headerSizeBytes: number;
    blockSizeBytes: number;
    spriteHeaderBytes: number;
    rowLengthFieldBytes: number;
    compression: 'row-rle';
  };
  fontFile: {
    file: string;
    totalSizeBytes: number;
    glyphWidthPixels: 8;
    planes: readonly {
      height: 6 | 8 | 14;
      sizeBytes: number;
    }[];
  };
  questionFile: {
    file: string;
    recordSizeBytes: number;
    maxTextBytes: number;
    headerEncoding: 'plain-decimal-cp866';
    bodyEncoding: 'cp866-plus-32';
    storedAsPairs: true;
  };
  leaderboardFile: {
    file: string;
    recordCount: number;
    recordSizeBytes: number;
    maxNameBytes: number;
    scoreEncoding: 'u16le';
  };
  cp866: {
    decoderLabel: 'ibm866';
    preserveBinaryRoundTrip: true;
    gameplayNormalizesYoToYe: true;
  };
  /**
   * The shipped runtime assets are transcodes of the original DOS data files:
   * graphics as lossless WebP images (editable in any image editor) plus a
   * JSON manifest for the non-derivable bytes, text/data as JSON. Each must
   * rebuild its original byte-for-byte (pinned by sha256). The original
   * binaries live only in gitignored `_local/` as test fixtures.
   */
  transcodedAssets: {
    files: readonly {
      original: string;
      transcoded: string;
      /** Present when the asset's payload ships as editable images next to the manifest. */
      imageFiles?: { dir: string; count: number; format: 'webp-lossless' };
      originalSizeBytes: number;
      originalSha256: string;
    }[];
    /**
     * POLE2.LIB row-RLE packer rule, inferred from the file itself (the
     * oracle only has the decoder): emit an RLE token for runs of 3+, or
     * exactly 2 when no literal is pending; 127 caps both token kinds; every
     * row ends with an empty-literal 0x00 terminator; sprite-header word at
     * offset 4 is always zero.
     */
    libRowRle: {
      emitRunMinLength: 3;
      emitRunPairOnEmptyLiteral: true;
      maxRunLength: 127;
      maxLiteralLength: 127;
      rowTerminator: 'empty-literal';
      spriteHeaderWord4: 0;
    };
  };
}

export interface RenderSpec {
  internalSurface: {
    width: number;
    height: number;
  };
  scaling: {
    nearestNeighbor: true;
    cssImageRendering: 'pixelated';
  };
  palette: readonly PaletteColor[];
  spriteTransparency: {
    playerCharacters: number;
    wheelBase: number;
    wheelIcons: number;
    yakubovichOverlay: number;
    scenery: number;
  };
  playerPositions: readonly Point[];
  stage: {
    backgroundBands: readonly (Rect & { fillColor: number })[];
    floorRect: Rect & { fillColor: number };
    board: {
      rect: Rect & { fillColor: number };
      horizontalLineYs: readonly number[];
      verticalLineXs: readonly number[];
      lineColor: number;
    };
    yakubovich: {
      basePosition: Point;
      passivePosition: Point;
      activePosition: Point;
      passiveEyesPosition: Point;
      activeEyesPosition: Point;
      bubblePosition: Point;
      bubbleTextCenterX: number;
      bubbleLineYs: readonly number[];
      animation: {
        talkFrameMs: number;
        idleBlinkPeriodMs: number;
        idleBlinkFrameMs: number;
      };
    };
  };
  wheel: {
    baseSpriteStart: number;
    frameCount: number;
    basePosition: Point;
    clearRect: Rect & { fillColor: number };
    arrowSpriteId: number;
    arrowPosition: Point;
    iconOrder: readonly number[];
    iconOffsets: readonly number[];
    iconOffsetStride: number;
  };
  text: {
    glyphHeights: readonly (6 | 8 | 14)[];
    defaultSpan: number;
    stageSpan: number;
    alphabetSpan: number;
    wordCellSpacing: number;
  };
  drawOrder: readonly string[];
  /** Master sound default at startup. DOS boots muted; Delphi deviation #13 turns it on. */
  soundDefaultEnabled: boolean;
  inputMappings: {
    prototypeWeb: Record<string, readonly string[]>;
    originalDos: Record<string, readonly string[]>;
  };
}

export interface FlowSpec {
  researchOrder: readonly string[];
  totalRounds: number;
  phases: readonly TurnPhase[];
  russianAlphabet: readonly string[];
  npc: {
    names: readonly string[];
    spriteIds: readonly number[];
    prototypeCorrectLetterBias: number;
    prototypePoolPolicy: 'unique-until-exhausted-then-random-reuse';
    originalHeuristicStatus: 'needs-dos-capture';
  };
  questionEditor: {
    sessionOnly: true;
    maxVisibleRows: number;
    maxTextBytes: number;
    exportFileName: string;
  };
  questionSelection: {
    avoidRepeatWithinSession: true;
    sourceFile: string;
  };
  leaderboard: {
    maxEntries: number;
    defaultPersistence: 'session-only';
    originalPersistence: 'rewrite-POLE.PIC';
  };
  wheel: {
    sectorOutcomes: readonly SectorOutcomeSpec[];
    /** Oracle-exact dispatch table, indexed by i = CurSector shr 1 (dpr:1245-1364). */
    sectorReactions: readonly SectorReactionSpec[];
    solveAllowedDuring: readonly TurnPhase[];
    bankruptResetsScore: true;
  };
  /** The 8 tournament stages of MainThread (dpr:803); `totalRounds` stays for the old sandbox. */
  stages: StageSpec;
  host: {
    scripts: {
      gameStart: HostCueSpec;
      nextRound: HostCueSpec;
      promptLetter: HostCueSpec;
      bonusLetter: HostCueSpec;
      multiplier: HostCueSpec;
      prize: HostCueSpec;
      bankrupt: HostCueSpec;
      loseTurn: HostCueSpec;
      correctLetter: HostCueSpec;
      wrongLetter: HostCueSpec;
      wrongSolve: HostCueSpec;
      roundWin: HostCueSpec;
      finalWin: HostCueSpec;
    };
  };
  roundSequence: readonly string[];
  eliminationRules: readonly string[];
}

export type EvidenceSource =
  | 'dos-exe'
  | 'dos-asset'
  | 'delphi-port'
  | 'ts-runtime'
  | 'manual-capture'
  | 'automated-test';

export interface ParityCase {
  id: string;
  subsystem: 'binary-assets' | 'rendering-text-input' | 'main-flow' | 'npc-audio-timing';
  topic: string;
  evidenceSource: EvidenceSource;
  tsStatus: 'research-only' | 'implemented' | 'mismatch' | 'not-started';
  resolutionStatus: 'open' | 'confirmed' | 'planned' | 'intentionally-different';
  summary: string;
  sourceRefs: readonly string[];
  nextAction: string;
}
