# The Gaffer — full technical audit

*Audit date: 2026-11-20. Baseline commit: `697290d`. Audited by reading the code and running it (tests,
headless Chrome over the DevTools protocol, Node timing scripts). Companion documents:
[match simulation](GAFFER_MATCH_SIMULATION_AUDIT.md), [visuals](GAFFER_VISUAL_AUDIT.md),
[assets and licences](GAFFER_ASSET_AND_LICENCE_AUDIT.md), [roadmap](GAFFER_DEVELOPMENT_ROADMAP.md),
[baseline results](BASELINE_TEST_RESULTS.md).*

## 1. Stack and runtime

| Part | What it is |
|---|---|
| Game logic | Plain Node.js (CommonJS), no framework. `src/index.js` (`GameWorld`, about 2,270 lines) plus 20 engines in `src/engine/`. |
| API | `src/api.js`: one route table shared by two hosts. |
| Host 1: server | `src/server.js`, a plain `http` server. Saves go to files (`data/`, gzip with rotating backups) or MongoDB when `MONGODB_URI` is set. |
| Host 2: offline | `public/engine.worker.js`, the same `src/` code bundled by esbuild (`scripts/build-web.js`). It runs in a Web Worker and saves to IndexedDB. **GitHub Pages runs this mode.** |
| UI | `public/index.html`: one page with inline CSS and two inline scripts (about 2,600 long lines). It holds the match view's simulation and the 2D renderer. |
| 3D | `public/match3d.js` on three.js r170 (vendored in `public/vendor/`, no CDN). |
| Audio | `public/sound.js` (Web Audio synthesis, no audio files) and `public/commentary.js` (text commentary). |
| PWA | `public/sw.js` (shell cache), `manifest.webmanifest`, icons. |
| Tests | Vitest, 11 files, 70 tests after this phase; ESLint over `src` and `test`. |
| Deploy | `.github/workflows/pages.yml` builds the worker and publishes `public/` on every push to `main`. |
| Determinism | mulberry32 `RNG` and `hashString` in `src/utils.js`. The world state is plain JSON. |

## 2. How the main systems work (as implemented)

* **Matches.** `src/engine/matchEngine.js` plays 15-minute segments: six in normal time, two in extra
  time. Each segment does the following:
  * It recomputes both sides' strength from the players on the pitch (position ability, fitness,
    morale, chemistry, home edge, the tactic matrix, form).
  * It draws a Poisson number of shots from the strength ratio, each with an xG value; goals come
    from those shots.
  * It then rolls fatigue, cards and injuries per player.
  * The manager's own matches pause at half-time for decisions.
  * See the [match simulation audit](GAFFER_MATCH_SIMULATION_AUDIT.md).
* **Match timeline (new, Phase 1).** `src/engine/timeline.js` turns each of the manager's matches
  into a second-by-second record of real actions between the actual players. The view follows it,
  and possession and pass statistics are measured from it.
* **Match view.** `public/index.html` (`stepPositions`, `simPass`, `simShoot`, `simGive`) moves 22
  dots and a ball in pitch coordinates. `public/match3d.js` draws that state as a stadium with
  motion-captured footballers. The 2D view draws the same state.
* **Season, competitions and transfers.** These are handled by separate engines: `seasonEngine`,
  `competitionEngine`, `transferEngine`, `negotiationEngine`, `developmentEngine`, `youthEngine`,
  `financeEngine`, `boardEngine`, `awardsEngine`, `internationalEngine`, `historyEngine` and others.
* **Saves.** Schema v11 (`src/migrations.js`), migrated step by step, with older saves backed up
  before migration (`auto.v6.backup…`).
  * The history archive (`historyEngine`) is append-only.
  * Player IDs are permanent.
  * A paused half-time match (`liveMatch`) is saved with its timeline (about 130 KB).
  * Finished reports are saved **without** the play-by-play.
* **Mobile quality.** `createView({ quality: 'auto' | 'low' | 'high' })` picks the pixel ratio,
  antialiasing, shadows and crowd density. `auto` decides from the device (core count, memory,
  screen).
* **Assets and caching.** The service worker caches the app shell. The footballer model (340 KB)
  and clips (830 KB) are fetched once per session and shared by all 22 players. If they fail to load
  within 30 s, the view uses the procedural figures instead.

## 3. Status of each area

### Fully implemented (verified by tests or by running it)
* Club management loop, seasons, promotion and relegation, cups, continental and international
  football: `engine`, `features`, `nextlevel` and `soak` tests (3 seasons, zero exceptions).
* Save, load, migration and the offline worker: `save`, `server` and `features` tests, plus browser
  checks of IndexedDB in earlier passes.
* Transfers, loans in and out, negotiation, contracts, youth intake, development and values.
* History archive (club, player, competition, manager and match records; earlier seasons are never
  overwritten): `history.test.js`.
* The authoritative match timeline and measured possession and passing: `timeline.test.js`, 8 tests.
* 3D stadium, motion-captured players with a procedural fallback, four cameras and goal replays:
  browser screenshots.
* PWA install and offline play.

