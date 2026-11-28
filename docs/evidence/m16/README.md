# Milestone 16 evidence

This folder records repeatable local regression measurements and the phone checks still needed.
The tests load the shipped footballer GLB skeleton and the same walk/jog/sprint stride warps used by
the match renderer. They do not represent a real Android GPU, a live-site visual review or a human
listening test.

## Results

* [`contact-timing.json`](contact-timing.json): 32 scheduling profiles across acceleration,
  deceleration, left/right turns, both feet, 164/198 cm body scales and 1x/2x/4x/8x playback. A
  second shipped-skeleton contact check also applies the lean/heavier body slider extremes and
  measured 248 selected-boot contacts, all within 0.12 m (median 0.012 m, p95 0.031 m, maximum
  0.035 m).
* [`foot-slip.json`](foot-slip.json): 120 simulated seconds each at walk, jog and sprint, 60 Hz,
  with the runtime body-shape recipe and exact stride warps/blends. It reports per-speed slip percentiles, left/right stance
  duration and raw clip contact shares.
* [`audio-memory.md`](audio-memory.md): measured compressed file totals, resident AudioBuffer cache
  limits, release behaviour and which real-device values remain to be collected.
* [`test-results.md`](test-results.md): full-suite and isolated soak results with the threshold
  unchanged.
* [`ANDROID_TEST_STEPS.md`](ANDROID_TEST_STEPS.md): exact browser, installed-app, offline and audio
  collection steps.

The development overlay is enabled only by `?matchDebug=1`. It reports frame time, gait and phase,
foot state, ball velocity, actual selected-boot gap, touch timing, cached/active audio estimates and
service-worker control. It stays on the page after match exit and then shows the released memory.

## Visual evidence status

No new screenshots or recordings are labelled as Milestone 16 results because the available browser
surface timed out and the live URLs could not be opened in the current environment; the Windows
browser helper also returned `failed to connect native pipe: The system cannot find the file
specified`. The numerical
test artifacts above are reproducible evidence of the contact and IK changes. The live match,
mobile viewport and installed PWA still need the steps in `ANDROID_TEST_STEPS.md`.
