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

**Correction (2026-11-26):** two statements below were wrong. The 29.8 MB came mostly from the face-expression morph targets (34 shapes across the whole mesh) and the braided hair, not from textures. The body shapes were all wrong because Ara's morph-target pack was empty on this machine (a Windows path bug; see the next section). With face shapes, teeth and tongue off and the bug fixed, a dressed low-detail footballer exports at about 21,800 triangles and 2.5 MB.

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

## Close-up bodies: optimised, integrated and shipped (2026-11-26)

### What was found first
* **Every Ara character was MakeHuman's neutral base mesh.** On Windows, Ara's asset build wrote an
  empty morph-target pack (153 bytes): target keys were built with backslashes but looked up with
  forward slashes. Gender, height, build and heritage therefore did nothing; every export was 168 cm
  with the same androgynous shape, which explains the female-looking "Kofi Mensah".
* **Fixed in the lab copy of Ara.** After the fix there are 1,037 targets: men are male, the woman
  is female, and heights range from 170 to 187 cm. Screenshots before and after were checked.
* **Recipes for game use:** low detail, game rig, T-pose, no clips, no face shapes, no teeth or
  tongue, a white kit. A dressed footballer is then about 21,800 triangles, 16 materials and 2.5 MB.

### The pipeline
`tools/character-pipeline/` (see its README). It uses glTF Transform 4.5, meshoptimizer 1.3 and
sharp 0.35; it is build-time only and not shipped.
* **Simplification:** the kit and boots are simplified; the face, eyes, brows and hair keep every
  triangle.
