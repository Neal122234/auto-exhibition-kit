#!/usr/bin/env python3
"""Build: exhibit.json + rooms/<id>/room.json (+ overlay.json) -> room.js / exhibit.js; index.html -> site.html (page body for the export)
+ local.html (full document for local / headless tests).

usage: python3 build.py [--out NAME] [--strict] [--bundle] [--upto ROOM_ID]   (or env EH_UPTO=ROOM_ID)
  --out NAME   write only local-NAME.html (a private NAME per agent, so parallel tests don't clobber each other)
  --strict     a missing room.json / main image / wrong art.w,h is an error (export and deploy always build strict)
  --bundle     2 script files instead of one per room / module (room data + config + sound manifest; transitions + specials)
  --upto ID    ship rooms only up to this id (later, unfinished rooms stay out; the timeline shows them as "not open yet")
Without --strict, rooms without room.json get a placeholder (rooms/_stub).
"""
import json, os, re, sys
from urllib.parse import unquote
ROOT = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
OUT = args[args.index('--out') + 1] if '--out' in args else None
STRICT = '--strict' in args
BUNDLE = '--bundle' in args

# exhibit.json "palette" key -> CSS custom property of index.html
PALETTE_VARS = {'bg': '--bg', 'wall': '--wall', 'inkLight': '--ink-light', 'inkDark': '--ink-dark', 'accent': '--accent',
                'gate': '--gate-bg', 'gateInk': '--gate-ink', 'gateInk2': '--gate-ink-2', 'view': '--view-bg', 'viewInk': '--view-ink',
                'viewInk2': '--view-ink-2', 'viewInk3': '--view-ink-3', 'line': '--line'}


def write_atomic(path, text):
    tmp = path + '.%d.tmp' % os.getpid(); open(tmp, 'w', encoding='utf-8').write(text); os.replace(tmp, path)


def load_config():
    p = os.path.join(ROOT, 'exhibit.json')
    if not os.path.exists(p): sys.exit('exhibit.json missing (copy exhibit.example.json and fill it in)')
    C = json.load(open(p, encoding='utf-8'))
    plan = [r if isinstance(r, dict) else {'id': r} for r in C.get('rooms', [])]
    if not plan: sys.exit('exhibit.json: "rooms" is empty')
    ids = [r['id'] for r in plan]
    if len(set(ids)) != len(ids): sys.exit('exhibit.json: duplicate room id')
    for i in ids:
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', i): sys.exit(f'exhibit.json: room id "{i}" must be lower-case letters, digits, "-"')
    return C, plan


def stub(r):
    w = {'img': '../_stub/w.webp', 'w': 1200, 'h': 900, 'who': '（占位）', 'whoLat': 'Placeholder', 'title': '占位作品', 'meta': [], 'note': '', 'credit': ''}
    return {'id': r['id'], 'zh': r.get('era', r['id']), 'lat': r['id'], 'yrs': '', 'one': '（内容制作中）', 'wall': '#2b2825', 'ink': 'light', 'frame': 'none',
            'art': {'img': '../_stub/main.webp', 'w': 1600, 'h': 1200, 'who': '（占位）', 'whoLat': 'Placeholder', 'title': '占位', 'short': '占位', 'meta': [], 'credit': ''},
            'lede': '', 'work': '', 'quote': [], 'origin': '', 'traits': [], 'special': {'title': '', 'type': 'none', 'text': ''},
            'works': [w], 'chain': '', 'sources': [], '_stub': True}


def merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): merge(a[k], v)
        else: a[k] = v


def check_room(i, d, problems):
    """The fields the core needs, and the hung image's real size (the hand-over draws at art.w/h: a wrong size shows as a jump)."""
    for k in ('zh', 'lat', 'one', 'wall', 'ink', 'art'):
        if not d.get(k): problems.append(f'{i}: room.json has no "{k}"')
    a = d.get('art') or {}
    for k in ('img', 'w', 'h', 'title'):
        if not a.get(k): problems.append(f'{i}: art.{k} missing')
    if a.get('img'):
        f = os.path.normpath(os.path.join(ROOT, 'rooms', i, a['img']))
        if not os.path.exists(f): problems.append(f'{i}: art.img {a["img"]} not found')
        else:
            try:
                from PIL import Image
                with Image.open(f) as im:
                    if (a.get('w'), a.get('h')) != im.size: problems.append(f'{i}: art.w/h {a.get("w")}x{a.get("h")} but {a["img"]} is {im.size[0]}x{im.size[1]}')
            except ImportError:
                pass
    sc = d.get('scroll')
    if sc: check_scroll(i, d, sc, problems)
    for w in d.get('works') or []:
        if w.get('img') and not os.path.exists(os.path.normpath(os.path.join(ROOT, 'rooms', i, w['img']))): problems.append(f'{i}: works image {w["img"]} not found')
    if d.get('wall') and not re.fullmatch(r'#[0-9a-fA-F]{6}', d['wall']): problems.append(f'{i}: wall must be #rrggbb (the core computes text contrast from it)')


