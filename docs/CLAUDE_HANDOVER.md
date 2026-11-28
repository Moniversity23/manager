# Claude handover: The Gaffer

*Updated 2026-11-28. Live at <https://moniversity23.github.io/manager/> (GitHub Pages, from `main`
through `.github/workflows/pages.yml`).*

## Architecture
* **Engine (authoritative), Node CommonJS:**
  * `src/engine/matchEngine.js` decides results. The manager's own match runs in five-minute
    segments, other matches in fifteen.
  * `src/engine/timeline.js` gives a second-by-second action timeline with its own random stream.
  * Seasons, transfers, finance and the other engines are also in `src/engine/`.
  * The world is `src/index.js` (`GameWorld`).
* **API:** `src/api.js` (every endpoint, transport-free). `src/server.js` serves it over HTTP;
  `src/webEngine.js` runs it in a Web Worker, built into `public/engine.worker.js` by
  `scripts/build-web.js`. Offline saves go to IndexedDB.
* **UI:** `public/index.html` is a single file containing:
  * the menu of 7 hubs with tabs (`HUBS`, `hubTabs`);
  * the screens;
  * the match view's simulation (`stepPositions`, `simPass`, `simShoot`, `chanceShown`);
  * live match management (`openLivePanel`, `spliceLive`, `finishLive`).
* **3D:** `public/match3d.js` (three.js r170 vendored in `public/vendor`). It provides:
  * one shared renderer;
  * `warmUp` and `prepare` for shaders;
  * view reuse across halves (`attach`, `rebind`);
  * mocap players (`makeFootballer`, `animateFootballer`);
  * the Studio and award views;
  * athletes (`loadAthleteSet`, `athleteFor`, `athleteRecipe`, `makeAthlete`): every footballer,
    from `public/models/athletes/` (match detail on the pitch, full detail in the Studio and award
    ceremonies), with the mannequin as the fallback;
  * the athlete lab (`athleteLab`, page `public/dev/athletes.html`).
* **Animation pipeline:** `scripts/anim/` (`glb.js`, `inspect.js`, `extract-ara.js`, `retarget.js`,
  `build-footballer.js`), producing `public/models/footballer.glb` and `footballer-anims.json`
  (61 clips).
* **Player Studio:** `studio/` → `public/studio/`, `src/studio/*`, `public/appearance.js`.
* **Character pipeline (build time):** `tools/character-pipeline/` (its own `npm install`). It turns
  Ara 3D Gen exports into the athletes (and the earlier close-up bodies); see its README.
* **Sound:** `public/sound.js` (Web Audio synthesis) and `public/commentary.js` (device speech); no
  audio files.

## Completed in this release
See `docs/INTEGRATION_CHANGELOG.md`. In short:
* **Athletes, dribbling, sound, Lineup and cards (2026-11-28, section 14):**
  * every footballer is an athlete: one base with 37 shape targets (face, heritage, build, age),
    11 modelled hairstyles, beards and keeper gloves; his look gives him a face and build of his own;
  * the ball is dribbled ahead of the carrier in touches;
  * sound unlocks on the first tap, survives a hidden tab, and has a phone-speaker EQ;
  * the Lineup is a formation pitch of compact cards (overall rating, suitability apart) with
    select-and-exchange; the match board uses the same pitch and cards; cards are smaller.
* **Match board, cards, ball, camera and athletes (2026-11-27, section 13):**
  * a DLS-inspired substitution board (pitch, bench, out/in, preview, swaps) in pause and half-time;
  * mentality, pressing, passing and player instructions; instructions now saved;
  * player cards with roles, a brighter palette, free agents in their own tab;
  * ball drag, bounces, driven passes, spin and visibility;
  * a closer Broadcast camera with lead and adaptive zoom;
  * realistic athletes on the pitch with their own hairstyles (Settings → Players in matches).
