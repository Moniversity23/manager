# Asset register

Every third-party file the game ships or keeps for its build, with its licence and checksum.
Machine-readable copy: [`asset-register.json`](asset-register.json). Clip-by-clip animation detail:
[`assets/animations/licenses/REGISTER.md`](../animations/licenses/REGISTER.md).

Only licences that allow commercial use without payment are accepted. Add a row here (and to the
JSON) **before** an asset is used.

| Asset | Original URL | Creator | Licence | Commercial use | Attribution required | Downloaded | SHA-256 (original) | Original file | Processed file | Used for | Modifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Human mannequin model | https://github.com/Mesh2Motion/mesh2motion-app (`static/assets/human/model.glb`) | Mesh2Motion | CC0 1.0 | Yes | No | 2026-11-18 | `bce15f56f0ca4daf4e085337b2412116ab18d3165cb51ea672d1cb9f1194b37f` | `assets/animations/source/mesh2motion/model.glb` | `public/models/footballer.glb` (`df5a5b43…c04f`) | Every player and official in the 3D view | Split into kit regions (shirt, shorts, socks, boots, skin, hands); head hidden; decompressed; no texture |
| Human skeleton | same repository (`skeleton.glb`) | Mesh2Motion | CC0 1.0 | Yes | No | 2026-11-18 | `1784d9aa20e24dee3233d97a8ac2f2e0d72cc74f0692b44fcded87d2d3e33f9c` | `assets/animations/source/mesh2motion/skeleton.glb` | (reference only) | Inspection | None |
| 38 human animation clips | same repository (`animations/*.glb`) | Mesh2Motion | CC0 1.0 | Yes | No | 2026-11-18 | per file: see `assets/animations/processed/build-report.json` | `assets/animations/source/mesh2motion/animations/` | `public/models/footballer-anims.json` (`58c7acc6…18a5`) | Locomotion, kicks, tackles, keeper actions, celebrations, reactions | Bone rotations and pelvis translation kept, static tracks collapsed, values rounded, ball-contact times added |
| KinemIQ Free Game Animations (35 clips) | https://huggingface.co/datasets/Kinemiq/free-game-animations | KinemIQ (clips from Quaternius, retargeted) | CC0 1.0 | Yes | No | 2026-11-18 | `64ca5ab4a92c9da079c5e88ca509391b0a58a24ccf2a1307b16e2f0fc6b23ffc` (zip) | `assets/animations/source/kinemiq/` (not in git) | — | **Not used** (different skeleton; duplicates) | — |
| three.js r170 core | https://github.com/mrdoob/three.js (npm `three`) | three.js authors | MIT | Yes | Keep the licence notice (kept in the file header) | 2026-11-15 | `08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7` | npm package | `public/vendor/three.module.min.js` | 3D rendering | None |
| GLTFLoader | three.js `examples/jsm/loaders/` | three.js authors | MIT | Yes | Keep the licence notice | 2026-11-18 | `47a90ccd683aa4c66946ff6d179778d04b14d6b9661891210afa2b558bb90256` | npm package | `public/vendor/jsm/loaders/GLTFLoader.js` | Loading the footballer model | Import paths pointed at the vendored core |
| SkeletonUtils | three.js `examples/jsm/utils/` | three.js authors | MIT | Yes | Keep the licence notice | 2026-11-18 | `0ab720eaf4875a706ee377bcaa253fb015f1b0cb75f5f23396fbad3696ceb585` | npm package | `public/vendor/jsm/utils/SkeletonUtils.js` | Cloning skinned players | Import paths |
| BufferGeometryUtils | three.js `examples/jsm/utils/` | three.js authors | MIT | Yes | Keep the licence notice | 2026-11-18 | `669381049ccaa95417ff3b5a3b86d9aec517bd18ef7a615c6cf8a4cd1f502f76` | npm package | `public/vendor/jsm/utils/BufferGeometryUtils.js` | Needed by GLTFLoader | Import paths |
| GLTFExporter | three.js `examples/jsm/exporters/` | three.js authors | MIT | Yes | Keep the licence notice | 2026-11-21 | `6df5187f886b74a18c32b5d41deae7c5fc8d9be93c11d15c6f3a644868286446` | npm package | `public/vendor/jsm/exporters/GLTFExporter.js` | Player Studio .glb export | Import paths pointed at the vendored core |
| meshoptimizer decoder | three.js `examples/jsm/libs/meshopt_decoder.module.js` | Arseny Kapoulkine | MIT | Yes | Keep the licence notice | 2026-11-18 | (npm package file, build tool only) | `node_modules/three/…` | — | Decoding source GLBs in `scripts/anim/` | None |
| Barlow, Barlow Condensed, Space Mono | https://fonts.google.com | Jeremy Tribby (Barlow); Colophon Foundry (Space Mono) | SIL Open Font License 1.1 | Yes | No (licence travels with the font) | loaded at run time | — (served by Google Fonts) | — | — | Interface text | None |

**Generated in code (no third-party files):** textures, stadium, crowd, ball, faces, all sound
(Web Audio synthesis in `public/sound.js`), commentary, and every name of a player, club,
competition and sponsor.