def check_scroll(i, d, sc, problems):
    """room.scroll (long-scroll viewer): every tile exists, and art.img really sits at scroll.win (else the viewer jumps when it opens)."""
    import math
    rd = os.path.join(ROOT, 'rooms', i)
    for k in ('w', 'h', 'win', 'lo', 'levels'):
        if sc.get(k) is None: problems.append(f'{i}: scroll.{k} missing'); return
    files = [sc['lo']]
    for L in sc['levels']:
        for n in range(math.ceil(L['w'] / L['tw'])):
            files.append(re.sub(r'\{i(\d?)\}', lambda m: str(n).zfill(int(m.group(1) or 0)), L['f']))
    gone = [f for f in files if not os.path.exists(os.path.join(rd, f))]
    if gone: problems.append(f'{i}: scroll tiles missing: {", ".join(gone[:4])}{" …" if len(gone) > 4 else ""} (tools/make_scroll.py)'); return
    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        return
    a = d.get('art') or {}
    f = os.path.join(rd, a.get('img', ''))
    if not os.path.exists(f): return
    with Image.open(os.path.join(rd, sc['lo'])) as lo:
        lo = lo.convert('L'); k = lo.size[0] / sc['w']; x0, y0, x1, y1 = [v * k for v in sc['win']]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(lo.size[0], x1), min(lo.size[1], y1)
        size = (max(8, round(x1 - x0)), max(8, round(y1 - y0)))   # at lo.webp's own resolution: a shift of a few lo px already shows
        ref = np.asarray(lo.resize(size, Image.BOX, box=(x0, y0, x1, y1)), dtype=float)
    with Image.open(f) as im:
        got = np.asarray(im.convert('L').resize(size, Image.BOX), dtype=float)
    diff = float(np.abs(ref - got).mean())
    if diff > 6: problems.append(f'{i}: art.img {a.get("img")} is not at scroll.win (mean diff {diff:.1f}): the hung crop changed? run python3 tools/make_scroll.py {i} --relocate')


def theme_block(C):
    """exhibit.json palette + fonts -> <style id="theme">, then theme.css (topic-specific CSS: frame styles, gate mark, …)."""
    decl = []
    for k, v in (C.get('palette') or {}).items():
        if k in PALETTE_VARS: decl.append(f'{PALETTE_VARS[k]}:{v}')
        else: print(f'warning: palette key "{k}" unknown (known: {", ".join(PALETTE_VARS)})')
    F = C.get('fonts') or {}
    if F.get('text'): decl.append('--font-text:' + F['text'])
    if F.get('latin'): decl.append('--font-latin:' + F['latin'])
    out = '<style id="theme">:root{' + ';'.join(decl) + '}</style>' if decl else ''
    tc = os.path.join(ROOT, 'theme.css')
    if os.path.exists(tc): out += '\n<style id="theme-css">\n' + open(tc, encoding='utf-8').read().strip() + '\n</style>'
    return out


