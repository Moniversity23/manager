# The stadium sound

`build-stadium.py` cuts real recordings into the game's crowd beds and reactions and writes them to
`public/audio/stadium/`. Every source is a **CC0 1.0** recording on freesound.org; its licence was
read on its page before it was used. `index.json` lists, for each output file, its sources: the
Freesound id, author, title, URL and licence. Every source is also in
`assets/licences/ASSET_REGISTER.md`.

| Output | From | Use in the game |
|---|---|---|
| `bed-calm` | 206003 *Norwegian football match ambience* (habbis92) with 39733 *noise#01* (huubjeroen) | the match murmur, looped |
| `bed-lively` | 31150 *stadium* (cognito perceptu) | the fuller crowd as an attack builds, looped |
| `goal-1`, `goal-2`, `goal-3` | 528799 (D.jones), 189821 (blaukreuz), 348978 (Kinoton) | home goals |
| `goal-away` | 189821 (distant, low-passed) with 619007 *crowd 'oh' – disappointed* (mrrap4food) | away goals |
| `nearmiss-2` | 189823 *Chance* (blaukreuz) | a close miss |
| `gasp`, `save-gasp`, `ooh`, `groan` | 764320 (ShangusBurger), 264376 (HowardV), 870651 (CHallSmith), 619007 | shots, saves, misses |
| `applause`, `cheer`, `boo` | 410868 (NobodyYouKnowOf), 675056 (craigsmith), 264378 (HowardV) | saves, substitutions, cards, half- and full-time |
| `whistle-short`, `whistle-long` | 538422 (Rosa-Orenes256), 218318 (SpliceSound) | the referee |
| `touch-1` … `touch-6` | 788268 *Soccer Ball Kick Dribble in Grass* (amsaenz03), split at each touch | passes, dribbling, first touches |
| `kick-1` … `kick-3` | 813402, 816823 (Luisa_Sanchez), 446639 (Nicolas4677) | shots |

The script does the following:
* **Levels:** crowd beds −22/−20 dBFS RMS, reactions −21 to −15, whistles −14.
* **Cuts and fades** each recording.
* **Loops the beds** with an equal-power crossfade of 2.5 s.
* **Finds the six touches** in the dribbling recording from its energy.
* **Encodes MP3s** (VBR, 32 kHz; whistles 44.1 kHz).

Total: about 1.4 MB.

```
<python with numpy and soundfile> tools/stadium-audio/build-stadium.py <folder with the previews>
```

The previews (Freesound's high-quality MP3 previews, `cdn.freesound.org/previews/…-hq.mp3`) are
kept in `FOOTBALL-RALISM-LAB/voice-lab/freesound/`, not in git. `list.txt` there gives each preview's
id and URL.
