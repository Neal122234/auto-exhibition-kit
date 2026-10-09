#!/usr/bin/env python3
"""Public static export of the exhibition -> deploy/dist/ (Cloudflare Pages at the site root; GitHub Pages under a sub-path).

  python3 tools/export_static.py (--project NAME | --site-url URL) [--out DIR] [--refresh-fonts]
                                 [--no-share | --share-png FILE] [--share-room ID] [--share-state rest|seek]
                                 [--share-p 0.62] [--share-wait 6] [--share-chrome]
  --project NAME   the Cloudflare Pages project; the site URL defaults to https://NAME.pages.dev
  --site-url URL   the production URL (canonical / og:url / og:image); overrides the one derived from --project
Title, description, language, theme colour and the share-image defaults come from exhibit.json ("title", "description", "lang",
"palette.bg", "share": {"room", "state", "p", "wait", "alt"}).

 1. Holds _wip/.buildlock while it runs `build.py --strict --bundle` and copies site.html (-> index.html) plus every file of
    tools/stage_publish.site_files(): ORIGINAL sources, byte-identical, same relative paths.
 2. Cross-checks every asset-like string literal in the page, core, bundles and room data against dist, so a file a module loads
    at runtime cannot be missing just because site_files() did not list it (copied in and reported).
 3. Self-hosts the fonts: the Google Fonts stylesheet of the page -> fonts/fonts.css + fonts/<hash>.woff2 (same family names,
    font-display: swap and unicode-range kept); css2 URLs that modules inject at runtime -> fonts/<family>.css, and those URL
    literals in the dist copies are pointed at them. Cache: _wip/fonts-cache/.
 4. <head>: description, Open Graph, Twitter card, theme-color, favicon.svg (the exhibition's own favicon.svg if it has one,
    otherwise a plain frame in the palette's accent colour).
 5. share.jpg (1200x630, q85): a screenshot of the served export in headless Chrome (tools/cdp.mjs), the share room at rest by default.
 6. _headers (Cloudflare Pages caching), 404.html and .nojekyll; junk sweep.
 7. Summary: file count, size, largest file (< 25 MiB), external request references (must be 0).
Every URL in dist stays relative, so the same folder works at https://host/ and at https://user.github.io/<repo>/.
Verify with: node tools/check_static.mjs http://127.0.0.1:<port>/  (see its header)
"""
import argparse, hashlib, json, os, re, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # app/
PROJ = os.path.dirname(ROOT)                                                  # the exhibition's project folder
LOCK = os.path.join(ROOT, '_wip', '.buildlock')
FONT_CACHE = os.path.join(ROOT, '_wip', 'fonts-cache')
CDP = os.path.join(ROOT, 'tools', 'cdp.mjs')
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/140.0.0.0 Safari/537.36')                                        # current desktop Chrome -> woff2 + unicode-range slices
CFG = json.load(open(os.path.join(ROOT, 'exhibit.json'), encoding='utf-8'))
TITLE = CFG.get('title', '展览')
DESC = CFG.get('description', TITLE)
LANG = CFG.get('lang', 'zh-CN')
PAL = CFG.get('palette') or {}
THEME = PAL.get('bg', '#0b0908')                                              # html/body background (the dark behind every room)
MAX_FILE = 25 * 1024 * 1024                                                   # Cloudflare Pages per-file limit
JUNK_NAMES = {'.DS_Store', 'Thumbs.db', 'notes.md', 'factcheck.md', '.done', 't.done', 'room.json', 'overlay.json', 'exhibit.json'}
JUNK_DIRS = {'_wip', 'src', '_pub', 'backup', 'node_modules', '.git'}
TEXT_EXT = ('.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.md', '.xml', '.webmanifest')

