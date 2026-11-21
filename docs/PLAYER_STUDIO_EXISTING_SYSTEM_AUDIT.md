# Player Studio — existing system audit

Audit date: 2026-11-21

## 1. Architecture

The Gaffer is a plain CommonJS Node application with a bundled browser/offline engine.

- `src/index.js` owns `GameWorld`, permanent player and club registries, season state and save serialization.
- `src/models.js` defines `Player` and `Club`. It allocates IDs through `GameWorld.ctx()` and does not use global randomness.
- `src/look.js` provides the legacy deterministic appearance, packed into one integer and stored as `Player.look`.
- `src/engine/youthEngine.js` creates academy players and wonderkids through `Player` and `world.registerPlayer()`.
- `src/api.js` exposes the shared route table used by both the Node server and offline worker.
- `src/webEngine.js` bundles the same API and game logic into `public/engine.worker.js` for PWA/offline use.
- `src/server.js` serves static files and adapts HTTP requests to `src/api.js`.
- `public/index.html` is the primary application UI and contains inline management sections.
- `public/match3d.js` is the Three.js match renderer.
- `public/models/footballer.glb` is a 341 KB skinned shared mannequin split into kit regions.
- `public/models/footballer-anims.json` contains 38 processed animation clips.

## 2. Reusable functionality

- Permanent player IDs are allocated once and restored from the saved ID counter.
- Nation, age and position already exist on every player.
- `src/look.js` deterministically derives a legacy appearance from player ID, nation and position.
- Transfers and loans update club ownership while keeping the player object and ID unchanged.
- Youth intake, custom-club youth and wonderkids all use the same `Player` constructor path.
- Saves round-trip as plain JSON and preserve optional player fields.
- Three.js r170 is vendored locally; GLTFLoader and SkeletonUtils are present.
- The existing GLB is split into shirt, shorts, socks, boots, skin, hands and hidden head regions.
- The shared skinning skeleton has 66 joints and 38 football-related clips.
- The match renderer clones the same model and shares clips across 22 players.
- The classic procedural player renderer remains an independent fallback.
- The service worker caches the app, worker, Three.js and current character assets.
- The animation lab and licence register already verify the existing model and clips.

## 3. Limitations

- Existing player faces are procedural heads assembled from primitive geometry; the shared GLB head is hidden.
- Legacy appearance is packed into one integer with limited skin, hair, beard, face and build values.
- The match renderer currently scales and recolours the shared mesh; it does not load a per-player GLB.
- The UI has no independent character studio route or asset library.
- There is no appearance-profile schema or visual asset registry in player saves.
- No face morph targets or per-player geometry assets are currently required for the fallback.
- The offline engine cannot create unrestricted server files, so the visual library must use browser storage or saved profile JSON rather than treating server filesystem writes as mandatory.
- Local Blender/MPFB automation is not presently installed or part of the build.
- Additional animation packs are optional only and must be compatibility-tested.

## 4. Current player identity and appearance structure

A player contains, among football fields:

- `id`, `name`, `nation`, `age`, `clubId`, `position`
- `look` (legacy packed integer)
- football attributes, personality, contract, history and season statistics

The legacy packed appearance fields are:

- skin, hair style, hair colour, beard, head shape, eye colour, eyebrows
- height in 165–204 cm, build, celebration

`LOOK.makeLook()` hashes `look:<playerId>:<nation>` and is deterministic without affecting world RNG. `LOOK.describe()` applies age-dependent beard and hair changes for rendering. Therefore legacy appearance is already stable across transfers, replays and saves.

## 5. Model and skeleton specifications

The processed footballer:

- GLB: `public/models/footballer.glb`
- 7 kit/head primitives; person-height about 1.57–1.68 bind-pose model units
- 66-joint skin
- Y-up mesh
- regions: shirt, shorts, socks, boots, skin, hands, hidden head
- uncompressed size: approximately 341 KB

Animation JSON:

- 38 clips, pelvis translation and shared joint rotations
- static tracks collapsed
- finite float tracks only
- kick clips include ball-contact time and kicking foot metadata

A Studio character may reuse this rig by exporting a GLB with 66 compatible joints or by retaining the shared `footballer.glb` as the base model. A new model must not change match-engine player IDs or skeleton semantics.

## 6. Animation compatibility

Existing clips bind directly to the Mesh2Motion bones in `footballer.glb`. The match renderer creates one `AnimationMixer` per cloned model. Compatibility is determined by:

- identical/compatible joint names
- finite, correctly sized quaternion/vector tracks
- no required missing nodes
- stable pelvis/root motion
- target clip duration and loop status

The existing animation test suite validates the skeleton, clip names, finite tracks and kick metadata.

## 7. API integration opportunities

`src/api.js` can host narrow Studio routes. It already accepts JSON and enforces `{ world }` career guards for career-dependent operations.

Recommended integration:

- Library/profile endpoints remain independent of football state.
- Player assignment validates an existing player ID but changes only visual metadata.
- The assignment operation must not change attributes, contracts, club, transfer or match state.
- Standalone Studio routes should work without mutating a career.
- In offline mode, routes work through `createApi()` inside the worker, with library state in IndexedDB or an optional Studio service behind the API.

## 8. Save compatibility risks

- `Player.toData()`/`fromData()` already preserve optional fields listed in `PLAYER_OPTIONAL`.
- Appearance profile fields can be optional and can be added to that list without migrating every legacy save.
- `SAVE_VERSION` should advance only when a migration is required. Optional profile state can be defaulted on load with no migration needed if serialization is explicit.
- Legacy saves without visual profiles must continue to call `LOOK.makeLook()` and `LOOK.describe()`.
- Visual profile corruption must never affect player construction, save loading or football state.
- Asset files are not valid as game authority: profile JSON stores rig ID and asset ID; the renderer uses the shared fallback if missing or invalid.

## 9. Recommended implementation architecture

1. Add a versioned appearance profile module under `src/studio/`.
2. Keep legacy `src/look.js` read-only and as the deterministic fallback.
3. Store visual metadata outside football attributes, with `playerId` as an optional link only.
4. Use an in-browser library backed by IndexedDB/localStorage in offline mode and a small server-side document store in server mode.
5. Serve a standalone `/studio/index.html` module and `/studio/js/*.js` assets without changing the existing game shell.
6. Start by previewing the existing `footballer.glb`; do not introduce Blender generation until a compatible test model passes GLB and animation validation.
7. Implement deterministic natural-language parsing and profile generation in pure JavaScript.
8. Expose narrow API routes for health, library, generation, player assignment and profile export/import.
9. Add Studio appearance fields to `snapshot` player rows only where needed, not in the deterministic football authority.
10. Add profile assignment to player objects as an optional field so transfers and careers preserve visual identity automatically.

## 10. Implementation constraints

- Do not create a second player database or player ID allocator.
- Do not regenerate existing appearances at startup.
- Do not replace `footballer.glb` without passing the existing animation tests.
- Do not expose arbitrary file paths or uploaded executable content.
- Do not make Blender, MakeHuman, MPFB or an external LLM mandatory.
- Preserve classic/procedural rendering, PWA/offline operation and old saves.
