# Renders tools/dev/estimate-preview.ts output on the game's overview image.
#   python3 tools/dev/estimate-preview.py <in.json> <overviews folder> <out.png>
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
d = json.load(open(sys.argv[1])); ovd = sys.argv[2]
txt = open(os.path.join(ovd, d['map'] + '.txt'), encoding='latin1').read()
import re
zoom = float(re.search(r'ZOOM\s+([-\d.]+)', txt).group(1)); o = [float(v) for v in re.search(r'ORIGIN\s+([-\d.]+)\s+([-\d.]+)', txt).groups()]
img = Image.open(os.path.join(ovd, d['map'] + '.bmp')).convert('RGB')
px = img.load()
for y in range(img.size[1]):
    for x in range(img.size[0]):
        if px[x, y] == (0, 255, 0): px[x, y] = (24, 26, 30)
s = zoom / 8
P = lambda x, y: (512 + (x - o[0]) * s, 384 - (y - o[1]) * s)
dr = ImageDraw.Draw(img, 'RGBA')
F = lambda n: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', n)
# uncertainty circles every 2 s (estimated only)
last = -9
for e in d['est']:
    if e['source'] in ('estimated', 'held') and e['time'] - last >= 2:
        last = e['time']; cx, cy = P(e['x'], e['y']); r = e['radius'] * s
        dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 170, 60, 140), width=1)
# truth
tr = [P(t[1], t[2]) for t in d['truth']]
if len(tr) > 1: dr.line(tr, fill=(255, 255, 255, 230), width=2)
# estimate path (dashed look: dots)
for e in d['est']:
    cx, cy = P(e['x'], e['y'])
    if e['source'] in ('estimated', 'held'):
        dr.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], outline=(255, 170, 60, 255))
# anchors
col = {'seen': (60, 220, 90), 'heard': (80, 170, 255), 'radar': (200, 120, 255), 'spawn': (255, 255, 0), 'death': (255, 60, 60)}
for a in d['anchors']:
    cx, cy = P(a['pos'][0], a['pos'][1]); c = col[a['kind']]
    dr.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=c + (255,))
H = 110
lg = Image.new('RGB', (img.size[0], H), (16, 16, 18)); ld = ImageDraw.Draw(lg)
ld.text((10, 6), f"{d['player']} ({d['team']}), round {d['round']}, {d['end']-d['start']:.0f} s — what the POV recorder knew vs the truth (HLTV)", font=F(16), fill=(235, 235, 235))
items = [((255, 255, 255), 'true path (HLTV)'), ((60, 220, 90), 'seen by recorder'), ((80, 170, 255), 'heard'), ((200, 120, 255), 'radar'), ((255, 255, 0), 'spawn'), ((255, 60, 60), 'death spot'), ((255, 170, 60), 'estimate (dots) + uncertainty circle every 2 s')]
for i, (c, t) in enumerate(items):
    x = 10 + (i % 4) * 255; y = 36 + (i // 4) * 26
    ld.ellipse([x, y + 4, x + 10, y + 14], fill=c); ld.text((x + 16, y), t, font=F(14), fill=(220, 220, 220))
out = Image.new('RGB', (img.size[0], img.size[1] + H)); out.paste(img, (0, 0)); out.paste(lg, (0, img.size[1])); out.save(sys.argv[3])
