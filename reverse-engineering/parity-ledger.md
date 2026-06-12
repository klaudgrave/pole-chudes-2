# Parity Ledger

Canonical machine-readable parity cases live in `web/src/spec/defaultSpecs.ts` as `defaultParityCases`.

## Open / Planned
- `ts-text-centering-provisional`: word/round-title centering follows the Delphi reconstruction, which itself deviated from DOS; the DOS placement needs capture proof.
- `ts-audio-approximation`: the PWM synth and every envelope are now ported, but the WebAudio timbre is unvalidated against captured DOS PC-speaker output.
- `ts-npc-heuristics-unconfirmed`: the disassembly-derived NPC branch is implemented; DOS trace confirmation pending.
- `dos-capture-lane-unprovisioned`: reproducible DOS capture workflow is still missing — it gates final parity sign-off for the three items above and the DOS-vs-Delphi policy calls listed in `DIFF_FROM_ORIGINAL.md`.

## Confirmed
- `ts-main-flow-simplified`: RESOLVED — the full MainThread flow is ported scene-for-scene in `web/src/game/script.ts` (splash, presentation, 8 stages, hand-cursor input, boxes, prize bargaining, adware, endgame, session top-8), verified by headless full-game integration tests and the smoke flow.
- `ts-host-dialog-approximate`: RESOLVED — the complete Yakubovich/Player dialogue call tree is ported with exact strings and save/restore regions.
- `ts-ovl-pairing-evidence-corrected`: OVL pairing (word=odd record, theme=even record) verified directly against POLE.OVL; the literal Delphi indexing mispairs and overruns.
- `ts-lib-row-decoder-corrected`: sprite decode follows the DOS/Delphi row-RLE routine.
- `ts-assets-transcoded-byte-exact`: RESOLVED — the four data files ship as editable sources that rebuild the original binaries byte-for-byte (sha256-pinned in `defaultAssetSpec.transcodedAssets`, byte-compared against `_local` fixtures when present). Graphics are lossless WebP images: 61 per-sprite images (`web/public/assets/sprites/`, opaque EGA-palette colors, RGB↔index mapping exact both ways) and 3 font glyph atlases (`web/public/assets/fonts/`, 16×16 glyphs, white = bit set); slim JSON manifests carry only the non-derivable bytes. OVL/PIC remain JSON. The POLE2.LIB row-RLE packer rule was inferred from the file itself: emit a run token for 3+ equal pixels, or exactly 2 when no literal is pending (an RLE pair ties appending to an open literal but beats opening a new one); both token kinds cap at 127; every row ends with an empty-literal 0x00 terminator; the sprite-header word at offset 4 is always 0. Verified against all 3851 sprite rows. Non-derivable writer garbage — OVL/PIC record residue and LIB block padding (stale buffer fragments) — is preserved verbatim in the manifests. The WebP container bytes are not pinned (encoder version may vary); the decoded pixels are the source of truth, and both the transcode script and the tests verify the rebuild from the decoded images.
- `ts-dos-palette-byte-order-corrected`: shared render palette matches the DOS asset corpus.
- `playwright-smoke-now-checked-in`: smoke flow drives the full DOS-style game via the debug API and is artifact-producing.
