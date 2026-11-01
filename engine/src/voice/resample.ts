// Sample-rate conversion for voice (5.g4): 8 kHz old voice ↔ 44.1 kHz (the AI model) ↔ 24 kHz (Steam voice).
// Band-limited (windowed-sinc, Kaiser window) polyphase resampler for rational ratios: each output sample is a weighted
// sum of nearby input samples; the weights repeat every `up` outputs, so they are worked out once per phase.

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function besselI0(x: number): number {
  let sum = 1, term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

export interface ResampleOptions {
  /** Zero crossings of the filter on each side, counted at the lower of the two rates (default 64). */
  zeros?: number;
  /** Pass band as a fraction of the lower Nyquist frequency (default 0.96). */
  rolloff?: number;
  /** Kaiser window beta (default 12: about 120 dB stop band). Defaults chosen to come closest to librosa/soxr_hq
   * (what the 5.g1 reference uses): 61.8 dB SNR on 8 → 44.1 kHz voice. */
  beta?: number;
}

/** Resample mono audio from `from` Hz to `to` Hz. Output length = ceil(input length × to / from), as librosa. */
export function resample(input: Float32Array, from: number, to: number, o: ResampleOptions = {}): Float32Array {
  if (from === to) return input.slice();
  const g = gcd(from, to), up = to / g, down = from / g;
  const zeros = o.zeros ?? 64, rolloff = o.rolloff ?? 0.96, beta = o.beta ?? 12;
  // Filter cutoff relative to the input rate.
  const cutoff = (Math.min(from, to) / from) * rolloff; // as a fraction of the input Nyquist frequency
  const half = Math.ceil((zeros * from) / Math.min(from, to)); // half width in input samples
  const outLen = Math.ceil((input.length * to) / from - 1e-9);
  const out = new Float32Array(outLen);
  const i0b = besselI0(beta);
  // Phase p (0..up-1): output n with (n * down) % up = p sits p/up of an input sample after floor(n * down / up).
  const taps = 2 * half;
  const table = new Float32Array(up * taps);
  for (let p = 0; p < up; p++) {
    const frac = p / up;
    for (let k = 0; k < taps; k++) {
      const x = k - half + 1 - frac; // distance (input samples) from the output point to input sample (base - half + 1 + k)
      const t = (cutoff / 2) * 2 * x; // cutoff·x with cutoff as a fraction of the input Nyquist
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = x / (half + 1);
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
      table[p * taps + k] = cutoff * sinc * w;
    }
  }
  for (let n = 0; n < outLen; n++) {
    const pos = n * down;
    const base = Math.floor(pos / up), p = pos % up;
    const c = p * taps;
    let s = 0;
    const start = base - half + 1;
    if (start >= 0 && start + taps <= input.length) {
      for (let k = 0; k < taps; k++) s += table[c + k] * input[start + k];
    } else {
      for (let k = 0; k < taps; k++) { const i = start + k; if (i >= 0 && i < input.length) s += table[c + k] * input[i]; }
    }
    out[n] = s;
  }
  return out;
}

export const toFloat = (x: Int16Array): Float32Array => { const f = new Float32Array(x.length); for (let i = 0; i < x.length; i++) f[i] = x[i] / 32768; return f; };
export const toInt16 = (x: Float32Array): Int16Array => {
  const o = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32768)));
  return o;
};
