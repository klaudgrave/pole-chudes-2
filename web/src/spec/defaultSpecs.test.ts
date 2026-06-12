import { describe, expect, it } from 'vitest';

import { defaultAssetSpec, defaultFlowSpec, defaultParityCases, defaultRenderSpec } from './index';

describe('default reverse-engineering specs', () => {
  it('stay JSON-serializable and preserve DOS executable metadata', () => {
    const json = JSON.parse(JSON.stringify(defaultAssetSpec)) as typeof defaultAssetSpec;

    expect(json.oracle.executableFormat).toBe('MZ');
    expect(json.oracle.executableBits).toBe(16);
    expect(json.oracle.executableSizeBytes).toBe(56528);
    expect(json.oracle.requiredAssetFiles).toEqual(['POLE2.LIB', 'POLE.FNT', 'POLE.OVL', 'POLE.PIC']);
  });

  it('capture the canonical render surface and wheel geometry', () => {
    expect(defaultRenderSpec.internalSurface).toEqual({ width: 640, height: 350 });
    expect(defaultRenderSpec.palette).toEqual([
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
    ]);
    expect(defaultRenderSpec.playerPositions).toHaveLength(3);
    expect(defaultRenderSpec.stage.backgroundBands).toHaveLength(5);
    expect(defaultRenderSpec.stage.floorRect).toEqual({ x: 0, y: 111, width: 640, height: 238, fillColor: 7 });
    expect(defaultRenderSpec.stage.board.rect).toEqual({ x: 120, y: 15, width: 400, height: 80, fillColor: 7 });
    expect(defaultRenderSpec.stage.board.verticalLineXs.at(0)).toBe(120);
    expect(defaultRenderSpec.stage.board.verticalLineXs.at(-1)).toBe(520);
    expect(defaultRenderSpec.stage.yakubovich).toEqual({
      basePosition: { x: 480, y: 172 },
      passivePosition: { x: 511, y: 173 },
      activePosition: { x: 511, y: 173 },
      passiveEyesPosition: { x: 532, y: 209 },
      activeEyesPosition: { x: 532, y: 201 },
      bubblePosition: { x: 479, y: 142 },
      bubbleTextCenterX: 558,
      bubbleLineYs: [145, 158],
      animation: {
        talkFrameMs: 150,
        idleBlinkPeriodMs: 3200,
        idleBlinkFrameMs: 150,
      },
    });
    expect(defaultRenderSpec.wheel.iconOrder).toHaveLength(16);
    expect(defaultRenderSpec.wheel.iconOffsets).toHaveLength(32);
  });

  it('keep flow/editor constraints aligned with the DOS assets', () => {
    expect(defaultFlowSpec.totalRounds).toBe(8);
    expect(defaultFlowSpec.phases).toEqual(['loading', 'await_spin', 'await_letter', 'round_over', 'game_over']);
    expect(defaultFlowSpec.questionEditor.sessionOnly).toBe(true);
    expect(defaultFlowSpec.questionEditor.maxTextBytes).toBe(20);
    expect(defaultFlowSpec.leaderboard.maxEntries).toBe(8);
    expect(defaultFlowSpec.wheel.sectorOutcomes).toHaveLength(16);
    expect(defaultFlowSpec.host.scripts.gameStart.line1).toBe('НАЧИНАЕМ ИГРУ!');
    expect(defaultFlowSpec.host.scripts.promptLetter.line2).toBe('БУКВУ!');
  });

  it('pairs NPC names and sprites exactly as the oracle Characters array (dpr:141)', () => {
    const ids = defaultAssetSpec.spriteIds;

    expect(defaultFlowSpec.npc.names).toEqual([
      'ИА-ИА', 'КАРЛСОН', 'КРОЛИК', 'СОВА', 'ПЯТАЧОК', 'ВИННИ-ПУХ', 'ФРЕКЕН БОК', 'БАГИРА',
    ]);
    expect(defaultFlowSpec.npc.spriteIds).toEqual([
      ids.CHARACTER_IA,
      ids.CHARACTER_CARLSEN,
      ids.CHARACTER_RABBIT,
      ids.CHARACTER_OWL,
      ids.CHARACTER_PYATACHOK,
      ids.CHARACTER_VINNY,
      ids.CHARACTER_FREKEN,
      ids.CHARACTER_BAGIRA,
    ]);
    // dpr pairing: КРОЛИК -> RABBIT (51) comes before СОВА -> OWL (50).
    expect(defaultFlowSpec.npc.names[2]).toBe('КРОЛИК');
    expect(defaultFlowSpec.npc.spriteIds[2]).toBe(ids.CHARACTER_RABBIT);
    expect(defaultFlowSpec.npc.names[3]).toBe('СОВА');
    expect(defaultFlowSpec.npc.spriteIds[3]).toBe(ids.CHARACTER_OWL);
  });

  it('encodes the oracle sector dispatch table (dpr:1245-1364)', () => {
    const reactions = defaultFlowSpec.wheel.sectorReactions;

    expect(reactions).toHaveLength(16);

    const indicesOf = (kind: string): number[] =>
      reactions.flatMap((reaction, index) => (reaction.kind === kind ? [index] : []));

    expect(indicesOf('bankrupt')).toEqual([14]);
    expect(indicesOf('prize')).toEqual([6]);
    expect(indicesOf('plus')).toEqual([12]);
    expect(indicesOf('x2')).toEqual([0]);
    expect(indicesOf('x4')).toEqual([2]);
    expect(indicesOf('zero')).toEqual([4, 10]);

    const valueSum = reactions.reduce(
      (sum, reaction) => sum + (reaction.kind === 'value' ? reaction.value : 0),
      0,
    );
    expect(valueSum).toBe(125);

    // Icon under the arrow for reaction i is SectorIcons[(16 - i) mod 16]
    // (DrawFortuneWheel geometry dpr:463-482 + dispatch dpr:1245-1249).
    const sectorIcons = defaultRenderSpec.wheel.iconOrder;
    reactions.forEach((reaction, i) => {
      expect(reaction.iconSpriteId).toBe(sectorIcons[(16 - i) % 16]);
    });
  });

  it('carries the 8 oracle stages and the DOS sound default', () => {
    expect(defaultFlowSpec.stages.count).toBe(8);
    expect(defaultFlowSpec.stages.names).toEqual([
      '1/64 ФИНАЛА',
      '1/32 ФИНАЛА',
      '1/16 ФИНАЛА',
      '1/8 ФИНАЛА',
      '1/4 ФИНАЛА',
      'ПОЛУФИНАЛ',
      'ФИНАЛ',
      'СУПЕРФИНАЛ',
    ]);
    expect(defaultFlowSpec.stages.names).toHaveLength(defaultFlowSpec.stages.count);
    expect(defaultRenderSpec.soundDefaultEnabled).toBe(false);
  });

  it('tracks the current known parity gaps in a machine-readable ledger', () => {
    const ids = defaultParityCases.map((entry) => entry.id);

    expect(ids).toContain('ts-lib-row-decoder-corrected');
    expect(ids).toContain('ts-dos-palette-byte-order-corrected');
    expect(ids).toContain('ts-main-flow-simplified');
    expect(ids).toContain('ts-host-dialog-approximate');
    expect(ids).toContain('ts-audio-approximation');
    expect(ids).toContain('dos-capture-lane-unprovisioned');
  });
});
