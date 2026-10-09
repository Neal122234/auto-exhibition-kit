#!/usr/bin/env python3
"""Tile pyramid for a handscroll room's viewer (engine feature "scroll", see js/API.md).

The viewer shows the hung crop (art.img) at exactly the size it has today and the rest of the scroll continues on both sides.
This writes, into rooms/<id>/scroll/:
  lo.webp          the whole scroll at LO_H px high (placeholder: shown at once, blurry until the tiles arrive)
  a00.webp …       level 1: the whole scroll at the hung image's own pixel density (height = art.h by default), cut into TW-px-wide tiles
and writes the "scroll" field into rooms/<id>/overlay.json (merged over room.json by build.py). An existing, higher tiled level
(e.g. cut/hr from the room's prep) can be listed as level 2 with --top, so zooming in uses it without new bytes.

usage:
  python3 tools/make_scroll.py <room> --src SRC --win x0,y0,x1,y1|auto [--top SPEC] [--head right|left] [--l1h N] [--tw 1024] [--q 82] [--dry]
  python3 tools/make_scroll.py <room> --relocate      the hung crop (art.img) changed: find it again in the tiles and rewrite scroll.win only
SRC  (covers the whole scroll = the scroll coordinate space, full height):
  tiles:<pattern>:<W>:<H>:<tw>   tiles relative to the room folder, pattern with {i} {i2} {i3} (index, zero-padded); W×H = the tiled level
  npy:<path>                     (H, W, 3) uint8 array (memory-mapped)
  img:<path>                     one image file
--win  where art.img sits in scroll coordinates (scroll space = main.webp px: the scroll is W_main × H_main);
       auto = find it by matching art.img against the tiles (full-height crops only)
--top  tiles:<pattern>:<W>:<H>:<tw>  an existing higher level to reuse (only if its H > level 1's)
--space W,H  the scroll coordinate space (default: main.webp's size)
"""
import json, math, os, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LO_H = 160


def arg(name, default=None):
    a = sys.argv
    return a[a.index(name) + 1] if name in a else default


def fmt(pattern, i):
    return pattern.replace('{i}', str(i)).replace('{i2}', '%02d' % i).replace('{i3}', '%03d' % i)


