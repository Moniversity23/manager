# Player Studio — test results

*Recorded 2026-11-21 on Windows 10, 4 cores, Node 22.14, with headless Chrome over the DevTools
protocol. Only checks that actually ran are marked as passed.*

## Automated (`npm test`: build → ESLint → Vitest)

| Check | Result |
|---|---|
| `node scripts/build-web.js` | **Passed.** Worker bundle; Studio copied to `public/studio/`; GLTFExporter vendored |
| `eslint src test` | **Passed** (no problems) |
| Vitest, full run | **113 of 114 passed** across 20 files |
| The one failure | `soak.test.js`, speed limit only: 448 ms/week median against a 400 ms limit while the machine ran the suite in parallel. Its correctness checks (96 weeks, zero exceptions, a healthy world) passed |
| `soak.test.js` alone | **Passed:** 343 ms/week median |

### Studio and appearance tests (all passed)

| Requirement | Test |
|---|---|
| Legacy appearance fallback | `studio-api` — "without a Studio profile the legacy look is used" |
| Studio appearance merge | `studio-api` — "a Studio profile overrides only what it sets"; `studio-integration` |
| Missing appearance profile | `studio-api` — the legacy fallback test |
| Missing library asset | `studio-api` — "a profile whose library asset no longer exists still renders" |
| Missing model file (GLB) | Not testable in Node; the renderer's existing fallback covers it (a 30 s timeout, then classic figures; seen in an earlier browser run) |
| Corrupt appearance profile | `studio-api` — six corrupt and unsupported profiles all give the legacy look; validation rejects bad values and drops unknown fields |
| Stable look after save and load | `studio-api` — the same look after `toSave`/`fromSave` and after a load through the API |
| Player id preserved | `studio-api` — byte-for-byte snapshot after assigning and clearing |
| Football attributes, contract, stats and history preserved | `studio-api` — the same snapshot covers attributes, ability, potential, contract, wage, club, history, season stats, career, moves and honours |
| Transfers keep the look | `studio-api` — after `executeTransfer` |
| Youth players | `studio-api` — academy players have permanent looks and can be dressed |
| Match line-up compatibility | `studio-api` — line-ups carry the Studio look, and every player has a look and a slot rating |
| Library operations | `studio-api` — create, edit, duplicate, search, export, import, delete, and no delete while worn |
| Input safety | `studio-api` — unknown ids, path tricks (`..%2F`), corrupt imports, oversized descriptions and unsafe asset ids are refused |
| Club kits | `studio-api` — validated, saved with the career, worn in matches, with badges |
| Generator | `studio.test.js` — the example description, determinism, schema |

### Other new tests (all passed)
* **`sponsorship.test.js` (4).** Shirt deals no longer compound: 25 seasons of the richest
  one-year deal stay flat. A save with a $1.8 billion deal is repaired on load and the money already
  earned is kept. Lower-division income is unchanged, and every club stays within its cap after a
  season.
* **`instructions.test.js` (6).** Sliders from 0 to 100: 50 gives exactly the old results, a
  stronger setting has a stronger effect, and the old words still work.
* **`studio-api.test.js` (11).** Also covers the man of the match (his look, kit and career
  count) and AI bidding wars.

## Visual checks (headless Chrome — inspected, not just built)

| Check | Result |
|---|---|
| Studio opens (offline engine, the GitHub Pages setup) | **Passed:** 3D footballer loads on the shared match rig |
| Camera rotate and zoom; face and body focus | **Passed** (buttons; drag and wheel are wired) |
| Generation from the example description | **Passed:** 17, Nigeria, ST, 183 cm, dark skin, short curly low fade, brown eyes, clean-shaven, broad shoulders, strong legs, red and white kit |
| Appearance controls change the model | **Passed:** skin, hair, colour, beard, jaw, nose, face shape, eyes, height 200 cm, muscle, shoulders and legs; the model rebuilt each time (part and triangle counts changed; screenshots) |
| Kit change on the model | **Passed** (shirt colour and stripes) |
| Animation preview | **Passed:** 26 clips listed; shoot and sprint played |
| Save and library | **Passed:** "Test Striker: light: 200 cm" in the library |
| GLB export, then reading it back | **Passed:** 2.34 MB, 30 meshes, 38 animations, profile read back from the file |
| Import | **Passed:** the profile read from the .glb imported as a new character |
| Faces close up (four looks) | **Inspected:** dark skin with a fade, light skin with blond swept hair and blue eyes, tan with a full beard, very dark with an afro and goatee. All are recognisable human faces. Procedural, not photo-realistic |
| Match in 3D (offline) | **Passed:** players with new faces and kits; name tags show the rating in position; commentary captions; no console errors |
| Man of the match ceremony | **Passed:** player on the podium in club kit with the trophy and confetti; the canvas is disposed when the window closes |
| Career flow (server mode, 2D): match, half-time sliders, full time, nine screens | **Passed:** no console errors, no undefined or NaN text |
| Phone layout (390×844) | **Passed:** no overflow on four screens |
| Fullscreen | **Not tested** (headless Chrome cannot enter fullscreen) |
| Real phone frame rate | **Not tested** (headless rendering is software-only) |

## Performance notes
* **One shared model and clip set** load once for all 22 players and the Studio. A character adds
  no model file.
* **Close-up face detail** (eyes, lids, lips, nostrils) is hidden beyond 18 m of the camera, so a
  full match draws no more than before at TV distance. Low quality keeps flat shading and no detail
  meshes.
* **Local server under headless Chrome:** a known contention on this 4-core machine makes week
  steps take 5–45 s. Without a browser running the same requests take about 1 s. GitHub Pages runs
  the offline engine and is not affected.
