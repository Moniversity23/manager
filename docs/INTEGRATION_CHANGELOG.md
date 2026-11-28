# Integration changelog: reference projects, live match, UI and athletes (2026-11-24 to 2026-11-28)

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

## 14. Athletes with faces, dribbling, sound, Lineup and cards (2026-11-28)

**Footballers (priority 1).** Every footballer is now an athlete: in matches, in the Player Studio
and at award ceremonies. Details are in `PLAYER_STUDIO_INTEGRATION_AUDIT.md`.
* **One base, shape targets:** one base footballer from Ara 3D Gen (MakeHuman CC0 data) with 37 shape
  targets: 28 face features (head shape and width, jaw, chin, cheekbones, brow, forehead, nose width,
  length and hump, mouth width, lips, eye size and spacing, ears), 3 heritages and 2 ages (the face
  only), and 4 builds (muscular, lean, heavy, slim).
* **Hair and kit:** 11 modelled hairstyles (eight MakeHuman styles, and Ara's cornrows, mohawk and
  buzz). Beards (goatee, short, full, moustache, stubble) are soft-edged layers. Keepers wear gloves.
  The skin texture is stylised and tinted to eight tones.
* **His own identity:** his look sets the weights: the Studio's face sliders when set, otherwise the
  hash of his look. Heritage comes from his nationality or skin tone, and build and age from his own.
  His hairstyle and beard come from his look, with two variants for some styles. The result is the
  same every match.
* **Two levels of detail:**
  * Match: 1.17 MB, about 9,400 triangles plus 1,000–2,200 for the hairstyle.
  * Full (Player Studio, award ceremonies): 1.83 MB, about 16,000 triangles plus hair.
  * Hairstyles are 55–203 KB each and load only when a player in view wears one.
* **In the game:** the weights are baked once per player, so nothing morphs per frame. The mannequin
  with his look is the fallback. The four close-up bodies of section 12 are no longer loaded.
* **Fixed in the pipeline:** sparse 8-bit targets that were stored as zero; heritage and age targets
  that moved the head with the height; garments that did not follow a change of build; a skin texture
  too dark to tint lighter; hair textures that made blond hair look black.
* **Comparison scene:** `public/dev/athletes.html` shows 11 outfield players and 2 keepers, with
  different skins, faces, hairstyles, beards, builds, ages and both kits. Views: front, side, match
  camera, and a grid of faces from the front and side. Add `?classic=1` to see the same players as
  mannequins, and `?lod=match` for the match athlete.
* **Measured** (13 players, shadows): the match athletes need 268 draw calls and 309,420 triangles; the
  mannequins need 805 and 477,920. A real 3D match with athletes: 243 draw calls, about 340,000
  triangles.

**Dribbling (priorities 2 and 3).** The match view draws the dribble as touches:
* **Touches:** the carrier pushes the ball ahead, about every 0.36–0.62 s and longer at pace. It rolls
  out and slows between touches: 0.45 m ahead when walking, about 1.9 m at a sprint.
* **Turns** use a curved touch. A tackled or received ball carries on from where it is.
* **Results unchanged:** it runs after the players move, at any speed, and decides nothing.
  Possession, passes and shots still come from the timeline.
* **Measured** on settled dribbling at 4× speed: the ball behind the carrier in 1.5% of frames (19.4%
  before), with 7 jumps (24 before). At 1× speed: 2.1% of frames, no jumps.
* **Passes and shots:** their trajectories are unchanged from section 13 and covered by
  `ball.test.js`.

**Sound (priority 4).** Every sound is still generated in code, so there are no audio files to check.
See `AUDIO.md`. Fixed:
* **Hidden tab:** hiding the tab while no crowd played used to silence every later match sound. This
  was reproduced on the previous file.
* **Phones:** the first tap now unlocks audio, and any later gesture wakes it after the system
  suspends it. Speech is unlocked by the first gesture too and stops while the tab is hidden.
* **Phone speakers:** they get a high-pass filter and a presence lift, and kicks and drums now have
  mid-range sound.
* **Master volume:** it now changes the commentary and announcer volume at once.

**Lineup and cards (priorities 5–8):**
* **Lineup:**
  * The starting XI stands on a pitch in its formation's own shape. Each player is a compact card:
    overall rating (the big number), slot, a separate suitability mark (✓ natural, ≈ can play there,
    ! out of position) and condition.
  * Tap a player, then another: two starters swap places, a substitute or reserve comes in for a
    starter, or two substitutes swap seats. The preview shows both players' cards with overall
    rating, rating in the new slot and condition. Nothing changes until Confirm. On phones the preview
    stays at the bottom of the screen.
  * Substitutes and the rest of the squad are shown as cards, marked for the selected slot.
  * A formation selector sits above the pitch. Before a match every change is free. During one, a
    notice points to the match board.
