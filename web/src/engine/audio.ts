/**
 * 8 kHz PWM square-wave synth (dpr:176-241, 484-501).
 *
 * The original mixes into a 8192-sample DirectSound ring buffer; here pwm()
 * synthesizes into a power-of-two scratch buffer with the same wrap-around
 * semantics, and an AudioOutput sink plays the finished samples.
 */
import type { AudioApi, ClockApi, RngApi } from './types';

/** Ring buffer length in samples (AudioBufLen, dpr:99). */
export const AUDIO_BUF_LEN = 8192;
/** Playback rate: 8 samples per millisecond (dpr:110 `nSamplesPerSec: 8000`). */
export const SAMPLE_RATE = 8000;
/** Master output gain for the WebAudio sink. */
export const MASTER_GAIN = 0.15;

/**
 * Square-wave generator (dpr:197-228). Writes `duration*8` samples starting
 * at index `i` (wrapping at buf.length): half-period 4000/freq samples,
 * amplitude ±32767; freq 0 writes silence. Returns the next write index
 * (unwrapped). `buf.length` must be a power of two (the original masks with
 * `AudioBufLen-1`).
 */
export function pwm(buf: Int16Array, i: number, freq: number, duration: number): number {
  const len = buf.length;
  if (len === 0 || (len & (len - 1)) !== 0) {
    throw new Error(`pwm buffer length must be a power of two, got ${len}`);
  }

  let pulseWide: number;
  let amp: number;
  if (freq !== 0) {
    pulseWide = 4000 / freq;
    amp = 32767;
  } else {
    pulseWide = duration * 8;
    amp = 0;
  }

  let pos = 0;
  const j = i + duration * 8;
  while (i < j) {
    if (pos >= pulseWide) {
      pos -= pulseWide;
      amp = -amp;
    }
    pos += 1;
    buf[i & (len - 1)] = amp;
    i += 1;
  }

  return i;
}

/**
 * Sample sink. `samples` is only valid for the duration of the call
 * (the synth reuses its scratch buffer); copy if retaining.
 */
export interface AudioOutput {
  play(samples: Int16Array): void;
}

/** AudioApi implementation: PWM synth in front of a pluggable output. */
export class PwmAudio implements AudioApi {
  /** Master mute (EnableSound). DOS default is OFF (deviation table #13). */
  enabled = false;

  private readonly clock: ClockApi;
  private readonly rng: RngApi;
  private readonly output: AudioOutput;
  private readonly scratch = new Int16Array(AUDIO_BUF_LEN);

  constructor(clock: ClockApi, rng: RngApi, output: AudioOutput) {
    this.clock = clock;
    this.rng = rng;
    this.output = output;
  }

  pwm(buf: Int16Array, i: number, freq: number, duration: number): number {
    return pwm(buf, i, freq, duration);
  }

  /**
   * Single tone (dpr:230-241). Synthesis/playback is gated on `enabled`, but
   * the Delay ALWAYS happens — pacing is identical muted or not (dpr:239).
   */
  async sound(freq: number, durationMs: number): Promise<void> {
    if (this.enabled) {
      this.scratch.fill(0);
      const k = pwm(this.scratch, 0, freq, durationMs);
      this.output.play(this.scratch.subarray(0, Math.min(k, this.scratch.length)));
    }
    await this.clock.delay(durationMs);
  }

  /**
   * Raw sample playback (dpr:176-195). The original delays `size shr 4` ms
   * (size in bytes, 2 bytes/sample, 8 samples/ms) whether muted or not.
   */
  async playWav(samples: Int16Array): Promise<void> {
    if (this.enabled) {
      this.output.play(samples);
    }
    await this.clock.delay(samples.length / 8);
  }

  /**
   * 7-burst random mumble (dpr:484-501). The RNG is consumed even when muted
   * (SpeechSound always synthesizes; only PlayWAV checks EnableSound), which
   * keeps seeded runs reproducible regardless of the mute state.
   */
  async speechSound(): Promise<void> {
    this.scratch.fill(0);
    let k = 0;
    for (let i = 0; i <= 6; i += 1) {
      k = pwm(this.scratch, k, this.rng.random(100), 10 - i);
      k = pwm(this.scratch, k, 0, 1);
    }
    await this.playWav(this.scratch.subarray(0, k));
  }
}

/**
 * WebAudio sink through a master gain of 0.15.
 *
 * Safari notes: older WebKit only exposes `webkitAudioContext`, and some
 * versions reject `createBuffer` rates below 22050 Hz — so the 8 kHz samples
 * are upsampled to the context's native rate with nearest-neighbor, which
 * also preserves the hard square-wave edges better than the browser's
 * interpolating resampler.
 */
export class WebAudioOutput implements AudioOutput {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      return this.ctx;
    }
    if (typeof window === 'undefined') {
      return null;
    }
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN;
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.gain = gain;
    return ctx;
  }

  /** Resume a context suspended by the browser autoplay policy. */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  play(samples: Int16Array): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gain || samples.length === 0) {
      return;
    }
    const ratio = Math.max(1, Math.round(ctx.sampleRate / SAMPLE_RATE));
    const buffer = ctx.createBuffer(1, samples.length * ratio, SAMPLE_RATE * ratio);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i] / 32768;
      const base = i * ratio;
      for (let k = 0; k < ratio; k += 1) {
        channel[base + k] = value;
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.start();
  }
}

/** Recording sink for tests and headless runs. Stores copies of each play(). */
export class SilentOutput implements AudioOutput {
  readonly played: Int16Array[] = [];

  play(samples: Int16Array): void {
    this.played.push(samples.slice());
  }
}
