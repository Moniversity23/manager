# Match audio — architecture, assets and device checks

> **Milestone 15 (2026-11-28): a recorded commentator and a recorded ground.**
> * **Commentary** is a recorded male British broadcast voice, not the device's speech synthesis.
>   * The voice was made once for the game with Kokoro-82M, an open speech model (Apache-2.0), run
>     offline on a computer with `tools/commentary/build-commentary.py`.
>   * It speaks 205 original lines (`tools/commentary/lines.mjs`) and every surname the game can give
>     a player (503, each recorded calm and called out).
>   * The game plays the files in `public/audio/commentary/`; it never runs a model, needs no
>     connection and costs nothing per match.
>   * The device voice is still available as a choice (Settings → Commentary voice).
> * **The ground** is real recordings: 25 cuts from 20 CC0 recordings on freesound.org, each source
>   registered in `assets/licences/ASSET_REGISTER.md` and listed in `public/audio/stadium/index.json`.
>   * Two crowd beds crossfade with the danger of play.
>   * Goal roars, an away end, gasps, "ooh"s, groans, applause, boos and cheers.
>   * Real referee whistles, and ball touches and kicks.
>   * The synthesised ground of earlier versions stays as the fallback for any sound that cannot load.

## How it fits together

```
match view (public/index.html)                         what you hear
  simPass / simShoot / simDribble / markEvent
        │ structured events (what happened, who, where)
        ├── audioEv(type, data) ─► GafferSound.event ──► recorded reaction (or synthesised fallback)
        │                          public/sound.js       crowd · ref · ball buses ─┐
        │                                                 crowd bus ducks under ──┤
        ├── say(kind, data) ─────► GafferCommentary.say    the voice              ├─► master ─► (phone EQ) ─► compressor ─► speakers
        │                          public/commentary.js ─► recorded call ─► voice ┘   (the voice joins after the master volume)
        └── pa(kind, data) ──────► GafferCommentary.announce ─► chime + caption (device voice if chosen)
```

### The ground (`public/sound.js`)

| Event | Recorded | Synthesised fallback |
|---|---|---|
| `KICK_OFF` | one long whistle | pea whistle |
| `HALF_TIME` | two long whistles, then applause (boos if the home side is losing) | long whistle |
| `FULL_TIME` | short, short, long whistle, then a cheer and applause (boos after an away win) | three whistles and a cheer |
| `RESTART`, `INJURY` | short whistle | short whistle |
| `PASS` | a touch on grass, louder for a long ball, panned by where on the pitch it happens | soft thud |
| `DRIBBLE` | a soft touch for every dribbling touch, no closer than 0.23 s apart | — |
| `TOUCH`, `BOUNCE`, `HEADER` | first touch, bounce, header (lower) | — |
| `TACKLE` | a heavier touch; sometimes an "ooh" for a sliding tackle | — |
| `SHOOT` | a struck ball (three takes) | kick |
| `GOAL` (home) | one of three stadium roars, in turn, and the net | roar, horn and claps |
| `GOAL` (away) | a distant away end, and groans nearby | groan |
| `SAVE` | a gasp, then applause | "ooh" and claps |
| `MISS` | close: a chance missed, an "ooh" or a gasp; otherwise a groan or an "ooh" | "ooh" |
| `WOODWORK` | "ooh" and the ball on the post | "ooh" |
| `CARD` | whistle, then boos (home player booked) or applause (away player) | whistle and boos |
| `SUB` | applause | — |

* **Beds.** `bed-calm` is a Norwegian league match with a little distant crowd noise mixed in;
  `bed-lively` is a fuller stadium. Both loop seamlessly: the build crossfades their ends, and the
  game trims the MP3 padding before setting the loop points.
* **Following the play.** `excite(0..1)` follows the danger of the attack and crossfades from the
  murmur to the fuller crowd with equal power. A little of the fuller crowd is always there.
