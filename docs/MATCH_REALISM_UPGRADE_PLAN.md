# Match realism: upgrade plan and status

*Updated 2026-11-24. "Done" means implemented, tested and deployed in this release; the rest is
planned.*

## The rule every change follows

The engine decides; the view shows. `src/engine/matchEngine.js` decides goals, shots, cards,
injuries and substitutions. `src/engine/timeline.js` turns them into a second-by-second timeline of
real actions between the actual players, using its own random stream. The 2D and 3D views
(`public/index.html` simulation and `public/match3d.js`) follow that timeline. Nothing in the view
or in ball physics may add, remove or change an outcome.

## Architecture of the match view

```
matchEngine (result, events)  ──►  timeline (passes, tackles, fouls, throw-ins, saves …)
         │                                  │
         └──────► the live payload (events + packed timeline + line-ups and looks) ◄─┘
                                   │
         view simulation (index.html: stepPositions, simPass, simShoot, chanceShown)
                                   │  positions, ball, phase, strike, dive, receive, throw-in …
                                   ▼
         3D renderer (match3d.js: figures, clips, ball, cameras, replays)
```

## Priorities and status

| # | Priority | Status |
|---|---|---|
| 1 | **Events and animation agree with the timeline** | **Done:** one chance at a time (`chanceShown`). A goal or shot waits, with the clock held, until the view has struck it and the ball has arrived. Before this, two chances in the same minute collided: the second cut the goal celebration short and the ball sat in the net with no goal. Keepers dive only at real shots, take the save type (catch, parry or dive) from the timeline, and watch shots that are well wide or over. The dive side is fixed when the shot is struck. Browser audit: 9 matches in 3 careers, 0 problems (see the changelog) |
| 2 | **Footballer movement and action transitions** | **Done in part:** 23 new football clips (passes with the inside of the foot, driven pass, shot, first touch, chest control, header and jumping header, standing and slide tackle, the keeper's set, catch, punch, dives and low dives, throw-in, a celebration). Each starts so its contact frame meets the ball (measured kick offset −0.02 to +0.02 s). Locomotion was already blended by speed and direction with smoothed acceleration; it was not changed |
| 3 | **Ball interaction** | **2026-11-28, dribbling:** the carrier pushes the ball ahead in touches (about every 0.36–0.62 s, longer at pace), and it rolls out and slows between them: 0.45 m ahead walking, about 1.9 m at a sprint, with a curved touch to turn. A tackled or received ball carries on from where it is. Measured at 4× speed: the ball was behind the carrier in 1.5% of settled frames (19.4% before) with 7 jumps (24 before). Tested in `test/dribble.test.js`. **Done in part:** the receiver plays a first touch or chest control as the pass arrives. Throw-ins are taken from above the head and the ball flies from the hands. **2026-11-27:** lofted balls slow in the air, long balls bounce twice, driven passes skim the grass, and the ball spins with its flight (backspin when lofted, sidespin when curling). The ball is 1.7× real size with a dark outline and slight glow. Every flight still arrives where and when the timeline says |
| 4 | **Players' movement off the ball (AI) on screen** | **Done:** the timeline's next receiver makes a run into the pass's space and his marker tracks him; on crosses, attackers attack the near and far post and are marked goal-side; the keeper narrows the angle |
| 5 | **Player appearance** | **2026-11-28: athletes everywhere.** One base with 37 shape targets (face, heritage, build, age), modelled hairstyles, beards and keeper gloves: every player has his own face (see the integration audit). Match detail: 268 draw calls for 13 players against 805 for the mannequins. **2026-11-27:** realistic bodies on the pitch too (Settings → Players in matches), each with his own build, skin tone, kit and hairstyle; 232 draw calls and 412K triangles a frame against 274 and 384K for the mannequins. **Done for close-ups:** realistic Ara 3D Gen bodies, reduced to about 12,000 triangles, 4 materials and 0.54 MB each, are shown in the Player Studio and award ceremonies. They are loaded on first use, with the classic figure as the fallback and a setting to turn them off. Match players keep the Mesh2Motion figures. See `PLAYER_STUDIO_INTEGRATION_AUDIT.md` |
| 6 | **Replays and presentation** | Existing replays and highlights now show the new clips. Header shots are now shown as headers after a cross (most of them; see the changelog), and keepers throw or roll the ball out after a catch |
| 6b | **Camera** | **Done (2026-11-27):** the default Broadcast camera is about a quarter closer and lower, leads the ball, widens slowly for long balls and tightens near goal; Standard (the old TV view), Follow, Tactical, Wide and Goal remain |
| 7 | **Performance** | Measured: a full match draws about 270 calls and 385K triangles a frame, with 235 small textures (about 25 MB). **Done:** one shared WebGL renderer per session with compiled shaders kept, a shader warm-up during the week's simulation, and the first half's view reused for the second half. Second-half start in headless Chrome: about 20 s → 0.7–1.5 s. First frame of the second half: 10 s → 0.04 s |

## Live match management (new)

Pause now opens a panel for style, formation, the three instruction sliders and substitutions.
The engine plays the manager's own match in five-minute segments with a snapshot at each mark.
`GameWorld.liveChange` restores the next mark, applies the decisions there and plays the rest of
the half again. Nothing already shown changes; the view splices in the new events and timeline.
Substitutions during play use one of three windows, as in real football; half-time is free.

* Results stay deterministic (the same changes on the same career give the same world; tested).
* Five-minute segments keep the scoring and card rates of fifteen-minute ones. Over 120 matches the
  mean goals per match differed by less than 0.45 (tested).
* Matches between other clubs still use fifteen-minute segments, and recording the timeline still
  never changes a result (tested).

## Implementation sequence for what remains

1. ~~Header shots~~ and ~~keeper distribution~~: done.
2. ~~Header chances that start while the other side has the ball~~ and ~~support runs~~: done.
3. ~~A reduced Ara-based body for close-up cameras only, loaded on demand~~: done (Studio and awards).
4. ~~Studio face sliders on the realistic bodies, and more faces~~: done with the athletes (2026-11-28).
5. Realistic bodies for the replay close-ups and the goal celebration, after real-phone frame-rate measurements.

## Formation on the pitch (2026-11-28)
* The Lineup screen and the match board draw the formation from one table (`FORMATION_LAYOUT` in
  `src/utils.js`). A 4-4-2's wide players are in the midfield line (it was drawn as 4-2-2-2), and a
  lone holding midfielder or striker is central.
* In the 3D match, a lone holding midfielder, centre midfielder, playmaker or striker now stands
  central (y 0.40–0.42 before). The rest of the match view still follows the timeline's own slot table,
  so players stay where the timeline's events put them. The engine and timeline are unchanged.

## Milestone 15: human footballers, football movement, a controlled ball, a real ground (2026-11-28)
Status of the priorities above after this milestone (details and measurements in
`INTEGRATION_CHANGELOG.md`, section 15):

* **Posture (5).** The backward lean is gone. The athletes were bound with the Ara bind pose, which
  left their spine, legs and feet a few degrees off the animation's rest. They now keep the
  animation's rest there (`--spine-rest` in `optimise.mjs`).
  * Standing, trunk and upper body measure 2° and 11° forward (−3.6° and −1.6°, leaning back, before).
  * Running, the trunk leans 6°, 12°, 16° and 18° forward at 1.3, 3.2, 5.5 and 7.2 m/s.
* **Movement (2).** One stride phase drives every forward gait, advanced by the ground covered, so the
  planted foot stays put. The long mocap strides are shortened per gait (stride warping) so the
  cadence is that of a footballer, not a hurdler.
  * Steps per minute: 111, 152, 205 and 208 at those speeds (89–151 before).
  * The planted foot drifts along the run at 0.13, 0.20, 0.62 and −0.31 m/s. Its total slip in
    any direction is 0.25, 0.97, 1.89 and 1.61 m/s, measured on the match athlete with the lab's
    `runTest`. Before this, the old gaits slipped at 0.9–4.9 m/s: half to three-quarters of the
    running speed.
  * The trunk straightens per gait and leans into acceleration.
* **Ball control (3).** The dribble is physics, not a timer:
  * the ball rolls and slows with grass friction (2.6 m/s²);
  * each touch aims it at where he will be a stride or a few later;
  * he plays it when he gets to it;
  * the view lines his stride up so the touching foot swings through then, reaches the leg forward,
    and closes the last few centimetres between boot and ball at contact.

  Touches come within 0.12 s of their plan, with the ball at his feet, never behind him (tests).
* **Appearance (5).**
  * Photographic MakeHuman skins by heritage and age, eye colours (brown, light brown, blue, green),
    image-based light, and fuller beards.
  * Portraits rendered from each player's own athlete replace the drawn faces on every card.
* **Sound (new).** A recorded commentator and real stadium recordings (see `AUDIO.md`).
* **Still to do:**
  * The athletes for replay close-ups and goal celebrations, after real-phone measurements.
  * The kick and pass clips' foot contact is timed to the ball (section 13), not yet adjusted to it
    by IK.
  * The dribble reaches with the leg on top of the run, not a dedicated dribbling clip; a set of
    dribbling clips (inside, outside, drag-back) would be the next step.
