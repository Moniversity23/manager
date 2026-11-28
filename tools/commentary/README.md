# The commentator's voice

The match commentary is recorded speech, made once on a computer and shipped as small MP3s in
`public/audio/commentary/`. The game only plays the files (`public/commentary.js`). It never runs a
speech model, needs no connection and pays for no service.

| File | What it is |
|---|---|
| `lines.mjs` | The script: every line by kind (kick-off, build-up, dribble, shot, goal, the situation after a goal, save, miss, cards, half- and full-time…), with an intensity (calm, lively, excited) and, for lines that follow a name, whose name. Also the score lines ("It's two-one.") and the voice settings. Original lines, written for the game. |
| `export-script.mjs` | Writes `script.json` from `lines.mjs` and every surname in the game's name pools (`src/names.js`: the last word of each name, as the match calls players). |
| `build-commentary.py` | Records each line and each surname with Kokoro-82M through kokoro-onnx, then trims, levels (speech at −19 dBFS RMS, peaks under −1.5 dBFS) and encodes mono MP3s, and writes `public/audio/commentary/index.json`. |

## The voice

The voice is a blend of two of Kokoro's British male styles: 60% `bm_george` and 40% `bm_lewis`.
They were chosen from Kokoro's four British male styles by measured speaking pitch (medians of
145 Hz for `bm_george`, 101 Hz for `bm_lewis`, 128 Hz for `bm_daniel` and 122 Hz for `bm_fable`),
mixing the clearest with the deepest for an older-sounding broadcaster. The pipeline could not judge
by listening. Settings → Commentary voice → ▶ Test plays a sample, and another blend is one line in
`lines.mjs` plus a rebuild. It is a synthetic voice and is not modelled on any
real person or commentator.

| Intensity | Speed | Pitch |
|---|---|---|
| Calm | 0.98 | as recorded |
| Lively | 1.04 | as recorded |
| Excited (shots, goals, saves) | 1.12 | lifted 4.5% (by resampling, as a voice rises with the moment) |

Each surname is recorded twice: calm ("Okafor.") and called out ("Okafor!", at the excited settings)
for goals.

## Running it

```
# once: a Python 3.12 environment with kokoro-onnx (it brings onnxruntime, phonemizer and espeak-ng)
uv venv --python 3.12 .venv && uv pip install kokoro-onnx soundfile
# the model files from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
#   kokoro-v1.0.onnx (325 MB), voices-v1.0.bin (28 MB): kept out of git

node tools/commentary/export-script.mjs
.venv/Scripts/python tools/commentary/build-commentary.py kokoro-v1.0.onnx voices-v1.0.bin            # everything missing
.venv/Scripts/python tools/commentary/build-commentary.py kokoro-v1.0.onnx voices-v1.0.bin --only names
.venv/Scripts/python tools/commentary/build-commentary.py kokoro-v1.0.onnx voices-v1.0.bin --force    # all again
```

Existing recordings are kept, so a new line or a new surname records only what is missing. Each clip
takes 3–6 s on a laptop CPU; everything (1,211 clips) takes about an hour and three quarters.

## Licences

All of these are registered in `assets/licences/ASSET_REGISTER.md`.
* **Kokoro-82M weights and voice styles:** Apache-2.0.
* **kokoro-onnx and onnxruntime:** MIT.
* **phonemizer and espeak-ng:** GPL-3.0, used at build time only and not shipped.
* **soundfile and numpy:** BSD-3-Clause. libsndfile is LGPL-2.1.
* **The script and the recordings** are the game's own.
