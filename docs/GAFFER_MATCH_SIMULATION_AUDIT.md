# The Gaffer — match simulation audit

*2026-11-20 · baseline `697290d` · see also the [full technical audit](GAFFER_FULL_TECHNICAL_AUDIT.md)*

## 1. Before Phase 1: two separate matches

```
matchEngine.js (authoritative)               index.html view (presentation)
──────────────────────────────               ───────────────────────────────
15-min segments                              its own 22 dots + ball
strength → Poisson shots → goals             random passes every 1–3 s
cards / injuries / subs                      random tackles and interceptions
pos = xG share  ◄── wrong                    steered towards the engine's shots/goals
        │                                             ▲
        └──── events (goal, shot, card, sub) ─────────┘   only the key moments were shared
```

* **How possession was determined:** `finalizeMatch` set `pos` from each side's share of total
  xG. Possession was therefore a restatement of chance quality. It was never measured.
* **How match events were created:** only goals, shots (in the manager's matches), cards,
  injuries and substitutions existed. There were no passes, tackles, interceptions or ordinary
  fouls anywhere.
* **How players moved:** the view placed each dot at a formation slot, shifted it with the ball
  and possession, and added noise. The ball went to a random nearby team-mate. Turnovers were
  random, at a rate set by the strength share. Before each engine shot the view built an attack
  so the right player shot at the right moment.
* **How the ball moved:** linear interpolation between players at a speed set by distance, with
  a lifted arc on long passes. Shots used a separate trajectory.
* **How tactics affected the match:** the engine's strength matrix, fatigue intensity and card
  rate. The view's tempo did not depend on tactics.
* **How statistics were calculated:** goals, shots and xG came from the engine; possession from xG
  (wrong); passes, tackles and interceptions did not exist.

## 2. Phase 1: the authoritative timeline

`src/engine/timeline.js` runs inside the engine, once per half, **only for matches somebody watches**
(`recordShots`: the manager's own matches).

```
matchEngine.playFirstHalf ──► TL.extend(m, ctx, 0, 45)
matchEngine.playSecondHalf ─► TL.extend(m, ctx, 45, end)
                                   │
          anchors = the engine's own goals, shots, cards, injuries, subs (fixed)
          between anchors: possession spells, passes, turnovers, fouls (generated)
                                   │
           m.tl.events  ── validate() ──  pack() ──► half-time view / match report ──► the view
           m.tl.spells  ── possession()                                       (follows it)
           m.tl.stats   ── summary()  ──► report, half-time line, history archive
```

**Event model.** Each event has the fields `{ id, seq, t (seconds), type, side, team, pid, tid,
from, to, kind, out, by, rel }`.

| Type | Meaning |
|---|---|
| `KICKOFF` | start of each half and after each goal |
| `PASS` | `kind`: short, long, through, cross. `out`: complete, intercepted, lost, off. `by`: the opponent who won it |
| `INTERCEPTION` | pass cut out |
| `TACKLE` | standing or sliding |
| `RECOVERY` | misplaced or loose ball picked up (new in this phase) |
| `THROW_IN` | after a pass out of play (new in this phase) |
| `FOUL` | always followed by a `FREE_KICK` |
| `SHOT` | `out`: goal, saved, off |
| `GOAL` | `tid` = the assister |
| `SAVE` | catch, parry or dive |
| `GOAL_KICK` | after a missed shot |
| `YELLOW`, `RED` | a second yellow is merged into a red |
| `INJURY` | |
| `SUB` | `pid` on, `tid` off |
| `HALF_TIME`, `FULL_TIME` | |

**Rules it guarantees** (checked by `TL.validate`, run over 65 seeded matches in `test/timeline.test.js`):
1. Every event is in time order with a gap-free sequence.
2. Every actor is on the pitch at that moment. Nobody acts after being substituted or sent off.
3. A pass is made by the player who has the ball, to a team-mate on the pitch.
4. Possession changes only through an interception, tackle, recovery, throw-in, free kick, goal
   kick, save or kick-off, and only to the other side.
5. A shot is taken by the player on the ball. Every goal follows its own shot, and its last pass
   comes from the engine's assister.
6. Goals and shots per side equal the engine's. Possession spells cover the whole match.
7. The same match ID and state always give the same timeline.
8. The timeline has its own random stream, so results with and without it are identical (tested).

**Possession.**
* The timeline spells are measured, in seconds of ball possession.
* The expected share comes from both midfields' passing and vision, tactic tilts and a small home
  edge, and varies from match to match.
* Matches nobody watches have no timeline, so their `pos` uses that same expected share. It is
  never taken from xG.

**Match statistics** (median per team over 40 seeded top-division matches, measured 2026-11-20).
The first four rows were tuned towards typical professional ranges:

| Stat | Median | Range seen |
|---|---|---|
| Passes | 466 | 226–729 |
| Pass accuracy | 84% | 70–91% |
| Tackles won | 20 | 9–33 |
| Interceptions | 16 | 7–30 |
| Fouls | 10 | 3–20 |
| Possession (home) | 55% | 28–76% |

The calibration used the following mix of possession changes: 18% interceptions, 22% tackles, 32%
loose or misplaced balls recovered and 28% passes out of play. Fouls without a card occur on about
2.4% of passes (3% against a pressing side).

## 3. How the view uses the timeline

The view's code is in `public/index.html`, between `unpackTimeline` and `tlLiveStats`.

* **Passes.**
  * `tlNextPass` finds the real pass nearest the current clock, preferring one by the player who
    has the ball.
  * If someone else has the ball, the view first gives it to the real passer; then it plays the
    real pass to the real receiver.
  * An intercepted or lost pass is won by the real opponent (`by`).
* **Turnovers.**
  * `tlTurnovers` follows the possession spells.
  * The player who wins the ball is the one in the real tackle, interception, recovery, throw-in,
    free kick, goal kick or save that started the spell.
  * Tackles trigger the tackle animation (`sim.tackle`), sliding when the event says so.
* **Shots.** `tlBuildUp` takes the last real passes before each engine shot (up to four players).
  The attack plays that chain, and the final ball comes from the real assister.
* **Pacing.** The clock now runs at 0.75 match minutes per second per speed step, half its old
  rate, so real passes can be shown between chances. At 1×, a half lasts one minute.
* **Statistics on screen.** Possession and passes (completed/attempted) update every match minute
  from the timeline, up to the current clock.

**Measured in the browser** (2D view, 1×, first 42 minutes):
* 17 pass decisions: 11 timeline build-ups, 5 feeds to the real passer, 1 real pass, **0 invented**.
* Possession changes: 5 recoveries, 4 tackles, 3 throw-ins, 2 interceptions, 1 free kick, all real
  timeline events with the real player.

**Prototype requirement check** (master prompt §53):

| Requirement | How it is met |
|---|---|
| One actual possession | Possession spells from the timeline, shown live and in the report |
| One actual pass | Passes come from `PASS` events (passer, receiver, kind) |
| One receiving player | The receiver is the event's `tid` |
| One defender reacting | The real interceptor or tackler (`by` / `pid`) wins the ball on screen |
| A coherent ball trajectory | The ball travels passer → receiver, or passer → the interception point |
| A correctly triggered animation | `TACKLE` events set `sim.tackle` (slide or standing), and kicks fire at ball contact |
| Correct match statistics | Possession, passes, accuracy, tackles and interceptions are counted from the same events |

## 4. Still open (next phases)
* **Off-ball movement** is the view's formation shape, not decisions (Phase 3).
* **Not every timeline pass is shown at normal speed** (about one in three or four); the rest are
  summarised by the ball reaching the right player. Slow or real-time playback is a Phase 9 option.
* **Engine order of events inside a segment** (shots after reds): fixing it in the engine would
  change results. The plan is a versioned engine flag for new saves only (Phase 2).
* **Engine-level shot locations, set pieces and offside** are not simulated; the timeline makes
  them up consistently.
