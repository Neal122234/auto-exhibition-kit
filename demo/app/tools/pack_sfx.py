#!/usr/bin/env python3
"""Pack each room's one-shot sound files into one "sprite" MP3 (audio/sprites/<room>.mp3) + an offset map (audio/sprites/<room>.json).
Why: fewer requests (and hosts with a file-count cap): 150 short effects become one file per room. Loops stay separate files (seamless
looping needs exact buffer ends). build.py rewrites manifest entries to {"sprite": …, "o": start s, "d": duration s}; core plays them with
source.start(t, o, d). Run after sound designers change audio/sfx/ or audio/parts/: python3 tools/pack_sfx.py && python3 build.py
"""
import json, os, subprocess, glob, wave, array
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'audio')
SR, GAP = 44100, 0.30          # 0.3 s of silence between sounds: decoder delay / resampling never bleeds one sound into the next

def parts():
    sfx = {}
    for f in sorted(glob.glob(os.path.join(A, 'parts', '*.json'))):
        sfx.update(json.load(open(f)).get('sfx', {}))
    return sfx

def pcm(path):
    """decode any file to mono 16-bit PCM at SR"""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    return array.array('h', raw)

def main():
    sfx = parts(); rooms = {}
    for name, e in sfx.items():
        if e.get('loop'): continue
        for f in e.get('files', []):
            rooms.setdefault(e.get('room', 'ui'), []).append(f)
    if not rooms: print('pack_sfx: no one-shot sounds in audio/parts/*.json, nothing to pack'); return
    os.makedirs(os.path.join(A, 'sprites'), exist_ok=True)
    for room, files in sorted(rooms.items()):
        buf = array.array('h'); gap = array.array('h', [0] * int(SR * GAP)); m = {}
        buf.extend(gap)
        for f in sorted(set(files)):
            s = pcm(os.path.join(A, f))
            m[f] = [round(len(buf) / SR, 5), round(len(s) / SR, 5)]
            buf.extend(s); buf.extend(gap)
        wav = os.path.join(A, 'sprites', room + '.wav')
        with wave.open(wav, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(buf.tobytes())
        out = os.path.join(A, 'sprites', room + '.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '112k', out], check=True)
        os.remove(wav)
        json.dump({'file': 'sprites/' + room + '.mp3', 'map': m}, open(os.path.join(A, 'sprites', room + '.json'), 'w'), indent=0)
        print(f'{room:13s} {len(m):3d} sounds  {len(buf)/SR:6.1f} s  {os.path.getsize(out)//1024} KB')

if __name__ == '__main__':
    main()