def favicon():
    """The exhibition's own favicon.svg (next to exhibit.json), else a plain frame in the accent colour on the page background."""
    own = os.path.join(ROOT, 'favicon.svg')
    if os.path.isfile(own): return open(own, encoding='utf-8').read()
    acc, bg = PAL.get('accent', '#b08d57'), THEME
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
            f'  <rect width="64" height="64" rx="12" fill="{bg}"/>\n'
            f'  <rect x="11" y="11" width="42" height="42" fill="none" stroke="{acc}" stroke-width="6"/>\n'
            f'  <rect x="21" y="21" width="22" height="22" fill="{acc}" fill-opacity=".35"/>\n</svg>\n')

HEADERS = '''/rooms/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800

/audio/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800

/fonts/*
  Cache-Control: public, max-age=31536000, immutable
'''


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ 1. build under the shared lock, copy originals
class BuildLock:
    def __enter__(self):
        t0 = time.time()
        while True:
            try:
                os.mkdir(LOCK); return self
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(LOCK) > 600:      # stale (> 10 min): a crashed holder
                        log('removing stale build lock'); os.rmdir(LOCK); continue
                except FileNotFoundError:
                    continue
                if time.time() - t0 > 900: raise SystemExit('build lock held for > 15 min; giving up')
                time.sleep(1)

    def __exit__(self, *exc):
        try: os.rmdir(LOCK)
        except FileNotFoundError: pass


def safe_reset(out):
    """Recreate OUT, refusing to wipe a folder that is not an earlier export (or empty)."""
    if os.path.exists(out):
        entries = [e for e in os.listdir(out) if e != '.DS_Store']
        looks_like_export = os.path.isfile(os.path.join(out, 'index.html')) and os.path.isdir(os.path.join(out, 'rooms'))
        if entries and not looks_like_export:
            raise SystemExit(f'refusing to wipe {out}: not empty and not an earlier export')
        shutil.rmtree(out)
    os.makedirs(out)


def build_and_copy(out):
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    cwd = os.getcwd()
    with BuildLock():
        subprocess.run([sys.executable, 'build.py', '--strict', '--bundle'], cwd=ROOT, check=True)
        import stage_publish
        os.chdir(ROOT)
        files = stage_publish.site_files()
        html = open(os.path.join(ROOT, 'site.html'), encoding='utf-8').read()
        for f in files:
            dst = os.path.join(out, f); os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(ROOT, f), dst)
    os.chdir(cwd)
    return html, files


# ------------------------------------------------------------------ 2. runtime asset cross-check
ASSET_EXT = r'(?:webp|png|jpe?g|gif|svg|avif|json|mp3|ogg|wav|m4a|aac|bin|woff2?|ttf|otf|css|js|mp4|webm|txt|glsl|wasm)'
LIT = re.compile(r'''["'`]([^"'`\s<>(){}]{1,240}?\.''' + ASSET_EXT + r''')(?:[?#][^"'`\s]*)?["'`]''')


def room_ids():
    ids = [r if isinstance(r, str) else r['id'] for r in CFG['rooms']]
    return ids[:ids.index(os.environ['EH_UPTO']) + 1] if os.environ.get('EH_UPTO') else ids


