# Claude handover: The Gaffer

*Updated 2026-11-24. Live at <https://moniversity23.github.io/manager/> (GitHub Pages, from `main`
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
  * the Studio and award views.
* **Animation pipeline:** `scripts/anim/` (`glb.js`, `inspect.js`, `extract-ara.js`, `retarget.js`,
  `build-footballer.js`), producing `public/models/footballer.glb` and `footballer-anims.json`
  (61 clips).
* **Player Studio:** `studio/` → `public/studio/`, `src/studio/*`, `public/appearance.js`.

## Completed in this release
See `docs/INTEGRATION_CHANGELOG.md`. In short:
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
* Header shots are struck with the foot in the view (the timeline marks them as headers).
* Keeper distribution clips exist but are not used in matches yet.
* Ara bodies are not shipped. They are about 6× the rendering cost and identity is baked at export;
  the plan is in the integration audit. The stored sample `Kofi_Mensah.glb` renders with a female
  body despite a male recipe, so regenerate before evaluating further.
* Real-phone frame rate and first-half start on a real GPU are unmeasured. Headless Chrome on this
  machine renders in software.
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
```
* **Browser checks** were driven over the Chrome DevTools protocol, including:
  * a frame-by-frame audit that every shot, dive, goal and substitution on screen matches an engine
    event;
  * pausing and changing players;
  * half-start timing;
  * screenshots of every hub on desktop and phone.
* **Deploy:** push `main`; the Pages workflow builds, lints and uploads `public/`. Bump `CACHE` in
  `public/sw.js` when shipped files change (now `gaffer-shell-v19`).

## Rules that still apply
* Never let the view or physics decide an outcome. Keep results deterministic, and keep saves and
  player identities compatible.
* Assets: commercial-use licences only, registered before use. Nothing from SoccerDribble (no
  licence from its author). No real clubs' crests, kits or players.
* `FOOTBALL-RALISM-LAB/`, `.vscode/` and the master prompt file stay out of git.
