# The Gaffer — development roadmap

*Updated 2026-11-20. Sources: the [technical audit](GAFFER_FULL_TECHNICAL_AUDIT.md), the
[match simulation audit](GAFFER_MATCH_SIMULATION_AUDIT.md) and the
[baseline](BASELINE_TEST_RESULTS.md). Every phase must keep saves, IDs, offline play and mobile
working; use only free assets with a register entry; leave engine results unchanged unless a phase
says otherwise; and end with the completion report below.*

| Phase | Goal | Status |
|---|---|---|
| 0 | Audit and baseline | **Done** (this document set) |
| 1 | Authoritative match timeline that the view follows; measured possession and passing | **Done** (report below) |
| 2 | Engine event order and on-ball decisions | **Done** |
| 3 | Tactical shape and off-ball movement | **Done** (view-side shape; see report) |
| 4 | Ball physics | **Done** (passes; shots keep their own path) |
| 5 | Animation selection and blending from timeline actions | **Done** (kicks, tackles, headers) |
| 6 | Player models and kits | **Done** (club patterns on the 3D model) |
| 7 | Stadium and crowd | **Done** (grounds by capacity, attendance, rain) |
| 8 | Audio and commentary | **Done** (original sound kept; play-by-play commentary) |
| 9 | Broadcast cameras and replays | **Done** (big-chance replays; timeline replays still open) |
| 10 | Transfers, management AI and player development | **Done** (best-fit recruitment, performance ratings) |
| 11 | Performance and offline optimisation | **Done** (line-up cache; save size assessed) |
| 12 | Full regression and release preparation | **Done** (client syntax test; browser runs) |

## Phase 1 completion report: authoritative match timeline

1. **Files inspected:**
   * `src/engine/matchEngine.js`, `src/index.js`, `src/api.js`, `src/engine/historyEngine.js`,
     `src/utils.js`, `src/migrations.js`;
   * `public/index.html` (match view, reports, half-time), `public/match3d.js`, `public/sw.js`;
   * the existing tests.
2. **Files created:**
   * `src/engine/timeline.js` and `test/timeline.test.js`;
   * six documents in `docs/`: the five `GAFFER_*` audits and roadmap, and `BASELINE_TEST_RESULTS.md`;
   * `docs/REALISM_AUDIT.md` and `docs/REALISM_ROADMAP.md`;
   * `assets/licences/ASSET_REGISTER.md` and `assets/licences/asset-register.json`.
3. **Files changed:**
   * `src/engine/matchEngine.js`: builds the timeline each half and takes possession from it;
   * `src/index.js`: sends the packed timeline to the half-time view and the report, and keeps it out
     of the saved last report;
   * `src/engine/historyEngine.js`: stores passes, accuracy, tackles and interceptions in the match
     archive;
   * `public/index.html`: the view follows the timeline; the clock runs at half its old rate; live
     possession and passes; new report row;
   * `public/engine.worker.js` (rebuilt) and `public/sw.js` (cache v13).
4. **Architecture.**
   * The engine still decides every result.
   * The new timeline runs inside the engine, with its own random stream, only for matches somebody
     watches.
   * It records every action between the real players, anchored on the engine's goals, shots,
     cards, injuries and subs.
   * The view consumes that timeline instead of inventing passes and turnovers.
   * Possession is measured, never taken from xG.
5. **Assets added:** none.
6. **Licences verified:** the existing assets, now recorded in the asset register with checksums.
7. **Tests executed:**
   * the full Vitest suite, ESLint and the worker build;
   * the timeline test over 65 seeded matches;
   * a Node timing of 200 matches with and without the timeline;
   * headless Chrome: the full career flow in 2D, the 3D view, phone layout, and the timeline
     instrumentation in the view;
   * the baseline commit run side by side for the server-speed problem.
8. **Results:**
   * 69 of 70 tests pass in the full run. The soak's timing limit fails only under parallel load
     and passes when run alone (369 ms/week); its correctness checks pass in both.
   * Zero timeline integrity problems.
   * Results are identical with and without the timeline.
   * In the view: 0 invented passes or turnovers in the measured window.
   * Statistics in realistic ranges (see the simulation audit).