def cross_check(out, files):
    """Every asset-like literal must resolve to a file in dist. Literals that resolve only to a source file are copied in
    (reported), except anything outside rooms/ audio/ or inside a src/ folder (provenance notes, originals)."""
    ids = room_ids()
    scan = {'index.html': None, 'js/core.js': None}
    for f in files:
        if f.endswith(('.js', '.json', '.css', '.html')): scan[f] = None
    bases = ['', 'audio/'] + [f'rooms/{i}/' for i in ids] + [f'rooms/{i}/cut/' for i in ids]
    cands = {}
    for rel in scan:
        p = os.path.join(out, rel) if rel != 'index.html' else os.path.join(ROOT, 'site.html')
        txt = open(p, encoding='utf-8', errors='replace').read()
        for m in LIT.finditer(txt):
            c = m.group(1)
            if '://' in c or c.startswith(('data:', 'blob:', '//')): continue
            cands.setdefault(c, set()).add(rel)
    have = set(files)
    added, skipped, unresolved, ok = [], [], [], 0
    for c, srcs in sorted(cands.items()):
        tries = []
        for s in srcs:                                              # relative to the JSON / module that mentions it first
            if s.startswith('rooms/'): tries.append(os.path.dirname(s) + '/')
        tries += bases
        hits = []
        for b in tries:
            q = os.path.normpath(b + c)
            if q.startswith('..'): continue
            if q in have or os.path.isfile(os.path.join(ROOT, q)): hits.append(q)
        hits = list(dict.fromkeys(hits))
        if not hits:
            unresolved.append((c, sorted(srcs))); continue
        if any(h in have for h in hits):
            ok += 1; continue
        for h in hits:
            if not h.startswith(('rooms/', 'audio/')) or '/src/' in h:
                skipped.append((h, 'outside rooms/ audio/ (provenance note)', sorted(srcs)))
            else:
                dst = os.path.join(out, h); os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(os.path.join(ROOT, h), dst); have.add(h); added.append((h, sorted(srcs)))
    return {'literals': len(cands), 'present': ok, 'added': added, 'skipped': skipped, 'unresolved': unresolved}


# ------------------------------------------------------------------ 3. fonts
def http_get(url, accept='*/*'):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status != 200: raise RuntimeError(f'{url}: HTTP {r.status}')
        return r.read()


def cached(kind, url, fetch, refresh):
    os.makedirs(os.path.join(FONT_CACHE, kind), exist_ok=True)
    ext = '.css' if kind == 'css' else '.woff2'
    p = os.path.join(FONT_CACHE, kind, hashlib.sha1((url + (UA if kind == 'css' else '')).encode()).hexdigest()[:16] + ext)
    if refresh or not os.path.isfile(p):
        data = fetch(url)
        tmp = p + '.part'; open(tmp, 'wb').write(data); os.replace(tmp, p)
    return open(p, 'rb').read()


def selfhost_css(css_url, out, name, refresh):
    """Google css2 URL -> dist/fonts/<name> with every woff2 downloaded as fonts/<sha256[:12]>.woff2. Returns (rel path?v=, stats)."""
    css = cached('css', css_url, lambda u: http_get(u, 'text/css,*/*;q=0.1'), refresh).decode('utf-8')
    faces = css.count('@font-face')
    if not faces: raise SystemExit(f'no @font-face in {css_url}')
    fdir = os.path.join(out, 'fonts'); os.makedirs(fdir, exist_ok=True)
    mapping, nbytes = {}, 0
    for u in dict.fromkeys(re.findall(r'url\((https://fonts\.gstatic\.com/[^)\s]+)\)', css)):
        data = cached('woff2', u, http_get, refresh)
        if data[:4] != b'wOF2': raise SystemExit(f'not a woff2: {u}')
        h = hashlib.sha256(data).hexdigest()[:12] + '.woff2'
        if not os.path.exists(os.path.join(fdir, h)):
            open(os.path.join(fdir, h), 'wb').write(data); nbytes += len(data)
        mapping[u] = h
    css2 = re.sub(r'url\((https://fonts\.gstatic\.com/[^)\s]+)\)', lambda m: 'url(' + mapping[m.group(1)] + ')', css)
    if re.search(r'https?://', css2): raise SystemExit(f'{name}: absolute URL left after rewrite')
    if css2.count('font-display: swap') != faces: raise SystemExit(f'{name}: font-display: swap missing on some faces')
    fams0 = ', '.join(sorted(set(re.findall(r"font-family: '([^']+)'", css))))
    header = (f'/* Self-hosted copy of the Google Fonts css2 stylesheet for {fams0} (fetched with a desktop Chrome UA, so woff2 +\n'
              '   unicode-range slices). Files renamed by content hash; family names, font-display and unicode-range unchanged. */\n')
    css2 = header + css2
    open(os.path.join(fdir, name), 'w', encoding='utf-8').write(css2)
    fams = sorted(set(re.findall(r"font-family: '([^']+)'", css2)))
    ver = hashlib.sha256(css2.encode()).hexdigest()[:10]
    return f'fonts/{name}?v={ver}', {'css': name, 'faces': faces, 'woff2': len(mapping), 'families': fams, 'new_bytes': nbytes}


