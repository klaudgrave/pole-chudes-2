# CLAUDE.md

Faithful browser port of the 1993 DOS game «Поле Чудес 2». The original
source code is lost; the port is built from the original data files and a
public-domain disassembly-based reconstruction. Accepted deviations:
`DIFF_FROM_ORIGINAL.md`. Design & deviation policy: `docs/architecture.md`.

## Hard constraints (non-negotiable)

1. DOS-first behavior and visuals; web-only runtime target.
2. 640×350 internal render surface with nearest-neighbor scaling.
3. CP866 text compatibility everywhere text is stored or compared.
4. Session-only state by default — no persistent player state. Question
   editing is session-scoped with explicit export/download.
5. Original assets only for in-game visuals/audio style; never ship custom
   replacement game graphics.
6. The playable game UI is primary; the admin/editor UI is secondary.

## Commands (run from `web/`)

- `npm run dev` — play (URL params: `?seed=42` deterministic run, `?fast=10` speed)
- `npm run test` / `npm run build` / `npm run smoke` / `npm run verify`
- Required after any gameplay/rendering/input/audio change: test + build + smoke.

## Conventions

- The behavioral oracle is `reference/delphi/PoleWin32.cp866.txt` (public-domain
  reconstruction of POLE2.EXE; line numbers match upstream `PoleWin32.dpr`).
  Code comments cite it as `dpr:NNN`. Never "fix" oracle constants or strings.
- Spec-first: when a DOS fact lands, update `web/src/spec/defaultSpecs.ts`
  (test-pinned) and `reverse-engineering/parity-ledger.md` together.
- Intentional behavior deviations are documented in `DIFF_FROM_ORIGINAL.md`
  and referenced from the code as `DIFF #N`.
- The smoke harness and tests drive the game через `window.__poleDebug`
  (snapshot + injectKey) — keep that contract in lockstep with `main.ts`.
- Keep TypeScript strict; keep parser/codec logic deterministic and testable;
  preserve the module boundaries in `web/src`.
- If sprites look broken, debug palette/indexed-color handling, sprite
  offsets, transparency rules, and draw order before touching art.
- Originals and non-publishable material live in gitignored `_local/`.

## Main goal: eliminate the original binary files — DONE, 100% converted

The repo ships **zero original binary files**: code is TypeScript, graphics
are editable lossless WebP images, text/data are JSON. Status by original
bytes (the five files the DOS game required, 178,777 B):

| File | Bytes | Kind | Status |
|---|---:|---|---|
| POLE2.EXE | 56,528 | executable code | **converted** — 100% of behavior is TypeScript (`web/src/engine/`, `web/src/game/`); the EXE is not shipped or executed |
| POLE2.LIB | 86,144 | sprite data | **converted** — 61 lossless WebP images (`assets/sprites/NN-name.webp`, one per sprite, openable in any image editor) + `POLE2.LIB.json` manifest (sprite order + verbatim block padding); rebuilt byte-exactly by `rebuildLib` via the inferred row-RLE packer rule |
| POLE.OVL | 28,833 | question data | **converted** — `POLE.OVL.json` (question text + per-record residue bytes) |
| POLE.FNT | 7,168 | font data | **converted** — 3 lossless WebP glyph atlases (`assets/fonts/font-{6,8,14}.webp`, 16×16 glyphs, white = bit set) + `POLE.FNT.json` manifest |
| POLE.PIC | 104 | top-8 data | **converted** — `POLE.PIC.json` (8 name/score records + residue bytes) |

Fidelity invariants (keep these true):

- The sources in `web/public/assets/` rebuild each original binary
  byte-for-byte; `web/src/assets/transcoded.test.ts` pins sha256 + size via
  `defaultAssetSpec.transcodedAssets` and byte-compares against the `_local`
  fixtures when present.
- Sprite WebPs use exactly the 16 opaque EGA palette colors of
  `defaultRenderSpec.palette` (font atlases: opaque black/white only); decode
  maps RGB back to palette indices and fails loudly on any off-palette or
  translucent pixel. The WebP bytes themselves are not pinned — the decoded
  pixels are the source of truth (`web/src/assets/spriteImage.ts`).
- The original binaries live only in gitignored `_local/Pole Chudes 2/` as
  test fixtures. Do not modify them, and never ship binaries from
  `web/public/assets` again. To restore pristine assets, regenerate from the
  fixtures with `npm run transcode:assets` (self-verifying); editing a
  shipped image intentionally forks the art and will fail the fidelity tests.
  Never hand-edit the JSON manifests.
- Transcoding changes the format, not the provenance — the art/data remain
  the original author's work (see README).
