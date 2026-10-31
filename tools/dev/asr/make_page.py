# 5.v trial: listening page — one row per talk burst with the audio (plain and AI-cleaned) and what each model wrote,
# plus a rating per row that the owner can copy back. Usage: python make_page.py <results dir> <out dir>
import json, os, shutil, sys, html
res_dir, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(out, 'audio'), exist_ok=True)
def load(name):
    p = os.path.join(res_dir, name)
    return {b['file']: b for b in json.load(open(p))['bursts']} if os.path.exists(p) else {}
sets = [
    ('modCT', 'modCTside (2002, Miles voice)', True),
    ('fta', 'fta_vigor_t_cali_ct (2005, Speex voice)', False),
]
rows, times = [], {}
for key, title, has_vf in sets:
    base, small = load(f'res_{key}_ggml-base.en.json'), load(f'res_{key}_ggml-small.en-q5_1.json')
    vbase, vsmall = (load(f'res_{key}_vf_ggml-base.en.json'), load(f'res_{key}_vf_ggml-small.en-q5_1.json')) if has_vf else ({}, {})
    for name in ['base.en', 'small.en-q5_1']:
        for k in [key] + ([key + '_vf'] if has_vf else []):
            p = os.path.join(res_dir, f'res_{k}_ggml-{name}.json')
            if os.path.exists(p): times[f'{k} {name}'] = json.load(open(p))['seconds']
    rows.append(f'<tr class="set"><th colspan="6">{html.escape(title)}</th></tr>')
    for f, b in (small or base).items():
        a = f'audio/{key}_{f}'
        shutil.copy(os.path.join(res_dir, key, f), os.path.join(out, a))
        cells = [f'<audio controls preload="none" src="{a}"></audio>']
        if has_vf:
            av = f'audio/{key}_vf_{f}'
            shutil.copy(os.path.join(res_dir, key + '_vf', f), os.path.join(out, av))
            cells.append(f'<span class="lab">AI-cleaned</span><audio controls preload="none" src="{av}"></audio>')
        t = lambda d: html.escape(d.get(f, {}).get('text', '') or '—')
        texts = f'<div><span class="lab">small</span> {t(small)}</div><div><span class="lab">base</span> {t(base)}</div>'
        if has_vf: texts += f'<div class="vf"><span class="lab">small · cleaned</span> {t(vsmall)}</div><div class="vf"><span class="lab">base · cleaned</span> {t(vbase)}</div>'
        rid = f'{key}/{f}'
        rate = '<span class="lab">small is</span>' + ''.join(f'<label><input type="radio" name="{rid}" value="{v}"> {v}</label>' for v in ['right', 'mostly', 'wrong', "can't tell"])
        best = ['small', 'base'] + (['small cleaned', 'base cleaned'] if has_vf else [])
        rate += '<span class="lab">best version</span>' + ''.join(f'<label><input type="radio" name="{rid}#best" value="{v}"> {v}</label>' for v in best)
        rows.append(f'<tr><td class="mono">{b["start"]:.0f} s</td><td>{html.escape(b["player"])}<div class="lab">{b["seconds"]} s</div></td><td>{"".join(cells)}</td><td>{texts}</td><td class="rate" data-id="{rid}">{rate}</td></tr>')
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice to text trial</title><style>
:root {{ --bg:#15171a; --s:#1e2125; --b:#30353b; --t:#e8eaed; --m:#a3a9b1; --a:#f2a93b; }}
@media (prefers-color-scheme: light) {{ :root {{ --bg:#f4f5f7; --s:#fff; --b:#dde1e6; --t:#1b1e22; --m:#5b626b; --a:#8a5300; }} }}
body {{ margin:0; padding:24px 16px; background:var(--bg); color:var(--t); font:14px/1.45 system-ui, 'Segoe UI', sans-serif; }}
main {{ max-width:1200px; margin:0 auto; }} h1 {{ font-size:20px; }} p {{ color:var(--m); max-width:820px; }}
table {{ width:100%; border-collapse:collapse; background:var(--s); border:1px solid var(--b); border-radius:8px; }}
td, th {{ padding:8px 10px; border-top:1px solid var(--b); vertical-align:top; text-align:left; }}
tr.set th {{ background:var(--bg); font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:var(--m); padding-top:18px; }}
audio {{ width:220px; height:32px; display:block; margin:2px 0 6px; }} .lab {{ color:var(--m); font-size:12px; margin-right:6px; }}
.vf {{ opacity:.9; }} .mono {{ font-family:ui-monospace, Consolas, monospace; }} .rate label {{ display:block; white-space:nowrap; }} .rate .lab {{ display:block; margin-top:6px; }}
button {{ background:var(--a); color:#15171a; border:0; border-radius:6px; padding:8px 14px; font-weight:600; cursor:pointer; }}
.bar {{ position:sticky; top:0; background:var(--bg); padding:10px 0; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }}
@media (max-width:800px) {{ table, tbody, tr, td {{ display:block; }} tr.set th {{ display:block; }} }}
</style></head><body><main>
<h1>SpaceDemo 5.v · voice to text trial</h1>
<p>Each row is one talk burst from the demo. Play it, read what the speech model wrote, and rate the <b>small</b> model's text: <b>right</b>, <b>mostly</b> right, <b>wrong</b>, or <b>can't tell</b> (you can't make out the words yourself either). Then tick which <b>version is best</b>. Rate about 20 rows, ideally both demos. "small" is the bigger, more accurate model, "base" the smaller one. For the 2002 demo, "cleaned" is the same burst after the AI voice clean-up (5.g). When you're done, press <b>Copy my ratings</b> and paste the result into the chat.</p>
<p>Time taken in my workspace (2 cores; your PC is faster): {html.escape(', '.join(f'{k}: {v:.0f} s' for k, v in times.items()))}.</p>
<div class="bar"><button id="copy">Copy my ratings</button><span id="count" class="lab"></span></div>
<table><tbody>{''.join(rows)}</tbody></table></main>
<script>
const KEY = 'spacedemo-5v-ratings';
let saved = {{}}; try {{ saved = JSON.parse(localStorage.getItem(KEY) || '{{}}'); }} catch (e) {{}}
const count = () => {{ document.getElementById('count').textContent = Object.keys(saved).filter((k) => !k.endsWith('#best')).length + ' rated'; }};
document.querySelectorAll('td.rate').forEach((td) => {{
  td.querySelectorAll('input').forEach((i) => {{
    const id = i.name;
    if (saved[id] === i.value) i.checked = true;
    i.addEventListener('change', () => {{ saved[id] = i.value; try {{ localStorage.setItem(KEY, JSON.stringify(saved)); }} catch (e) {{}} count(); }});
  }});
}});
count();
document.getElementById('copy').addEventListener('click', async () => {{
  const text = '5.v ratings: ' + Object.entries(saved).map(([k, v]) => k + '=' + v).join('; ');
  try {{ await navigator.clipboard.writeText(text); document.getElementById('count').textContent = 'Copied ' + Object.keys(saved).length + ' ratings'; }}
  catch (e) {{ prompt('Copy this:', text); }}
}});
</script></body></html>'''
open(os.path.join(out, 'Voice to text trial.html'), 'w', encoding='utf-8').write(page)
print('page with', sum(1 for r in rows if not r.startswith('<tr class')), 'rows')
