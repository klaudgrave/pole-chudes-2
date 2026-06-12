# Spec

- The canonical internal render surface is `640x350` with nearest-neighbor presentation scaling.
- The EGA-style palette is 16 colors and must be treated as indexed output, not arbitrary RGBA art replacement.
- `DrawSprite` semantics:
  - decode rows from the sprite archive
  - skip writes for the chosen transparent color
  - preserve row order and original draw offsets
- `Print` semantics:
  - glyph width is 8 pixels
  - supported heights are `6`, `8`, and `14`
  - glyph bytes are consumed MSB-first
  - common spans are `8`, `16`, and `20`
- `FillRect` writes horizontal runs into the framebuffer with a stride of 640 bytes.
- Stage compositor primitives currently confirmed from the Delphi reconstruction:
  - background bands at `y=0..9`, `10..11`, `13..106`, `108..109`, and `331`
  - floor fill rect at `x=0,y=111,width=640,height=238`
  - word board rect at `x=120,y=15,width=400,height=80`
  - board grid lines every 20 pixels vertically and 16 pixels horizontally
  - Yakubovich base/passive/eyes-open offsets at `(480,172)`, `(511,173)`, and `(532,209)`
- `ScreenCopy` copies rectangular regions row by row inside the same indexed screen buffer.
- Fortune wheel drawing order is fixed:
  1. clear wheel rect
  2. redraw player 1 overlap sprite
  3. draw wheel frame sprite
  4. draw sector icons from the 32-entry offset table
  5. draw arrow sprite
- Input primitives to document against DOS:
  - left/right cursor motion
  - space and mouse confirmation
  - enter for text acceptance
  - tab/minimize and sound toggles
  - escape exit
- The browser sandbox may expose instrumentation hooks, but they must not redefine the canonical behavior.
