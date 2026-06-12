# Reverse Engineering Workspace

This workspace stores the human-readable evidence trail for the DOS-first reimplementation.

## Canonical Machine Specs
- `web/src/spec/defaultSpecs.ts`
- `web/src/spec/types.ts`

The markdown files here record evidence, gaps, and acceptance criteria against that machine-readable layer. Update the spec layer first when a DOS fact becomes clear, then update the matching markdown artifact.

## Freeze Policy
- Treat `web/src/main.ts` as a runnable sandbox.
- Only add instrumentation, fixture hooks, or changes that align the sandbox with an already-documented subsystem.
- Do not use the sandbox as the authority when DOS and Delphi disagree.

## Research Order
1. `01-binary-assets`
2. `02-rendering-text-input`
3. `03-main-flow`
4. `04-npc-audio-timing`

## DOS Capture Lane
- Artifacts belong under `output/playwright/`.
- Decompiled asset inspection artifacts belong under `output/decompiled-assets/`.
- Static analysis is provisional until matched with reproducible DOS screenshots, traces, or input captures.
- The checked-in browser smoke harness is `cd web && npm run smoke`.
- The checked-in asset decompiler is `cd web && npm run decompile:assets`.

## Verification
- `cd web && npm run test`
- `cd web && npm run build`
- `cd web && npm run smoke`
