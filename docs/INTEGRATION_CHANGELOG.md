# Integration changelog: reference projects, live match and UI (2026-11-24)

Each entry: what was there before, what changed, the files, why, the tests, and the result.

## 1. Changes while the match is paused (in-match management)
* **Before:** tactics, shape and substitutions could only be changed at half-time. Pause only stopped
  the clock.
* **Change:**
  * Pause opens a panel with style, formation, the three instruction sliders and substitutions.
  * The engine plays the manager's own match in five-minute segments and keeps a snapshot at each
    mark: the match, the world's random state, and the fitness and injuries of both squads.
  * `liveChange` restores the next mark, applies the decisions and replays the rest of the half.
  * In-play substitutions use one of three windows.
  * The second half stays open until full time: `liveResume`, then `liveFinish`. The rest of the
    week then plays in the background while the full-time report is read.
* **Files:**
  * `src/engine/matchEngine.js`: `segmentsOf`, `playRange`; `applyHalftime` takes a minute;
    `playSecondHalf(from)`.
  * `src/index.js`: `_liveCtx`, `_liveMark`, `liveState`, `liveChange`, `liveResume`,
    `liveFinish`, `_sideView`, `_afterFirstHalf`.
  * `src/api.js`: `/api/match/state`, `/api/match/change`, `/api/match/finish`, and
    `/api/match/resume` with `live: true`. The old resume behaviour is kept for other callers.
  * `public/index.html`: the pause panel, `spliceLive`, `applyLiveShape`, `finishLive`.
* **Tests:** `test/live-match.test.js` (6, new). It checks:
  * marks every five minutes;
  * nothing already played changes;
  * same changes, same world;
  * the second half can be changed;
  * no changes after the last mark;
  * three windows;
  * goal and card rates equal to 15-minute segments.

  Existing tests still pass: interactive play equals headless play, and the timeline never changes
  results.
* **Browser check:**
  * paused at 12' and the panel showed "Changes take effect at 15'";
  * the substitution appeared at 15' and the new formation was applied;
  * a second-half change worked;
  * full time, then the week completed.

## 2. The wait at the start of each half
* **Before:** each half built a new WebGL renderer, stadium and 22 players. The first frame then
  compiled every shader and uploaded every texture: 10–13 s in headless Chrome. The second half
  also waited for the whole rest of the week to be simulated.
* **Change:**
  * One shared renderer per session (compiled programs are kept between matches).
  * `warmUp()` compiles the match shaders while the week is simulated.
  * `prepare()` compiles and uploads before the first frame.
  * The first half's view is kept through half-time and reused (`attach`, `rebind`).
  * The rest of the week is simulated after full time, not before the second half.
  * Fixed a pre-existing bug: a frame stamped before the view started could run the clock
    backwards.
* **Files:** `public/match3d.js`, `public/index.html` (`start3D`, `keep3D`, `drop3D`, `viewTick`).
* **Measured (headless Chrome, software rendering):**
  * second half from "resume" to the clock moving: about 20 s → 0.7–1.5 s;
  * first frame of the second half: 10 s → 0.04 s.

  The first half on this machine is dominated by software texture uploads. On a real GPU these
  take milliseconds; real-device timing was not measured.

## 3. Skip removed
* `Skip ⏭` removed from the match controls. Tapping the intro or a replay still skips that
  cinematic only.

## 4. Free agents out of the transfer list
* **Before:** the Transfers list mixed free agents with players at other clubs.
* **Change:** two tabs, **At other clubs** (default) and **Free agents**. Signing free agents still
  works from their tab.
* **File:** `public/index.html` (`rTransfers`, `marketView`).

## 5. Football clips from Ara 3D Gen, retargeted
* **Before:** 38 Mesh2Motion clips. Kicks, the keeper's catch and punch, and the standing tackle were
  stand-ins: kickFront/kickSide, block, and a side-kick.
* **Change:**
  * `scripts/anim/extract-ara.js` copies 23 football clips from an Ara export into
    `assets/animations/source/ara3dgen/` (577 KB).
  * `scripts/anim/retarget.js` transfers them onto the Gaffer skeleton: world-space rotation
    transfer with rest-pose alignment (Ara rests in an A-pose, the Gaffer in a T-pose), hips scaled
    by leg length.
  * `build-footballer.js` adds them and fails the build if any limb is more than 1° off.
  * `match3d.js` uses them for:
    * shots, driven passes and inside-foot passes;
    * the first touch and chest control;
    * headers and jumping headers;
    * standing and slide tackles;
    * the keeper's set, catch, punch, dives and low dives;
    * throw-ins;
    * a new celebration.

    Each clip is started so its contact frame meets the ball.