def sound(rooms_tags):
    """audio/manifest.json + audio/parts/*.json (one part per author) + sprites + cue sheets + credits -> audio/manifest.js (window.EH_AUDIO)."""
    A_DIR = os.path.join(ROOT, 'audio')
    am = os.path.join(A_DIR, 'manifest.json'); pd = os.path.join(A_DIR, 'parts')
    if not (os.path.exists(am) or os.path.isdir(pd)): return
    A = json.load(open(am, encoding='utf-8')) if os.path.exists(am) else {}
    A.setdefault('sfx', {}); A.setdefault('music', {})
    for f in sorted(os.listdir(pd)) if os.path.isdir(pd) else []:
        if f.endswith('.json'):
            P = json.load(open(os.path.join(pd, f), encoding='utf-8'))
            for k in ('sfx', 'music'): A[k].update(P.get(k, {}))
    sd = os.path.join(A_DIR, 'sprites')   # one-shots packed by tools/pack_sfx.py -> {"sprite","o","d"} (loops stay separate files)
    if os.path.isdir(sd):
        SM = {}
        for f in os.listdir(sd):
            if f.endswith('.json'):
                J = json.load(open(os.path.join(sd, f), encoding='utf-8'))
                for k, v in J['map'].items(): SM[k] = {'sprite': J['file'], 'o': v[0], 'd': v[1]}
        for name, e in A['sfx'].items():
            if not e.get('loop'): e['files'] = [SM.get(f, f) for f in e.get('files', [])]
    cd = os.path.join(A_DIR, 'cues')     # cue sheets: audio/cues/<roomId>.json -> sounds fired by the core at transition progress p
    A['cues'] = {f[:-5]: json.load(open(os.path.join(cd, f), encoding='utf-8')) for f in sorted(os.listdir(cd)) if f.endswith('.json')} if os.path.isdir(cd) else {}
    # attribution for CC BY / BY-SA sounds, parsed from audio/credits/sfx-<room>.md tables: File | Source | Author | Licence | …
    A['credits'] = {}
    crd = os.path.join(A_DIR, 'credits')
    for f in sorted(os.listdir(crd)) if os.path.isdir(crd) else []:
        if not (f.startswith('sfx-') and f.endswith('.md')): continue
        room = f[4:-3]; out = []
        for line in open(os.path.join(crd, f), encoding='utf-8'):
            c = [x.strip() for x in line.strip().strip('|').split('|')]
            if len(c) < 4 or c[0] in ('File', '') or set(c[0]) <= set('-: '): continue
            links = re.findall(r'\[([^\]]+)\]\((https?://[^\s]+?)\)(?=\s|$|\+|,|;)', c[1])
            if links: pairs = [(n.replace('File:', ''), u) for n, u in links]
            else: pairs = [(re.sub(r'.*File:', '', unquote(u)), u) for u in re.findall(r'https?://\S+', c[1])]
            authors = [x.strip() for x in c[2].split(';')]; lics = [x.strip() for x in c[3].split(';')]
            for k, lic in enumerate(lics):
                mm = re.search(r'CC BY(?:-SA)? \d\.\d', lic)
                if not mm: continue                      # CC0 / public domain / own synthesis need no credit line
                au = re.sub(r'\s*\(.*?\)', '', authors[min(k, len(authors) - 1)]).replace('original / ', '').strip()
                nm, u = pairs[min(k, len(pairs) - 1)] if pairs else ('', '')
                nm = re.sub(r'\.(ogg|wav|flac|mp3|webm)$', '', nm.replace('_', ' ')).strip()
                if not nm or any(x['author'] == au for x in out): continue
                out.append({'title': nm, 'author': au, 'lic': mm.group(0), 'url': u})
        A['credits'][room] = out
    write_atomic(os.path.join(A_DIR, 'manifest.js'), 'window.EH_AUDIO=' + json.dumps(A, ensure_ascii=False) + ';\n')
    rooms_tags.append('<script src="audio/manifest.js"></script>')


def bake_gate(html, C):
    """exhibit.json gate mark + gate texts straight into index.html's gate markup (core.js sets the same values again)."""
    G, T = C.get('gate') or {}, C.get('text') or {}
    if G.get('markHTML') is not None:
        html = re.sub(r'(<div class="gmark" id="gmark">).*?(</div></div><p>)', lambda m: m.group(1) + G['markHTML'] + '</div><p>', html, count=1, flags=re.S)
    elif G.get('mark') == 'none':
        html = re.sub(r'(<div class="gmark" id="gmark">).*?(</div></div><p>)', r'\1</div><p>', html, count=1, flags=re.S)
    for key, el in (('gate', 'gtext'), ('gateSub', 'gsub'), ('gateKeys', 'gkeys')):
        if T.get(key):
            html = re.sub(r'(id="%s">)[^<]*(<)' % el, lambda m: m.group(1) + T[key].replace('<', '&lt;') + m.group(2), html, count=1)
    return html


