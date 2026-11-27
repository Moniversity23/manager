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

* **Found on production and fixed (follow-up commit):** the warm-up and the match share one renderer. When the warm-up finished after the match view had started (slower network), its clean-up removed the shared canvas and the match played with a blank 3D view. Each view now claims the renderer when it draws (canvas, size, pixel ratio, shadows) and removes the canvas only if it still owns it. Reproduced locally by forcing a warm-up during a match: the match keeps rendering.

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

## 9. Header shots and the keeper's distribution (follow-up)
* **Before:** the timeline marks about 15% of shots as headers, but the view always struck them
  with the foot. After a catch the keeper put the ball down and kicked it.
* **Change:**
  * For a header the scorer gets a cross. When time is short the ball goes straight to him; if he
    already has it he lays it off wide first. The cross lands about half a second before the shot,
    and a late chance holds the clock briefly, as `chanceShown` does.
  * The header leaves from the height the cross arrived at, with `headerA` or `headerJump` timed
    to meet the ball.
  * A keeper who caught the ball keeps it in his hands, then rolls it (`gkRoll`) to a team-mate
    within about 20 m, throws it (`gkThrow`) further, or kicks it long. The choice follows the
    timeline's next pass from him.
* **Checked in the browser:**
  * 9 matches in 3 careers: 10 of the last 12 header chances were shown as headers (0 of 18
    before), keepers threw and rolled the ball out, and still 0 accuracy problems;
  * the 3D clip log shows `headerA`, `headerJump`, `gkThrow` and `gkRoll` playing.
* **Fixed along the way:** the throw-in and keeper-throw windows could outlast their clips and
  replay the release. A keeper whose side lost the ball before he released it no longer mimes a
  throw.

## 10. Movement off the ball, the keeper's angle, and the last header cases (follow-up)
* **Support runs:** the timeline's next receiver moves into the space his pass goes to before it is
  played, and the nearest defender tracks him goal-side.
* **Crosses:** on a cross or a header chance, two more attackers attack the near and far post and
  defenders pick each of them up goal-side. Frozen mid-cross in 3D: 2 attackers and 4 defenders were
  in the box.
* **The keeper narrows the angle:** he comes off his line (at most 6 m) and across with the ball as it
  enters his third.
* **Header chances that run out of time before the cross** get one extension (the clock holds as in
  `chanceShown`): a lay-off if the scorer has the ball, or the cross.
* **Stricter audit (9 matches, 3 careers):**
  * every one of the 124 engine shots and goals was visibly struck before being recorded;
  * 0 problems;
  * 13 of 16 header chances were shown as headers.

## 11. Phones, and what a full match costs to draw (follow-up)
* **All 25 screens checked at 390 × 844:** no undefined, NaN or [object Object] text, and nothing
  wider than the screen. The tab strips scroll sideways.
* **On phones** the bottom bar already holds Play and More. The hero's Play button and the top bar's
  menu button only repeated them, so they are hidden there, and the top bar keeps balance and
  position next to Back.
* **Measured, a full 3D match (22 players, referee, stadium):**
  * about 270 draw calls and 385,000 triangles per frame (shadow passes included);
  * 17–21 shader programs and 235 small textures (64–256 px each, about 25 MB of GPU memory).

  These are within what mid-range phones draw. Without a GPU here the frame rate cannot be judged
  (software rendering gives 1–2 fps), so no further optimisation was made blind. The automatic
  quality setting already picks "low" on touch devices, small screens and devices with 4 GB of
  memory or less.

## 12. Realistic close-up bodies: Ara 3D Gen, optimised (2026-11-26)
**Before:**
* The Player Studio and award ceremonies drew the classic Mesh2Motion figure: 30 meshes and 18,477
  triangles in the Studio.
* Ara 3D Gen bodies had been evaluated and rejected at 29.8 MB each.
* Every Ara body came out with the same androgynous build, because Ara's morph-target pack was empty
  on Windows.

**Changed:**
* **Ara's Windows bug:** fixed in the lab copy, outside this repository. Target keys were built with
  backslashes and looked up with slashes.
* **New `tools/character-pipeline/`:** glTF Transform 4.5, meshoptimizer 1.3 and sharp 0.35; build
  time only. Four male recipes (light, brown, dark skin, East Asian) and a female test body.
* **Per body:**
  * the kit and boots are simplified;
  * the skin under the kit is cut away along a line 1.2 cm inside its edges, so the arm cannot come
    through the sleeve when it is raised;
  * the mesh is rebound onto the game's skeleton (every one of the 61 clips works);
  * 16 materials become 4 (WebP atlases);
  * attributes are quantised.
* **Results:** 12,072–12,267 triangles, 4 materials, 0.53–0.56 MB per body, from 2.5 MB (or 29.8 MB
  for the earlier Kofi export).
* **Checked on the CPU against Ara's own skeleton and clips:**
  * at rest: mean 0.27–0.31 mm;
  * in 16 moments of 7 clips: mean 1.9–2.0 mm, 95% under 5.7 mm;
  * skin under the kit is counted on its own.
