# Evidence

- `Pole2/PoleWin32.dpr:792-1605` contains the reconstructed DOS flow and the stage labels.
- `Pole2/PoleWin32.dpr:1037-1587` shows repeated `YakubovichTalk` call sites during participant presentation, stage prompts, wheel outcomes, and round/final wrap-up.
- `Pole2/Readme.md` calls out known Delphi-vs-original differences, which must be treated as suspect until the DOS binary confirms them.
- `web/src/spec/defaultSpecs.ts` now records the research order, stage count, wheel outcomes, editor constraints, and parity cases.
- `web/src/main.ts` reads the shared `totalRounds` value from the DOS-backed flow spec.
