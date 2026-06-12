# Spec

- Audio primitives from the reconstruction are:
  - `PWM`
  - `Sound`
  - `PlayWAV`
  - speech/noise helper routines
- Timing in the original flow is blocking and delay-driven. Browser approximations must be derived from captured timings, not from convenience alone.
- NPC behavior belongs here because it is timing-sensitive and tied to original branching:
  - select letter from the guessed word under some conditions
  - otherwise pick from remaining alphabet
  - behavior depends on remaining hidden letters and current stage
- Current browser instrumentation may expose debug state, but production parity decisions still require DOS evidence.