* **`public/match3d.js`:**
  * `bodyFor` and `chooseBody`, with `makeBodyFootballer` and a kit shader for club colours and
    patterns;
  * `shapeBody` taken out of `makeFootballer` (same code, now shared);
  * the Studio and award views use the body when it has loaded, and the classic figure until then
    or on any failure;
  * the Studio fetches nothing until a look is set;
  * an award ceremony waits at most 6 s for the body (a slow connection gets the classic figure);
  * a Studio .glb export of a realistic body carries the club colours in its vertex colours.
* **Studio:** a "Close-up body" choice (`baseBody`: Automatic, one of the four, or Classic), saved in
  the profile. `assetId` was left as it is (it is the library link).
* **Settings:** "Close-ups": realistic bodies on or off.
* **East Asian bodies:** nationality and nation give an East Asian hint (Japan, Korea, China).

**Not changed:** the 22 players on the pitch, match results, the save format beyond one optional
appearance field, and every API.

**Files:**
* `tools/character-pipeline/*`;
* `public/models/bodies/*` and `assets/characters/build-report.json`;
* `public/match3d.js`, `public/appearance.js` and `public/index.html`;
* `studio/js/app.js` (and `public/studio/js/app.js`);
* `src/studio/profileSchema.js` and `src/studio/appearanceService.js`;
* `test/character-bodies.test.js`;
* the licence registers.

**Tests:**
* `test/character-bodies.test.js` (7):
  * the shipped bodies, their skeleton, materials and extensions;
  * the build report, with a passed deformation check and every hidden skin vertex found;
  * the profile field;
  * the look mapping;
  * identity through save, reload and transfer;
  * the East Asian hint.
* **Browser:**
  * four profiles: faces, kits (plain, stripes, hoops), idle, shot, dive, sprint, celebration, and the
    throw-in for every body;
  * the female body before and after the morph-target fix;
  * the award ceremony: realistic, classic setting, and a failed load falling back to the classic
    figure;
  * Studio save, reload and reopen;
  * the Studio export loaded back with GLTFLoader;
  * a 3D match: no body files requested, and the figures unchanged.

## 13. Match board, tactics, player cards, ball, camera and athletes (2026-11-27)
**Interface:**
* **Free agents:** the Transfers screen lists only deals with other clubs. Free agents have their
  own tab in the Transfers hub (Transfers · Free agents · Scouting), with a message when there are
  none. Nothing about signing them changed, and no transactions are created by looking at them.
