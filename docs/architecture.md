# Full TypeScript Port — Architecture & Deviation Policy

Goal: replace the sandbox game in `web/src/main.ts` with a complete, faithful TypeScript
implementation of the DOS game, eliminating all invented logic. The behavioral oracle is the
public-domain (Unlicense) Delphi reconstruction `Pole2/PoleWin32.dpr` (UTF-8 decoded copy:
`reference/delphi/PoleWin32.cp866.txt`, line numbers match), corrected toward DOS where
the Delphi port documents its own deviations (`Pole2/Readme.md`). The full extracted behavioral
spec was extracted by a multi-agent analysis pass (kept locally; summary below and in the parity ledger).

## Module layout (extends existing boundaries, per CLAUDE.md)

```
web/src/
  assets/         existing parsers (lib/fnt/ovl/pic) — unchanged
  encoding/       existing cp866 — unchanged
  spec/           machine-readable specs — corrected & extended (see below)
  engine/
    types.ts      Machine facade interfaces (FROZEN contract, hand-written)
    screen.ts     indexed framebuffer + DrawSprite/Print/FillRect/ScreenCopy/Line + presenter
    input.ts      KeyPressed/Enter auto-reset events, hand cursor, UserInput text entry
    audio.ts      8 kHz PWM square-wave synth: pwm/sound/playWav/speechSound
    timing.ts     Clock: delay(ms) with abort + speed factor; VirtualClock for tests
    rng.ts        Delphi-compatible LCG (seed*134775813+1; random(n) = high 32 bits of seed*n)
  game/
    constants.ts  characters, prizes, stage names, sector tables, strings (from Delphi consts)
    script.ts     direct port of MainThread: splash → stage loop → endgame (hand-written)
  main.ts         bootstrap: canvas, asset load, admin panel (kept), debug API (hand-written)
```

## Core fidelity decisions

1. **Linear framebuffer, original offsets.** One `Uint8Array(640*750)`. Visible area = rows
   0..349. `BACKBUF = 400*640`, `BACKBUF2 = 350*640` are scratch regions used by save/restore
   `screenCopy`. All drawing uses linear byte offsets (`ofs = y*640 + x`) exactly like the
   original; **no rectangular clipping** — writes wrap across row edges as in DOS (this is
   observable behavior, e.g. money-stack jitter). Only guard against writes outside the buffer.
2. **drawSprite(sprite, ofs, transparentColor)** consumes the already-decoded `PoleSprite`
   pixels but compares transparency against the FULL byte value (tc=16 is meaningful; decoded
   pixels are not masked to 0..15).
3. **print(bytes, ofs, color, glyphHeight, span)**: 8-px-wide glyphs, MSB-first
   (`0x80 >> col`), glyph row = `font[code*height + row]`, set-bits painted with `color`,
   clear bits transparent, advance `span` bytes per char. Text accepted as CP866 bytes or JS
   string (encoded via encoding/cp866).
4. **Presenter**: 50 fps tick (20 ms accumulator over rAF); blits rows 0..349 through the
   BITMAPINFO palette already in defaultSpecs; increments `frame`; draws the UserInput caret
   (8x2 underline at `ofs+12*640`, color `((frame/25)&1)*7`) only while `len < maxLen`.
5. **Blocking → async.** Every `Delay`/`WaitForSingleObject` becomes `await` on the Machine
   clock/input. The whole game is one cancellable async function (`AbortSignal`); "New game"
   and Esc abort and restart the script.
6. **Auto-reset events.** Space keydown / mouse-down set KeyPressed; Enter keydown sets Enter;
   keyup resets. `waitKeyPressed(timeout)` consumes the event like WaitForSingleObject.
   Poll variant for the hand-cursor loops (`WaitForSingleObject(...,0)`).
7. **RNG**: Delphi LCG, seedable via `?seed=` for deterministic tests/smoke. Default seed from
   `Date.now()` at bootstrap (the script itself never calls Date).
8. **Speed factor** via `?fast=` (scales every delay/timeout) for smoke; VirtualClock +
   scripted input for unit tests.
9. **Audio**: generate Int16 samples at 8000 Hz per the PWM routine
   (half-period = 4000/freq samples, duration*8 samples, amplitude ±32767, freq 0 = silence),
   play via WebAudio at master gain ≈0.15. `sound()`/`playWav()` always await their original
   delays (duration ms / bytes>>4 ms) regardless of mute — pacing identical muted or not.
10. **Session-only state**: POLE.PIC top-8 updates stay in memory (exact strict-less insertion,
    0-based rank labels, `%u$` score text, inserted-row-only highlight color 5). Question pool
    is the live session-edited list from the admin panel.

## OVL indexing (evidence-corrected)