* **Match board:** it uses the same pitch and cards. The bench shows each player's overall rating, and
  his suitability for the selected slot appears as text. The preview reads, for example, "35 overall ·
  39 as RW". The detailed chooser also shows overall rating as its big number.
* **Formations** come from one table (`FORMATION_LAYOUT`, `src/utils.js`, sent in the snapshot):
  * a 4-4-2 used to be drawn as 4-2-2-2;
  * in the 3D match, a lone holding midfielder (4-3-3, 4-1-4-1) or lone striker (4-3-3, 4-2-3-1,
    4-1-4-1) stood off-centre and now stands central;
  * the formation was already saved with the career; this is now tested.
* **Cards:** about 15% smaller (grid 152 → 128 px, portrait 78 → 64 px), with every number kept. On
  phones they fit three across, and each number sits over its label.

**Files:**
* `public/match3d.js`: athletes (`athleteRecipe`, `makeAthlete`, `loadAthleteSet`, `athleteFor`,
  `athleteLab`) in matches, Studio and awards.
* `public/index.html`: dribble, Lineup, board, cards, settings and audio wiring.
* `public/sound.js`, `public/commentary.js`, `public/sw.js` (v28), `public/dev/athletes.html`, and
  `studio/js/app.js` (body choice; copied to `public/studio/` by the build).
* `src/utils.js`, `src/index.js` (`formationLayouts`).
* `public/models/athletes/` (25 files, 5.6 MB in all; one match loads about 2 MB).
* `tools/character-pipeline/athletes/` and `optimise.mjs`; `assets/characters/athletes-*.json`.
* Tests: `athletes.test.js` (10), `dribble.test.js` (6), `formation-layout.test.js` (5) and
  `sound.test.js` (5), all new.

## 15. Realism milestone: human footballers, football movement, a recorded commentator and ground, installing the app (2026-11-28)

The milestone report is below. The evidence is in `docs/evidence/m15/` (before/after
screenshots, each labelled, with an index). The other documents were updated too:
* `AUDIO.md`, with the phone-testing checklist;
* `PLAYER_STUDIO_INTEGRATION_AUDIT.md`, with the alternatives evaluated for the characters;
* `MATCH_REALISM_UPGRADE_PLAN.md` and `CLAUDE_HANDOVER.md`;
* the asset register;
* `tools/commentary/README.md` and `tools/stadium-audio/README.md`.

### A. Characters

* **Audit first.** The live site (v28) was inspected in its athlete lab: front, side, faces, the match
  camera and walk/jog/sprint, at 1600 × 900. Found:
  * every athlete leaned back (trunk −3.6°, upper body −1.6°), with the toes lifted off the grass;
  * the heads tilted down;
  * everyone had brown eyes and one stylised skin;
  * beards were patchy.

  The installed app's service worker had never installed (see D).