GF_CSS = re.compile(r'''https://fonts\.googleapis\.com/css2?\?[^"'`\s<>]+''')


def family_slug(url):
    fams = re.findall(r'family=([^:&]+)', url)
    return '-'.join(re.sub(r'[^a-z0-9]+', '-', f.replace('+', ' ').lower()).strip('-') for f in fams) or 'extra'


# ------------------------------------------------------------------ 4. page
HEAD_TOK = re.compile(r'\s*(<title>.*?</title>|<link\b[^>]*>|<meta\b[^>]*>|<style\b[^>]*>.*?</style>|<!--.*?-->)', re.S | re.I)


def esc(s):
    return s.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')


def make_page(site_html, fonts_href, site_url, img_alt):
    pos, head = 0, []
    while True:
        m = HEAD_TOK.match(site_html, pos)
        if not m: break
        head.append(m.group(1)); pos = m.end()
    body = site_html[pos:].lstrip('\n')
    title = next((h for h in head if h.lower().startswith('<title')), f'<title>{TITLE}</title>')
    keep = []
    for h in head:
        if h is title: continue
        if h.lower().startswith('<link') and re.search(r'fonts\.(googleapis|gstatic)\.com', h): continue   # replaced by fonts/fonts.css
        keep.append(h)
    styles = [h for h in keep if h.lower().startswith('<style')]
    other = [h for h in keep if not h.lower().startswith('<style')]
    u = site_url.rstrip('/') + '/'
    meta = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
        title,
        f'<meta name="description" content="{esc(DESC)}">',
        f'<meta name="theme-color" content="{THEME}">',
        '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
        f'<link rel="canonical" href="{esc(u)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:site_name" content="{TITLE}">',
        f'<meta property="og:title" content="{TITLE}">',
        f'<meta property="og:description" content="{esc(DESC)}">',
        f'<meta property="og:url" content="{esc(u)}">',
        f'<meta property="og:locale" content="{LANG.replace("-", "_")}">',
        f'<meta property="og:image" content="{esc(u)}share.jpg">',
        '<meta property="og:image:type" content="image/jpeg">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:image:alt" content="{esc(img_alt)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{TITLE}">',
        f'<meta name="twitter:description" content="{esc(DESC)}">',
        f'<meta name="twitter:image" content="{esc(u)}share.jpg">',
        f'<meta name="twitter:image:alt" content="{esc(img_alt)}">',
    ] + ([f'<link rel="stylesheet" href="{fonts_href}">'] if fonts_href else [])
    return (f'<!doctype html>\n<html lang="{LANG}">\n<head>\n' + '\n'.join(meta + other + styles) + '\n</head>\n<body>\n'
            + body.rstrip() + '\n</body>\n</html>\n')