Real file: 1373 records, header "686", pairs are (word = record 2k−1, theme = record 2k),
k = 1..686 — verified directly against POLE.OVL content. The literal Delphi indexing
(theme=2w, word=2w+1) mispairs word w+1 with theme w and reads out of bounds at w=686; we keep
the parser's evidence-correct pairing. Decryption (−32 per byte, header plain) already matches.

## DOS-vs-Delphi deviation policy (gameplay-relevant)

| # | Topic | Delphi | DOS | Port decision |
|---|-------|--------|-----|---------------|
| 4 | Box trigger | 3 opened letters (`LettersForBox += k`) | 3 successful moves | **DOS**: +1 per successful move (k>0); reset on turn pass and after box game |
| 5 | NPC agency | NPCs choose boxes/prize (random) | NPCs could not | **DOS-leaning**: box game only offered to human seats; NPC on ПРИЗ always answers "Играем!" |
| 7 | Prize haggling | may stop early (`i=0 or random(2)=1`) | always bargains to МИЛЛИОН | **DOS**: hand prize only at i=0 |
| 10 | Player speech | human also gets speech bubbles | only NPCs spoke | **DOS**: PlayerTalk only for NPC seats |
| 12 | Word repeats | PrevWords avoidance | repeats possible | **Delphi (accepted deviation)**: keep avoidance; if pool < 8 questions allow repeats (avoids the soft-lock) — document in DIFF_FROM_ORIGINAL.md |
| 2/3 | Empty name | seat becomes NPC | seats 2-3 stayed human | **Delphi (accepted deviation)**: NPC fallback enables single-player web play; seat 0 (1-ый ИГРОК) is never prompted, exactly as in the code |
| 13 | Sound default | on | off | **DOS**: muted until Ctrl+S or on-screen toggle (also satisfies browser autoplay policy) |
| 1 | Word/title centering | centered | not centered (placement unknown) | Keep Delphi formulas; parity case stays open pending DOS capture |
| 11 | Solve input | typed on board | unknown mechanism | Keep Delphi board-typed input; parity case stays open |
| — | Esc | ExitProcess | exit to DOS | abort game → return to splash (browser can't exit); document |
| — | Tab boss key | mute + minimize | mute (no minimize concept) | mute only; document |
| — | Alt+Enter | fullscreen toggle | always fullscreen | browser Fullscreen API on the canvas wrapper |

Everything else follows the Delphi code paths verbatim (they are the direct translation of the
DOS disassembly): sector dispatch on `i = CurSector >> 1` (14 БАНКРОТ; 4,10 ноль; 12 ПЛЮС;
0/2 x2/x4; 6 ПРИЗ; else +SectorValues[i]); score set to precomputed `size` only when letters
found (no per-letter multiplication); NPC letter AI (`RemaindLetters*2 < len && random(Stage+2)>0`
→ pick from word, else random alphabet); wheel spin `(random(10)+5)*2` ticks with delay 10+3/tick;
assistant walk/flip animation; adware between stages; endgame ceremony; top-8 semantics;
splash sequence; name-entry WM_CHAR filter (CP866 byte ≥ '0', Alt-bit rejected, backspace
double-clear, caret suppression when full); winner carry-over (`Winner` seat keeps name, score,
sprite); eliminated players keep Score (only БАНКРОТ zeroes it); prize/money outcomes never
touch Score; all-eliminated → adware skip path with Winner=3.

## UI shell

Play tab: the 640x350 canvas (pixelated, 2x default) + one hint line + sound toggle button.
All gameplay interaction is DOS-authentic: Space/click = confirm, arrows = hand, Enter = accept
text, letters typed during name/word entry, Ctrl+S sound, Esc back to splash. The HTML letter
grid / spin / solve buttons of the sandbox are removed. Admin tab unchanged (question editor,
OVL import/export, status). `window.__poleDebug` gets a richer snapshot (scene, stage, seats,
word state, sector) + `injectKey()` used by the smoke harness; keep it in lockstep with
scripts/playwright-smoke.mjs.

## Verification

- Unit: engine primitives against hand-computed expectations; game logic scenarios on
  VirtualClock + scripted input + fixed seed (sector dispatch incl. БАНКРОТ/ноль/ПЛЮС/x2/x4/ПРИЗ,
  letter scoring, box trigger semantics, haggling ladder, elimination, all-eliminated, word
  selection fallback, top-8 insertion incl. ties and no-insert, name-entry filter).
- Smoke: deterministic seeded run (`?seed=…&fast=…`), drives splash → name entry → human turn
  (spin, letter, solve) via injected keys, asserts via debug snapshots, screenshots to
  output/playwright/.
- Adversarial review: per-subsystem agents diff the TS implementation against the Delphi source
  line-by-line before sign-off.