def main():
    C, plan = load_config()
    ids = [r['id'] for r in plan]
    upto = os.environ.get('EH_UPTO') or (args[args.index('--upto') + 1] if '--upto' in args else None)
    if upto:
        if upto not in ids: sys.exit(f'EH_UPTO={upto} is not a room of exhibit.json')
        ids = ids[:ids.index(upto) + 1]
    rooms_tags, trans_tags, missing, problems = [], [], [], []
    RC = dict(C); RC['fonts'] = {k: v for k, v in (C.get('fonts') or {}).items() if k != 'css'}   # the page links the stylesheet; the runtime needs no URL
    write_atomic(os.path.join(ROOT, 'exhibit.js'), 'window.EH_CONFIG=' + json.dumps(RC, ensure_ascii=False) + ';\n')
    rooms_tags.append('<script src="exhibit.js"></script>')
    lst = os.path.join(ROOT, 'rooms', '_list.js')
    if upto:
        write_atomic(lst, 'window.EH_ROOM_LIST=' + json.dumps(ids) + ';\n'); rooms_tags.append('<script src="rooms/_list.js"></script>')
    elif os.path.exists(lst): os.remove(lst)
    byid = {r['id']: r for r in plan}
    for i in ids:
        j = os.path.join(ROOT, 'rooms', i, 'room.json')
        if not os.path.exists(j):
            missing.append(j)
            if STRICT: continue
            os.makedirs(os.path.join(ROOT, 'rooms', i), exist_ok=True); d = stub(byid[i])
            mw = os.path.join(ROOT, 'rooms', i, 'main.webp')
            if os.path.exists(mw):   # the real work is already there: stub the text only
                from PIL import Image
                with Image.open(mw) as im: d['art'].update({'img': 'main.webp', 'w': im.size[0], 'h': im.size[1]})
        else:
            d = json.load(open(j, encoding='utf-8'))
        ov = os.path.join(ROOT, 'rooms', i, 'overlay.json')   # owned by the transition author: presentation overrides (art.img, frame, wall…)
        if os.path.exists(ov): merge(d, json.load(open(ov, encoding='utf-8')))
        d['id'] = i
        if not d.get('_stub'): check_room(i, d, problems)
        write_atomic(os.path.join(ROOT, 'rooms', i, 'room.js'), '(window.EH_ROOMS=window.EH_ROOMS||{})[' + json.dumps(i) + ']=' + json.dumps(d, ensure_ascii=False) + ';\n')
        rooms_tags.append('<script src="rooms/%s/room.js"></script>' % i)
        if os.path.exists(os.path.join(ROOT, 'js', 't-%s.js' % i)): trans_tags.append('<script src="js/t-%s.js"></script>' % i)
    sound(rooms_tags)
    for extra in sorted(os.listdir(os.path.join(ROOT, 'js'))):
        if extra.startswith('s-') and extra.endswith('.js'): trans_tags.append('<script src="js/%s"></script>' % extra)
    if BUNDLE:   # concatenate data, and modules, in tag order
        def cat(tags, out):
            srcs = [re.search(r'src="([^"]+)"', t).group(1) for t in tags]
            write_atomic(os.path.join(ROOT, out), '\n;\n'.join(open(os.path.join(ROOT, x), encoding='utf-8').read() for x in srcs) + '\n')
            return ['<script src="%s"></script>' % out]
        rooms_tags = cat(rooms_tags, 'data.bundle.js')
        if trans_tags: trans_tags = cat(trans_tags, 'mods.bundle.js')
    F = C.get('fonts') or {}
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    html = html.replace('%%TITLE%%', C.get('title', '展览'))
    if F.get('css'): html = html.replace('%%FONTS_CSS%%', F['css'])
    else: html = re.sub(r'<link rel="stylesheet" href="%%FONTS_CSS%%">\n?', '', html)
    html = html.replace('<!-- @THEME -->', theme_block(C))
    html = bake_gate(html, C)
    html = html.replace('<!-- @ROOMS -->', '\n'.join(rooms_tags)).replace('<!-- @TRANSITIONS -->', '\n'.join(trans_tags))
    html = re.sub(r'<script src=', '<script charset="utf-8" src=', html)   # some embedded browsers decode charset-less scripts as windows-1252 (UI text turned to mojibake)
    if STRICT and (missing or problems):   # a strict build that fails writes no page (an export must never pick up a half build)
        print('MISSING:', *missing, sep='\n  ') if missing else None
        print('PROBLEMS:', *problems, sep='\n  ') if problems else None
        sys.exit(1)
    lang = C.get('lang', 'zh-CN')
    doc = '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + html + '</body></html>'
    if OUT: write_atomic(os.path.join(ROOT, 'local-%s.html' % OUT), doc)
    else: write_atomic(os.path.join(ROOT, 'site.html'), html); write_atomic(os.path.join(ROOT, 'local.html'), doc)
    print('rooms:', len(ids), 'script tags (data):', len(rooms_tags), 'modules:', len(trans_tags))
    if missing: print('MISSING (stubbed):', *missing, sep='\n  ')
    if problems: print('PROBLEMS:', *problems, sep='\n  ')


if __name__ == '__main__':
    main()