# ------------------------------------------------------------------ 5. share image
SHARE_JS = r'''
export default async (b) => {
  const P = JSON.parse(process.env.EH_SHARE);
  await b.waitUntil('window.EH&&EH.debug&&EH.debug.state&&document.readyState==="complete"', 90000);
  await b.evaluate('document.fonts.ready.then(()=>1)');
  await b.evaluate('EH.debug.begin()'); await b.sleep(600);
  const i = await b.evaluate(`EH.debug.rooms().findIndex(r=>r.id===${JSON.stringify(P.room)})`);
  if (i < 0) throw new Error('no room ' + P.room);
  if (P.state === 'seek') { await b.evaluate(`EH.debug.seek(${i},${P.p})`); await b.waitUntil(`EH.debug.state.idx===${i}&&!EH.debug.loading`, 180000); }
  else { await b.evaluate(`EH.debug.jump(${i})`); await b.waitUntil(`EH.debug.state.idx===${i}&&EH.debug.state.phase==='rest'&&!EH.debug.loading`, 180000); }
  await b.evaluate('document.fonts.ready.then(()=>1)');
  await b.sleep(P.wait * 1000);
  if (P.hideChrome) { await b.evaluate(`(()=>{const s=document.createElement('style');s.textContent='.foot,#line,#skip,.hint,#hint{visibility:hidden!important}';document.head.appendChild(s);})()`); await b.sleep(300); }
  await b.shot(P.out);
  return { room: P.room, i, state: await b.evaluate('JSON.stringify({ph:EH.debug.state.phase,t:EH.debug.state.t})'),
           fonts: await b.evaluate('[...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family+" "+f.style+" "+f.weight).filter((v,k,a)=>a.indexOf(v)===k)') };
};
'''


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def serve(directory, logpath):
    port = free_port()
    lf = open(logpath, 'w')
    proc = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', directory],
                            stdout=lf, stderr=subprocess.STDOUT)
    for _ in range(100):
        try:
            socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
        except OSError:
            time.sleep(0.1)
    return proc, port


def make_share(out, a):
    from PIL import Image
    dst = os.path.join(out, 'share.jpg')
    tmpd = tempfile.mkdtemp(prefix='eh-share-')
    try:
        if a.share_png:
            png = a.share_png
        else:
            png = os.path.join(tmpd, 'share.png')
            js = os.path.join(tmpd, 'share.mjs'); open(js, 'w').write(SHARE_JS)
            proc, port = serve(out, os.path.join(tmpd, 'http.log'))
            log(f'share: serving {out} on 127.0.0.1:{port} (pid {proc.pid})')
            try:
                env = dict(os.environ, EH_SHARE=json.dumps({'room': a.share_room, 'state': a.share_state, 'p': a.share_p,
                                                             'wait': a.share_wait, 'hideChrome': not a.share_chrome, 'out': png}))
                r = subprocess.run(['node', CDP, 'run', f'http://127.0.0.1:{port}/', js, '--w', '1200', '--h', '630', '--dpr', '1',
                                    '--timeout', '180000', '--quiet'], env=env, capture_output=True, text=True, timeout=420)
                log('share:', r.stdout.strip().replace('\n', ' ')[:400])
                if r.returncode not in (0, 2) or not os.path.isfile(png):
                    raise SystemExit('share screenshot failed: ' + r.stderr[-800:])
            finally:
                proc.terminate(); proc.wait(10)
        with Image.open(png) as im:
            im = im.convert('RGB')
            if im.size != (1200, 630): im = im.resize((1200, 630), Image.LANCZOS)
            im.save(dst, 'JPEG', quality=85, optimize=True, progressive=True)
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)
    with Image.open(dst) as im: return im.size


# ------------------------------------------------------------------ 7. external reference audit
URL_RE = re.compile(r'''(?:https?:)?//[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?[^\s"'`<>)\\]*''')


