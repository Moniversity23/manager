# Animation and character asset register

Only assets whose licence allows commercial use without payment are included. Everything that ships
in the game (public/models/) comes from the first row.

| Asset | Original source | Download location | Licence | Commercial use | Attribution | Downloaded / processed | Format | Status |
|---|---|---|---|---|---|---|---|---|
| Human mannequin (model.glb, skeleton.glb) and 38 human animation clips (see list below) | Mesh2Motion — https://github.com/Mesh2Motion/mesh2motion-app | `https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/assets/human/` (model.glb, skeleton.glb, animations/*.glb) | CC0 1.0 for all 3D models, rigs and animations (`LICENSE-CC0.MD` in the repository, copied here as `mesh2motion-LICENSE-CC0.MD`); app code MIT (`mesh2motion-LICENSE-MIT.MD`) | Yes | Not required | 2026-11-18 | GLB (meshopt-compressed glTF 2.0) | **Used in production** after processing by `scripts/anim/build-footballer.js` |
| KinemIQ Free Game Animations — 35 clips + mannequin | KinemIQ (Hugging Face dataset `Kinemiq/free-game-animations`); the README states the clips are the Quaternius Universal Animation Library (CC0), retargeted by KinemIQ | `https://huggingface.co/datasets/Kinemiq/free-game-animations/resolve/main/KinemIQ_Free_Animations_CC0_GLB.zip` — SHA-256 `64ca5ab4a92c9da079c5e88ca509391b0a58a24ccf2a1307b16e2f0fc6b23ffc` (matches the dataset's published LFS hash) | CC0 1.0 (dataset licence tag and README, copied here as `kinemiq-README.md`). Only this 35-clip pack is CC0; the larger KinemIQ library includes CC BY clips and was **not** downloaded | Yes | Not required | 2026-11-18 (inspected, not processed) | GLB | Downloaded and verified; **not used**: it is on a different 66-bone skeleton, and every clip it offers that the game needs is already covered by Mesh2Motion. Kept out of git (re-download with the URL and hash above). |
| Quaternius Universal Animation Library | https://quaternius.com/packs/universalanimationlibrary.html | Download only through itch.io in a browser | CC0 1.0 | Yes | Not required | — | FBX / GLB | **Not downloaded**: the site offers no direct download link for automated tools. Its content is already available as CC0 through the KinemIQ pack above. |
| meshoptimizer decoder (used by the build script to read the compressed GLBs) | three.js `examples/jsm/libs/meshopt_decoder.module.js` | npm package `three` | MIT | Yes | Licence notice kept in the file | 2026-11-18 | JavaScript | Build tool only |
| GLTFLoader, SkeletonUtils, BufferGeometryUtils | three.js examples (`public/vendor/jsm/`) | npm package `three` | MIT | Yes | Licence notice kept in the files | 2026-11-18 | JavaScript | Used in production |

## Mesh2Motion clips used

| Game clip | Source file | Used for |
|---|---|---|
| idle, idle2 | idle-subtle.glb, idle-a.glb | standing |
| walk, jog, sprint | walk.glb, jog.glb, sprint.glb | locomotion, blended by speed |
| back, strafeL, strafeR | walk-backwards.glb, strafe-left.glb, strafe-right.glb | back-pedalling and side-stepping |
| ready, crouch | fighting-idle.glb, crouch-idle.glb | keeper set position |
| injuredWalk | walk-injured.glb | (available) |
| kickFront, kickSide | kick-front.glb, kick-side.glb | shots and long passes; short side-foot passes |
| slide | slide.glb | slide tackles |
| header, jumpStart, jumpAir, jumpLand | jump-2.glb, jump-start.glb, jump-air.glb, jump-land.glb | headers |
| diveL, diveR | dodge-left.glb, dodge-right.glb | keeper dives (with a sideways launch added in code) |
| block, pickUp, chest | defend.glb, pick-up.glb, hit-chest.glb | keeper saves and punches, shot blocks, fourth official's board |
| celFist, celVictory, celFlip, celDab, celPower | victory-fist-pump.glb, victory.glb, backflip.glb, dab.glb, power-up.glb | goal celebrations (each player has his own) |
| clap | clapping.glb | team-mates celebrating |
| angry, reject | angry.glb, reject.glb | appeals and complaints |
| call, nod, yes | greeting.glb, head-nod.glb, yes.glb | referee showing a card; reactions |
| tired, sitCry | tired-hunched.glb, sit-ground-crying.glb | disappointment |
| fall, getUp | hit-knockback.glb, laytoidle.glb | injuries and getting up |