9. **Unresolved:**
   * Off-ball positions are still the view's formation shape.
   * At normal speed only about one pass in three or four is shown.
   * The engine's within-segment order (shots after a red) is worked around, not fixed.
   * Local server slowness under browser load (pre-existing).
10. **Possible regressions:**
    * Matches now take twice as long to watch at the same speed setting (deliberate: the clock runs
      at 0.75 match minutes per second per speed step instead of 1.5). Users who want the old pace
      can pick the next speed up.
    * A paused half-time match in the save grows by about 100 KB.
    * Possession figures in new reports differ from old ones, because they are now measured.
11. **How to reverse:** revert the Phase 1 commit (`git revert <commit>`). Saves stay compatible
    either way:
    * the timeline is not part of the schema;
    * old reports simply have no `ts` statistics;
    * a half-time save with `m.tl` loads fine in older code, which ignores it.
12. **Next phase:** Phase 2 (done; report below).

## Phases 2–12 completion reports (2026-11-20)

Common to all of them:
* **Assets and licences:** no new third-party assets. The ball physics, kit patterns, stadiums,
  rain and commentary are written in code, so the asset register is unchanged.
* **How to reverse:** revert the commit for these phases. No save migration was needed; old saves
  load as before, and new saves load in older code, which ignores the new fields (`st` per-player
  stats in ratings, `capacity` in line-ups, timeline `DRIBBLE` events in a half-time match).
* **Verification:** the full test suite, lint, the worker build, and headless Chrome runs listed
  under Phase 12.

### Phase 2: engine event order and on-ball decisions
* **Changed:** `src/engine/matchEngine.js` (`afterLastAction`), `src/engine/timeline.js`
  (`dribble`, `DRIBBLE` event, validation), `test/timeline.test.js`.
* **Engine order.** A card or injury rolled in a 15-minute segment now happens no earlier than that
  player's last shot, goal or assist in the segment, and a second yellow no earlier than the first.
  * This is done by moving the rolled minute, with **no extra random draws**, so scores are
    unchanged. No versioned engine flag was needed after all.
  * Only the minutes of cards and injuries change, and with them the minutes played.
  * New test: across 65 matches, nobody acts after a red card or injury.
* **On-ball decisions.**
  * The player on the ball may carry it forward or take a man on instead of passing. The chance
    depends on his dribbling and pace (squared), his position (wingers and attacking midfielders
    most, centre-backs least) and how far upfield the ball is.
  * A take-on records the defender beaten.
  * Measured: median about 15 dribbles per team per match, and wide players dribble more than
    twice as often as centre-backs (tested).
* **Not done:** a separate shoot/pass/clear decision model. Shots still come only from the
  engine's chances, which keeps the results untouched.

### Phase 3: tactical shape and off-ball movement
* **Changed:** `public/index.html` (`SHAPE`, `shapeOf`, player targets in `stepPositions`), and
  `src/engine/timeline.js` (`pack` sends both tactics).
* **Shape by tactic.** Each tactic sets four things for off-ball players:
  * defensive line height (high press +0.07 of the pitch, low block −0.09);
  * width with the ball (possession is widest);
  * compactness without it (low block is narrowest);
  * how far full-backs overlap when the ball is in the opponents' half.
* **Pressing.** A pressing side sends a second man at the ball when he is close enough.
* **Dribbles on screen.** Timeline dribbles show the carrier running with the ball, and the beaten
  defender chases.
* **Not done:**
  * Shape keyframes are not part of the timeline (the view derives them from the tactic).
  * No new tactical instructions in the management screens.

### Phase 4: ball physics
* **Added:** `public/ball.js` (shared, deterministic) and `test/ball.test.js` (5 tests).
* **Ball types.**
  * Ground passes slow under rolling friction (about 6 m/s²), and a through ball is hit harder so it
    is still running at the receiver.
  * Long balls fly with a peak height that depends on distance, land short of the receiver and
    bounce up to him.
  * Crosses arrive at head height (1.5–3 m), which triggers the existing header animation.
