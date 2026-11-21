# Player Studio — handover audit

*2026-11-21. Taken over from another assistant's uncommitted work on `main`. Nothing was reset,
stashed or discarded: a non-destructive checkpoint of the tracked changes was stored with
`git stash create` + `git stash store` (stash@{0}, "checkpoint before Player Studio takeover");
the working tree was left as it was.*

## 1. State found

**Branch:** `main`, last commit `12abaff`.

**Uncommitted, modified files:**

| File | Change found |
|---|---|
| `src/index.js` | Studio look merged into match line-ups, **plus large accidental damage** (see §3) |
| `src/api.js` | Studio routes attached |
| `src/server.js` | `/studio/` static route; the GET-only check on static files was dropped |
| `src/models.js` | `studioProfile` saved as an optional player field |
| `scripts/build-web.js` | Copies `studio/` to `public/studio/` |
| `public/index.html` | "Player Studio" link in the menu |
| `public/sw.js` | Cache bumped |
| `README.md` | Studio section |

**Untracked, added:**
* `src/studio/` — `profileSchema.js`, `characterService.js`, `appearanceService.js`, `studioApi.js`
* `studio/` and its copy `public/studio/` — page, two stylesheets, `js/app.js`
* `test/studio.test.js` (4 tests) and `test/studio-integration.test.js` (2 tests)
* Six `docs/PLAYER_STUDIO_*.md` files
* `.vscode/` — not part of the game, left uncommitted

## 2. What the previous assistant completed, partly completed or left out

| Area | Found | Status after this handover |
|---|---|---|
| Natural-language creator | A rule-based parser for about 15 phrases plus a seeded generator. No paid AI | Extended: face, nose, lips, ears, eyes, brows, hair, beard, body, positions, kit colours, height in cm or feet. The base comes from the nation-aware look generator |
| Profile schema | Validation, but unknown fields were kept | Unknown fields dropped, every value checked, a size limit, lip and eyebrow enums |
| 3D preview | Loaded the bare mannequin; **no control changed the model** | Rebuilt on the match renderer: every control changes the real 3D model |
| Appearance editor | Height, weight, muscle, shoulders, legs, skin, hair, eyes and beard **in the JSON only** | Face shape, forehead, jaw, chin, cheekbones, nose, eyes, brows, lips, ears, hair, hairline, beard, height, weight, muscle, shoulders, chest, waist, arms and legs, all on the model |
| Kit workshop | Three colour pickers in the JSON only | Club home, away, third and goalkeeper kits (shirt, second colour, shorts, socks, pattern), saved with the career and worn in matches. Crest, sponsor, name and number on the model |
| Animation lab | Played clips on the bare mannequin | 26 clips on the Studio character (same rig as the matches), with speed control |
| Library | Create, update, duplicate, delete and import over the API; the UI had no delete, search or open | Search, open, duplicate, delete with confirmation, import and export |
| Export and import | JSON only | JSON, plus GLB (model, skeleton, 38 animations and profile embedded); GLB import reads the profile back |
| Career integration | `mergeForRenderer` in `_lineups`; nothing was saved after an assignment | Assign and remove are saved through the autosave queue; one character dresses one player at a time; transfers keep the look |
| Studio on GitHub Pages | Model paths (`../../models`) resolved outside the site's `/manager/` path | Fixed: the renderer loads its own assets; the offline engine worker serves the Studio API |

## 3. Defects found in the inherited changes (all fixed)

1. **`src/index.js` had lost about 170 lines.**
   * The history archive views were gone: `historyIndex`, `competitionHistory`, `clubHistory`,
     `managerCareer`, `playerHistory`, `historySearch`, `matchArchive` and `matchRecord`. The
     `/api/hist*` routes still called them, so the whole History section would have failed.
   * **Fixed** by adding the deleted methods back from the last commit, leaving the intended
     Studio change in place.
2. **Every match would have crashed.** In `_lineups` the line defining `hc` and `ac` (home and
   away club) was deleted, but the next lines used them, giving a `ReferenceError` in every
   match. **Fixed.**
3. **League tables lost their promotion and relegation zones** (`zone`, `zoneLabel`) and point
   deductions (`ded`). **Fixed.**
4. **The transfer market listed retired players instead of free agents** (`if (p.retired)`).
   **Fixed.**
5. **`server.js` served static files for any HTTP method**, not only GET. **Fixed.**
6. **Studio–renderer mismatches in `mergeForRenderer`:**
   * The beard `chin-strap` was never mapped to the renderer's `chin strap`.
   * `height` went stale when `heightCm` changed.
   * Every Studio field was spread raw into the look.

   **Fixed** with one shared mapping, `public/appearance.js`, used by both the server and the
   browser.
7. **Studio model paths broke under `/manager/` on GitHub Pages.** **Fixed.**
8. **A Studio assignment was never saved**, so it was lost on reload. **Fixed.**

After the repair, `git diff src/index.js` against the last commit showed only the intended Studio
lines (the import and two `mergeForRenderer` calls). Everything added afterwards is new work.

## 4. Tests that existed

* `test/studio.test.js` (4) and `test/studio-integration.test.js` (2): passing.
* One `studio-integration` expectation (build ≥ 10 for a muscular player) failed with an
  intermediate version of the new mapping. It was fixed in the mapping, not by weakening the
  test.
* The rest of the suite (13 files) is described in `docs/PLAYER_STUDIO_TEST_RESULTS.md`.

## 5. Was the match integration working?

**No, not as left.**
* The line-ups merged the Studio look, but the same function crashed (`hc` undefined) before
  returning.
* Even with that fixed, the renderer ignored every face and body field, so a Studio character
  looked like any other player except for skin, hair, beard, eye colour, height and build.

It works now: the renderer draws face shape, jaw, chin, cheekbones, nose, eyes, lids, lips, ears,
hairline and body proportions. This is tested in `test/studio-api.test.js` and was checked in the
browser.

## 6. What remained before deployment (all done in this handover)

* Repair the damage above.
* Wire every control to the model.
* Club kits.
* GLB export and import.
* The tests the brief asks for.
* Security validation.
* Asset register.
* Visual tests.
* Deployment.
