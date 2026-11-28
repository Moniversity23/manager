# Milestone 16 test results

Date: 2026-11-28 (local Windows environment)

## Full command

`npm.cmd test` ran the web build, ESLint and all Vitest files.

* Build completed successfully.
* ESLint had zero errors and one existing warning: `test/tactics-extra.test.js:61`, unused
  variable `target`.
* Vitest: 29 of 30 files passed; 196 of 197 tests passed.
* The sole failure was the soak test's 400 ms/week performance threshold. It measured a 512 ms
  median (559 ms mean) across 96 weeks while the repository's other CPU intensive suites were also
  running. Its simulation and world-health checks passed with zero exceptions.

## Isolated soak

`vitest run test/soak.test.js` with the same source and unchanged 400 ms/week assertion:

* Passed, 1 test / 1 file.
* 96 weeks, 335 ms median / 362 ms mean per week, including season ends.
* Zero simulation exceptions.

The isolated soak was rerun on the final source and still met the original threshold. The full-run
timing matches the repository's prior parallel-run contention pattern; the threshold remains
400 ms/week.

## Focused regression suites

Dribble, sound, commentary and service-worker tests passed: 36 tests across four files. A final
movement/client rerun passed 16 tests across two files after expanding actual rig contacts across
lean/heavier body builds. The dribble suite measured 248 selected-foot contacts with median 0.012 m,
p95 0.031 m and maximum 0.035 m separation. World planting measured 14,018 samples with median
0.004 m/s, p95 0.029 m/s and maximum 0.042 m/s slip.

The final full run includes the diagnostic audio-prefetch status, four-part voice preview and body
shape extremes in the actual skeleton contact matrix. `test/client.test.js` and `test/dribble.test.js`
were also rerun after those edits (16 tests passed).
