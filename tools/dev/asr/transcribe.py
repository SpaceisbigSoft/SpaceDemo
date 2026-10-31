# 5.v trial: transcribe each talk burst with whisper.cpp (pywhispercpp) and a word list of callouts + player names.
import sys, os, json, time, wave
import numpy as np
from pywhispercpp.model import Model
model_path, src, out_json = sys.argv[1], sys.argv[2], sys.argv[3]
names = sys.argv[4] if len(sys.argv) > 4 else ''
info = json.load(open(os.path.join(src.replace('_vf', ''), 'bursts.json')))
players = sorted({b['player'] for b in info['bursts']})
prompt = ('Counter-Strike team voice chat. Callouts: bomb, plant, defuse, site A, site B, mid, ramp, CT spawn, T spawn, '
          'rush, rotate, flash, smoke, nade, AWP, AK, deagle, one left, two left, hes low, hit, lit, hurt. Players: '
          + ', '.join(p.split('.')[0].replace(':i69:', '') for p in players) + '. ' + names)
m = Model(model_path, n_threads=2, print_progress=False, print_realtime=False)
def load(path):
    w = wave.open(path)
    rate, n = w.getframerate(), w.getnframes()
    raw = np.frombuffer(w.readframes(n), dtype='<i2' if w.getsampwidth() == 2 else '<i4').astype(np.float32)
    if w.getsampwidth() == 4: raw /= 2**31
    else: raw /= 32768
    if w.getnchannels() > 1: raw = raw.reshape(-1, w.getnchannels()).mean(1)
    t = np.arange(0, len(raw) / rate, 1 / 16000)
    return np.interp(t, np.arange(len(raw)) / rate, raw).astype(np.float32)
res = []
t0 = time.time()
for b in info['bursts']:
    p = os.path.join(src, b['file'])
    if not os.path.exists(p): continue
    audio = load(p)
    audio = np.concatenate([audio, np.zeros(16000 // 2, np.float32)])
    segs = m.transcribe(audio, language='en', initial_prompt=prompt, no_context=True, suppress_blank=True)
    text = ' '.join(s.text.strip() for s in segs).strip()
    res.append({**b, 'text': text})
json.dump({'model': os.path.basename(model_path), 'src': src, 'seconds': round(time.time() - t0, 1), 'bursts': res}, open(out_json, 'w'), indent=1)
print(os.path.basename(model_path), src, len(res), 'bursts in', round(time.time() - t0, 1), 's')