* **Posture.** The athletes were bound with the Ara bind pose, which left the spine, neck, head, legs
  and feet a few degrees off the animation's own rest. The rebind now keeps the animation's rest
  there (`--spine-rest`, `tools/character-pipeline/optimise.mjs`).
  * Standing: trunk 2.0°, upper body 11° forward.
  * Running (the match's own locomotion, measured on the match athlete): 6°, 12°, 16° and 18°
    forward at 1.3, 3.2, 5.5 and 7.2 m/s.
* **Skin, eyes, light.**
  * Photographic MakeHuman skins (CC0, registered) in six groups (young or 31+; European, African or
    East Asian), tinted to each player's exact tone.
  * A four-eye strip under each skin gives dark brown, light brown, blue and green eyes from the look.
  * Image-based light: three.js `RoomEnvironment` for close-ups and portraits, a procedural stadium
    sky in matches.
  * Skin roughness 0.6: not plastic.
* **Beards.** They are 20% fuller in the middle, still soft at the edges, and black beards are lifted
  towards dark brown so they read as hair.
  * Tried and reverted: a matte material. It turned black beards into masks in the portraits.
  * Grey beards come from the look's `grey` (age), by design.
* **Portraits** replace the drawn faces on every card, in the Lineup, lists and the market (see the
  integration audit).
  * His own athlete, head and shoulders, three-quarter, in studio light and his club's home shirt.
  * Cached by look and kit (memory and IndexedDB), with the drawn face shown until the render is
    ready.
  * The server now sends the renderer's look (with Studio changes) in every player summary, so the
    portrait, the Studio, the Lineup and the match show the same man. A Studio change gives a new
    portrait.
  * Cards keep their size (15% smaller since section 14), the three-across phone layout and OVR
    apart from suitability.
* **Sizes:**
  * Close-up athlete: 2.19 MB (finer head for faces and portraits; 1.83 MB before).
  * Match athlete: 1.17 MB.
  * Skin atlases: 6 × 62–91 KB close-up, 6 × about 20–30 KB in matches.
* **Alternatives** (Blender/Rigify custom base, Mixamo, Rokoko, Rocketbox, modular parts) were
  evaluated on appearance, animation, phone cost, licence, access and effort. Details are in the
  integration audit. The MakeHuman/Ara base with shape targets was kept and improved: CC0, scripted
  and phone-sized. Mixamo and Rokoko need accounts and have their own terms; a sculpted base needs an
  artist.

### B. Movement and ball

* **Gaits.**
  * One stride phase drives every forward gait. It advances by the ground covered over the blended
    gaits' stride, so the planted foot stays put.
  * Each forward clip is placed at that phase (the left foot lands at 0, the right at 0.5).
  * The mocap jog and sprint strides were too long: the legs had to slide or the cadence collapse.
    They are shortened per gait by warping each limb towards its mean pose (`warpClip`).
  * The trunk straightens per gait (the mocap sprint leans like a start) and leans into acceleration.
  * Measured on the match athlete:
    * steps per minute: 111, 152, 205 and 208 at 1.3, 3.2, 5.5 and 7.2 m/s (89–151 before);
    * planted foot drifting along the run: 0.13, 0.20, 0.62 and −0.31 m/s;
    * total slip in any direction: 0.25, 0.97, 1.89 and 1.61 m/s. Before, the old gaits slipped at
      0.9–4.9 m/s, half to three-quarters of the running speed.
* **Dribbling** is physics now (`simDribble`, `public/index.html`).
  * The ball rolls and slows with grass friction (2.6 m/s²).
  * Each touch aims it at where he will be a stride or a few later, at his foot. The time to the next
    touch (T) depends on his pace and the play:

    | Pace or play | T |
    |---|---|
    | Close control | 0.55 s |
    | Jog | 0.62–0.9 s |
    | Running with it | up to 1.6 s, the ball 1–2 m ahead |
    | A turn | 0.45 s, round his side on a curve |
    | A ball behind him | a 0.32 s recovery prod |
  * He plays it when he gets to it: sooner if he would run past it, at most 0.4 s late.
  * At close control the feet alternate; running with it he uses his stronger foot (about one player
    in four is left-footed).
  * Tests: touches within 0.12 s of their plan, the ball at his feet at each touch (never behind him,
    within 0.45 m to the side), the ball only slowing between touches, and the feet as described. Plus
    the earlier six tests (ahead at a walk and a sprint, through a U-turn, at 4×, after a tackle, after
    a pass).
* **The foot on the ball.** The 3D view (`public/match3d.js`) does three things:
  * Lines his stride up with the next touch. The foot that needs the smaller change swings through
    just before it lands, and the cadence changes by 15% at most.
  * Reaches that leg forward from 0.2 s before contact to just after (hip, knee, toes).
  * At contact, draws the ball at that boot: a correction of a few centimetres, never more than 35,
    faded in and out.

  Measured in a 3D match: the contacts were sampled over two match runs in headless Chrome, with drawing switched off by a
  test hook so that the match ran at full rate. 11 contacts were caught at the moment of touch:
  * 8 had the boot within 0.18–0.30 m of the ball before the view's correction (median 0.21 m in the
    second run, in line along the run), which the view closes, so the boot is drawn on the ball;
  * 3 were touches forced 0.4 s late, after the player had slowed, with the ball 1.2–1.4 m ahead. They
    are drawn without contact (a known gap; capping the lead to his run's target broke the sprint
    tests, so it was reverted).

  The animation of a whole 3D match costs 7 ms a frame here (median; 19 ms at the 90th percentile)
  without drawing..
* **Ball.** Passes, shots, bounces, spin and woodwork are unchanged from section 13 (`ball.test.js`).
  The dribble's roll is new.
* **The engine decides everything, as before.** The view and the dribble never change possession or
  an outcome. The new sound and the commentary follow the engine's events.

### C. Audio

