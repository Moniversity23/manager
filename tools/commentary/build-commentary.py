# The Gaffer's commentator: records every line of the script (tools/commentary/lines.mjs, exported
# by export-script.mjs) and every surname call-out with Kokoro-82M (Apache-2.0 weights; run on the
# CPU with kokoro-onnx, MIT), then trims, levels and encodes each as a small mono MP3 in
# public/audio/commentary/, with index.json for the game. Nothing is generated while a match plays:
# the game only plays these files, so it needs no connection and no paid service.
#
#   <venv python> tools/commentary/build-commentary.py <kokoro.onnx> <voices.bin> [--only lines|names|namesx] [--force]
#
# The voice is a blend of two British male voices (VOICE.blend). Excited lines are spoken faster and
# lifted a little in pitch (resampled), as a commentator's voice rises with the moment.
import json, os, re, sys, time, unicodedata
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'audio', 'commentary')
args = sys.argv[1:]
model, voices = args[0], args[1]
only = args[args.index('--only') + 1] if '--only' in args else None
force = '--force' in args
script = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
V = script['voice']
os.makedirs(os.path.join(OUT, 'names'), exist_ok=True)

k = Kokoro(model, voices)
style = sum(k.get_voice_style(name) * w for name, w in V['blend'])
SR_OUT = 24000

def slug(s):
    a = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', a).strip('-') or 'x'

def shape(x, sr, lift):
    # Pitch and pace lift (resampling: both rise together, as in an excited voice).
    if lift != 1:
        n = int(round(len(x) / lift))
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    # Trim silence (40 dB under the peak), keep 40 ms either side.
    env = np.abs(x); thr = env.max() * 0.01
    on = np.where(env > thr)[0]
    if len(on): x = x[max(0, on[0] - int(0.04 * sr)): min(len(x), on[-1] + int(0.04 * sr))]
    # Level: speech RMS to -19 dBFS, peaks no higher than -1.5 dBFS.
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    x = x * (10 ** (-19 / 20) / rms)
    pk = np.max(np.abs(x))
    if pk > 10 ** (-1.5 / 20): x = x * (10 ** (-1.5 / 20) / pk)
    f = int(0.008 * sr)
    x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
    return x.astype(np.float32)

def record(text, speed, lift, path):
    if os.path.exists(path) and not force: return None
    samples, sr = k.create(text, voice=style, speed=speed, lang=V['lang'])
    x = shape(np.asarray(samples, dtype=np.float32), sr, lift)
    sf.write(path, x, sr, format='MP3', subtype='MPEG_LAYER_III', compression_level=0.55, bitrate_mode='VARIABLE')
    return len(x) / sr

index_path = os.path.join(OUT, 'index.json')
index = json.load(open(index_path, encoding='utf-8')) if os.path.exists(index_path) else {'lines': {}, 'names': {}}
t0 = time.time(); done = 0
if only in (None, 'lines'):
    for l in script['lines']:
        i = l['i']; p = os.path.join(OUT, l['id'] + '.mp3')
        d = record(l['text'], V['speed'][i], V['lift'][i], p)
        index['lines'][l['id']] = {'kind': l['kind'], 'text': l['text'], 'i': i, **({'name': l['name']} if l.get('name') else {}), 'file': l['id'] + '.mp3'}
        if d is not None: done += 1; print(f"line {l['id']}: {d:.2f}s ({time.time() - t0:.0f}s)", flush=True)
if only in (None, 'names'):
    used = {}
    for name in script['names']:
        s = slug(name); n = used.get(s, 0); used[s] = n + 1; s = s if n == 0 else f'{s}-{n}'
        p = os.path.join(OUT, 'names', s + '.mp3')
        d = record(name + '.', 1.0, 1.0, p)
        index['names'][name] = 'names/' + s + '.mp3'
        if d is not None: done += 1; print(f"name {name}: {d:.2f}s ({time.time() - t0:.0f}s)", flush=True)
if only in (None, 'namesx'):
    # Each surname again, called out: faster and lifted like the excited lines, for goals and shots
    # ("Goal! ... Okafor! ..."), where a calm reading of the name would sound flat.
    used = {}; index['namesX'] = {}
    for name in script['names']:
        s = slug(name); n = used.get(s, 0); used[s] = n + 1; s = s if n == 0 else f'{s}-{n}'
        p = os.path.join(OUT, 'names', s + '-x.mp3')
        d = record(name + '!', V['speed'][2], V['lift'][2], p)
        index['namesX'][name] = 'names/' + s + '-x.mp3'
        if d is not None: done += 1; print(f"called {name}: {d:.2f}s ({time.time() - t0:.0f}s)", flush=True)
index['voice'] = {'model': 'Kokoro-82M v1.0 (Apache-2.0)', 'runtime': 'kokoro-onnx (MIT)', 'blend': V['blend'], 'lang': V['lang'], 'sampleRate': SR_OUT}
json.dump(index, open(index_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{done} recorded in {time.time() - t0:.0f}s; {len(index["lines"])} lines, {len(index["names"])} names')
