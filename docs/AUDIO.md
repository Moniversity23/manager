# Match audio — architecture and asset register

> **2026-11-18 update:** the crowd, whistle and ball sounds were restored to the original engine,
> which has more football feel and did not crackle. The layered version (two crowd sections, sung
> chants, player shouts, chimes) was removed. The match still sends structured events, but only key
> ones make a sound: kick-off, passes and shots (timed to the moment the ball leaves the boot),
> goals (home and away crowds react differently), saves, misses, cards, injuries, the restart after
> a goal, half-time and full-time. Commentary and the announcer stay, without added-time and
> line-up announcements. Volume groups now: crowd, referee, ball, commentary, announcer. The
> sections below describe the earlier design where they differ.

## How it fits together

```
match view (public/index.html)                         what you hear
  stepPositions / simPass / simShoot / markEvent
        │  structured events                              ┌──────────────┐
        ├── audioEv(type, data) ──► GafferSound.event ───►│ buses: crowd │──┐
        │                          (public/sound.js)      │ ref · ball   │  │
        │                                                 │ voices · …   │  ├─► master ─► compressor ─► limiter ─► speakers
        ├── say(kind, data) ─────► GafferCommentary.say ──► speech + captions (device voices)
        └── pa(kind, data) ──────► GafferCommentary.announce ─► chime + PA line (another voice)
```

* **Events**, sent by the match code when the thing actually happens on screen:
  `KICK_OFF`, `RESTART`, `PASS` (power, long), `TOUCH`, `HEADER`, `BOUNCE`, `TACKLE` (slide),
  `PRESS`, `GK_SHOUT`, `LONG_KICK`, `SHOOT` (power), `GOAL`, `SAVE` (catch / punch / dive), `MISS`
  (close or not), `WOODWORK`, `CARD` (yellow / red), `INJURY`, `SUB`, `HALF_TIME`, `FULL_TIME`,
  `CHIME`. Each carries the side and the position along the pitch (used for stereo panning).
* **Crowd**: two sections, the home end (most of the ground) and the away end, each with its own
  murmur bed and reactions: roar, groan, "ooh", gasp, applause, boos, fans' whistling and sung
  chants (several rhythms and tunes, never the same twice in a row). The attacking side's section
  rises as a chance builds. Home and away goals sound different.
* **Mixing**: separate buses for crowd, referee, ball and boots, player voices, commentary,
  announcer and music (reserved), each with a slider in Settings (0 = off) under the master volume.
  The crowd ducks while commentary or the announcer speaks and is boosted during a goal.
* **Commentary**: phrase banks per event (`PHRASES.en` in public/commentary.js) filled with player,
  club and competition names. No line repeats back to back, chatter has cooldowns, only key lines
  are spoken at 4× and 8×, stale lines are dropped, and a goal outranks everything. Spoken with the
  device's speech synthesis (Web Speech API) and shown as captions. A new language is a new bank.
* **Stadium announcer**: welcome with the expected attendance, the home line-up, goals with shirt
  numbers and assists, substitutions, added time, half-time and full-time. It waits for commentary
  to finish rather than talking over it.
* **Lifecycle**: Pause suspends audio and speech; the crowd and speech stop when a match ends, when
  you leave it or press Continue; hiding the tab or app suspends audio. Audio starts only after a
  tap (browser autoplay rules); the first Continue also unlocks speech on iOS.

## Why synthesis, not recordings

Everything is generated in the browser with the Web Audio API: no downloads, no decoding, nothing
to preload, works offline, adds about 30 KB of code, and there is nothing to license. Commentary uses
the voices already on the device, so there is no cost per match and no AI speech service. Recorded
clips (licensed crowd beds, whistles, commentary) can be added later behind the same events.

## Asset register

| Asset | Source | Licence | Permitted use | Format | Duration |
|---|---|---|---|---|---|
| Crowd beds, chants, applause, boos, whistling, roars | Synthesised in public/sound.js (original) | Part of this project | Any, including commercial | Generated at run time | Continuous / 0.5–5 s |
| Referee whistle (pea whistle) | Synthesised (original) | Part of this project | Any | Generated | 0.2–1.1 s |
| Ball, boots, net, post, keeper sounds | Synthesised (original) | Part of this project | Any | Generated | 0.05–1.2 s |
| Player shouts (no words) | Synthesised formant voices (original) | Part of this project | Any | Generated | 0.15–0.6 s |
| PA chime | Synthesised (original) | Part of this project | Any | Generated | 1 s |
| Commentary and announcer voices | The user's device speech synthesis (system voices) | Provided by the operating system or browser | Spoken locally on the user's device; nothing is distributed | Live speech | Per line |
| Commentary and announcement texts | Written for this project (public/commentary.js) | Part of this project | Any | Text | — |

No football broadcasts, club chants or commentary recordings are used.
