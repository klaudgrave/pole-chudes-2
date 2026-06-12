# Acceptance

- `defaultRenderSpec` owns palette, surface size, wheel geometry, and shared text metrics.
- Browser smoke flow runs without console errors and writes artifacts under `output/playwright/`.
- At least one capture-backed comparison exists for:
  - initial board
  - wheel stop
  - letter reveal
- Any accepted layout difference is recorded in `DIFF_FROM_ORIGINAL.md`.