def audit_external(out, site_url):
    """Classify every absolute URL in dist text files. Only 'request' ones could make the browser contact another origin."""
    site = urlparse(site_url)
    res = {'request': [], 'citation_links': 0, 'namespace': 0, 'own_meta': 0, 'files_scanned': 0}
    for root, _, fs in os.walk(out):
        for f in fs:
            if not f.endswith(TEXT_EXT) and f != '_headers': continue
            p = os.path.join(root, f); rel = os.path.relpath(p, out)
            txt = open(p, encoding='utf-8', errors='replace').read(); res['files_scanned'] += 1
            for m in URL_RE.finditer(txt):
                s, url = m.start(), m.group(0)
                if url.startswith('//'):
                    prev = txt[max(0, s - 6):s]
                    if not re.search(r'''(=\s*["']?|url\(\s*["']?|["'`])$''', prev): continue      # a // comment, not a URL
                before = txt[max(0, s - 40):s]
                host = urlparse(url if not url.startswith('//') else 'https:' + url).hostname or ''
                if host == 'www.w3.org': res['namespace'] += 1; continue                     # xmlns / createElementNS
                if re.search(r'''"url"\s*:\s*"$''', before): res['citation_links'] += 1; continue  # sources & credits -> <a href>
                if re.search(r'''<a\b[^>]*href=["']?$''', txt[max(0, s - 200):s]): res['citation_links'] += 1; continue
                if host == site.hostname and rel == 'index.html' and re.search(r'''(content|href)=["']$''', before):
                    res['own_meta'] += 1; continue                                               # og:url / og:image / canonical
                res['request'].append((rel, url[:120]))
    return res


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    SH = CFG.get('share') or {}
    ap.add_argument('--out', default=os.path.join(PROJ, 'deploy', 'dist'))
    ap.add_argument('--project', help='Cloudflare Pages project name (site URL defaults to https://NAME.pages.dev)')
    ap.add_argument('--site-url', help='production URL; overrides the one derived from --project')
    ap.add_argument('--refresh-fonts', action='store_true', help='re-download the font CSS/woff2 instead of using _wip/fonts-cache')
    ap.add_argument('--no-share', action='store_true', help='skip share.jpg')
    ap.add_argument('--share-png', help='use this screenshot (1200x630) instead of taking one')
    ap.add_argument('--share-room', default=SH.get('room') or room_ids()[0])
    ap.add_argument('--share-state', default=SH.get('state', 'rest'), choices=['rest', 'seek'])
    ap.add_argument('--share-p', type=float, default=SH.get('p', 0.62))
    ap.add_argument('--share-wait', type=float, default=SH.get('wait', 6.0), help='seconds to wait after the room rests before the screenshot')
    ap.add_argument('--share-chrome', action='store_true', help='keep the timeline / buttons / hint in the screenshot (hidden by default)')
    a = ap.parse_args()
    if not (a.site_url or a.project): ap.error('give --project NAME or --site-url URL')
    out = os.path.abspath(a.out); site_url = (a.site_url or f'https://{a.project}.pages.dev').rstrip('/')
    t0 = time.time()

    safe_reset(out)
    site_html, files = build_and_copy(out)
    log(f'copied {len(files)} originals from site_files()')

    cc = cross_check(out, files)
    log(f"asset literals: {cc['literals']} checked, {cc['present']} present, {len(cc['added'])} added, "
        f"{len(cc['skipped'])} skipped (not loaded), {len(cc['unresolved'])} unresolved")
    for h, srcs in cc['added']: log(f'  + added {h}  (mentioned in {", ".join(srcs)})')
    for h, why, srcs in cc['skipped']: log(f'  - skipped {h}: {why}  (mentioned in {", ".join(srcs)})')
    for c, srcs in cc['unresolved']: log(f'  ? unresolved "{c}"  (in {", ".join(srcs)})')

    # fonts: the page's stylesheet, then any css2 URL a module injects at runtime
    gl = re.search(r'<link[^>]+href="(https://fonts\.googleapis\.com/css2\?[^"]+)"', site_html)
    fonts_href = None
    if gl:
        main_url = gl.group(1).replace('&amp;', '&')
        fonts_href, st = selfhost_css(main_url, out, 'fonts.css', a.refresh_fonts)
        log(f"fonts.css: {st['faces']} @font-face, {st['woff2']} woff2, families {st['families']}")
    else:
        log('fonts: no Google Fonts stylesheet in the page (exhibit.json fonts.css empty): system fonts only')
    rewritten = []
    for root, _, fs in os.walk(out):
        for f in fs:
            if not f.endswith(('.js', '.css', '.json')) or root.startswith(os.path.join(out, 'fonts')): continue
            p = os.path.join(root, f); txt = open(p, encoding='utf-8').read()
            urls = sorted(set(GF_CSS.findall(txt)))
            if not urls: continue
            for u in urls:
                href, st2 = selfhost_css(u, out, family_slug(u) + '.css', a.refresh_fonts)
                txt = txt.replace(u, href)
                rewritten.append((os.path.relpath(p, out), u, href))
                log(f"{st2['css']}: {st2['faces']} @font-face, {st2['woff2']} woff2, families {st2['families']} (runtime, {os.path.relpath(p, out)})")
            open(p, 'w', encoding='utf-8').write(txt)

    img_alt = SH.get('alt') or f'{TITLE} · 展厅一景'
    page = make_page(site_html, fonts_href, site_url, img_alt)
    open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(page)
    open(os.path.join(out, 'favicon.svg'), 'w').write(favicon())
    open(os.path.join(out, '_headers'), 'w').write(HEADERS)
    open(os.path.join(out, '.nojekyll'), 'w').close()
    # without a 404.html, Pages answers a missing file with index.html + 200 and loaders fail silently
    open(os.path.join(out, '404.html'), 'w', encoding='utf-8').write(
        f'<!doctype html><html lang="{LANG}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>找不到这一页 · {TITLE}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:{THEME};color:{PAL.get("inkLight", "#e8e0d0")};'
        f'font:16px/1.7 serif"><p>这一页不在展厅里。<a style="color:{PAL.get("accent", "#d9b36a")}" href="' + site_url.rstrip('/') + '/">回到入口</a></p></body></html>')

    # junk sweep (site_files() already filters; this is the belt to its braces)
    removed = []
    for root, dirs, fs in os.walk(out, topdown=True):
        for d in list(dirs):
            if d in JUNK_DIRS: shutil.rmtree(os.path.join(root, d)); removed.append(os.path.relpath(os.path.join(root, d), out)); dirs.remove(d)
        for f in fs:
            if f in JUNK_NAMES or f.endswith(('.tmp', '.part', '.orig', '.bak')) or '.tmp' in f:
                os.remove(os.path.join(root, f)); removed.append(os.path.relpath(os.path.join(root, f), out))
    if removed: log('junk removed:', removed)

    if not a.no_share:
        size = make_share(out, a); log(f'share.jpg {size[0]}x{size[1]}')

    # summary
    allf = []
    for root, _, fs in os.walk(out):
        for f in fs:
            p = os.path.join(root, f); allf.append((os.path.getsize(p), os.path.relpath(p, out)))
    allf.sort(reverse=True)
    total = sum(s for s, _ in allf)
    ext = audit_external(out, site_url)
    byte_diff = [r for r, _, _ in rewritten]
    log('\n==== static export summary ====')
    log(f'out:            {out}')
    log(f'files:          {len(allf)}')
    log(f'total:          {total / 1e6:.1f} MB ({total / 2**20:.1f} MiB)')
    log(f'largest:        {allf[0][1]}  {allf[0][0] / 2**20:.2f} MiB  (limit 25 MiB: {"OK" if allf[0][0] < MAX_FILE else "TOO BIG"})')
    log(f'external request references: {len(ext["request"])}' + ''.join(f'\n    {r}: {u}' for r, u in ext['request']))
    log(f'  (not requests: {ext["citation_links"]} citation links rendered as <a href>, {ext["namespace"]} XML namespace URIs, '
        f'{ext["own_meta"]} og/canonical URLs of the site itself; {ext["files_scanned"]} text files scanned)')
    log(f'differs from build output: index.html (head/fonts/meta)' + ''.join(f', {r} (font URL -> {h})' for r, _, h in rewritten))
    log(f'done in {time.time() - t0:.0f} s')
    ok = allf[0][0] < MAX_FILE and not ext['request']
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
