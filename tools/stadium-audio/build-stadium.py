# The Gaffer's stadium sound: cuts real CC0 recordings from Freesound (downloaded to the lab, see
# assets/licences) into loopable crowd beds and one-shot reactions, levels them and encodes MP3s into
# public/audio/stadium/ with index.json (every file's source, author and licence).
#   <venv python> tools/stadium-audio/build-stadium.py <folder with the downloaded previews>
import json, os, sys
import numpy as np, soundfile as sf

SRC = sys.argv[1]
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'audio', 'stadium')
os.makedirs(OUT, exist_ok=True)
SOURCES = {  # file → (Freesound id, author, title)
    'bed-norway-a': (206003, 'habbis92', 'Norwegian football match/soccer game ambience'),
    'bed-noise01': (39733, 'huubjeroen', 'noise#01'),
    'bed-stadium': (31150, 'cognito perceptu', 'stadium'),
    'goal-djones': (528799, 'D.jones', 'Football Crowd - Reaction To Goal'),
    'goal-leipzig': (189821, 'blaukreuz', 'Goal!'),
    'goal-kinoton': (348978, 'Kinoton', 'Crazy Soccer Crowd Cheering'),
    'chance-leipzig': (189823, 'blaukreuz', 'Chance'),
    'buildup-letdown': (763884, 'ShangusBurger', 'CRWDReac_Excitement Build Up, Let Down'),
    'gasp-voiced': (764320, 'ShangusBurger', 'CRWDReac_Crowd Gasping In Surprise, Voiced 02'),
    'gasp-small': (264376, 'HowardV', 'small crowd gasp shock surprise'),
    'ooh-group': (870651, 'CHallSmith', 'Group Ooh 2'),
    'oh-disappointed': (619007, 'mrrap4food', "crowd 'oh' - disappointed"),
    'boo': (264378, 'HowardV', 'crowd booing'),
    'cheer-clap': (410868, 'NobodyYouKnowOf', 'crowd cheering and clapping'),
    'reactions-craig': (675056, 'craigsmith', 'S12-01 Crowd reactions; oohs; ahh; cheering'),
    'whistle-a': (538422, 'Rosa-Orenes256', 'Referee whistle sound'),
    'whistle-gym': (218318, 'SpliceSound', 'Referee whistle blow, gymnasium'),
    'dribble-grass': (788268, 'amsaenz03', 'Soccer Ball Kick Dribble in Grass'),
    'kick-a': (813402, 'Luisa_Sanchez', 'Soccer ball kick'),
    'kick-b': (816823, 'Luisa_Sanchez', 'soccer ball kick 2 edit'),
    'kick-c': (446639, 'Nicolas4677', 'Ball Kick'),
}
index = {'note': 'CC0 1.0 recordings from freesound.org (each source page states Creative Commons 0), cut, looped and levelled by tools/stadium-audio/build-stadium.py', 'files': {}}

def load(name):
    x, sr = sf.read(os.path.join(SRC, name + '.mp3'), always_2d=True)
    return x.astype(np.float32), sr