* **Realistic close-up bodies (2026-11-26):**
  * four Ara 3D Gen bodies, optimised to about 12,100 triangles, 4 materials and 0.54 MB, on the
    game skeleton;
  * shown in the Player Studio and award ceremonies, with a "Close-up body" choice in the Studio and
    an on/off setting;
  * Ara's empty morph-target pack on Windows found and fixed (in the lab).
* **Changes while paused:** style, formation, instructions and substitutions, applied from the
  next five-minute mark; three in-play substitution windows.
* **No more wait at the start of each half:** shared renderer, shader warm-up, view reused at
  half-time, rest of the week simulated after full time.
* **Skip removed.**
* **Free agents** have their own tab in Transfers.
* **23 football clips from Ara 3D Gen**, retargeted and proven, used by every player.
* **The view follows the timeline more closely:** one chance at a time; the keeper reads saves and
  watches wide shots.
* **Menu:** 26 entries became 7 hubs with tabs; a simpler Home.
* **Docs:**
  * `REFERENCE_PROJECT_COMPARISON.md`;
  * `PLAYER_STUDIO_INTEGRATION_AUDIT.md`;
  * `MATCH_REALISM_UPGRADE_PLAN.md`;
  * `ASSET_AND_LICENCE_REGISTER.md`;
  * `INTEGRATION_CHANGELOG.md`;
  * this file.

## Outstanding
* About one header chance in six is still struck with the foot (it starts while the other side has
  the ball). Keepers now throw or roll the ball out after a catch.
* **Athletes:**
  * Stylised from MakeHuman (smoothed skin, real hair), not hand-sculpted stylised art; faces vary
    within MakeHuman's range. Hairlines of the short styles are cut-outs (soft only with antialiasing).
  * Eye colour is the same brown for everyone; no tattoos, headbands or sleeves.
  * Only male athletes. Fingers differ from Ara's by about 15 mm (held poses).
  * The four close-up bodies (`public/models/bodies/`, 2.2 MB) are no longer loaded; deleting them is
    left to the owner.
* Real-phone frame rate, first-half start on a real GPU, and sound on a real Android or iOS device
  (and as an installed app) are unmeasured. Headless Chrome on this machine renders in software;
  sound was checked there with phone emulation.
* The soak test's 400 ms/week limit fails when the whole suite runs in parallel on this 4-core
  machine. Run alone it passes (341 ms/week).

## Run and test
```
npm install
npm test                  # build-web + ESLint + Vitest (about 4 minutes)
npx vitest run test/soak.test.js   # alone, for the timing limit
npm start                 # server mode on PORT (unset MONGODB_URI locally; .env points at a remote DB)
python -m http.server 3157 --directory public   # the GitHub Pages setup (offline engine in a worker)
node scripts/anim/build-footballer.js            # rebuild the model and clips (fails if a retarget is > 1° off)
node scripts/anim/extract-ara.js [file.glb]      # only when the Ara source clips must be refreshed
cd tools/character-pipeline && npm install && node athletes/variants.mjs && node athletes/build-athletes.mjs && node athletes/build-athletes.mjs --lod match   # rebuild the athletes
cd tools/character-pipeline && node build-bodies.mjs [--export]   # the earlier close-up bodies
```
* **Browser checks** were driven over the Chrome DevTools protocol, including:
  * a frame-by-frame audit that every shot, dive, goal and substitution on screen matches an engine
    event;
  * pausing and changing players;
  * half-start timing;
  * screenshots of every hub on desktop and phone.
* **Deploy:** push `main`; the Pages workflow builds, lints and uploads `public/`. Bump `CACHE` in
  `public/sw.js` when shipped files change (now `gaffer-shell-v28`).

## Rules that still apply
* Never let the view or physics decide an outcome. Keep results deterministic, and keep saves and
  player identities compatible.
* Assets: commercial-use licences only, registered before use. Nothing from SoccerDribble (no
  licence from its author). No real clubs' crests, kits or players.
* `FOOTBALL-RALISM-LAB/`, `.vscode/` and the master prompt file stay out of git.
