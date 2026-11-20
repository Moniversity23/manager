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
| 2 | Engine event order and on-ball decisions | Next |
| 3 | Tactical shape and off-ball movement | Planned |
| 4 | Ball physics | Planned |
| 5 | Animation selection and blending from timeline actions | Planned |
| 6 | Player models and kits | Planned |
| 7 | Stadium and crowd | Planned |
| 8 | Audio and commentary | Planned (constraint: keep the original sound; the user rejected a full rework) |
| 9 | Broadcast cameras and replays | Planned |
| 10 | Transfers, management AI and player development | Partly done in earlier passes |
| 11 | Performance and offline optimisation | Planned |
| 12 | Full regression and release preparation | Planned |

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
12. **Next phase:** Phase 2.

## Phase plans

### Phase 2: engine event order and on-ball decisions
* Behind a versioned engine flag for new saves (old saves keep their results):
  * order each segment's events by minute before cards and injuries are applied, so nobody acts
    after leaving the pitch;
  * then remove the timeline's workaround.
* On-ball decisions in the timeline: pass, dribble, shot, clearance, chosen from the player's
  attributes, pressure and tactic. Add a `DRIBBLE` event.
* **Tests:** validate with no workaround; results distribution unchanged (goals per match, home
  win rate) within tolerance over 500 seeded matches.

### Phase 3: tactical shape and off-ball movement
* The timeline emits team shape keyframes (block height, width, compactness) from the tactic and
  game state.
* The view moves the 20 off-ball players towards them: defensive line, pressing triggers,
  overlapping full-backs, forward runs before through balls.
* More tactic instructions (line height, width, tempo, pressing intensity) that feed both the
  engine's strength and the timeline.
* **Tests:** shape metrics per tactic differ as intended; view instrumentation shows players
  reaching their keyframes.

### Phase 4: ball physics
* Pass and shot trajectories from kind, distance and power: ground passes with roll friction,
  lofted passes and crosses as arcs with bounce, driven shots, deflections.
* Deterministic, so a replay of the same event is identical.
* **Tests:** pure-function unit tests of the trajectories; arrival times match the timeline gaps.

### Phase 5: animation from actions
* Map timeline actions to clips: receive and first touch, side-foot and instep passes, crosses,
  standing and sliding tackles, interceptions, headers, keeper actions.
* Blend by speed and body orientation; time kick contact to the ball's departure.
* Only CC0 clips; add any new clip to the register.

### Phase 6: player models and kits
* More body types from the same rig; kit patterns (stripes, hoops, sleeves) from club colours;
  goalkeeper kits; numbers and names on the back.

### Phase 7: stadium and crowd
* Several procedural stadium designs chosen by club size and history; animated crowd sections
  reacting to timeline events; weather and time of day.

### Phase 8: audio and commentary
* Keep the original sound engine (the user preferred it).
* Commentary lines for timeline actions (key passes, tackles, saves) with variety and no repeats.

### Phase 9: cameras and replays
* Replays rebuilt from the timeline, not the screen buffer: any moment, several angles.
* A full-time highlight reel and a tactical camera. An option to watch key spells at real-time
  pace.

### Phase 10: management depth
* AI recruitment by squad need, contract dynamics, and morale effects from playing time.
  Development and value curves were improved in an earlier pass; extend them with the timeline's
  per-player statistics.

### Phase 11: performance and offline
* Smaller saves: strip derived data, compress histories, and save deltas.
* Server: move saving off the request path so a slow save does not block play.
* Fetch the footballer model in parallel with the week simulation. On slow connections keep it
  cached in the service worker.

### Phase 12: regression and release
* A full soak with timelines on for every match.
* Browser runs of every screen on desktop and phone, in both views.
* A save-compatibility matrix (v6 to the current version).
* Update the docs; tag the release.
