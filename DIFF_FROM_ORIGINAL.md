# DIFF_FROM_ORIGINAL

Accepted, intentional deviations of the TypeScript port from the original DOS game.
The behavioral oracle is the public-domain Delphi reconstruction (`Pole2/PoleWin32.dpr`);
where that reconstruction itself deviated from DOS (per `Pole2/Readme.md`), the port
follows DOS unless noted. Full policy with rationale: `docs/architecture.md`.

## Web-platform substitutions (no DOS equivalent possible)

1. **Esc** restarts to the splash screen instead of exiting to DOS (`ExitProcess`).
   As in the original, nothing is persisted on exit.
2. **Tab** (boss key) mutes the sound but cannot minimize the browser window.
3. **Alt+Enter** toggles fullscreen via the browser Fullscreen API instead of the
   Win32/DOS mode switch.
4. **Top-8 list (POLE.PIC)** is updated in session memory only — never written to disk
   (CLAUDE.md hard constraint). Insertion semantics (strict-less, 0-based rank labels,
   `$` suffix, inserted-row highlight) match the original exactly.
5. The two hand-cursor busy-loops yield to the event loop every 10 ms (the original
   busy-waited the CPU); timing of all visible behavior is unaffected.
6. Sound is produced by an 8 kHz PWM synth through WebAudio at a fixed master gain.
   Envelopes, frequencies, durations, and pacing replicate the original routines;
   the speaker timbre is an approximation (parity case `ts-audio-approximation`).

## Evidence-based corrections to the reconstruction

7. **OVL pairing**: words are odd records, themes even records (verified directly
   against POLE.OVL). The literal reconstruction indexing pairs word w+1 with theme w
   and reads out of bounds at the last word; the port uses the verified pairing.

## DOS-first policy calls (reconstruction deviated; port follows DOS, capture-unverified)

8. **Box (шкатулки) trigger**: after 3 successful moves (DOS) rather than 3 opened
   letters (reconstruction), and offered to human seats only.
9. **NPC on СЕКТОР ПРИЗ**: always answers «Играем!» — NPCs never take the prize.
10. **Prize bargaining**: Yakubovich always escalates to МИЛЛИОН before handing over
    the prize (the reconstruction could stop earlier at random).
11. **Player speech**: only NPC seats get speech bubbles; the human plays silently.

## Reconstruction behaviors kept although DOS differed

12. **Player modes.** The web default is «1 игрок + 2 НПС»: only seat 2 is
    prompted for a name and an empty name keeps the seat human as «ИГРОК».
    The settings tab offers «2 игрока (как в оригинале)», which restores the
    original prompts for seats 2–3 with the reconstruction's empty-name → NPC
    fallback (DOS itself kept unnamed seats human). Seat 1 is never prompted
    in any mode, exactly as in the code.
13. **Word-repeat avoidance across stages** (DOS could repeat words): kept; if the
    session question pool has fewer than 8 entries, repeats are allowed to avoid the
    original's selection soft-lock.
14. **Word/round-title centering** and the **board-typed word entry** follow the
    reconstruction; the DOS placement/mechanism is unknown pending captures
    (parity case `ts-text-centering-provisional`).

## Minor

15. The brick-wall pattern was effectively fixed in the original (drawn before the
    RNG was seeded); the port draws it from the seeded RNG stream, so it varies per
    run and follows `?seed=`.
16. The admin question editor sanitizes words to А–Я (a word containing any other
    byte could never be completed or solved by the engine).
17. Sound defaults to OFF — this matches DOS (the reconstruction turned it on by
    default); listed here for visibility, not a deviation.
18. **Wheel spin animation** (dpr:1229-1244): the original travels
    `(random(10)+5) shl 1` = 10..28 half-steps — always under one revolution and
    always an even count, so against the symmetric two-color 16-wedge art every
    spin *looked* like the same two-segment nudge (landing sectors were random;
    the perceived rotation was not). The port prepends two full extra revolutions
    (+64 half-steps ≡ 0 mod 32) at constant speed before the original
    deceleration: the same single `random(10)` draw, the same landing sector,
    and the same RNG stream — only the visible animation is longer. Landings
    stay even-aligned: an odd rest would park the arrow exactly between two
    sector icons (verified by rendering).