### Partially implemented
* **The match view follows the timeline, but only partly.**
  * Passes, turnovers and the build-up to shots come from the timeline.
  * The *positions* of the 20 off-ball players are still the view's own formation-shape movement.
    They are not tactical positioning decisions.
  * At normal speed, every third or fourth timeline pass is shown (the ball cannot travel as fast
    as the clock).
* **Tactics.**
  * The four tactics change engine strength (a rock-paper-scissors matrix), the timeline's
    possession share and pass tempo, and how quickly fatigue builds.
  * Width, line height, pressing triggers and similar instructions do not exist.
* **Commentary.** It describes real engine and timeline events (goals, shots, cards, subs) but
  not passes or tackles.
* **Replays.** They replay the frames the viewer actually saw (a recorded buffer). That matches
  what happened on screen, but replays exist only for goals.

### Placeholder
* Crowd: instanced box figures that bounce. No individual animation or crowd audio sections (the
  audio pass that added these was reverted at the user's request).
* Stadium architecture: one generated design for every club, with a capacity-driven stand height.

### Implemented but not connected correctly (found by this audit)
* **Possession came from xG.** `pos` was derived from the share of expected goals, so a side with
  more shots always "had more of the ball". **Fixed in Phase 1:** it is now measured from timeline
  spells, or estimated from both midfields and tactics for matches nobody watched.
* **The view invented its own match.** Its passes, tackles and interceptions were random and
  unrelated to the engine, so the screen and the statistics disagreed. **Mostly fixed in Phase 1**
  (see above).
* **Shots after a red card or injury.** The engine rolls a segment's shots before its cards and
  injuries, so a player can shoot in minute 38 after being sent off in minute 33. The timeline
  works around this by moving the card or injury after his last action. The engine itself is
  unchanged, so its results stay identical.

### Defects (open)
* The engine has no notion of where the ball is. Shot locations, set pieces and offsides are not
  simulated; the timeline makes them up consistently, after the fact.
* Non-goal shots are spread evenly through their segment and their outcome follows from xG (by
  design, so no extra random draws are made). Saves and misses are therefore predictable from xG.

### Performance problems
* The local server under a busy browser: a week step that takes about 1 s over HTTP took 8–14 s
  while headless Chrome was rendering on the same 4-core machine. The baseline commit behaves the
  same, so this was not caused by the timeline. The live site (worker mode) is not affected.
* Saves are about 12.6 MB of JSON (1.8 MB gzipped) after a few seasons. Each save serialises the
  whole world (about 300 ms).
* The soak test's 400 ms/week limit fails when the whole suite runs in parallel on this machine
  (524 ms median) and passes alone (386 ms).
* Headless software rendering of the 3D view runs at about 2 fps. Real devices are much faster,
  but this means automated 3D checks are slow.

### Missing
* Ball physics (spin, bounce, aerial passes as arcs, deflections), offside, corners, throw-ins in
  the view (they exist in the timeline from this phase), goalkeeper distribution decisions.
* Player decision-making in the view (scan, choose, execute). Off-ball runs and defensive shape.
* Replays of anything other than goals. Stadium variety. Weather.

### Features that should not be changed
* Engine results and their random stream. Every result, table and record depends on them, and the
  timeline is built to leave them untouched (tested).
* Save schema, player and club IDs, the history archive.
* The offline worker and PWA path (it is how the live site runs).
* The original sound engine (restored at the user's request).

## 4. The ten highest-impact problems

| # | Problem | Impact | Status |
|---|---|---|---|
| 1 | The view invented its own passes and turnovers, unrelated to the engine | What you saw was not the match | **Mostly fixed (Phase 1)**: passes, turnovers and build-ups come from the timeline; off-ball positioning is still the view's own |
| 2 | Possession derived from xG | A core statistic was wrong | **Fixed (Phase 1)** |
| 3 | No pass, tackle or interception statistics | Reports had nothing on how a match was played | **Fixed (Phase 1)**: passes, accuracy, tackles and interceptions in the report, the half-time screen and the history |
| 4 | Engine segment order: shots after a red card or injury | Impossible sequences | **Worked around in the timeline**; the engine change is deferred (it would change results) |
| 5 | Off-ball players move in formation shape only | No defensive shape, runs or pressing on screen | Open: Phase 3 |
| 6 | The ball moves in straight lines at fixed speed | Long balls and crosses do not look like football | Open: Phase 4 |
| 7 | Animation choice is driven by the view's speed and events only | Kick timing, first touch and body orientation are approximate | Open: Phase 5 |
| 8 | Tactics are four presets | Little tactical depth | Open: Phase 3 and Phase 10 |
| 9 | Replays only for goals; one stadium design | Presentation feels repetitive | Open: Phases 7 and 9 |
| 10 | Large saves (12.6 MB JSON) | Slow saves on phones; storage limits | Open: Phase 11 |

## 5. Risks

* `public/index.html` is very large, and the view simulation lives inside it. Changes need the
  browser debug scenarios as well as unit tests.
* The timeline must stay consistent with the engine. `TL.validate()` runs over 65 seeded matches in
  the tests; any engine change must keep it at zero problems.
* Headless 3D checks are slow on this machine, so 2D mode is used for logic checks and 3D for
  screenshots.
