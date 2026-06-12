# Evidence

- `rabin2 -I "Pole Chudes 2/POLE2.EXE"` confirms `MZ`, `bits=16`, `os=DOS`, and `binsz=56528`.
- `strings` and `rabin2 -zz` expose the asset filenames used by the executable and DOS-era strings such as the EGA mode names and embedded mailing address.
- `Pole2/imHex/LIB.hexpat` documents the sprite archive layout and row-RLE decoder.
- `Pole2/PoleWin32.dpr` `DrawSprite` confirms the exact row decoder shape: `f := i + rowLen + 2`, then `inc(i, 3)` so the first run length is read from `data[i - 1]`.
- `web/src/assets/lib.ts` now follows that decoder, and sampled sprite output is constrained to palette indices `0..15` instead of impossible values such as `191` or `208`.
- `Pole2/imHex/FNT.hexpat` documents the three font planes and 8-pixel glyph width.
- `Pole2/imHex/OVL.hexpat` documents the 21-byte encrypted string records and CP866 mapping.
- `Pole2/imHex/PIC.hexpat` documents the 8-entry leaderboard structure.
- `Pole2/imHex/LIB.hexpat` includes a visualization palette, but its constants are not direct runtime RGB triples. `Pole2/PoleWin32.dpr:127` provides the DIB `bmiColors` table that the web renderer should match.
- `web/src/assets/parsers.test.ts` validates the current TypeScript parsers against the original binary assets.
- `web/scripts/decompile-assets.mjs` emits a standalone inspection viewer at `output/decompiled-assets/` using the original DOS assets and the shared spec layer. `index.html` now embeds the manifest so it can be opened directly from disk.
