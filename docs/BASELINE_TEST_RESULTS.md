# Baseline test results

*Recorded 2026-11-20. Machine: Windows 10 Pro, 4 logical cores, Node 22.14, headless Chrome over the
DevTools protocol. Baseline commit `697290d`, compared with the working tree after Phase 1. Every
number here was measured; nothing is estimated.*

## Automated checks

| Check | Baseline (`697290d`) | After Phase 1 |
|---|---|---|
| `node scripts/build-web.js` | builds | builds (worker 286 KB) |
| `eslint src test` | clean | clean |
| Vitest test files | 10 | 11 (`test/timeline.test.js` added) |
| Vitest tests | 62 passed | 70 tests (62 + 8 timeline). Final `npm test`: 69 passed; the soak failed only its timing limit (see below) |
| Soak (3 seasons, 96 weeks) run alone | passes, 260–290 ms/week median (earlier passes) | passes, **369–386 ms/week** median over two runs (machine busier: VS Code, Chrome, a test server) |
| Soak inside the full parallel run | intermittent timing failure (known) | **failed its timing limit** in both full runs: 502 and 524 ms/week against a 400 ms limit, zero exceptions |

**Soak note.** The 400 ms/week limit is a speed check, not a correctness check. The timeline runs
only for the manager's own match, one per week, and costs about 2 ms per match (200 matches timed:
1.9–3.1 ms with the timeline against 0.2–0.7 ms without). That cannot explain a 100+ ms difference
per week; the cause is machine load. The world-health assertions all passed.

## Timeline-specific results
* `TL.validate` over 65 seeded matches (40 league, 25 knockout with extra time and penalties):
  **0 problems**.
* The same world gives identical scores and xG with the timeline on and off.
* Packed size per match: under 80 KB of JSON before compression. A paused half-time match in
  the save is about 130 KB.

## Browser checks (headless Chrome, local server)

| Check | Result |
|---|---|
| Full career flow: reset, week 1 match, half-time talk, second half, full time, nine screens, negotiation, player profile (`main` scenario, 2D view) | **Passed.** No console errors; no `undefined`, `NaN` or `[object Object]` on any screen. The full-time report shows possession 45–55%, passes 425–468, accuracy 89–92%, tackles 47–31, interceptions 39–46. These were measured *before* the turnover calibration in this phase; the realistic numbers are in the match simulation audit. |
| Same flow, 3D view | Canvas created; no console errors. The run timed out waiting for the server (see below). |
| 3D view after the models load (`3dwait`) | **Rendered**: stadium, players, score bug, radar, live timeline stats. On this busy machine the model took over 30 s, so the view used its classic figures, as designed. |
| Phone layout, 390×844 (`phone`) | **Passed**: no horizontal overflow on dashboard, dressing room, news or challenges; no errors. |
| Timeline in the view (`tldbg`, 2D, 1×, first 42 minutes) | 17 pass decisions, 0 invented; 15 possession changes, all real timeline events. |
| Fullscreen | Not re-tested this phase. The button exists and was verified in the visual pass; the headless browser cannot enter fullscreen. |
| Save and restore | Covered by `save.test.js` and `server.test.js` (pass). The server restored its autosave on start ("Auto-save restored: Abuja Pride, season 2026, week 1"). |

### A pre-existing performance problem found
While headless Chrome runs a match on the same machine, the local server takes 8–14 s for a week
step or a second-half resume. The same requests take 0.7–1.3 s over `curl` with no browser
running, and the engine part takes 0.3–0.9 s in Node.

**The baseline commit shows the same 14 s**, measured by running `697290d` from a separate worktree
on another port. This phase did not cause it.

The live site runs the engine in a Web Worker, not this server. The problem is recorded in the
roadmap (Phase 11).

### Limitations
* **3D frame rate.** Headless WebGL is software-rendered (about 2 fps), so 3D frame rates here say
  nothing about real devices.
* **Local server saves.** The local `.env` points saves at a remote MongoDB, and a save is 12.6 MB,
  so the browser checks ran the server with `MONGODB_URI` unset (file saves).