class Src:
    def __init__(self, spec, room_dir):
        kind, rest = spec.split(':', 1)
        self.kind = kind
        if kind == 'tiles':
            pat, W, H, tw = rest.rsplit(':', 3)
            self.pat, self.W, self.H, self.tw = os.path.join(room_dir, pat), int(W), int(H), int(tw)
            self.cache = {}
        elif kind == 'npy':
            import numpy as np
            self.a = np.load(rest, mmap_mode='r'); self.H, self.W = self.a.shape[:2]
        elif kind == 'img':
            self.im = Image.open(rest).convert('RGB'); self.W, self.H = self.im.size
        else:
            raise SystemExit('unknown src kind ' + kind)

    def tile(self, i):
        if i not in self.cache:
            if len(self.cache) > 3: self.cache.pop(next(iter(self.cache)))
            self.cache[i] = Image.open(fmt(self.pat, i)).convert('RGB')
        return self.cache[i]

    def cols(self, a, b):
        """source columns [a, b) (ints), full height, as a PIL image"""
        a, b = max(0, a), min(self.W, b)
        if self.kind == 'npy':
            import numpy as np
            return Image.fromarray(np.ascontiguousarray(self.a[:, a:b, :3]))
        if self.kind == 'img':
            return self.im.crop((a, 0, b, self.H))
        out = Image.new('RGB', (b - a, self.H))
        for i in range(a // self.tw, (b - 1) // self.tw + 1):
            tx = i * self.tw
            t = self.tile(i)
            x0, x1 = max(a, tx), min(b, tx + t.size[0])
            if x1 > x0: out.paste(t.crop((x0 - tx, 0, x1 - tx, self.H)), (x0 - a, 0))
        return out

    def strip(self, sx0, sx1, ow, oh):
        """source x range [sx0, sx1) (floats) resampled to ow × oh"""
        a = max(0, int(math.floor(sx0)) - 3); b = min(self.W, int(math.ceil(sx1)) + 3)
        im = self.cols(a, b)
        return im.resize((ow, oh), Image.LANCZOS, box=(sx0 - a, 0, min(sx1, self.W) - a, self.H))


def fmt_level(rd, L, i):
    return os.path.join(rd, fmt(L['f'], i))


def locate(rd, field, art_img):
    """where art.img (a full-height crop of the scroll) sits: coarse match on lo.webp, then 1-px match on level 1 with a sub-pixel peak"""
    import numpy as np
    W, H = field['w'], field['h']; L = field['levels'][0]
    win = Image.open(os.path.join(rd, art_img)).convert('L'); aw, ah = win.size
    lo = np.asarray(Image.open(os.path.join(rd, field['lo'])).convert('L'), dtype=np.float32); lh, lw = lo.shape
    ww = round(aw * lh / ah); t = np.asarray(win.resize((ww, lh), Image.BOX), dtype=np.float32)
    d = [np.abs(lo[:, x:x + ww] - t).mean() for x in range(0, lw - ww + 1)]
    xl = int(np.argmin(d))
    # level 1: the crop at level-1 density
    k1 = L['h'] / ah; cw = aw * k1                     # crop width in level-1 px
    x1c = xl * L['w'] / lw; a = max(0, int(x1c - 40)); b = min(L['w'], int(x1c + cw + 40) + 1)
    strip = Image.new('L', (b - a, L['h']))
    for i in range(a // L['tw'], (b - 1) // L['tw'] + 1):
        strip.paste(Image.open(fmt_level(rd, L, i)).convert('L'), (i * L['tw'] - a, 0))
    S = np.asarray(strip, dtype=np.float32)[::2, :]
    T = np.asarray(win.resize((round(cw), S.shape[0]), Image.BOX), dtype=np.float32)
    tw_ = T.shape[1]; e = []
    for x in range(0, S.shape[1] - tw_ + 1): e.append(np.abs(S[:, x:x + tw_] - T).mean())
    e = np.array(e); j = int(np.argmin(e)); off = 0.0
    if 0 < j < len(e) - 1:
        den = e[j - 1] - 2 * e[j] + e[j + 1]
        if den > 0: off = .5 * (e[j - 1] - e[j + 1]) / den
    x0 = float((a + j + off) * W / L['w'])
    print(f'  located: lo diff {min(d):.2f}, level-1 diff {e[j]:.2f}, x0 {x0:.2f}')
    return [x0, 0.0, float(x0 + cw * W / L['w']), float(H)]


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith('-'): print(__doc__); sys.exit(1)
    rid = sys.argv[1]; rd = os.path.join(ROOT, 'rooms', rid)
    room = json.load(open(os.path.join(rd, 'room.json'), encoding='utf-8'))
    ovp = os.path.join(rd, 'overlay.json')
    ov = json.load(open(ovp, encoding='utf-8')) if os.path.exists(ovp) else {}
    art = dict(room.get('art') or {}); art.update(ov.get('art') or {})
    sp = arg('--space')
    if sp: SW, SH = [float(v) for v in sp.split(',')]
    else:
        with Image.open(os.path.join(rd, room['art']['img'])) as m: SW, SH = m.size
    if '--relocate' in sys.argv:
        cur = json.load(open(ovp, encoding='utf-8')); f = cur['scroll']
        f['win'] = [round(v, 2) for v in locate(rd, f, art['img'])]
        cur = json.load(open(ovp, encoding='utf-8')); cur['scroll'] = f
        tmp = ovp + '.tmp'; open(tmp, 'w', encoding='utf-8').write(json.dumps(cur, ensure_ascii=False, indent=1) + '\n'); os.replace(tmp, ovp)
        print(rid, 'scroll.win =', f['win']); return
    auto = arg('--win') == 'auto'
    win = [0, 0, SW, SH] if auto else [float(v) for v in arg('--win').split(',')]
    src = Src(arg('--src'), rd)
    h1 = int(arg('--l1h', art['h'])); tw = int(arg('--tw', 1024)); q = int(arg('--q', 82))
    w1 = round(src.W * h1 / src.H)
    k = src.W / w1                              # source px per level-1 px
    od = os.path.join(rd, 'scroll'); os.makedirs(od, exist_ok=True)
    dry = '--dry' in sys.argv
    total = 0
    n = math.ceil(w1 / tw)
    print(f'{rid}: source {src.W}x{src.H}, level 1 {w1}x{h1} in {n} tiles of {tw}, scroll space {SW}x{SH}')
    if not dry:
        for i in range(n):
            x0, x1 = i * tw, min(w1, (i + 1) * tw)
            t = src.strip(x0 * k, x1 * k, x1 - x0, h1)
            p = os.path.join(od, 'a%02d.webp' % i); t.save(p, 'WEBP', quality=q, method=5); total += os.path.getsize(p)
        w0 = round(src.W * LO_H / src.H); lo = Image.new('RGB', (w0, LO_H)); k0 = src.W / w0
        for x0 in range(0, w0, 512):
            x1 = min(w0, x0 + 512); lo.paste(src.strip(x0 * k0, x1 * k0, x1 - x0, LO_H), (x0, 0))
        p = os.path.join(od, 'lo.webp'); lo.save(p, 'WEBP', quality=72, method=5); total += os.path.getsize(p)
    else:
        w0 = round(src.W * LO_H / src.H)
    levels = [{'f': 'scroll/a{i2}.webp', 'w': w1, 'h': h1, 'tw': tw}]
    top = arg('--top')
    if top:
        pat, W, H, ttw = top.split(':', 1)[1].rsplit(':', 3)
        if int(H) > h1:
            for i in range(math.ceil(int(W) / int(ttw))):
                if not os.path.exists(os.path.join(rd, fmt(pat, i))): raise SystemExit('missing top tile ' + fmt(pat, i))
            levels.append({'f': pat, 'w': int(W), 'h': int(H), 'tw': int(ttw)})
    field = {'w': SW, 'h': SH, 'win': win, 'head': arg('--head', 'right'), 'lo': 'scroll/lo.webp', 'loW': w0, 'loH': LO_H, 'levels': levels}
    if auto: win = locate(rd, field, art['img'])
    field['win'] = [round(v, 2) for v in win]
    # sanity: the window's aspect must be art.img's (else the hung crop and the tiles disagree)
    wa = (win[2] - win[0]) / (win[3] - win[1]); aa = art['w'] / art['h']
    print(f'  window aspect {wa:.4f} vs art.img {aa:.4f} ({(wa / aa - 1) * 100:+.2f}%)')
    if abs(wa / aa - 1) > .01: raise SystemExit('window aspect does not match art.img')
    if not dry:
        cur = json.load(open(ovp, encoding='utf-8')) if os.path.exists(ovp) else {}   # re-read right before writing (others edit overlay.json too)
        cur['scroll'] = field
        tmp = ovp + '.tmp'; open(tmp, 'w', encoding='utf-8').write(json.dumps(cur, ensure_ascii=False, indent=1) + '\n'); os.replace(tmp, ovp)
    print('  scroll field:', json.dumps(field, ensure_ascii=False))
    print(f'  new bytes: {total} ({total / 1e6:.2f} MB)')


if __name__ == '__main__':
    main()
