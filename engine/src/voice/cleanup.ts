// "Voice cleanup" setting (plan 2.8). ON by default since 2026-10-26 (owner preferred it after listening in game);
// "plain" keeps the voice exactly as decoded. Mirrors the ffmpeg
// chain tested on 2026-10-25 (highpass=110, lowpass=3400, equalizer 2.2 kHz +3 dB, dynaudnorm) with standard biquad
// filters (RBJ audio-EQ cookbook formulas) and a per-burst level evening. The FFT de-hiss step (afftdn) is not
// included yet.

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

function highpass(f: number, rate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * f) / rate, c = Math.cos(w), a = Math.sin(w) / (2 * q), n = 1 + a;
  return { b0: (1 + c) / 2 / n, b1: -(1 + c) / n, b2: (1 + c) / 2 / n, a1: (-2 * c) / n, a2: (1 - a) / n };
}
function lowpass(f: number, rate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * f) / rate, c = Math.cos(w), a = Math.sin(w) / (2 * q), n = 1 + a;
  return { b0: (1 - c) / 2 / n, b1: (1 - c) / n, b2: (1 - c) / 2 / n, a1: (-2 * c) / n, a2: (1 - a) / n };
}
function peaking(f: number, rate: number, gainDb: number, q = 1): Biquad {
  const A = 10 ** (gainDb / 40), w = (2 * Math.PI * f) / rate, c = Math.cos(w), a = Math.sin(w) / (2 * q), n = 1 + a / A;
  return { b0: (1 + a * A) / n, b1: (-2 * c) / n, b2: (1 - a * A) / n, a1: (-2 * c) / n, a2: (1 - a / A) / n };
}
function run(x: Float64Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Target loudness (RMS of speech, full scale = 32768) and the most a quiet burst is lifted. */
const TARGET_RMS = 3500, MAX_GAIN = 4;

export function voiceCleanup(pcm: Int16Array, rate: number): Int16Array {
  let x = Float64Array.from(pcm);
  x = run(x, highpass(110, rate));
  x = run(x, lowpass(Math.min(3400, rate * 0.45), rate));
  x = run(x, peaking(2200, rate, 3));
  return evenLevel(x, rate);
}

/**
 * Brings a burst's speech level (RMS of the louder half of 20 ms blocks) to TARGET_RMS (quiet bursts lifted at most
 * MAX_GAIN times), with a soft limit near full scale instead of clipping. Used by voice cleanup and, since 5.g6, by the
 * AI voice (owner: AI voice sounded quieter than the normal fix; it was ~9 dB lower because it skipped this step).
 */
export function evenLevel(input: ArrayLike<number>, rate: number): Int16Array {
  const x = input;
  const block = Math.round(rate * 0.02), levels: number[] = [];
  for (let p = 0; p + block <= x.length; p += block) {
    let s = 0;
    for (let i = p; i < p + block; i++) s += x[i] * x[i];
    levels.push(Math.sqrt(s / block));
  }
  levels.sort((a, b) => b - a);
  const loud = levels.slice(0, Math.max(1, Math.ceil(levels.length / 2)));
  const rms = loud.reduce((a, b) => a + b, 0) / loud.length;
  const gain = rms > 1 ? Math.min(MAX_GAIN, TARGET_RMS / rms) : 1;
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * gain;
    out[i] = Math.round(Math.abs(v) < 24000 ? v : Math.sign(v) * (24000 + 8767 * Math.tanh((Math.abs(v) - 24000) / 8767)));
  }
  return out;
}
