import { describe, expect, it } from 'vitest';

import { defaultAssetSpec, defaultFlowSpec } from '../spec';
import {
  ALPHABET_LEN,
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

const spriteIds = defaultAssetSpec.spriteIds;

describe('game constants (oracle data tables)', () => {
  it('have the oracle table lengths', () => {
    expect(CHARACTERS).toHaveLength(8);
    expect(SEATS).toHaveLength(3);
    expect(PLAYER_ROUND_NAMES).toHaveLength(3);
    expect(MONEY_VALUES).toHaveLength(4);
    expect(PRIZES).toHaveLength(10);
    expect(STAGE_NAMES).toHaveLength(8);
    expect(SECTOR_VALUES).toHaveLength(16);
    expect(SECTOR_ICONS).toHaveLength(16);
    expect(WHEEL_OFFSETS).toHaveLength(32);
    expect(DECISION_ANIM).toHaveLength(5);
    expect(ALPHABET_LEN).toBe(32);
  });

  it('pair character names with sprite ids in dpr:141 order', () => {
    expect(CHARACTERS.map((c) => c.name)).toEqual([
      'ИА-ИА', 'КАРЛСОН', 'КРОЛИК', 'СОВА', 'ПЯТАЧОК', 'ВИННИ-ПУХ', 'ФРЕКЕН БОК', 'БАГИРА',
    ]);
    // The dpr pairing puts КРОЛИК (RABBIT=51) before СОВА (OWL=50).
    expect(CHARACTERS[2]).toEqual({ spriteId: spriteIds.CHARACTER_RABBIT, name: 'КРОЛИК' });
    expect(CHARACTERS[3]).toEqual({ spriteId: spriteIds.CHARACTER_OWL, name: 'СОВА' });
    expect(CHARACTERS.map((c) => c.spriteId)).toEqual([48, 49, 51, 50, 53, 54, 55, 56]);
  });

  it('match the Players seat constants (dpr:138-140)', () => {
    expect(SEATS[0]).toEqual({
      spriteOfs: 0xd0 + 0x76 * 640,
      talkBubbleOfs: 0xd0 + 0x76 * 640 - 17888,
      labelOfs: 0x78 * 640 + 0x122,
      moneyOfs: 0x76 * 640 + 0x78,
      caption: '1-ый ИГРОК',
    });
    expect(SEATS[1].spriteOfs).toBe(0x8 + 0xdb * 640);
    expect(SEATS[1].labelOfs).toBe((0xdf + 0x50) * 640 + 0x4);
    expect(SEATS[1].moneyOfs).toBe(0xc1 * 640 + 0x18);
    expect(SEATS[2].spriteOfs).toBe(0x168 + 0xdb * 640);
    expect(SEATS[2].labelOfs).toBe((0xdf + 0x50) * 640 + 0x164);
    expect(SEATS[2].moneyOfs).toBe(0xc1 * 640 + 0x178);
    expect(SEATS.map((s) => s.caption)).toEqual(['1-ый ИГРОК', '2-ой ИГРОК', '3-ий ИГРОК']);
    for (const seat of SEATS) {
      expect(seat.talkBubbleOfs).toBe(seat.spriteOfs - 17888);
    }
  });

  it('keep the verbatim string tables', () => {
    expect(PLAYER_ROUND_NAMES).toEqual(['Первый игрок', 'Второй игрок', 'Третий игрок']);
    expect(MONEY_VALUES).toEqual(['МИЛЛИОН', 'СТО ТЫЩ', 'ТЫЩА', 'СТО']);
    expect(PRIZES[0]).toBe('ЗУБНУЮ ЩЕТКУ');
    expect(PRIZES[2]).toBe('Расчестку для усов'); // original misspelling preserved
    expect(PRIZES[9]).toBe('Пивную открывашку');
    expect(STAGE_NAMES[0]).toBe('1/64 ФИНАЛА');
    expect(STAGE_NAMES[7]).toBe('СУПЕРФИНАЛ');
  });

  it('match SectorValues and SectorIcons (dpr:804, dpr:468)', () => {
    expect(SECTOR_VALUES).toEqual([0, 5, 0, 20, 0, 10, 0, 15, 25, 10, 0, 5, 0, 20, 0, 15]);
    expect(SECTOR_VALUES.reduce((sum, v) => sum + v, 0)).toBe(125);
    expect(SECTOR_ICONS).toEqual([
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
    ]);
  });

  it('reproduce the wheel offset table from the documented formula (dpr:465-467)', () => {
    expect(WHEEL_OFFSETS[0]).toBe(0x1aee5);
    expect(WHEEL_OFFSETS[31]).toBe(0x1b155);
    for (let i = 0; i < 32; i += 1) {
      const x = (i * Math.PI) / 16 - Math.PI / 2;
      const expected = Math.round(Math.cos(x) * 84) + 0xe5 + (Math.round(Math.sin(x) * 63) + 0xeb) * 640;
      expect(WHEEL_OFFSETS[i]).toBe(expected);
    }
  });

  it('keep the decision animation sequence of dpr:591', () => {
    expect(DECISION_ANIM).toEqual([
      spriteIds.PLAYER_CHOOSE_LEFT,
      spriteIds.PLAYER_LEFT,
      spriteIds.PLAYER,
      spriteIds.PLAYER_RIGHT,
      spriteIds.PLAYER_CHOOSE_RIGHT,
    ]);
  });

  it('agrees with the flow-spec sector reactions', () => {
    const reactions = defaultFlowSpec.wheel.sectorReactions;
    expect(reactions).toHaveLength(16);
    reactions.forEach((reaction, i) => {
      // Values: every value reaction carries SectorValues[i]; non-value slots are 0 there.
      if (reaction.kind === 'value') {
        expect(reaction.value).toBe(SECTOR_VALUES[i]);
      } else {
        expect(SECTOR_VALUES[i]).toBe(0);
      }
      // Icon under the arrow for reaction i is SectorIcons[(16 - i) mod 16].
      expect(reaction.iconSpriteId).toBe(SECTOR_ICONS[(16 - i) % 16]);
    });
  });
});
