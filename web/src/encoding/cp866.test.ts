import { describe, expect, it } from 'vitest';

import { canEncodeCp866, decodeCp866, encodeCp866 } from './cp866';

describe('CP866 encoding helpers', () => {
  it('round-trip core Cyrillic and yo characters', () => {
    const sample = 'АБВ Ё ё';
    const encoded = encodeCp866(sample);

    expect(Array.from(encoded)).toEqual([0x80, 0x81, 0x82, 0x20, 0xf0, 0x20, 0xf1]);
    expect(decodeCp866(encoded)).toBe(sample);
  });

  it('reports unsupported characters before lossy export paths are used', () => {
    expect(canEncodeCp866('ПОЛЕ')).toBe(true);
    expect(canEncodeCp866('POLE')).toBe(true);
    expect(canEncodeCp866('€')).toBe(false);
  });
});
