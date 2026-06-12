# Delphi reference (behavioral oracle)

These files are UTF-8 decodings (from CP866) of the public-domain Delphi 7
reconstruction of the original `POLE2.EXE`:

- `PoleWin32.cp866.txt` — decoded copy of `PoleWin32.dpr`. **Line numbers match
  the upstream file exactly**, so every `dpr:NNN` citation in this repo's code
  comments, specs, and docs points into this file.
- `DSound.cp866.txt` — decoded copy of `DSound.inc` (the DirectSound include the
  reconstruction used for audio output).

## Provenance and license

Upstream: <https://github.com/fersatgit/Pole2> — a Win32 port written by
disassembling the original DOS `POLE2.exe`, released into the **public domain
(Unlicense)**. Per its README, the port is mostly a direct translation of the
16-bit DOS code, which is what makes it usable as a behavioral oracle for this
TypeScript port. The upstream repo also documents 13 intentional deviations
from the DOS original; this project's handling of each is recorded in
`DIFF_FROM_ORIGINAL.md` and `docs/architecture.md`.

Citations of the form `Pole2/PoleWin32.dpr:NNN` or `Pole2/Readme.md` throughout
this repository refer to the upstream repo; use `PoleWin32.cp866.txt` here to
look the lines up without the CP866 encoding hurdle.
