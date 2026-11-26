# Character pipeline: realistic close-up bodies

Build-time tool (not shipped to the browser). It turns Ara 3D Gen footballer exports into the
light, game-ready bodies in `public/models/bodies/`. Those bodies are used where one player fills the
screen: the Player Studio and award ceremonies.

## Run it
```
cd tools/character-pipeline
npm install                      # glTF Transform, meshoptimizer, sharp (this folder only)
node build-bodies.mjs --export   # export every recipe with Ara 3D Gen, then optimise, check and write
node build-bodies.mjs            # reuse the exports in FOOTBALL-RALISM-LAB/outputs/gaffer-bodies
node build-bodies.mjs --only m-brown --export
```
* **Ara 3D Gen workspace:** `--export` needs it in `FOOTBALL-RALISM-LAB/Ara3DGen` with its MakeHuman
  data built (`npm run build-assets` there).
* **Windows fix to Ara's asset build:** without the fix described in `FOOTBALL-RALISM-LAB/docs/CLAUDE_RESULTS.md`,
  Ara writes an empty `targets.pack`. Every character then comes out as MakeHuman's neutral base
  mesh: 168 cm, the same shape whatever the gender, heritage or build.
* **All or nothing:** a body that fails its check stops the build, and `public/` is left unchanged.

## Files
| File | What it does |
|---|---|
| `recipes/*.params.json` | Ara character settings: male, low detail, game rig, T-pose, no clips, no face shapes or teeth, a white kit (tinted in the game), short hair (tinted), MakeHuman shoes06 (the pipeline turns their upper into sock). `m-brown` sets its skin texture and tint explicitly, because Ara's automatic choice gives a 50/50 heritage the African skin. `m-light`, `m-brown`, `m-dark` and `m-asian` ship; `f-test` is built and checked only |
| `optimise.mjs` | The optimiser (see below) |
| `validate.mjs` | Checks one optimised body against its Ara original with CPU skinning in three.js |
| `build-bodies.mjs` | Runs everything for each recipe (passing the optimiser's report to the check), measures skin colour and chest depth, and writes the bodies, `index.json` and `assets/characters/build-report.json` |
| `inspect.mjs` | Lists a GLB's meshes, materials, textures, UV ranges, morph targets and skin |

## What `optimise.mjs` does
1. **Drops** the jersey-number geometry (each player has his own number) and any clips.
2. **Kit and boots:** each part gets its own vertices. The kit and boots are welded and simplified
   with meshoptimizer (about half, with borders locked). The skin, eyes, brows, lashes and hair keep
   every triangle, so the face keeps its shape.
3. **Skin under the kit** (so the body cannot come through the cloth). Ara leaves out most skin
   under its clothes, but at low detail the skin left around each garment's edge is a few big
   triangles. Without this step, the upper arm comes through the sleeve when the arm is raised
   (throw-in, keeper's catch) and the calf crosses the sock top. At the bind pose:
   * **Under the cloth:** a skin point counts as under the kit when the nearest point on the
     garments is not on an open edge of the cloth. It must also face the same way as the cloth and
     be no more than 2 cm outside it.
   * **Cut:** the skin is cut 1.2 cm inside the garments' open edges. Triangles crossing that line
     are split, with interpolated positions, normals, UVs and joint weights, and the part further
     under the cloth is removed.
   * **Edge band:** the band of skin left near the edges is moved in until it sits 4 mm inside the
     cloth, rising to 15 mm at 3 cm from the edge.

   Visible skin is never moved or cut. Every moved vertex and every new corner is listed in the
   optimiser's report.
4. **Socks and boots fit:**
   * the boot's upper above 10 cm becomes sock (Ara's boots come over the ankle with a white sock
     painted on);
   * the sock is moved out 4–5 mm.
5. **Rebinding** onto The Gaffer's footballer skeleton (Mesh2Motion joint names):
   * every joint takes the Ara joint's bind position, with the Gaffer rest orientation turned onto
     the Ara bone;
   * scaled so the hips sit at the game's hip height;
   * new inverse bind matrices, and joint indices remapped.

   Every game clip, the body-shape bone scaling and the existing animation code then drive the body
   unchanged.
6. **Four materials:**
   * **skin:** skin and eyes atlas, 1024 px skin plus a 256 px eye strip, Ara's skin tint baked in;
   * **hair:** scalp layer, brows, lashes and any hair mesh, made grey so the game tints it to the
     player's hair colour;
   * **kit:** one white fabric texture and normal map, 256 px. The part (shirt, collar and cuffs,
     shorts, stitching, socks, drawstring) is stored in `COLOR_0`, so the game paints club colours
     and patterns;
   * **boots:** 512 px.
7. **Size:**
   * textures as WebP;
   * normals, UVs, weights and colours quantised (`KHR_mesh_quantization`). Positions stay in metres
     for the shirt patterns;
   * duplicates and unused data pruned.

## What `validate.mjs` checks
* **At rest:** every visible optimised vertex is compared with the original vertex it came from.
  The mean must be under 1 mm and no vertex more than 6 mm out (the socks move 4–5 mm on purpose).
* **Skin under the kit** (`--moved`, the optimiser's report):
  * the moved skin and the new corners are hidden by the cloth, so they are matched by where they are
    stored and reported on their own;
  * every listed vertex must be found in the file, and no skin may have moved more than 3 cm.
* **In motion:**
  * the original is posed on Ara's own skeleton with Ara's own clips;
  * the optimised body is posed on the Gaffer skeleton with the game's clips (retargeted from the
    same Ara clips);
  * each vertex is compared relative to the hips at 16 moments of 7 clips;
  * the body must average under 5 mm, with 95% of vertices under 15 mm;
  * fingers are reported separately, because the game holds each finger at one pose per clip.

## Licences
| Tool or asset | Licence | Notes |
|---|---|---|
| glTF Transform 4.5 | MIT, Don McCurdy | Build tool, not shipped |
| meshoptimizer 1.3 | MIT, Arseny Kapoulkine | Build tool, not shipped |
| sharp 0.35 | Apache-2.0, Lovell Fuller and contributors | Build tool, not shipped. It bundles prebuilt libvips (LGPL-3.0) on this machine only |
| Ara 3D Gen code | MIT, Joshua Olatunde and contributors | Exports may be used commercially without attribution |
| MakeHuman base mesh, skins, eyes, hair, clothes and shoes | CC0 1.0 | — |
