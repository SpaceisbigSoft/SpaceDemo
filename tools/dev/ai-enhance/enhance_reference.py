# 5.g1 reference: AI voice enhancement as chosen in 1.6d (Spike 3), rebuilt.
#   python enhance_reference.py <tracks dir> <out.wav> [--size full|mixed] [--smooth] [--no-loudness] [--cache <dir>]
# <tracks dir> comes from tools/dev/ai-enhance/voice-tracks.ts (track_<slot>.wav, tracks.json, 8 kHz).
# Steps per player: talk bursts joined with 0.2 s silences -> VoiceFixer mode 0 (44.1 kHz out) -> cut back into bursts
# and put on the timeline at their original places -> loudness matched per burst -> optional smooth endings -> mixed.
# Mixed sizing (151 MB): vocoder weights fp16; every other weight with 2+ dimensions int8 with one fp16 scale per
# output channel; 1-D weights fp16. Applied here by rounding the weights (same numbers the compact file will hold).
# Needs Python 3.11 + torch + voicefixer, model files in ~/.cache/voicefixer (see Reference -> Settings).
import argparse, json, os, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np, soundfile as sf, torch

OUT_RATE = 44100
GAP = 0.2  # seconds of silence between joined bursts


def mixed_sizing(model):
    """Round the weights to what the 151 MB file stores (see header)."""
    with torch.no_grad():
        for name, p in model.named_parameters():
            if name.startswith('vocoder.') or p.dim() < 2:
                p.copy_(p.half().float())
            else:
                w = p.reshape(p.shape[0], -1)
                scale = (w.abs().amax(dim=1) / 127).half().float()  # an all-zero row keeps scale 0
                q = torch.clamp(torch.round(w / torch.where(scale > 0, scale, 1)[:, None]), -127, 127)
                p.copy_((q * scale[:, None]).reshape(p.shape))


def envelope(x, rate, attack=0.005, release=0.040):
    """Peak follower: fast rise (attack), slow fall (release)."""
    a, r = np.exp(-1 / (attack * rate)), np.exp(-1 / (release * rate))
    e, out = 0.0, np.empty(len(x))
    ax = np.abs(x)
    for i, v in enumerate(ax):
        e = a * e + (1 - a) * v if v > e else r * e + (1 - r) * v
        out[i] = e
    return out


def smooth_ending(enh, orig44, knee_db=-24.0, power=1.5, floor_db=-45.0, fade=0.020):
    """Smooth word endings: gain from the original voice's envelope (attack 5 ms, release 40 ms) relative to the
    burst's peak: 1 above peak -24 dB, (env / knee)^1.5 below it, 0 below peak -45 dB; then a 20 ms fade-out.
    The 1.6d code is lost (16ade37); knee and power were fitted to trial samples 12 -> 14 (5.g1, 2026-11-01)."""
    env = envelope(orig44, OUT_RATE)
    peak = env.max()
    if peak <= 0: return enh
    g = np.minimum(1.0, (env / (peak * 10 ** (knee_db / 20))) ** power)
    g[env < peak * 10 ** (floor_db / 20)] = 0
    out = enh * g
    n = min(len(out), int(fade * OUT_RATE))
    if n: out[-n:] *= np.linspace(1, 0, n)
    return out


def rms(x): return float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tracks'); ap.add_argument('out')
    ap.add_argument('--size', choices=['full', 'mixed'], default='mixed')
    ap.add_argument('--smooth', action='store_true')
    ap.add_argument('--no-loudness', action='store_true')
    ap.add_argument('--cache', help='keep VoiceFixer output per player here (reused when present)')
    a = ap.parse_args()
    meta = json.load(open(os.path.join(a.tracks, 'tracks.json')))
    rate = meta['rate']
    total = int(round(meta['samples'] * OUT_RATE / rate))
    mix = np.zeros(total)
    vf = None
    for slot in meta['slots']:
        track, _ = sf.read(os.path.join(a.tracks, f'track_{slot}.wav'))
        bursts = [b for b in meta['bursts'] if b['slot'] == slot]
        gap = np.zeros(int(GAP * rate))
        joined, spots = [], []  # spots: (position in joined, start on timeline, length) at 8 kHz
        pos = 0
        for b in bursts:
            seg = track[b['start']:b['start'] + b['samples']]
            if joined: joined.append(gap); pos += len(gap)
            spots.append((pos, b['start'], len(seg))); joined.append(seg); pos += len(seg)
        joined = np.concatenate(joined)
        cached = a.cache and os.path.join(a.cache, f'vf_{a.size}_{slot}.wav')
        if cached and os.path.exists(cached):
            enh, _ = sf.read(cached)
        else:
            if vf is None:
                from voicefixer import VoiceFixer
                vf = VoiceFixer()
                if a.size == 'mixed': mixed_sizing(vf._model)
            src = os.path.join(a.cache or os.path.dirname(os.path.abspath(a.out)), f'in_{slot}.wav')
            sf.write(src, joined, rate, subtype='PCM_16')
            tmp = src.replace('in_', 'vfout_')
            vf.restore(input=src, output=tmp, cuda=False, mode=0)  # librosa reads at 44.1 kHz, as in the trial
            enh, _ = sf.read(tmp)
            if cached: os.replace(tmp, cached)
        import librosa
        orig44 = librosa.resample(joined, orig_sr=rate, target_sr=OUT_RATE)
        for jpos, start, n in spots:
            j0, j1 = int(round(jpos * OUT_RATE / rate)), int(round((jpos + n) * OUT_RATE / rate))
            piece, ref = enh[j0:j1].copy(), orig44[j0:j1]
            if not a.no_loudness and rms(piece) > 0: piece *= rms(ref) / rms(piece)
            if a.smooth: piece = smooth_ending(piece, ref)
            t0 = int(round(start * OUT_RATE / rate))
            m = min(len(piece), total - t0)
            mix[t0:t0 + m] += piece[:m]
        print(f'player slot {slot}: {len(bursts)} bursts, {len(joined) / rate:.1f} s', file=sys.stderr)
    peak = np.abs(mix).max()
    if peak > 1: mix /= peak
    sf.write(a.out, mix, OUT_RATE, subtype='PCM_16')


if __name__ == '__main__':
    main()
