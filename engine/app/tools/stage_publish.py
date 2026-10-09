#!/usr/bin/env python3
"""What the public site ships: site_files() is the one list export_static.py copies (originals, byte-identical, same paths).

  python3 build.py --strict --bundle && python3 tools/stage_publish.py          -> prints the list summary, writes _wip/publish_files.json
  python3 tools/stage_publish.py --lite                                         -> also writes lighter audio copies to _pub/ (for hosts with
                                                                                   a per-version size cap; the static site never uses them)
Rule (no guessing by file-name patterns): every file inside a shipped room's folder is published, except
  - the authoring files named exactly: room.json, overlay.json, notes.md, factcheck.md, .done, t.done, .DS_Store (room.js ships inside the bundle),
  - folders named src/ (full-size originals) and any folder or file whose name starts with "_" or "." (scratch: _wip, _old, .cache, …).
A file a module loads at runtime therefore cannot be left out by a name that "looks like" a draft. Put drafts in rooms/<id>/_wip/.
Audio: every file the sound manifest names (sprites, loops, music). Plus the page's own <script src> files.
"""
import os, re, json, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTHOR_FILES = {'room.json', 'overlay.json', 'notes.md', 'factcheck.md', '.done', 't.done', '.DS_Store', 'room.js'}


def shipped_ids():
    C = json.load(open(os.path.join(ROOT, 'exhibit.json'), encoding='utf-8'))
    ids = [r if isinstance(r, str) else r['id'] for r in C['rooms']]
    up = os.environ.get('EH_UPTO')
    return ids[:ids.index(up) + 1] if up else ids


def site_files():
    html = open(os.path.join(ROOT, 'site.html'), encoding='utf-8').read()
    files = set(re.findall(r'src="([^"]+)"', html))
    for rid in shipped_ids():
        base = os.path.join(ROOT, 'rooms', rid)
        for root, dirs, fs in os.walk(base):
            dirs[:] = [d for d in dirs if d != 'src' and not d.startswith(('_', '.'))]
            for f in fs:
                if f in AUTHOR_FILES or f.startswith(('_', '.')): continue
                files.add(os.path.relpath(os.path.join(root, f), ROOT))
    mj = os.path.join(ROOT, 'audio', 'manifest.js')
    if os.path.exists(mj):
        s = open(mj, encoding='utf-8').read(); d = json.loads(s[s.index('=') + 1:s.rstrip().rindex(';')])
        for v in d.get('sfx', {}).values():
            for f in v.get('files', []): files.add('audio/' + (f if isinstance(f, str) else f['sprite']))
        for v in d.get('music', {}).values():
            if v.get('file'): files.add('audio/' + v['file'])
    have = sorted(f for f in files if os.path.exists(os.path.join(ROOT, f)))
    gone = sorted(f for f in files if not os.path.exists(os.path.join(ROOT, f)))
    if gone: print('stage_publish: referenced but missing:', *gone, sep='\n  ', file=sys.stderr)
    return have


def audio(src, dst, kbps, mono=False):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src] + (['-ac', '1'] if mono else []) + ['-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', dst], check=True)


def main():
    os.chdir(ROOT); lite = '--lite' in sys.argv
    M = {}; before = after = 0
    for f in site_files():
        size = os.path.getsize(f); before += size; src = f
        if lite and f.startswith('audio/'):
            dst = os.path.join('_pub', f)
            audio(f, dst, 80 if 'sprites/' in f else 88, mono='sprites/' in f); src = dst
            if os.path.getsize(src) > 0.9 * size: src = f          # not worth it: keep the original
        M[f] = src; after += os.path.getsize(src)
    os.makedirs('_wip', exist_ok=True)
    json.dump(M, open('_wip/publish_files.json', 'w'), indent=0)
    print(f'{len(M)} files  {before / 1e6:.1f} MB' + (f' -> {after / 1e6:.1f} MB (lite)' if lite else ''))


if __name__ == '__main__':
    main()
