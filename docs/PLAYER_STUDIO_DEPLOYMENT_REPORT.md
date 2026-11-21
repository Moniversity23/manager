# Player Studio — deployment report

| | |
|---|---|
| Release commit | `0695171`: "Player Studio completed; more human faces; sponsorship and business fixes" |
| Follow-up commit | Studio page icon and this report (see `git log`) |
| Branch | `main`, pushed to `origin` (github.com/Moniversity23/manager) with no force-push |
| Deployment target | GitHub Pages through `.github/workflows/pages.yml` (build, lint, upload `public/`) |
| Production URL | https://moniversity23.github.io/manager/ (Studio: https://moniversity23.github.io/manager/studio/) |
| Deployment status | **Live.** The service worker cache is `gaffer-shell-v18`; `studio/`, `appearance.js` and `vendor/jsm/exporters/GLTFExporter.js` return 200; the live `match3d.js` contains the Studio and ceremony views |
| Backend | None needed. On GitHub Pages the game and the Studio run in the browser (engine worker, saves in IndexedDB); the Studio routes run inside that worker. `render.yaml`, `Dockerfile` and `Procfile` were not changed. If a Render service is connected to this repository, the same Studio routes are in the server code. I had no access to a Render account to confirm whether one exists |
| Environment variables, database | Unchanged. No secrets in the repository (`.env` is ignored); no new database |

## Checked on production after deployment
| Check | Result |
|---|---|
| Game loads, offline engine starts | **Passed** |
| 3D match with the new faces, kits and name-tag ratings | **Passed:** players loaded, match clock running, no console errors |
| Studio opens, character loads on the match rig | **Passed** |
| Generation, appearance and body edits, kit change, animations | **Passed** |
| Library save; GLB export and reading it back; import | **Passed** (2.34 MB .glb, 38 animations, profile read back) |
| Console errors | One 404 for a missing favicon on the Studio page, fixed in the follow-up commit |

## Tests before release
* Build and lint: passed.
* Vitest: 113 of 114 passed. The one failure is the soak's speed limit under parallel load (448
  ms/week); it passes alone at 343 ms/week.
* Details are in `PLAYER_STUDIO_TEST_RESULTS.md`.

## Outstanding
* **Faces are procedural** (sculpted heads with 3D eyes, nose, lips and ears), not photo-realistic
  scans. No licensed photo-real head assets were used.
* **Not verified:** frame rate on a real phone, and fullscreen.
* **UI simplicity pass is partial.** Added the squad stats table, instruction sliders, the
  ceremony stage and the Commentary log. No full redesign of every screen.
