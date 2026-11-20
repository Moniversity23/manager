# The Gaffer — visual audit

*2026-11-20 · baseline `697290d` · inspected `public/match3d.js`, `public/index.html` (broadcast
layer), `public/models/`, and screenshots from headless Chrome.*

## Fully implemented
* **Stadium.**
  * Procedural stands sized by capacity; an instanced crowd in club colours with camera flashes.
  * Four floodlight towers: at night each casts its own shadow under every player.
  * Scrolling LED boards with club and sponsor names; corner flags.
  * Goals whose nets bulge.
  * Turf texture with mowing stripes; sky.
* **Players.**
  * One motion-captured, skinned footballer model (Mesh2Motion, CC0) shared by all 22 players and
    tinted per kit: shirt, shorts, socks and boots, plus goalkeeper gloves.
  * Each player keeps his permanent look (skin tone, hair, build, height) and has a shirt number.
  * 38 clips: locomotion blended by speed (walk, jog, sprint, back-pedal, strafe); side-foot and
    instep kicks timed to ball contact; slide tackles; headers; keeper set position, dives, saves
    and punches; celebrations; dejection; falls and getting up; referee card gestures.
* **Fallback.** Procedural figures are used if the model cannot load or the user picks "classic".
* **Officials.** Referee and assistants, plus the fourth official's board.
* **Broadcast layer.**
  * Score bug with match clock and a radar mini-map.
  * Pre-match fly-over; goal replays with a "REPLAY" badge.
  * Camera shake on goals.
  * Four cameras: TV, high, behind the goal, player-follow.
  * Fullscreen button.
* **Quality settings.** `auto`, `low` and `high`: pixel ratio, antialiasing, shadow maps and crowd
  density. `auto` picks low on weak phones.

## Partially implemented
* **Animation selection.**
  * Clips are chosen from the view's state: speed, `sim.strike`, `sim.tackle`, `sim.dive` and others.
  * Kick timing is matched to ball contact.
  * There is no first-touch, receiving or body-orientation logic, so players turn towards the
    ball rather than shaping to receive.
* **Replays.**
  * They replay the recorded frames of what the viewer saw, so they are faithful to the screen.
  * They exist only for goals and use a single replay camera.
* **Ball.** It travels on a straight line with a parabolic lift for long passes and crosses. It has
  no spin, bounce or roll friction model.

## Placeholder
* **Crowd figures** are boxes on instanced meshes that bounce in two alternating groups. They have
  no individual reactions.
* **Stadium architecture** is the same design for every club. Only colours, capacity and boards
  change.

## Implemented but not connected correctly
* **Off-ball movement.**
  * Before Phase 1, every visible pass and tackle was invented by the view.
  * Phase 1 connects passes, receivers, interceptions, tackles, recoveries, throw-ins and build-ups
    to the authoritative timeline.
  * The 20 off-ball players still move in formation shape rather than from timeline positions.

## Defects
* **Model loading on a busy server.** In local server mode on a loaded machine, the footballer
  model sometimes takes more than 30 s to arrive (the server is single-threaded while it saves).
  The view then correctly falls back to the classic figures. GitHub Pages serves the model from a
  CDN and is not affected.

## Performance
* Headless Chrome (software WebGL) renders the 3D view at about 2 fps, so 3D checks use long waits.
  Earlier passes measured real-device frame rates as acceptable on the "auto" setting.
* The model and clips download once (about 380 KB as served) and are shared by every player.

## Missing
* Weather, time-of-day transitions, stadium variety, crowd audio sections, replays of non-goal
  moments, a tactical camera, and a highlight reel at full time.

## Should not be changed
* The CC0 footballer pipeline (`scripts/anim/`), the fallback figures, the quality settings and the
  permanent player looks (portraits use the same look data).

## Screenshots taken this audit
Taken in headless Chrome and kept in the session's scratchpad (not committed):
* 3D TV camera during play, with live timeline stats;
* half-time screen with possession and passes;
* full-time report with the new statistics row;
* every main screen on desktop and phone (no horizontal overflow).
