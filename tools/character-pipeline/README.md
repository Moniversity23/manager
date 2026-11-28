# Character pipeline: athletes (and the earlier close-up bodies)

Build-time tool (not shipped to the browser). It turns Ara 3D Gen footballer exports into game-ready
files:
* **Athletes** (since 2026-11-28, every footballer the game draws): `public/models/athletes/`, built by
  `athletes/` (below).
* **Close-up bodies** (2026-11-26, no longer loaded by the game): `public/models/bodies/`, built by
  `build-bodies.mjs`.

## Athletes
One base footballer with 37 shape targets, at two levels of detail, plus 11 hairstyles and generated
beard and glove layers. A player's look sets the targets' weights in the game (`athleteRecipe` in
`public/match3d.js`).
```
cd tools/character-pipeline
node athletes/variants.mjs                 # 54 Ara exports (about 7 minutes; cached, --force to redo)
node athletes/build-athletes.mjs           # the full athlete (Player Studio, award ceremonies)
node athletes/build-athletes.mjs --lod match   # the match athlete (22 on the pitch); after the full one
```
* **Exports** (`athletes/variants.mjs`): one neutral footballer (medium detail, an even mix of the
  three heritages) and, from the same settings, one export per change: 28 single MakeHuman face
  modifiers, 3 pure heritages, more and less muscle and weight, older and younger, 11 hairstyles and 5
  beard styles. They go to `FOOTBALL-RALISM-LAB/outputs/gaffer-athletes/` (not in git).
* **Base** (`optimise.mjs --athlete`): the neutral export simplified (head gently, the hidden body
  hard), rebound onto the game skeleton, with a stylised skin texture moved to a light neutral tone
  (the game multiplies it by each player's tone, so one base serves every skin). Each skin vertex keeps
  the raw vertex it came from (`_RAWA`, `_RAWB`, `_RAWT`) so targets can be added after the
  optimisation.
* **Targets** (`build-athletes.mjs`): each export minus the neutral one, mapped to the optimised
  vertices. Face targets reshape the head only; heritage and age too, after the head's own movement
  and size are removed (those exports also change the height, which moved the head up to 15 cm);
  build targets reshape the body, and the shirt, shorts and socks follow along their normals (Ara
  rebuilds them with other vertex counts). Stored as 8-bit steps of a per-target scale
  (`index.json` `targetScale`); plain integers, because glTF Transform's sparse writer stores
  normalised 8-bit values as 0.
* **Hairstyles:** the hair of each hairstyle export, simplified, rebound and made grey (tinted in the
  game), each vertex tied to its nearest scalp vertex (`_SKINREF`) so the hair follows the head's
  shape. The median of each texture becomes a light grey, so blond and ginger come out as such.
* **Beards and gloves:** copies of the skin over the area where Ara grows each beard (or over the
  hands), offset outward, with a strand texture; a beard's alpha fades to its edges.
* **Match level of detail:** `--lod match` simplifies the head, skin, kit, boots and hair further and
  uses a 512 px skin: about 9,400 triangles with no beard, plus 1,000–2,200 for a hairstyle.
* **Writes** `athlete.glb`, `athlete-match.glb`, `hair-<style>[-match].glb`, `index.json` (targets,
  scales, skin tone, hair files, `lods.match`), and `assets/characters/athletes-report[-match].json`.
* **Checked by** `test/athletes.test.js`. The comparison scene is `public/dev/athletes.html`.

## Close-up bodies (2026-11-26)
The four bodies below are still built by `build-bodies.mjs` and checked by
`test/character-bodies.test.js`, but the game now draws athletes instead.

### Run it
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