* **Commentary.** A recorded, mature British male broadcast voice replaces the device's speech
  synthesis (which was often female or robotic). See `AUDIO.md` and `tools/commentary/README.md`.
  * Recorded once with Kokoro-82M (Apache-2.0, run offline on the CPU): a 60/40 blend of the British
    male styles `bm_george` and `bm_lewis`, faster and lifted for excited lines.
  * 205 original lines (`tools/commentary/lines.mjs`) and 503 surnames (every surname in the name
    pools), each calm and called out: lines 1.68 MB, calm names 2.85 MB, called names 2.57 MB, index 60 KB: 7.1 MB in all. A match fetches
    its lines and both teams' names, about 2.5 MB, mostly from the service worker's cache.
  * Calls are put together from what happened: the name, the line, the situation after a goal, the
    score read the British way, and half- and full-time results.
  * Names are matched with accents forgiven. A renamed player gets a line without a name.
  * The voice is mixed through the same chain as the ground, and the crowd ducks under it.
  * Silence when play is quiet (cooldowns, priorities, stale lines dropped).
  * No service, no connection, no cost per match.
  * The device voice remains a choice. The stadium announcer is a chime and a caption with the
    recorded voice.
* **The ground.** 25 cuts from 20 CC0 Freesound recordings, each registered with its URL, author,
  licence and checksum: 1.4 MB.
  * Two crowd beds crossfading with the danger.
  * Three goal roars and an away end; gasps, "ooh"s, groans, applause, boos and cheers.
  * Real whistles: one blast for kick-off, two for half-time, three for full-time.
  * Ball touches (each dribbling touch too) and kicks.
  * The synthesised ground stays as the fallback per sound.
* **Mixing and controls.** Separate sliders for the crowd, referee, ball and boots, commentary and
  the announcer, under the master volume, plus a voice choice with a test button.
* **Measured** in headless Chrome with phone emulation: with a 390 × 844 touch screen, coarse pointer, one real touch and master
  volume 0.6, all 25 stadium recordings decoded.

  | Check | Result |
  |---|---|
  | Crowd bed (RMS) | 0.022–0.027 |
  | Commentator's goal call | 0.073 mean, 0.17 peak: about 10 dB over the bed; three recordings: call, name, situation |
  | Goal roar peak | 0.096 |
  | Whistle peak | 0.19 (0.25 before rebalancing, louder than the voice) |
  | Shot peak | 0.033 |
  | Crowd slider at 0 | 0 |
  | Master at 0 | 0 |
  | Pause / resume | suspended / running |.

### D. Installation (PWA)

* **The service worker never installed on the live site.** Its file list named the same file twice,
  and `Cache.addAll` rejects duplicates, so the install failed every time. There was no offline
  cache and no installed-app behaviour.
  * Now the list is de-duplicated and each file is cached on its own: a missing optional file no
    longer fails the install, a missing core file does.
  * Each update reaches the open app, which says so ("The Gaffer has been updated").
  * Settings → "The app" shows how it is running (browser or installed app), whether it plays
    offline, and the version, with **Check for updates**.
* **Install button.** It sits in the sidebar and in Settings and is shown whenever the app is not
  already installed.
  * Where the browser offers installation (`beforeinstallprompt`: Chrome, Edge, Samsung Internet), it
    opens the browser's own prompt.
  * Elsewhere it opens a help panel for that browser: iOS Safari (Share → Add to Home Screen), iOS in
    another browser (open in Safari), in-app browsers (open in the real browser), Firefox (menu →
    Install, or Add to Home screen), and desktop.
  * The panel explains that an installed app opens in its own window and plays offline, while a
    shortcut only opens the site.
  * It never promises an APK.
* **Paths.** The manifest uses relative `id`, `start_url` (`./?source=pwa`) and `scope` (`./`), so it
  installs under `/manager/` on GitHub Pages. Checked locally and on the live site: 
  * **Locally**, in Chrome with phone emulation: no manifest errors, no installability errors, the
    service worker active and controlling the page, and both Install buttons present.
  * **Live**: see F..

### E. Testing