def resample(x, sr, to):
    if sr == to: return x
    n = int(len(x) * to / sr); t = np.linspace(0, len(x) - 1, n)
    return np.stack([np.interp(t, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], axis=1).astype(np.float32)

def level(x, rms_db, peak_db=-1.0):
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    x = x * (10 ** (rms_db / 20) / rms)
    pk = np.max(np.abs(x))
    if pk > 10 ** (peak_db / 20): x = x * (10 ** (peak_db / 20) / pk)
    return x

def fades(x, sr, a=0.01, b=0.05):
    fa, fb = int(a * sr), int(b * sr)
    if fa: x[:fa] *= np.linspace(0, 1, fa)[:, None]
    if fb: x[-fb:] *= np.linspace(1, 0, fb)[:, None]
    return x

def loop(x, sr, cross=2.5):
    # A seamless loop: the last `cross` seconds fade into the first (equal power).
    c = int(cross * sr); a, b = x[:c], x[-c:]
    t = np.linspace(0, np.pi / 2, c)[:, None]
    head = a * np.sin(t) + b * np.cos(t)
    return np.concatenate([head, x[c:-c]])

def cut(name, start, dur):
    x, sr = load(name); s = int(start * sr)
    return x[s: s + int(dur * sr)].copy(), sr

def mono(x): return x.mean(axis=1, keepdims=True)

def lowpass(x, sr, hz):
    # One-pole low pass, run twice (a distant crowd at the far end).
    a = np.exp(-2 * np.pi * hz / sr); y = np.zeros_like(x)
    for _ in range(2):
        prev = np.zeros(x.shape[1], dtype=np.float32)
        for i in range(len(x)): prev = (1 - a) * x[i] + a * prev; y[i] = prev
        x = y.copy()
    return y

def write(out, x, sr, src, use, stereo=True, rate=32000, q=0.6):
    if not stereo and x.shape[1] > 1: x = mono(x)
    x = resample(x, sr, rate)
    sf.write(os.path.join(OUT, out + '.mp3'), x, rate, format='MP3', subtype='MPEG_LAYER_III', compression_level=q, bitrate_mode='VARIABLE')
    srcs = src if isinstance(src, list) else [src]
    index['files'][out] = {'file': out + '.mp3', 'seconds': round(len(x) / rate, 2), 'channels': x.shape[1], 'use': use,
                           'sources': [{'freesound': SOURCES[s][0], 'author': SOURCES[s][1], 'title': SOURCES[s][2], 'url': f'https://freesound.org/s/{SOURCES[s][0]}/', 'licence': 'CC0 1.0'} for s in srcs]}
    print(out, round(len(x) / rate, 1), 's', os.path.getsize(os.path.join(OUT, out + '.mp3')) // 1024, 'KB', flush=True)

# Beds: the murmur of a match (calm) and a fuller, louder crowd (rises with attacks).
x, sr = cut('bed-norway-a', 30, 34); x2, sr2 = cut('bed-noise01', 60, 34)
x2 = resample(x2, sr2, sr)
bed = level(x, -24) + 0.55 * level(x2[: len(x)], -24)
write('bed-calm', fades(loop(level(bed, -22), sr), sr, 0, 0), sr, ['bed-norway-a', 'bed-noise01'], 'continuous crowd murmur of a match (loops)')
x, sr = cut('bed-stadium', 20, 28)
write('bed-lively', loop(level(x, -20), sr), sr, 'bed-stadium', 'a fuller crowd, faded in as an attack builds (loops)')
# Goals: three real stadium roars.
for out, (name, start, dur) in {'goal-1': ('goal-djones', 3.0, 11), 'goal-2': ('goal-leipzig', 22.0, 11), 'goal-3': ('goal-kinoton', 28.0, 11)}.items():
    x, sr = cut(name, start, dur); write(out, fades(level(x, -15), sr, 0.15, 3.0), sr, name, 'goal by the home side: the stadium erupts')
# An away goal: the travelling fans, far off, and the home end's groan.
x, sr = cut('goal-leipzig', 22.0, 7); g = lowpass(level(x, -24), sr, 1400)
y, sr2 = load('oh-disappointed'); y = resample(y, sr2, sr)
yy = np.zeros_like(g); n = min(len(g), len(y)); yy[:n] = y[:n]
write('goal-away', fades(level(g + 0.8 * level(yy, -20), -19), sr, 0.1, 2.0), sr, ['goal-leipzig', 'oh-disappointed'], 'goal by the visitors: a distant cheer, groans nearby')
# Chances and misses. (A build-up-and-let-down take, 'buildup-letdown', was tried and left out: its
# rise is fixed in time, and the match's shots fly for different lengths of time.)
x, sr = cut('chance-leipzig', 20.5, 8); write('nearmiss-2', fades(level(x, -19), sr, 0.2, 1.5), sr, 'chance-leipzig', 'a chance at a real match: the crowd rises and falls')
x, sr = load('gasp-voiced'); write('gasp', fades(level(x, -19), sr, 0.01, 0.4), sr, 'gasp-voiced', 'a shot on target: the crowd gasps', stereo=True)
x, sr = load('ooh-group'); write('ooh', fades(level(x, -19), sr, 0.01, 0.4), sr, 'ooh-group', 'a near miss: "ooh"', stereo=False)
x, sr = load('oh-disappointed'); write('groan', fades(level(x, -20), sr, 0.01, 0.6), sr, 'oh-disappointed', 'a shot wide or high: a groan', stereo=True)
# Saves, applause and boos.
x, sr = cut('gasp-small', 0.3, 3.2); write('save-gasp', fades(level(x, -19), sr, 0.01, 0.8), sr, 'gasp-small', 'a big save: a gasp', stereo=False)
x, sr = load('cheer-clap'); write('applause', fades(level(x, -21), sr, 0.05, 0.8), sr, 'cheer-clap', 'applause: a good save, a substitution, a fine move')
x, sr = cut('reactions-craig', 66.0, 7); write('cheer', fades(level(x, -20), sr, 0.1, 1.2), sr, 'reactions-craig', 'cheering at half- and full-time', stereo=False)
x, sr = cut('boo', 2.0, 5); write('boo', fades(level(x, -21), sr, 0.3, 1.2), sr, 'boo', 'boos: a card against the home side, the visitors time-wasting', stereo=False)
# The referee.
x, sr = load('whistle-a'); write('whistle-short', fades(level(x, -14), sr, 0.002, 0.05), sr, 'whistle-a', 'a short blast: a foul, a restart', stereo=False, rate=44100)
x, sr = cut('whistle-gym', 0.0, 1.4); write('whistle-long', fades(level(x, -14), sr, 0.002, 0.25), sr, 'whistle-gym', 'a long blast: kick-off, half-time, the last of the full-time three', stereo=False, rate=44100)
# The ball: touches cut from a dribble on grass (their onsets found by energy), and shots.
x, sr = load('dribble-grass'); m = mono(x)[:, 0]
w = int(0.01 * sr); e = np.array([np.sqrt(np.mean(m[i:i + w] ** 2)) for i in range(0, len(m) - w, w)])
peaks = [i for i in range(2, len(e) - 2) if e[i] > e[i - 1] and e[i] >= e[i + 1] and e[i] > np.percentile(e, 97) and e[i] > 3 * np.median(e[max(0, i - 40):i])]
picked = []
for i in peaks:
    if all(abs(i - j) > 40 for j in picked): picked.append(i)
picked = sorted(picked, key=lambda i: -e[i])[:6]
for n, i in enumerate(sorted(picked)):
    s = max(0, i * w - int(0.01 * sr)); seg = x[s: s + int(0.22 * sr)].copy()
    write(f'touch-{n + 1}', fades(level(seg, -20), sr, 0.002, 0.08), sr, 'dribble-grass', 'a touch of the ball on grass (dribbling, passing)', stereo=False, rate=32000)
for out, name in {'kick-1': 'kick-a', 'kick-2': 'kick-b', 'kick-3': 'kick-c'}.items():
    x, sr = load(name); m = mono(x)[:, 0]; i = int(np.argmax(np.abs(m))); s = max(0, i - int(0.015 * sr))
    write(out, fades(level(x[s: s + int(0.35 * sr)].copy(), -16), sr, 0.002, 0.12), sr, name, 'a struck ball: a shot or a long kick', stereo=False, rate=32000)
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.mp3'))
print('total', total // 1024, 'KB in', len(index['files']), 'files')
