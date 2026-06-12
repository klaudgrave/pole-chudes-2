# Evidence

- `Pole2/PoleWin32.dpr:247-457` contains `DrawSprite`, `Print`, `FillRect`, `Line`, and `ScreenCopy`.
- `Pole2/PoleWin32.dpr:656-766` documents the current reconstructed input handling in `WndProc`.
- `Pole2/PoleWin32.dpr:463-481` documents the draw order for the fortune wheel, including the player overlap quirk.
- `Pole2/PoleWin32.dpr:950-1021` documents the stage compositor primitives: the five background color bands, the floor fill at `y=111`, the 400x80 board grid at `x=120,y=15`, and the three-part Yakubovich stack.
- `Pole2/PoleWin32.dpr:503-545` documents `YakubovichSetSilent` and `YakubovichTalk`, including the bubble placement at `0x164DF`, the passive/active body swap, and the two eye overlay positions used during speech.
- `Pole2/PoleWin32.dpr:127` provides the active 16-color `bmiColors` table; the runtime palette must follow that byte order rather than reading the ImHex helper palette as literal RGB.
- `web/src/spec/defaultSpecs.ts` now captures the palette, player positions, stage background bands, board grid geometry, Yakubovich overlay offsets, wheel geometry, transparency classes, and input mappings as serializable data.
- `web/src/main.ts` reads the shared render/flow specs instead of duplicating the DOS constants locally.
- `output/decompiled-assets/index.html` is a standalone asset inspection viewer generated from the original binaries and shared specs for sprite/font/question/leaderboard verification.