* **Skin under the kit:** removed, so the body cannot come through the cloth. At low detail, Ara's
  skin around each garment's edge is a few big triangles; without this step, the upper arm came
  through both sleeves whenever the arms were raised (throw-in, keeper's catch). The skin is now cut
  1.2 cm inside the kit's edges. Triangles crossing that line are split, with interpolated weights,
  UVs and normals. The narrow band left near the edges is moved in under the cloth.
* **Socks and boots:** fitted (the boot's upper becomes sock).
* **Skeleton:** the mesh is rebound onto the game's skeleton, so every one of the 61 game clips and
  the body-shape bone scaling drive it.
* **Materials:** 4 (skin, hair, kit, boots). The kit parts are coded so the game paints club
  colours and patterns.
* **Data:** textures in WebP, attributes quantised.

### Measured: before (Ara export) → after (shipped)
| Body | Triangles | Vertices | Materials | File | Textures | Rest error (mean / max) | Body in motion (mean / 95%) |
|---|---|---|---|---|---|---|---|
| m-light | 21,842 → 12,174 | 13,553 → 7,706 | 16 → 4 | 2.51 → 0.56 MB | 1.60 → 0.18 MB | 0.28 / 4.6 mm | 1.93 / 5.4 mm |
| m-brown | 21,850 → 12,228 | 13,561 → 7,758 | 16 → 4 | 2.48 → 0.53 MB | 1.57 → 0.16 MB | 0.29 / 4.5 mm | 1.94 / 5.3 mm |
| m-dark | 21,834 → 12,267 | 13,547 → 7,811 | 16 → 4 | 2.52 → 0.54 MB | 1.61 → 0.16 MB | 0.27 / 4.4 mm | 1.94 / 5.3 mm |
| m-asian | 21,690 → 12,072 | 13,461 → 7,617 | 16 → 4 | 2.47 → 0.54 MB | 1.56 → 0.18 MB | 0.31 / 4.9 mm | 1.96 / 5.7 mm |
| f-test (checked, not shipped) | 25,664 → 14,030 | 16,717 → 9,716 | 17 → 4 | 3.92 → 0.70 MB | 2.81 → 0.26 MB | 0.22 / 5.0 mm | 1.75 / 5.0 mm |

* **Rest error (visible skin and kit):** the socks are moved out 4–5 mm on purpose; everything else is
  under 1 mm.
* **Skin under the kit:** each body has 96–117 skin triangles cut, 4–5 removed, 115–138 new corners
  and 34–45 vertices moved in (at most 27 mm). All of these are under the cloth. The check finds
  every one of them in the file and reports them on their own.
* **Motion:** 16 moments of 7 clips (shot, first touch, jumping header, keeper's dive,
  celebration, tackle, throw-in), compared with the original on Ara's own skeleton and clips.
* **Fingers:** reported apart (mean about 15 mm). The game holds each finger at one pose per clip,
  so this is a pose difference, not a skinning error.
* **Exact numbers:** in `assets/characters/build-report.json`.

**Targets:**
* triangles: 10,000–15,000 met (12,072–12,267);
* materials: 2–4 met (4);
* textures: at most 512 px, except the 1024 px skin and face texture, which was judged necessary for
  close-ups;
* file size: much smaller, 0.53–0.56 MB from 2.5 MB, or from 29.8 MB for the old Kofi export.

### Measured in the game's renderer (three.js r170, headless Chrome, software rendering)
| | Classic figure | Realistic body |
|---|---|---|
| Meshes (Studio preview) | 30 | 8 |
| Triangles (Studio preview) | 18,477 | 12,236 |
| Draw calls (body file alone) | — | 6 (4 materials + shadow) |
| First load of a body | — | 0.16–0.7 s (award) and 0.5–2.5 s (Studio): served locally, software rendering, first visit |

The realistic body is lighter than the classic figure it replaces in close-ups: fewer triangles and
fewer meshes.

### Integration
* **Where:** Player Studio preview and award ceremonies (man of the match, player of the season,
  Golden Ball) only. The 22 players on the pitch keep the Mesh2Motion figures; nothing new loads for
  a match.
* **How it loads:** `public/models/bodies/index.json` and one body file (about 0.5 MB) the first
  time a close-up needs it, then cached in memory and by the service worker, so it also works
  offline.
* **Fallback:** if the index or file fails, the classic figure is used. This was tested with
  simulated failures: no errors.
* **Slow connections:** an award ceremony waits at most 6 s for the body, then uses the classic
  figure; the body keeps downloading and is cached for the next ceremony. Tested with the body
  delayed 15 s: the ceremony appeared after 11.3 s, against 6.3 s with no delay. The Studio never
  waits: it shows the classic figure until the body arrives.
* **Setting:** Settings → "Close-ups" turns realistic bodies off.
* **First load:** the Studio waits for the profile's look before fetching, so it downloads only the
  body it will show. It had been fetching the default light body first and then the right one.
* **Export .glb:** a realistic body exports with its club colours and pattern written into the kit's
  vertex colours, so it looks right in any glTF viewer. The kit's region codes had been leaking into
  the file. Tested: 66 joints, 61 clips and the Studio profile read back from the file.
* **Body choice:**
  * the Studio's new appearance field `baseBody` (Automatic, one of the four bodies, or Classic);
  * otherwise East Asian heritage (Studio nationality, or a career player's nation) gives m-asian;
  * otherwise skin tone: 0–2 m-light, 3–4 m-brown, 5–7 m-dark.
* **Tinting:** the skin texture is tinted towards the player's exact tone, and the hair layer to his
  hair colour.
* **Kit:** club colours, the second colour for collar and cuffs, stripes, hoops and yokes,
  sponsor, crest and number.
* **`assetId` was investigated and left alone.** It means "the library character this profile
  came from" and drives assign, clear and "no delete while worn", so overloading it would break the
  library. The base body is the separate field `baseBody`. Old profiles without it are valid and
  mean Automatic.
* **Identity (tested):**
  * the choice survives a career save and load and a transfer;
  * Studio save, page reload and reopening from the library keep it;
  * ratings, contract, wage and history are unchanged.

### What the realistic body does not do yet
* **Face sliders:** the Studio's face sliders (jaw, nose, chin, cheekbones, eyes, lips, ears) and
  face shape do not reshape the Ara head. Those features are baked in at export; they still shape
  the classic figure.
* **Hair and beards:** hair styles (afro, long, fade and others) and beards are not reproduced;
  every realistic body has short hair, tinted to his colour.
* **Bodies:** only the four bodies and male players. The female body was built to prove the
  pipeline, not shipped.
* **Keepers:** goalkeepers on the realistic body show bare hands, not gloves.
* **Pitch:** realistic bodies on the pitch are not enabled; that needs real-device frame-rate
  measurements first.
* **Sock tops:** a small V at the front of each sock top is the shape of Ara's sock band (its opening),
  not skin coming through. It shows most on white socks.
* **Exported patterns:** stripes and hoops in an exported .glb have soft edges, because they are vertex
  colours in the file.

## Athletes on the pitch, and hairstyles on realistic bodies (2026-11-27)

* **Match players:** the 22 players can now be the optimised Ara bodies instead of the Mesh2Motion
  mannequins: Settings → "Players in matches" (Athletes by default). The four bodies (2.2 MB in all)
  load while the week is simulated and are cached. If none is ready within 12 s, the match uses the
  mannequins. If one body fails to download, the players who would wear it get the mannequin with
  their own look (never a body of another skin tone), the rest keep their athletes, and the failed body
  is tried again for the next match. This was tested by blocking one body: 12 athletes and 10
  mannequins, no errors. It was added after an HTTP/2 error on the live site cancelled all four.
* **Choosing a body:** the same choice as the Studio: his `baseBody`, East Asian heritage, then
  skin tone. Officials keep the mannequin figure.
* **His identity:** height and build (bone shaping), skin tone (texture tint), hair colour, kit
  colours and pattern, number, sponsor and crest come from his look and the club, as before.
* **Hairstyles:** his hairstyle from his look (crop, swept, curly, long, twists, afro, fade) is
  built with the Studio's own hair shapes and fitted to the body's head. The cranium is measured
  once per body, from the skin weighted to the head bone. This works in matches, the Studio and award
  ceremonies. Buzz, receding, bald and mohawk keep the body's own short hair.
* **Measured in a full 3D match** (headless Chrome, software rendering; same match, same moment):

| | Mannequins | Athletes |
|---|---|---|
| Draw calls | 274 | 232 |
| Triangles | 384,052 | 411,747 |
| Textures | 236 | 175 |
| Geometries | 102 | 83 |
| Shader programs | 21 | 26 |

  The athletes cost fewer draw calls and textures and about 7% more triangles. The frame rate cannot
  be judged without a GPU (about 1 fps either way here), so real-phone performance is unmeasured.

**What is limited (honestly):**
* **Faces:** there are four base faces, one per body (light, brown and dark skin, East Asian).
  Players on the same body share a face, though their height, build, skin tone and hair differ.
  Studio face sliders still do not reshape these heads.
* **Style:** the bodies use MakeHuman's photographic skin, so they are semi-realistic rather than the
  low-to-mid-poly stylised look of a game like Dream League Soccer. A stylised set (painted skin and
  sculpted stylised faces) needs new art, not just optimisation.
* **Beards and goalkeeper gloves** are not drawn on the athletes.
* **The crop hairstyle** sits a little like a cap; long hair frames the face like a hood.