| Check | Result |
|---|---|
| Build (`scripts/build-web.js`) and ESLint | **Passed** (one existing warning, in `tactics-extra.test.js`) |
| Vitest, full run (`npm test`) | **187 of 188 passed.** The one failure is the soak's speed limit under parallel load (517 ms/week against 400), as in sections 12–14 |
| `soak.test.js` alone | **Passed:** median 338 ms/week, mean 369 (limit 400). Sections 12–14 measured 336–354 alone, so this is machine contention, not a regression |
| New and changed tests: `commentary.test.js` (8, new), `sound.test.js` (10, five new), `dribble.test.js` (9, three new), `athletes.test.js` (size limit 2.3 MB for the finer close-up head) | **Passed** |
| Browser, athlete lab, before (live v28) and after: front, side, three-quarter, faces from the front, three-quarter and side, the match camera, walk, jog and sprint (`LAB.locomote`) | Done: `docs/evidence/m15/` |
| Browser, measurements in the lab (`posture`, `runTest`, match athlete) | Standing trunk 2.0°; lean 6/12/16/18°; 111/152/205/208 steps a minute; drift 0.13/0.20/0.62/−0.31 m/s at 1.3/3.2/5.5/7.2 m/s |
| Browser, portraits in a new career: squad (20 players) and Lineup | **Passed:** 20 of 20 rendered, none failed, drawn faces first |
| Browser, 3D match: recorded commentary captions, athletes, dribble contacts | **Passed**; contact measurements in B |
| Browser, sound with phone emulation | **Passed** (levels in C) |
| Browser, installability (phone emulation) | **Passed:** no manifest or installability errors; service worker active and controlling |
| Real phone, real GPU, installed app, real audio hardware | **Not tested** (no device here). Use the checklist in `AUDIO.md` |

### F. Deployment

* **Pushed** normally (no force) to `main`: `1e034c0..24e6cc1`. The Pages workflow deployed it; the
  live `sw.js` showed `gaffer-shell-v29` 30 s after the check began.
* **Live files match the commit.** 20 files were fetched from https://moniversity23.github.io/manager/
  and compared by SHA-256 with `24e6cc1`; all 20 are identical:
  * `index.html`, `sw.js`, `sound.js`, `commentary.js`, `portraits.js`, `match3d.js`, the manifest and
    the built `engine.worker.js`;
  * both audio indexes, `bed-calm.mp3`, `goal-1.mp3`, `gl1.mp3`, `names/okafor-x.mp3`;
  * `athlete.glb`, `athlete-match.glb`, `skin-young_african.webp`, the athletes' `index.json`;
  * `RoomEnvironment.js` and `dev/athletes.html`.
* **Live installation** (Chrome, phone emulation):
  * no manifest errors and no installability errors;
  * the service worker active with scope `/manager/` and controlling the page;
  * the cache `gaffer-shell-v29` holds 29 files, including `portraits.js` and `RoomEnvironment.js`;
  * both Install buttons present, and no console errors.
* **Live sound** (Chrome, phone emulation, after one touch):
  * all 25 stadium recordings decoded and the beds playing (RMS 0.025);
  * the recorded commentator (205 lines, 503 called names) played a goal call of three recordings
    (peak 0.125).
* **Not done:** a real phone, a real GPU, the installed app on a device. Use the checklist in
  `AUDIO.md`.

## Test results for section 14 (2026-11-28, Windows 10, 4 cores, Node 22)
| Check | Result |
|---|---|
| Build (`scripts/build-web.js`) and ESLint | **Passed** (one existing warning, in `tactics-extra.test.js`) |
| Vitest, full run | **171 of 172 passed**. The one failure is the soak's speed limit under parallel load (415 ms/week), as in sections 12 and 13 |
| `soak.test.js` alone | **Passed:** median 354 ms/week (limit 400; 336–348 in earlier runs, on a machine that was slower that day) |
| New tests: athletes (10), dribbling (6), formations and Lineup cards (5), sound (5) | **Passed** |
| Browser, comparison scene: 11 outfield players and 2 keepers; front, side, match camera, faces front and side; mannequins and match detail | Done (screenshots) |
| Browser, 3D match with athletes: match files requested (`athlete-match.glb` and 9 hairstyles), no errors | **Passed** |
| Browser, sound with phone emulation (touch, coarse pointer, 390 × 844) | **Passed**: no audio before a tap; after one it runs and speech is unlocked; crowd and whistle output 0.051, kick 0.031; master 0 → 0, crowd 0 → 0; pause and resume; hidden and shown recovers (output 0.057) |
| Browser, Lineup at 1366 and 390 wide: 4-2-3-1, 3-5-2, 4-4-2 and 4-3-3; select, preview, confirm; no sideways scroll; half-time board substitution preview | **Passed** after two fixes: a stale selection after a formation change threw an error, and the card numbers overflowed |
| Real phone, real GPU, installed app | **Not tested** |

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
* Athletes: MakeHuman-based rather than hand-sculpted; short-hair hairlines are cut-outs; beards are
  shells; only male athletes (see the integration audit).
* Dribbling: a touch forced late, after the carrier slowed with the ball rolling on, is not drawn
  touching. The dribble's leg reach is an overlay on the run, not a dribbling clip.
* Portraits show the club's default home kit, not a kit designed in the Studio.
* Sound was not checked on a real Android or iOS device, nor as an installed app.
* Real-phone frame rate and first-half start on a real GPU were not measured.