* **Pass type.** It comes from the timeline when it says (short, long, through, cross); otherwise
  it is chosen from distance and position. Through balls are played into space ahead of the runner.
* **Measured** (in the tests): a 15 m pass takes 0.7–1.4 s and a 40 m ball 1.5–2.6 s; the ball
  leaves the foot at under 30 m/s.
* **Not done:** spin and curl, deflections, and shot trajectories (shots keep their own path).

### Phase 5: animation from actions
* **Changed:** `public/match3d.js` and `public/index.html`.
* **Kicks.** Long balls and crosses use the instep kick (`kickFront`); short passes use the
  side-foot (`kickSide`); a through ball is a firmer side-foot.
* **Tackles.** Standing tackles from the timeline now play a quick foot-in instead of the slide;
  sliding tackles still slide.
* **Receiving.** Crosses reach head height, so the receiver heads it; first touches on arrival were
  already in place.
* **Measured in 3D** (offline mode, motion-captured players, 10 minutes):
  * `kickSide` ×4 and `kickFront` ×1, with ball-contact timing errors of 0, 0, 0 and 0.10 s;
  * a keeper dive and a goal celebration.
* **Not done:** chest control, shielding, and turning with the ball. There is no fitting CC0 clip,
  and the existing `hit-chest` clip is a recoil, not a control.

### Phase 6: player models and kits
* **Changed:** `public/match3d.js` (`kitShirtMaterial`).
* **Club patterns on the 3D model.** The motion-captured shirts now carry the same club pattern as
  the classic figures: stripes, hoops or a dark yoke.
  * The model has no texture coordinates, so the pattern is painted in the shader from each
    vertex's bind-pose position, and it moves with the cloth.
  * One shader program is shared by all patterned shirts.
  * Checked in a close-up screenshot (blue and white stripes).
* **Already in place:** permanent looks, heights and builds, and shirt numbers.
* **Not done:** names on shirts, sleeve patterns, and away kits chosen by colour clash (the existing
  hue clash rule remains).

### Phase 7: stadium and crowd
* **Changed:** `public/match3d.js` (`groundDesign`, `buildStands`, rain), `src/index.js` (line-ups
  carry the stadium `capacity`), `public/index.html` (`matchWeather`, Settings → 3D weather).
* **Grounds by capacity.**
  * Under 9,000: low terraces, three steps behind the goals, open ends.
  * Up to 32,000: covered stands.
  * Above that: a second tier and a raised roof over the side stands.
  * Roof colour is fixed per club.
* **Crowd.** It fills to the expected attendance, so a 1,225 crowd in a small ground leaves empty
  terraces (screenshot checked).
* **Rain.** About one fixture in five, fixed per fixture. It brings drops and heavier fog, and
  Settings can turn it off.
* **Not done:**
  * Individual crowd reactions (the instanced crowd still bounces as a whole on chances and goals).
  * Wind, snow and time-of-day transitions.

### Phase 8: audio and commentary
* **Changed:** `public/commentary.js` and `public/index.html`.
* **Sound:** the original synth was kept unchanged, as the user asked.
* **Commentary.** New phrase banks for real timeline actions (dribbles and take-ons, crosses, through
  balls, long balls, tackles, interceptions), each tied to the real player.
  * They have low priority with their own cooldowns, so they never talk over goals, saves or cards.
* **Not done:** commentary for build-up spells longer than a few passes, and other languages.

### Phase 9: broadcast cameras and replays
* **Changed:** `public/index.html` (`recFrame`, shot handling).
* **Replays.** Big chances now get a slow-motion replay too: a save from a chance of at least 0.2
  xG, or a shot off the woodwork. Goals already had one.
  * They use the recorded frames of what was shown, with the same replay camera beside the goal.
  * They are skipped at 8× speed and when replays are off.
* **Cameras:** five already exist (TV, Close, Wide, Tactical overhead, Goal); the tactical camera
  was already there.
