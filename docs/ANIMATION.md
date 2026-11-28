# Player animation and football movement

## Runtime

The match renderer is `public/match3d.js`, using the vendored three.js r170 runtime. Players keep
their existing IDs, appearance data, portraits, club kits and shared footballer skeleton. The
authoritative match engine and career-save format do not depend on the visual animation system.

`scripts/anim/build-footballer.js` produces the match skeleton and clips from the existing
Mesh2Motion base and the retargeted Ara football actions. The source/processed asset records remain
in `assets/animations/licenses/REGISTER.md` and `assets/licences/ASSET_REGISTER.md`.

## Movement and ball contact

Forward locomotion remains phase-locked across the walk, jog and sprint blends. The phase rate is
computed from ground speed, the selected clip's natural rate and its duration. The actual view now
adds:

* **World-space leg IK.** A two-segment thigh/calf solver aims the ankle and then rotates the boot
  to keep its toe at the chosen world point. A foot is held only while the hip can physically reach
  its anchor; it releases at the end of stance instead of stretching or skating past the leg's range.
* **Dribble contact IK.** The scheduled left or right foot reaches the ball's current simulated
  position at the planned contact. The rendered ball is never corrected or capped to make contact.
* **A procedural football dribble layer.** Short alternating steps, ball-side boot roll, recovery-leg
  flex, torso counter-sway and arm balance sit on the shared locomotion cycle. The timed contact
  reach is one part of the movement, not its only dribble motion.
* **Recovery.** `simDribble` predicts the player's velocity easing toward the desired velocity and
  searches the ball's rolling trajectory. It makes a touch only inside the contact envelope. If the
  ball rolls outside close control, the player visibly chases its natural stop point until it can be
  played; the authoritative match possession is unchanged.

The contact scheduler covers either foot, alternating close touches, preferred-foot running,
acceleration, deceleration and turns. The game can play at 1x, 2x, 4x and 8x. Dedicated football
mocap was investigated: Rokoko lists a free 12-clip sports pack exported to a Mixamo rig at 30 FPS,
but access is through a registration form; no account or contact details were supplied, so no pack
was downloaded. TechLabID lists soccer dribble and receive animations, but marks their downloads
paused. Neither candidate is in the build. No money was spent.

## Regression measurements (local, Node/Vitest)

`test/dribble.test.js` drives the existing match simulation and loads the shipped GLB skeleton and
animation clips for contact/stance measurements:

* **Touch matrix:** acceleration, deceleration and left/right turns; both declared feet; 164 cm and
  198 cm players; 1x, 2x, 4x and 8x. The 32 simulated profiles produced 124 scheduling events.
* **Selected boot at the touch frame:** a second matrix applied the production `shapeBody` recipe at
  lean and heavier build slider values on the 164/198 cm rigs. All 248 selected-foot contacts were
  within 0.12 m after IK; median separation 0.012 m, p95 0.031 m, maximum 0.035 m. This is a
  skeleton/animation regression, not a claim of visual phone testing.
* **Planted foot:** 120 seconds each at 1.1, 3.5 and 7.5 m/s on the exact walk, blended stride-warped
  jog/run and stride-warped sprint clips used by the renderer, at 60 Hz, with the production body
  shape recipe at the ordinary build. The gait clock uses each clip's actual duration, speed blend,
  height scale and natural stride rate. Across 14,018 reachable, low-foot samples, median world-space
  slip was 0.004 m/s, p95 0.029 m/s and maximum 0.042 m/s. By gait: walk 7,848 samples (p95 0.031,
  max 0.042), jog 3,604 (p95 0.004, max 0.007), sprint 2,566 (p95 0.012, max 0.023). Left/right
  anchored time was 68.30/65.47 s walking, 38.23/27.43 s jogging and 26.60/23.10 s sprinting.
  Median stance-phase lengths by left/right foot
  were 0.767/0.733 s walking, 0.233/0.167 s jogging and 0.133/0.117 s sprinting. Raw clip ground
  shares per foot were 52.4/51.2%, 17.8/8.9% and 14.3/14.3%, respectively. Unreachable stance
  points are released, not counted as planted. These are repeatable CPU-side rig measurements; the
  browser's complete match and a real GPU still need visual/device review.

## Diagnostic and remaining work

Append `?matchDebug=1` to a local match URL to show frame time/FPS, player count, gait/phase/speed,
left/right contact state, ball position/velocity, current boot-ball distance, recent contact p95,
planted-foot slip percentiles, decoded-audio estimates, service-worker control and browser/installed
mode. The overlay is created only when that query value is present.

The players retain the current stylised-realism anatomy and appearance pipeline. This milestone
improves whole-body movement and ground contact; it does not replace the body mesh. A dedicated
captured close-control/dribble library, full visual review on the live match and GPU testing on an
Android phone remain outstanding. The existing fallback to the classic procedural player remains.

Run `npx vitest run test/dribble.test.js` for the measurements and `npm run build:anim` only when
changing the source model or clip pipeline.
