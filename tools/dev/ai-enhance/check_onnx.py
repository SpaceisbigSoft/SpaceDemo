# 5.g3 check: the compact ONNX file against the PyTorch reference (mixed sizing) on some 8 kHz clips.
#   python check_onnx.py <model.onnx> <clip.wav>...
# Prints SNR (dB) of ONNX vs PyTorch per clip and the time per minute of audio for both. Plan target: SNR >= 30 dB.
import sys, time, warnings
warnings.filterwarnings('ignore')
import numpy as np, librosa, onnxruntime as ort, torch

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from enhance_reference import mixed_sizing  # noqa: E402

SEG = 44100 * 30


def trim_center(est, n):
    d = est.shape[-1] - n
    if d > 0: est = est[..., d // 2: d // 2 + n]
    return est[..., :n]


def run_onnx(sess, wav):
    """VoiceFixer.restore_inmem (mode 0) with the ONNX graph doing each 30 s segment."""
    out, bp = [], SEG
    while bp < len(wav) + SEG:
        seg = wav[bp - SEG: bp].astype(np.float32)
        y = sess.run(None, {'wav': seg[None, None, :]})[0]
        if np.abs(y).max() > 1: y = y / np.abs(y).max()
        out.append(trim_center(y, len(seg))[0, 0]); bp += SEG
    return np.concatenate(out)


def main():
    model, clips = sys.argv[1], sys.argv[2:]
    so = ort.SessionOptions(); so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(model, so, providers=['CPUExecutionProvider'])
    from voicefixer import VoiceFixer
    vf = VoiceFixer(); mixed_sizing(vf._model)
    for c in clips:
        wav, _ = librosa.load(c, sr=44100)  # as the reference reads its input
        t = time.time(); ref = np.asarray(vf.restore_inmem(wav, cuda=False, mode=0)).reshape(-1); tp = time.time() - t
        t = time.time(); got = run_onnx(sess, wav); to = time.time() - t
        n = min(len(ref), len(got))
        snr = 10 * np.log10(np.sum(ref[:n] ** 2) / max(1e-20, np.sum((ref[:n] - got[:n]) ** 2)))
        mins = len(wav) / 44100 / 60
        print(f'{c}: {len(wav) / 44100:.1f} s  SNR {snr:.1f} dB  corr {np.corrcoef(ref[:n], got[:n])[0, 1]:.5f}  '
              f'PyTorch {tp / mins:.0f} s/min  ONNX {to / mins:.0f} s/min', flush=True)


if __name__ == '__main__':
    main()