* **The synthesised murmur** drops to 12% under the recordings. The synthesised chants (claps and a
  drum) still come round now and then, quieter.
* **Loading.** Nothing loads until the first match starts. Then the index loads, the two beds are
  decoded first and start, and the reactions are decoded four at a time. A file that fails stays
  synthesised. A failed index is tried again at the next match.
* **Offline.** The service worker keeps every file it serves from `audio/`. The installed app
  prefetches the stadium and the whole commentary about 20 seconds after it opens; in a browser this
  happens 30 seconds into the first match. It is skipped on data-saver and 2G connections.

### The commentator (`public/commentary.js`)

* **A call.** A call is a sequence of recordings played back to back on the audio clock:
  * the player's name, when it is recorded and the line uses it;
  * the line;
  * for goals and results, a line for the situation.
* **After a goal.** The call is "Goal!" or a variant, the scorer called out, and then one of:
  * level: "And they're level!" (late: "Late drama! They have the equaliser!");
  * ahead: "And they're in front!" (late: "Surely that's the winner!");
  * further ahead: "They've doubled their advantage!";
  * a late reply while two or more behind: "A consolation, perhaps.";
  * otherwise praise.
* **The score.** It is read leader first: "It's two-one. To the home side." / "It's one all.".
* **Half-time and full-time.** The whistle line, the score, and the result ("The home side take the
  points.", "A goalless draw.").
* **Names.** A surname is matched with case and accents forgiven ("MÜLLER" → "Müller"). A player
  whose name is not recorded (one renamed in the editor) gets a line that needs no name. A goal
  scorer's name is the called-out recording ("Okafor!": faster and lifted, like an excited line).
* **Only what happened.** Every call comes from a match event with its real names and score.
  * Cooldowns keep chatter down, and quiet play stays quiet.
  * A more important line cuts a less important one.
  * Lines that would be late are dropped.
  * At 4× and 8× only the important lines are spoken.
* **Captions.** Captions show what is said ("Okafor, takes him on!"), and the commentary log in
  Commentary mode keeps them.
* **Mixing.** The crowd ducks to 75% while the commentator speaks (60% for the announcer). The voice
  goes through the same phone EQ and compressor as the ground, after the master volume. Its own
  level is the Commentary slider × master ÷ 0.6.
* **Loading.** At kick-off every line and the names of both teams (and the substitutes who will come
  on) are fetched, about 2.5 MB and mostly from the service worker's cache. They are decoded just
  before they are played; the last 48 decoded clips are kept.
* **The stadium announcer** reads club names, shirt numbers and attendances that cannot be recorded
  in advance. With the recorded voice it is a PA chime and a caption; with the device voice it
  speaks as before.

### Controls

Settings has the following controls:
* **Sound** on/off and the master volume.
* **Match audio mixer:** Crowd, Referee, Ball and boots, Commentary and Stadium announcer.
* **Spoken commentary** on/off, and **Captions** on/off.
* **Commentary voice:** the match commentator (recorded) or your device's own voice, with **▶ Test**
  to hear a sample goal call at the current volumes.

Each slider goes to 0 (off), and all of them apply at once, during a match too.

### Lifecycle on phones (unchanged from the previous milestone, now covering the recordings)

* The first tap, click or key creates the audio context and plays a silent sample inside the
  gesture. Any later gesture wakes it after a call or a lock.
* Pausing the match and hiding the tab silence it separately. It plays again only when neither
  holds. This covers the recorded beds, reactions and the commentator, which all share the one
  context. A hidden tab also drops waiting commentary, so nothing stale is said when you come back.

## Sizes

| What | Files | Size |
|---|---|---|
| Stadium (`public/audio/stadium/`) | 25 MP3 + index | 1.4 MB |
| Commentary lines (`public/audio/commentary/*.mp3`) | 205 + index (60 KB) | 1.68 MB |
| Surnames, calm (`public/audio/commentary/names/`) | 503 | 2.85 MB |
| Surnames, called out (`names/*-x.mp3`) | 503 | 2.57 MB |

A match fetches its lines and both teams' names: about 2.5 MB the first time, from the service
worker's cache after that.

**Measured** in headless Chrome as a phone (390 × 844, touch, coarse pointer), after one real touch,
master volume 0.6 (RMS at the output, 0..1):

| Check | Result |
|---|---|
| Crowd bed | 0.022–0.027 |
| Commentator's goal call | 0.073 mean, 0.17 peak (about 10 dB over the bed) |
| Goal roar peak | 0.096 |
| Whistle peak | 0.19 |
| Shot peak | 0.033 |
| Crowd slider at 0 | 0 |
| Master at 0 | 0 |
| Pause / resume | suspended / running |
| Stadium recordings decoded | all 25 |

## Building the audio again

```
# Stadium (the Freesound previews in a folder; see tools/stadium-audio/README.md)
<python with numpy and soundfile> tools/stadium-audio/build-stadium.py <folder>
# Commentary (Kokoro model files from kokoro-onnx's release "model-files-v1.0")
node tools/commentary/export-script.mjs
<python with kokoro-onnx> tools/commentary/build-commentary.py kokoro-v1.0.onnx voices-v1.0.bin [--only lines|names|namesx] [--force]
```

Recordings are kept between runs. A new line or a new surname in the name pools records only what
is missing. `--force` records everything again (about 1 h 50 min on a mid-range laptop CPU).

## Device-testing checklist (real phones)

Automated checks run in headless Chrome with phone emulation. **They are not a real phone.** On a
real Android phone (Chrome) and an iPhone (Safari), in the browser and as the installed app:

1. **First sound.** Open the game and do nothing: no sound. Tap anything, then start a match: the
   crowd bed starts within about 2 seconds of kick-off, with the long kick-off whistle.
2. **Commentator.** The commentator speaks the kick-off line. Settings → Commentary voice → ▶ Test
   plays a goal call with a scorer's name. The voice is male and British, clear over the crowd.
3. **Volumes.** Move each slider during a match:
   * Crowd 0 silences the beds and reactions only.
   * Referee 0 silences the whistles.
   * Ball 0 silences the touches and kicks.
   * Commentary 0 silences the voice but keeps the captions.
   * Master 0 silences everything.
4. **The silent switch (iPhone).** With the ring/silent switch on silent, Safari plays no Web Audio
   on some iOS versions. Note what happens, and whether it plays with the switch on ring.
5. **Interruptions.** During a match:
   * lock the screen for 10 s and unlock;
   * take or simulate a call;
   * switch to another app and back.

   After each, the next tap or the next event brings the sound back, and nothing stale is said.
6. **Pause.** ⏸ Pause stops the crowd and the voice mid-word; ▶ Play continues them.
7. **Leaving the match.** The crowd fades out at full-time (after the final whistle and the
   cheer). Leaving the match silences everything at once.
8. **Offline (installed app).** Open the installed app on Wi-Fi and wait 30 s. Then turn on
   airplane mode, close and reopen the app, and play a match: the recorded crowd, whistles and
   commentator are all there. The Settings card "The app" says it works offline.
9. **Bluetooth headphones.** Connect them mid-match: the sound moves to them and stays in step.
10. **Older phones.** On a low-memory Android phone (3 GB or less), play a whole match. The sound
    should not crackle or drop out when goals and commentary overlap.

Report the phone, the OS version, the browser and whether it ran as an installed app, with a short
screen recording when something is wrong.

## Earlier history

* **2026-11-28 (milestone 14):** phone fixes. A hidden tab no longer leaves later matches silent;
  audio unlocks on the first gesture; phones get the speaker EQ; master volume reaches the
  commentary at once.
* **2026-11-18:** the original synthesised crowd and whistle engine was restored; key events only.