* **Files:** the three scripts above, `public/models/footballer-anims.json` (826 KB → 1.4 MB, 38 →
  61 clips), `public/match3d.js`, `public/index.html`, `studio/js/app.js` (Animation tab lists 43
  clips).
* **Tests:** `test/anim-retarget.test.js` (5, new). It checks:
  * every joint is mapped;
  * clips only use the Gaffer skeleton;
  * every shipped clip is within 1° per limb, frame by frame (worst 0.29°);
  * kicks reach the ball in front of the body at contact;
  * the original clips are kept.
* **Browser check:**
  * The new clips were seen playing in matches. The animation log recorded shots, both kinds of
    pass, keeper dives (high and low), catch and punch, and standing and slide tackles. First touch,
    chest control and throw-in fired when forced. Kick timing was within −0.06 to +0.02 s.
  * Animation-lab screenshots showed natural dives and stances on the Gaffer model.

## 6. The view follows the timeline more closely
* **Before:**
  * Two chances in the same minute collided. The second shot cut the celebration short, and in one
    audited match the ball sat in the net with no goal.
  * Keepers dived at every shot, even ones going well wide.
  * The save type was random.
* **Change:**
  * `chanceShown()`: one chance at a time; the clock holds until the shot has been struck and the
    ball has arrived.
  * The keeper reads the timeline's SAVE (catch, parry or dive), watches shots that are well wide
    or over, dives low or high by shot height, and keeps his side for the whole dive.
* **Browser audit (all events cross-checked every frame):**
  * before: 3 matches, 16 frames of "ball in the net with no goal";
  * after: 9 matches in 3 careers, 0 problems;
  * 110 shots and 110 keeper reactions, each tied to an engine shot or goal;
  * 11 goals celebrated;
  * every substitution reflected.

## 7. UI simplicity redesign
* **Before:** a 26-entry menu in 7 groups. Home showed the next match twice and had two Play
  buttons.
* **Change:**
  * The menu is 7 hubs: Home, Team, Matches, Transfers, Club, World, Game.
  * Each hub's screens are tabs across the top.
  * Home has one next-match block with Line-up, Tactics and Last match links.
  * The floating Play button is hidden on Home on desktop (the hero has it). The phone bottom bar
    is unchanged.
* **File:** `public/index.html` (`HUBS`, `buildNav`, `hubTabs`, `renderSection`, `heroCard`, CSS).
* **Checked:** desktop and phone (390 × 844) screenshots; no undefined, NaN or [object Object] text
  on the screens checked; `test/ui.test.js` and `test/client.test.js` pass.

## 8. Housekeeping
* Service worker cache `gaffer-shell-v19`.
* Asset registers updated (Ara clips; the SoccerDribble rejection).
* Two unused variables removed from `test/studio-api.test.js` (lint warnings).

## Test results (2026-11-24, Windows 10, 4 cores, Node 22)
| Check | Result |
|---|---|
| Baseline before any change (`npm test`) | 113 of 114 passed; the soak's speed limit failed in parallel (443 ms/week) |
| Build (`scripts/build-web.js`) and ESLint | **Passed** |
| Vitest, full run after the changes | **124 of 125 passed**. The one failure is the same soak speed limit under parallel load (442 ms/week, unchanged from the baseline) |
| `soak.test.js` alone | **Passed:** 341 ms/week (baseline 343) |
| New: `live-match.test.js` (6), `anim-retarget.test.js` (5) | **Passed** |
| Existing: interactive play equals headless play; the timeline never changes results; save and load | **Passed** |
| Browser: event accuracy audit, 9 matches | **0 problems** |
| Browser: pause and change players, formation, style; second-half change; full time; week completes | **Passed** |
| Browser: half-start timing, clip log, animation lab, desktop and phone screenshots | Done (numbers above) |
| Real phone, real GPU | **Not tested** |

## Remaining issues
* Header shots are still struck with the foot; the timeline marks them as headers.
* Goalkeeper distribution clips (`gkPick`, `gkThrow`, `gkRoll`) are in the Studio but not yet in
  matches.
* Ara 3D Gen bodies are evaluated, not shipped (size).
* Real-phone frame rate and first-half start on a real GPU were not measured.
