# Reference projects compared with The Gaffer

*Recorded 2026-11-24. Sources inspected: the working trees in `FOOTBALL-RALISM-LAB/` (Ara3DGen,
SoccerDribble, outputs, docs). These are not part of The Gaffer's repository and nothing was copied
wholesale.*

## The three projects

| | The Gaffer (this repository) | SoccerDribble | Ara 3D Gen |
|---|---|---|---|
| What it is | Football management simulation with a 3D match view | Third-person 3v3 arcade football game (university course project) | Character builder, film studio and game maker |
| Authority over the result | The match engine (`src/engine/matchEngine.js`); the 3D view only shows it | Physics and player input decide everything | Not a football game |
| three.js | r170 (vendored) | r183 | own build |
| Players | One shared 66-joint skinned mannequin (CC0 Mesh2Motion), procedural faces, kits and body shapes for every player | One 55 MB Mixamo-rig model (78 joints) shared by all players; animation is procedural bone posing | MakeHuman bodies with photo skins; 65-joint game rig (Mixamo names), 259 clips |
| Licence | Own code; CC0 assets with a register | **No licence from its author.** The README names the author (a Sapienza University student); an MIT block was pasted into the middle of the README later. It bundles a "Nintendo – Mario Kart Wii – Item Box" sound, real club shirt images (Inter, Juventus, Milan) and a Qatar 2022 ball texture | MIT code (© 2026 Joshua Olatunde and contributors); MakeHuman data CC0; some clips from CMU mocap (free, including commercial use; not to be resold); football clips are Ara's own keyframes |

## SoccerDribble: what it offers and what was done with it

Used as a **reference only**. Its code and assets were not copied. A licence notice
pasted into the README by someone other than the author does not grant rights. Some of its assets
are plainly third-party property (a Nintendo sound effect, real club kits).

| Area | SoccerDribble | The Gaffer | Classification |
|---|---|---|---|
| Ball flight | Free physics: gravity 12 m/s², quadratic drag, Magnus spin, restitution 0.7, exponential grass friction, rolling rotation | Event-constrained flights (`public/ball.js`): every pass, cross and shot must arrive where and when the timeline says, with curl, wind, bounce and deflections | **Unsuitable**: free physics cannot guarantee the engine's outcome. The Gaffer already covers drag, bounce and curl inside its constraints |
| First touch | The ball is "magnetised" to the controlled player inside 2 m, then pushed ahead in touches on a cooldown | The ball arrived at the receiver's feet with no reaction | **Reimplemented independently**: the receiver now plays a first-touch (inside-foot) or chest-control clip timed to the ball's arrival |
| Dribbling | Discrete touches with a touch interval by speed | The ball stays 0.7–1.4 m ahead of the carrier with a touch rhythm | Already equivalent; not changed |
| Goalkeeper | Predicts where the ball crosses the line and dives to that side | The keeper always "dived", even at shots going well wide or over | **Reimplemented independently**: the keeper now watches shots that are well wide or over, takes the save type (catch, parry or dive) from the timeline, dives low or high by shot height, and keeps his dive side for the whole dive |
| Movement | Velocity with acceleration, stamina, sprint | Velocity smoothing toward a target with acceleration by urgency, stride-matched locomotion blend | Already equivalent; not changed |
| Replays | Records every bone of every player for 7 s at 60 fps | Records positions and sim state for 8 s and re-animates them; slow-motion goal and big-chance replays; a highlights reel | The Gaffer's approach is lighter and works for highlights; not changed |
| AI / tactics | 3v3: possession state machine, lane assignment, threat-scored marking | Engine timeline of real passes between the actual eleven players, shapes per tactic and instructions, pressing, runs | **Unsuitable**: a 3v3 system does not scale to 11 v 11 management |
| Weather, lighting | Clear/fog/rain/snow particles, HDR sky, night spotlights | Day/night with floodlights and shadows, rain, wind, snow by country and season | Equivalent; not changed |
| Stadium | One bundled GLB stadium | Procedural stadium sized by capacity, crowd shader, ad boards | Bundled model unlicensed: **not used** |
| Camera | Third-person follow, pointer lock | TV, high, wide, goal and close cameras, intro fly-over, replay angles | Not needed |
| Customisation | Material tints, hats, sunglasses, hair GLBs, face sculpting handles | Player Studio: face, hair, body, kit, crest, sponsor, numbers | Hair, hat and glasses GLBs unlicensed: **not used** |
| Arcade mechanics | Boost pads, nitro, power-ups, electric and fire shots | None | **Unsuitable**: not part of a management simulation |

## Ara 3D Gen: what it offers and what was done with it

| Area | Ara 3D Gen | Used in The Gaffer |
|---|---|---|
| Football clips | Shoot, straight pass, three inside-foot passes, receive, chest control, header, jumping header, standing and slide tackle, keeper ready/catch/punch/dives/low dives, pick-up, throws, throw-in, a jump-and-turn celebration (Ara's own keyframes) | **Yes: 23 clips retargeted** onto the Gaffer skeleton by `scripts/anim/retarget.js`, proven within 0.3° per limb (see `PLAYER_STUDIO_INTEGRATION_AUDIT.md`) |
| Locomotion clips | CMU motion capture (walk, run, strafes, turns) | Not used: the Mesh2Motion set already covers locomotion and matches the existing blend |
| Characters | MakeHuman bodies, photo skins, faces with blend shapes, hair, clothes; 5k–120k triangles | **Evaluated, not shipped**: the sample footballers are 32–36 MB each with a 40,505-vertex mesh and 20 materials (measurements in the audit). Using them needs a reduced export pipeline first |
| Exporter | GLB/FBX/OBJ, game/lite/full rigs, A- or T-pose | Documented as the path for a future reduced footballer body |

## What The Gaffer already had that neither reference has

* An authoritative engine whose 3D view is driven by an event timeline. This includes real passes
  between the actual players, plus tackles, fouls, throw-ins, saves and substitutions.
* Saved careers, transfers, contracts and history behind every player on the pitch.
* A permanent appearance for every player, with Studio overrides that never touch football data.
* An offline browser build (GitHub Pages and a PWA) with saves in IndexedDB.
