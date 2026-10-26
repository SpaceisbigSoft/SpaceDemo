# Renders the walk-preview JSON (tools/dev/walk-preview.ts) as PNG pictures for the owner.
#   python3 tools/dev/walk-preview.py <preview folder>
import json, sys, os, glob
from PIL import Image, ImageDraw, ImageFont

def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, size)
    return ImageFont.load_default()

ROUTE = {('T', 'A'): (230, 120, 20), ('T', 'B'): (240, 200, 40), ('CT', 'A'): (40, 120, 230), ('CT', 'B'): (60, 200, 230)}
for path in sorted(glob.glob(os.path.join(sys.argv[1], '*.json'))):
    d = json.load(open(path))
    xs = [n[0] for n in d['nodes']]; ys = [n[1] for n in d['nodes']]; zs = [n[2] for n in d['nodes']]
    ov = d.get('overview')
    if ov:
        img = Image.open(ov['bmp']).convert('RGB')
        # The game's overview images use pure green as "nothing here": show it dark.
        px_ = img.load()
        for yy in range(img.size[1]):
            for xx in range(img.size[0]):
                if px_[xx, yy] == (0, 255, 0): px_[xx, yy] = (24, 26, 30)
        s = ov['zoom'] / 8
        proj = lambda x, y: (512 + (x - ov['origin'][0]) * s, 384 - (y - ov['origin'][1]) * s)
        W, H = img.size
        dot = max(2, round(32 * s))
        bg = 'game overview image'
    else:
        pad = 200
        x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
        s = min(1100 / (x1 - x0), 900 / (y1 - y0))
        W, H = int((x1 - x0) * s), int((y1 - y0) * s)
        img = Image.new('RGB', (W, H), (24, 26, 30))
        proj = lambda x, y: ((x - x0) * s, (y1 - y) * s)
        dot = max(2, round(32 * s))
        bg = 'drawn from the map file (no matching overview image)'
    dr = ImageDraw.Draw(img, 'RGBA')
    zmin, zmax = min(zs), max(zs)
    # Walkable spots: shaded by height (lighter = higher); spots known only from demos in green.
    for x, y, z, geo in sorted(d['nodes'], key=lambda n: n[2]):
        px, py = proj(x, y)
        t = (z - zmin) / max(1, zmax - zmin)
        c = (int(70 + 150 * t), int(70 + 150 * t), int(80 + 150 * t), 110 if ov else 255) if geo else (60, 200, 90, 160)
        dr.rectangle([px - dot / 2, py - dot / 2, px + dot / 2, py + dot / 2], fill=c)
    for (team, letter), col in ROUTE.items():
        for r in d['routes']:
            if r['from'] == team and r['to'] == letter:
                pts = [proj(p[0], p[1]) for p in r['points']]
                dr.line(pts, fill=col + (255,), width=4 if team == 'T' else 3)
    boxes = []
    for site in d['sites']:
        a = proj(site['mins'][0], site['maxs'][1]); b = proj(site['maxs'][0], site['mins'][1])
        boxes.append((a, b))
        dr.rectangle([a, b], outline=(255, 60, 60, 255), width=3, fill=(255, 60, 60, 50))
    # Sites stacked on top of each other (de_nuke): put the letters side by side and say which is upper/lower.
    stacked = len(boxes) == 2 and not (boxes[0][1][0] < boxes[1][0][0] or boxes[1][1][0] < boxes[0][0][0] or boxes[0][1][1] < boxes[1][0][1] or boxes[1][1][1] < boxes[0][0][1])
    for k, (site, (a, b)) in enumerate(zip(d['sites'], boxes)):
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        label = site['letter']
        if stacked:
            other = d['sites'][1 - k]
            label += ' (upper)' if site['mins'][2] > other['mins'][2] else ' (lower)'
            cx = max(a[0], b[0]) + 90 if k == 0 else min(a[0], b[0]) - 90
            cy += -30 if k == 0 else 30
        dr.text((cx, cy), label, font=font(46 if not stacked else 30), fill=(255, 255, 255, 255), anchor='mm', stroke_width=4, stroke_fill=(150, 0, 0, 255))
    for team, key, col in [('T', 'spawnsT', (230, 140, 30)), ('CT', 'spawnsCT', (60, 140, 255))]:
        for p in d[key]:
            px, py = proj(p[0], p[1]); dr.ellipse([px - 4, py - 4, px + 4, py + 4], fill=col + (255,), outline=(0, 0, 0, 255))
        m = [sum(p[i] for p in d[key]) / len(d[key]) for i in range(2)]
        px, py = proj(*m)
        dr.text((px, py - 22), f'{team} spawn', font=font(20), fill=col + (255,), anchor='mm', stroke_width=3, stroke_fill=(0, 0, 0, 255))
    # Legend
    lg = Image.new('RGB', (W, 118), (16, 16, 18)); ld = ImageDraw.Draw(lg)
    ld.text((10, 6), f"{d['map']} (checksum {d['checksum']}, {d['demos']} demos) — background: {bg}", font=font(16), fill=(235, 235, 235))
    y = 32
    for i, ((team, letter), col) in enumerate(ROUTE.items()):
        r = next((r for r in d['routes'] if r['from'] == team and r['to'] == letter), None)
        txt = f"{team} spawn → {letter}: {r['cost']} units ≈ {r['cost']/250:.1f} s" if r else f'{team} → {letter}: none'
        ld.line([(10 + (i % 2) * 330, y + 9 + (i // 2) * 24), (40 + (i % 2) * 330, y + 9 + (i // 2) * 24)], fill=col, width=4)
        ld.text((48 + (i % 2) * 330, y + (i // 2) * 24), txt, font=font(15), fill=(220, 220, 220))
    ld.text((10, 86), 'grey = walkable (lighter = higher)   green = only known from demos   red box = bomb site (letter)   ≈ s at 250 u/s (knife)', font=font(13), fill=(170, 170, 170))
    out = Image.new('RGB', (W, H + lg.height)); out.paste(img, (0, 0)); out.paste(lg, (0, H))
    out.save(os.path.join(sys.argv[1], f"{d['map']} sites and routes.png"))
    print('wrote', d['map'])
