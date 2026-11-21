# Player Studio asset register

*Updated 2026-11-21. No new third-party art, model, animation, texture, font or sound was added for
the Player Studio. All faces, hair, bodies, kits, crests, sponsors, trophies and confetti are made
in code. The full game register is `assets/licences/ASSET_REGISTER.md`.*

| Asset | Source | Licence | Commercial use | Attribution | Used as |
|---|---|---|---|---|---|
| Footballer mannequin (one shared model) | Mesh2Motion | CC0 1.0 | Allowed | Not required | `public/models/footballer.glb` — every player, the Studio and the award ceremonies |
| 38 animation clips | Mesh2Motion | CC0 1.0 | Allowed | Not required | `public/models/footballer-anims.json` |
| three.js r170 | mrdoob/three.js | MIT | Allowed | Licence header kept | `public/vendor/three.module.min.js` |
| GLTFLoader, SkeletonUtils, BufferGeometryUtils | three.js examples | MIT | Allowed | Licence header kept | `public/vendor/jsm/` |
| **GLTFExporter** (new) | three.js examples, the same npm package | MIT | Allowed | Licence header kept | `public/vendor/jsm/exporters/GLTFExporter.js` — Studio .glb export |

## What the Studio does not use

* **No paid or external AI service.** Generation is a rule-based reader plus a seeded procedural
  generator, and runs offline.
* **No EA Sports FC or other commercial game assets.** No real players' likenesses, club logos or
  sponsor brands: crests are the club's initials, and AI clubs' sponsors are invented names.
* **Nothing whose licence could not be verified.**
