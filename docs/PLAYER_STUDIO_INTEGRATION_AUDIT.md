# Player Studio: integration audit for Ara 3D Gen and SoccerDribble

*2026-11-24. Everything below was measured on the actual files with the Gaffer's own three.js r170
(vendored), in Node and in headless Chrome (software rendering: absolute frame times are slow,
ratios are meaningful).*

## The Studio today (unchanged in structure)
* One Player Studio: `studio/` (UI), `src/studio/*` (schema, generator, appearance merge, kits, API),
  `public/appearance.js` (Studio fields → the renderer's look), `public/match3d.js`. The preview is
  the match renderer (`createStudioView`).
* Appearance is separate from football data. A player's `studioProfile` overrides only his look; a
  missing or invalid profile falls back to his permanent procedural look (`mergeForRenderer`).
* Every player shares one skinned mannequin (Mesh2Motion, 66 joints, 13,757 triangles) and one clip
  set. Faces, hair and bodies are procedural (sculpted heads, bone scaling); kits are textures.
* **What changed in this release:** the Studio's Animation tab now lists 43 clips. That includes the
  23 retargeted Ara football clips, which the match players also use. Nothing else in the Studio
  changed, and no second character library was created.

## Skeleton compatibility (proven before import)

| | Ara 3D Gen game rig | Gaffer (Mesh2Motion) |
|---|---|---|
| Joints | 69 (65 used + `Jaw`, eyes, `WeaponR`) | 66 |
| Naming | Mixamo style without prefix (`Hips`, `LeftUpLeg`, `LeftHandIndex1` …) | UE style (`pelvis`, `thigh_l`, `index_01_l` …) |
| Root | `Hips` (no root bone above it) | `root` (rotated −90° about X) → `pelvis` |
| Rest pose | A-pose (arms ~40° down) | T-pose |
| Axes and scale | Y-up, facing +Z, left = +X, metres; hips 0.91 m | Y-up, facing +Z, left = +X, metres; hips 0.92 m |
| Root motion | Football clips are in place (only the shot moves the hips 13 cm forward) | In place |

* **Mapping:** every one of the 65 body and finger joints has a counterpart
  (`MIXAMO_TO_M2M` in `scripts/anim/retarget.js`); eyes, jaw and the weapon socket are left out.
* **Transfer:** world-space rotation transfer with rest-pose alignment. Each target bone is first
  turned onto the source bone's rest direction (this absorbs A-pose vs T-pose), then follows the
  source bone's rotation from rest. The hips are scaled by the ratio of hip heights (1.01).
* **Proof:** `checkClip` replays each shipped clip on the Gaffer skeleton with three.js
  `AnimationMixer` and compares 13 limb directions with the source every frame. The worst error
  over all 23 clips is **0.29°** (`test/anim-retarget.test.js`; the build fails above 1°). At
  each kick's contact time, the right foot is ahead of the hips and near the ground (tested).
* **In the renderer:** the clips play in real matches (logged) and in the animation lab
  (screenshots: high and low dives, punch, first touch, chest control, header, tackle).

## Ara's own export check
Ara's `npm run test:gltf` had timed out for Grok. With a configurable limit and its progress log it
completed in 214 s. All 7 rig and pose configurations pass: 259 clips each, worst rotation error
0.0327°, root error 0, 34 face shapes, hand deformation working. So Ara's GLB exports themselves are
sound in three.js.

## Ara characters tested in the Gaffer renderer

The three stored footballers (`outputs/footballer-models/*.glb`) are 32–36 MB each. `Kofi_Mensah.glb`
was loaded with the Gaffer's GLTFLoader and SkeletonUtils:

| | Ara `Kofi_Mensah.glb` | Gaffer footballer |
|---|---|---|
| File | 32.0 MB (259 clips embedded) | 0.33 MB (+1.4 MB clips shared by all) |
| Load and parse | 1.2–1.7 s | 0.2–0.4 s |
| Triangles per player | 70,440 (one 40,505-vertex mesh) | 13,757 |
| Materials / draw calls per player | 20 / 23 | 7 / 8 |
| Shader programs | 9 | 2 |
| 22 players running: triangles, draw calls | 1,562,002 / 485 | 302,656 / 155 |
| 22 players: frame time (software renderer) | 4,098 ms | 663 ms (**6.2× faster**) |
| First frame, 22 players | 16.5 s | 0.7 s |

**Quality:** clearly more human at close range: photo-based skin, real eyes, braided hair and a
fitted shirt with a number. Problems found:
* this sample renders with a body that reads as female, although its recipe
  (`african-striker.params.json`) says `gender: 1` (male in Ara's convention), so the stored GLB
  may not come from that recipe;
* the shirt fabric shows moiré at a distance;
* faces and bodies are baked: twenty players need twenty exports, or a shared body with swapped
  textures.

**A low-detail export, measured (2026-11-24):** the same recipe exported with Ara's CLI at `--detail low`, game rig and `--no-animations` is still **54,336 triangles, 19 materials and 29.8 MB**, and takes 44 s to build. Ara writes full-size photo textures at every detail level, so the textures dominate the file. Its "about 5k triangles" applies to an undressed low-detail body, not a dressed footballer. A usable player body therefore needs a reduction step: textures to 512 px or less, the 19 materials merged, the mesh simplified to about 10–15k triangles. That would need a new tool (for example glTF-Transform) and its own licence check, so it was not done here.

**Conclusion:** Ara's bodies cannot replace the match players as exported. They are about 6× the
rendering cost, there is a megabyte-scale download per distinct player, and their identity is fixed
at export. Shipping them would break the "every player has his own permanent look" system unless
each look were exported.

## Recommended character pipeline

1. **Done:** use Ara's football clips through the retargeting pipeline (`extract-ara.js` →
   `assets/animations/source/ara3dgen/` → `build-footballer.js`, which checks every clip).
2. **Next, controlled evaluation:** export a small set of base bodies from Ara's CLI
   (`npm run export -- --params <file> --formats glb` in the Ara3DGen folder). Use:
   * the lite rig;
   * the low detail level (Ara documents about 5k triangles);
   * no embedded clips;
   * a plain kit that can be tinted per club.

   Run each through `scripts/anim/inspect.js` and the same `retarget.js` mapping, so it uses the
   Gaffer's clips instead of its own.
3. **Then:** offer one as an optional close-up body (award ceremony, Studio preview), loaded on
   demand, keeping the procedural players for the 22 on the pitch. Gate it on measured frame time.
4. **Stable identity:** a Studio profile could name a base body (`assetId`) while the existing look
   (skin, hair, face values) still drives tint and hair, so the player keeps the same appearance
   across seasons and clubs. The profile schema already has `assetId` and stays the single source.

## SoccerDribble and the Studio
Its customiser (material tints, hair, hat and glasses GLBs, face handles) has no licence and its
accessory models are of unknown origin, so none of it was used. The Studio already covers face,
hair, body and kit editing on the shared rig.
