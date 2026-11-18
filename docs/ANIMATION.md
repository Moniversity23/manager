# Player animation — how it works and what was used

## Audit (before this work)

* **Engine:** three.js r170 (WebGL), vendored in `public/vendor/`; the 3D match view is `public/match3d.js`.
* **Players:** built in code from simple shapes (cylinders, spheres, lathed torso) with a
  hand-written pose function. No skinned meshes, no skeleton, no animation clips, no model files.
* **Match engine:** the result is decided by the server or offline engine; the match view runs its
  own visual simulation (`stepPositions`, `simPass`, `simShoot` in `public/index.html`) that sets
  `sim.strike`, `sim.tackle`, `sim.dive`, `sim.touch`, `sim.block`, `sim.injured`, `sim.card`.
* **Machine:** Windows 10, Node 22, Python 3.14; Blender not installed.

## Tools

| Tool | Licence | Used for |
|---|---|---|
| Node.js (already installed) | MIT | the whole asset pipeline |
| `scripts/anim/glb.js` (written for this) | project | reading and writing GLB, decoding meshopt compression |
| meshoptimizer decoder (ships with three.js) | MIT | decoding the source GLBs |
| three.js GLTFLoader, SkeletonUtils, AnimationMixer | MIT | loading, cloning and animating players in the browser |

**Blender was not installed.** Every asset the game needs is already a GLB on one shared skeleton,
so nothing needs FBX import or retargeting. A Node pipeline also runs on GitHub's build servers
without a 350 MB download. If FBX sources or clips on a different skeleton are added later,
Blender's free command line (`blender --background --python script.py`) is the right tool and
can be added then.

## Assets

See `assets/animations/licenses/REGISTER.md` for the full register: source, download URL,
licence, commercial use, attribution and status of each asset.

* **Used:** Mesh2Motion's human mannequin and 38 of its clips (CC0 1.0 — commercial use allowed,
  no attribution needed).
* **Downloaded and verified but not used:** the KinemIQ 35-clip pack (CC0). It is on a different
  skeleton and duplicates clips already covered.
* **Not downloadable by script:** Quaternius Universal Animation Library (itch.io only). Its
  content is already available as CC0 through the KinemIQ pack.

## Pipeline

```
npm run inspect:anim   # report every source file: skeleton, clips, frame rates, root motion
npm run build:anim     # rebuild public/models/ from assets/animations/source/
```

`scripts/anim/build-footballer.js`:

1. Reads the mannequin and decodes it.
2. Splits the mesh into kit regions by the bone that moves each vertex most: shirt, shorts,
   socks, boots, skin, hands (gloves for keepers) and head (hidden; the player's own head is
   attached instead). The shorts and sock lines are cut along the mesh's own edge rings.
3. Writes `public/models/footballer.glb` (uncompressed glTF, no texture, about 330 KB; about
   230 KB as served).
4. Reads each clip and keeps bone rotations plus the pelvis translation. Static tracks are
   collapsed to one key, finger poses are held, and values are rounded.
5. Finds each kick's ball-contact moment and kicking foot by running the skeleton forward and
   timing the foot's fastest moment.
6. Writes `public/models/footballer-anims.json` (about 830 KB; about 150 KB as served) and a
   report to `assets/animations/processed/build-report.json`. Fails loudly if a clip is missing
   or broken.

The source files are never modified.

## In the match (`public/match3d.js`)

* Each player is a clone of the mannequin in his club's colours, with his own head (face, hair
  and beard from his permanent look) on the head bone and his number on his back. He is scaled
  to his real height and build.
* **Locomotion:** idle, walk, jog and sprint are blended by his actual ground speed, and the
  playback speed follows that speed so the feet don't slide. He walks backwards when retreating
  and strafes when side-stepping. Taller players have a slightly longer stride.
* **Match events trigger one-shot clips:**
  * pass → side-foot kick;
  * shot or long ball → driven kick, timed so the foot meets the ball as it leaves (contact moment
    from the pipeline);
  * tackle → slide;
  * high ball → header jump;
  * keeper → dive left or right with a sideways launch, block on a save or punch;
  * goal → each scorer's own celebration (fist pump, victory, backflip or dab), team-mates clap or
    punch the air, opponents slump;
  * card → the referee raises his arm and team-mates appeal;
  * injury → falls, then gets up.
* Clips fade in and out (0.12–0.2 s). A finished action hands back to locomotion.
* The referee, both assistants and the fourth official use the same system.
* **Fallback:** the files are fetched once, when you press Play, cached for offline use, and shared
  by every player. If they can't be loaded in 30 s, or Settings → 3D players is set to Classic,
  the view uses the previous procedural figures.

## Testing

* `test/animation.test.js` checks the processed files:
  * the mesh has all seven regions and is person-sized;
  * every needed clip exists, binds to existing bones and has finite values;
  * each kick has a contact time;
  * every source clip is in the licence register.
* `public/dev/anim-lab.html` shows every clip on its own footballer, for visual checks of
  orientation, foot contact and distortion.
* A full match was played in a headless browser while logging which actions fired and how far
  each kick's foot contact was from the ball leaving (see the commit notes for results).

## Known limitations

* The mannequin is a stylised, muscular figure, not a photo-real footballer.
* There is no mocap clip for a goalkeeper's full-length dive: a sidestep clip is launched sideways
  in code.
* Kicks use one foot each (front kick: left; side-foot pass: right). There is no mirroring yet.
* Headers use a general jump.
* No inverse kinematics: feet follow the clips, which keeps them on the ground on flat turf.
* Smoothness on real phones was not measured. Hands are high-poly in the source model; if phones
  struggle, the hands are the first thing to simplify, and the Classic setting is the fallback.
