# Milestone 15 — visual evidence

Labelled screenshots, compressed (JPEG, 1000 px wide), red band = **before**, green band = **after**.

* **Before:** the live site (https://moniversity23.github.io/manager/, service-worker cache v28, commit `1e034c0`), captured on 2026-11-28 at the start of the milestone in headless Chrome (software rendering) at 1600 × 900.
* **After:** this commit, served locally in the same way (offline engine in a worker), captured in headless Chrome at 1366 × 900 or 1600 × 900, or as a 390 × 844 phone.
* **Two "before" images are from this build:**
  * `04-before-beards`: the beards before their fix, already with the new skins and eyes;
  * `09-before-portraits`: the drawn portraits that show first, before the renders replace them.
    They are the portraits the live site shows.
* **Athlete lab:** `public/dev/athletes.html` shows 11 outfield players and 2 keepers.
* **The gait frames:** "before" shows the raw clips as they were played in matches; "after" shows the match's own locomotion (`LAB.locomote(speed)`: blended gaits, phase-locked stride, trunk posture), held at a share of the stride.
* **Measurements** quoted in the labels come from the lab's `posture()` and `runTest()`. See `docs/INTEGRATION_CHANGELOG.md`, section 15.

| File | What it shows |
|---|---|
| [01-before-posture-front.jpg](01-before-posture-front.jpg) | BEFORE (live v28, athlete lab): standing - trunk leans back (-3.6 deg), toes lifted |
| [01-after-posture-front.jpg](01-after-posture-front.jpg) | AFTER (this commit): upright athletic stance - trunk 2 deg forward, feet on the grass |
| [02-before-faces.jpg](02-before-faces.jpg) | BEFORE: heads tipped down by the lean, one stylised skin, brown eyes for everyone |
| [02-after-faces.jpg](02-after-faces.jpg) | AFTER: photographic skins by heritage and age, eye colours, image-based light, fuller beards |
| [03-after-faces-three-quarter.jpg](03-after-faces-three-quarter.jpg) | AFTER: three-quarter view (labels from the lab's full-body view are misplaced here) |
| [04-before-beards.jpg](04-before-beards.jpg) | BEFORE the beard fix: thin, patchy beards (skin shows through) |
| [04-after-beards.jpg](04-after-beards.jpg) | AFTER: fuller beards, soft edges; black beards read as hair; grey = the look's age |
| [05-before-walk.jpg](05-before-walk.jpg) | BEFORE: raw walk clip (89 steps/min; feet slid in matches) |
| [05-after-walk.jpg](05-after-walk.jpg) | AFTER: the match's own locomotion at 1.3 m/s - 111 steps/min, 6 deg lean |
| [06-before-jog.jpg](06-before-jog.jpg) | BEFORE: raw jog clip - a long bounding stride |
| [06-after-jog.jpg](06-after-jog.jpg) | AFTER: 3.2 m/s - 152 steps/min, 12 deg lean, stride warped to a footballer's |
| [07-before-sprint.jpg](07-before-sprint.jpg) | BEFORE: raw sprint clip - a start-of-race lean; slid 50-77% of its speed in matches |
| [07-after-sprint.jpg](07-after-sprint.jpg) | AFTER: 7.2 m/s - 208 steps/min, 18 deg lean, planted foot drift -0.31 m/s |
| [08-before-match-camera.jpg](08-before-match-camera.jpg) | BEFORE: the athletes from the match camera |
| [08-after-match-camera.jpg](08-after-match-camera.jpg) | AFTER: the athletes from the match camera |
| [09-before-portraits.jpg](09-before-portraits.jpg) | BEFORE: drawn (SVG) portraits on the squad cards |
| [09-after-portraits.jpg](09-after-portraits.jpg) | AFTER: portraits rendered from each player's own athlete, in the club's shirt |
| [10-after-portraits-zoom.jpg](10-after-portraits-zoom.jpg) | AFTER: six portraits at twice the card size |
| [11-after-lineup.jpg](11-after-lineup.jpg) | AFTER: the Lineup with rendered portraits (formation pitch and cards unchanged) |
| [12-after-match-broadcast.jpg](12-after-match-broadcast.jpg) | AFTER: a 3D match, Broadcast camera |
| [13-after-match-close.jpg](13-after-match-close.jpg) | AFTER: a 3D match, Close camera |
| [14-after-match-close-2.jpg](14-after-match-close-2.jpg) | AFTER: a 3D match, Close camera, later |
| [15-after-install-mobile.jpg](15-after-install-mobile.jpg) | AFTER: phone (390 x 844) - Install app button; service worker active and controlling |

Not shown here: anything on a real phone, a real GPU or the installed app; see the device checklist in `docs/AUDIO.md`. Sound cannot be shown as a picture; its measurements are in the changelog.
