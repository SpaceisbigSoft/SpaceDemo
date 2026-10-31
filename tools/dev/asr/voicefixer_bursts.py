# 5.v trial: VoiceFixer (5.g) on every burst written by tools/dev/voice-bursts.ts. Usage: python voicefixer_bursts.py <bursts dir> <out dir> <max count>
import sys, os, json, time, warnings
warnings.filterwarnings('ignore')
from voicefixer import VoiceFixer
src, dst, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
vf = VoiceFixer()
b = json.load(open(os.path.join(src, 'bursts.json')))['bursts'][:n]
t = time.time()
for x in b:
    out = os.path.join(dst, x['file'])
    if not os.path.exists(out): vf.restore(input=os.path.join(src, x['file']), output=out, cuda=False, mode=0)
print('done', len(b), 'in', round(time.time() - t, 1), 's')