* **Not done:** replays rebuilt from the timeline (any moment, several angles) and a full-time
  highlight reel. The recording buffer holds only the last 8 seconds.

### Phase 10: transfers, management AI and player development
* **Changed:** `src/engine/transferEngine.js` (`aiMarketRound`), `src/index.js` (`_ratings`),
  `public/index.html` (report).
* **Recruitment.**
  * AI clubs now compare up to six affordable targets in the position group they need.
  * They sign the best fit: quality against the squad, room to grow (ambitious clubs value young
    players with potential), an age penalty over 31, and price against budget.
  * Before, they signed the first one that passed the checks.
* **Match ratings.** In matches with a timeline, ratings now include what the player did: passes
  completed and accuracy, tackles, interceptions and dribbles, minus fouls. This replaces most of
  the old fixed random variation.
* **Report.** The full-time report names the leaders (most passes, tackles, dribbles), and each
  rating chip shows the player's numbers on hover.
* **Already in place** (earlier passes): need-based buying, morale from playing time, transfer
  requests, the development and value curves, and potential shifts.
* **Not done:** contract negotiation by AI clubs with each other, and scouting-driven AI recruitment.

### Phase 11: performance and offline
* **Changed:** `src/engine/timeline.js` (`lineupAt` is cached per match and side).
* **Measured:**
  * The line-up lookup was about 9% of the weekly simulation time; the soak median went from
    369–386 to 348 ms/week alone, and from 502–524 to 471 ms/week in the parallel run.
  * Profiled week: 457 → 391 ms.
* **Checked and left as they are:**
  * **Save size.** Players are 11.3 of a save's 12.6 MB. A compact encoding would cut that to
    8.1 MB raw but only from 1.00 to 0.86 MB gzipped, and old code relies on explicit `null`
    and `false` fields. Not worth the risk; recorded here.
  * **Saving before the server replies.** It stays that way: replying first could lose a week if
    the server stopped (the server test relies on this).
  * **The model and clips** are already cached by the service worker for offline play.
* **Still open:**
  * The local server slows to 8–59 s per step while headless Chrome renders on the same 4-core
    machine; the same requests take under 1 s otherwise. This is pre-existing (the baseline commit
    shows it), and the live site (worker mode) is not affected.

### Phase 12: full regression
* **Added:** `test/client.test.js`. It parses every browser script, including the page's inline
  scripts, with esbuild, and checks that the service worker caches every script the page loads.
  * A duplicate declaration in the 3D view during this work made the match silently fall back to
    2D. This test catches that class of bug; it was confirmed against the exact error.
* **Results:**
  * `npm test`: build and lint clean; **79 of 80 tests pass**. The soak's timing limit fails only
    under parallel load (471 ms/week) and passes alone (348 ms/week); its correctness checks pass
    in both runs.
  * **Browser, local server:** the full career flow (match, half-time, full time, nine screens,
    negotiation, profile) passes with no console errors and no undefined text. The phone layout
    has no overflow on four screens.
  * **Browser, static offline mode** (as on GitHub Pages): the 3D view runs with the
    motion-captured players, patterned kits, a small ground with a sparse crowd, and rain.
  * **Timeline instrumentation in the view:** no invented passes or turnovers.
* **Not covered:** real-phone frame rates (headless rendering is software-only), fullscreen
  (headless cannot enter it), and a save-compatibility matrix across every old version (the
  migration tests cover v6 → v11).

## Still to do (next work)
1. Replays rebuilt from the timeline, and a full-time highlight reel.
2. Shape keyframes and new tactical instructions (line height, width, tempo) that feed the engine.
3. Spin, curl and deflections in ball flight; shot trajectories through `ball.js`.
4. Chest control, shielding and turning animations (needs suitable CC0 clips: check Mesh2Motion
   updates and the Quaternius library).
5. Individual crowd reactions; wind and snow.
6. Moving the server's save off the request path safely (a write-ahead queue that is flushed on
   shutdown), and smaller saves through a versioned compact player encoding.