* **Skip:** stays removed (section 3). Speed buttons remain.
* **Player cards:** the Squad screen opens on cards (Cards · List · Season stats); the player profile
  has a large card. A card shows the rating (its colour is the tier: bronze, silver, gold, elite,
  icon), position, nation, portrait, name, role and six key numbers (pace, shooting, passing,
  dribbling, defending, physical), age, condition and potential. The role (for example "Target
  striker" or "Ball-winning midfielder") is the archetype for his position whose key attributes are
  his own strongest. Nothing new is invented and no rating changes.
* **Look:** a brighter "stadium night" palette for the default theme, rounder cards with depth, pill
  tabs, clearer buttons. The light theme is unchanged.

**The match board (pause and half-time), DLS-inspired:**
* **Substitutions tab:** your team on a pitch in its formation (each line left to right) with the
  bench beside it, or below it on phones. Tap the player to take off (OUT), then a substitute (or the
  substitute first). The bench is sorted by how well each fits the outgoing position. The preview
  shows both players, the substitute's rating there and a warning when he is weaker. Then Confirm or
  Cancel; "Compare all" opens the detailed comparison.
* **Positions:** a substitute takes the outgoing player's position, so the formation is kept.
  "⇄ Move positions" swaps two outfield players (engine decision `swaps`).
* **Limits:** substitutions and windows left are shown and enforced. Injured players cannot come on,
  nobody comes back on, and the goalkeeper cannot be swapped.
* **Tactics tab:** style, formation and six sliders: mentality, pressing, defensive line, width,
  passing and tempo.
* **Players tab:** player instructions: shoot on sight, create chances, get forward, stay back.
* **Apply:** changes are applied by the engine at the next five-minute mark, and the toast says when.
  The 3D view swaps the figures when the substitution happens.

**Engine (all deterministic; neutral settings give exactly the old results):**
* **New instructions:** `mentality`, `press` and `passing` (0–100, 50 = no change) in
  `instrMods`.
* **Player instructions:** `PLAYER_INSTRUCTIONS` change the weights of the shooter and assister
  draws the engine already makes, never the number of chances.
* **Position swaps:** `swaps` in `applyHalftime`.
* **Saving:** club instructions and player instructions are now saved with the career (before this
  they went back to normal whenever a career was reloaded).
* **Speed and identical results:** neutral instructions (every AI club, and most of yours) skip the
  instruction work. Measured on 24 weeks, alternating with the previous engine, the median week
  took 296–304 ms against 298–303 ms. After 12 weeks every league table, every player's goals,
  assists, appearances and fitness, and every club's balance match the previous engine exactly.

**Ball and camera:**
* **Ball flight:** lofted balls slow in the air, long balls bounce twice, and a new driven pass
  skims the grass. Spin follows the flight: backspin on lofted passes, sidespin on curl.
* **Ball visibility:** the ball is 1.7× real size (was 2.2×), with a dark outline and a slight glow.
* **Broadcast camera:** about a quarter closer and lower; it leads the ball and adapts its zoom
  slowly. The old view is kept as "Standard".

**Athletes:** the optimised Ara bodies play in matches, each with his own hairstyle, build, skin
tone and kit (see the integration audit), with the mannequins as the fallback and a setting. A body
that fails to download only affects the players who would wear it.

**Half starts (measured, headless Chrome, software rendering):**
* Second half: the engine's reply took 0.95 s, the 3D view was rebuilt in 0.47 s, and the clock ran
  2.1 s after Resume, the same with athletes or mannequins. In Node the engine's resume takes 82 ms.
* First half: 29.5 s from Play. This includes simulating the rest of the week's first matches and,
  on a first match, loading the players, bodies and shaders in software.
* No further change was made, because a real GPU is needed to tell the rest apart from the slow
  software rendering.

**Files:**
* `public/index.html`: board, cards, theme, free-agents tab, camera names, settings, driven pass.
* `public/match3d.js`: camera, ball, `loadBodySet`, athletes, hair fitting.
* `public/ball.js`.
* `src/engine/matchEngine.js`, `src/engine/timeline.js`, `src/api.js`, `src/index.js` and
  `src/models.js`.
* Tests: `test/tactics-extra.test.js` (new), `test/ball.test.js` and `test/instructions.test.js`.

## Test results for section 13 (2026-11-27, Windows 10, 4 cores, Node 22)
| Check | Result |
|---|---|
| Build (`scripts/build-web.js`) and ESLint | **Passed** |
| Vitest, full run | **145 of 146 passed**. The one failure is the soak's speed limit under parallel load (500 ms/week). It failed the same way before this work (440–493 ms in earlier full runs) |
| `soak.test.js` alone | **Passed:** 336 ms/week (baseline 341–348) |
| New: `tactics-extra.test.js` (10) and 4 new ball tests | **Passed** |
| Changed: `instructions.test.js` | The exact-object checks now include the three new instructions at 50 (still exact) |
| Changed: `ui.test.js` | Its stub element gained `querySelector` (returns nothing, as a real DOM would when nothing matches); the test now also renders the half-time board |
| Browser, live 3D match: board out/in, preview, confirm, cancel, swap, mentality and pressing, a player instruction, apply; substitute on at the next mark; half-time substitution; second half | **Passed** |
| Browser, phone width (390 × 844): board, cards, profile | **Passed** after one fix (the bench strip had widened the board) |
| Browser: before and after screenshots (desktop and phone), Standard and Broadcast cameras, athletes and mannequins, six hairstyles | Done |
| Real phone, real GPU | **Not tested** |

## Test results for section 12 (2026-11-26, Windows 10, 4 cores, Node 22)
| Check | Result |
|---|---|
| Build (`scripts/build-web.js`) and ESLint | **Passed** |
| Vitest, full run | **131 of 132 passed**. The one failure is the soak's speed limit under parallel load (440 ms/week; it was 443 before any of this work) |
| `soak.test.js` alone | **Passed:** 348 ms/week (baseline 341–343) |
| New: `character-bodies.test.js` (7) | **Passed** |
| Body pipeline: 5 bodies optimised and checked | **Passed:** rest mean 0.22–0.31 mm; motion mean 1.75–1.96 mm and 95% under 5.7 mm; every hidden skin vertex found |
| Browser: Studio, 4 profiles, motion, throw-in for every body, classic and realistic | Done (screenshots); no skin through the sleeves |
| Browser: Studio save, page reload, reopen from the library | **Passed** (the body choice is kept) |
| Browser: Studio .glb export loaded back with GLTFLoader | **Passed** (club colours in the file, 66 joints, 61 clips, profile read back) |
| Browser: award ceremony (realistic, classic setting, failed load → classic, nothing left after close) | **Passed** |
| Browser: 3D match | **Passed:** no body files requested; figures as before |
| Live site (GitHub Pages, service worker v25) | **Passed:** the four bodies and `index.json` return 200 at their built sizes. Studio: only the needed body loaded, export with club colours, throw-in clean. Award ceremony shown, no errors. 3D match played with no body files requested. The connection measured about 22 KB/s that day, so first loads were slow (a 0.5 MB body took 33–37 s, the existing 1.4 MB clip file 63 s) |
| Real phone, real GPU | **Not tested** |

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
* About one header chance in five or six is still struck with the foot. This happens when there is
  no way to get a cross in, such as a turnover right before the shot.
* Realistic Ara bodies are used for close-ups only. Studio face sliders, hairstyles, beards and
  goalkeeper gloves are not shown on them (see the integration audit).
* Real-phone frame rate and first-half start on a real GPU were not measured.
