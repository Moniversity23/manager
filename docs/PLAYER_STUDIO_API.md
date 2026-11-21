# Player Studio API

The same routes run on the Node server and, offline (GitHub Pages), inside the game's engine worker
(`src/api.js` → `src/studio/studioApi.js`). All responses are `{ ok, error?, ... }`; invalid input
returns `ok: false` with status 400/404/409 — never a crash.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/studio/health` | Studio status (procedural generator, no AI provider) |
| GET | `/api/studio/library?q=` | List characters, optional search by name, nation or position |
| GET | `/api/studio/library/:assetId` | One character |
| POST | `/api/studio/generate` | Create a character from `description` (≤ 1200 chars) or `appearance`; saved in the library (≤ 300) |
| POST | `/api/studio/preview` | Generate a profile without saving it |
| POST | `/api/studio/regenerate` | A new variation that keeps the `locks` groups (skin, face, eyes, hair, beard, body, kit) |
| PUT | `/api/studio/library/:assetId` | Update name and profile (validated); a character worn by a player updates his look |
| POST | `/api/studio/library/:assetId/duplicate` | Copy |
| DELETE | `/api/studio/library/:assetId` | Delete (refused while a player wears it) |
| POST | `/api/studio/import` | Import `{ name, profile }` (JSON export or the profile read from a Studio .glb) |
| GET | `/api/studio/export/:assetId` | Export as JSON |
| GET | `/api/studio/squad` | Your players (for assigning) |
| GET | `/api/studio/player/:id` | His Studio profile and the look the renderer draws |
| POST | `/api/studio/player/:id/assign` | Give him a character (`{ assetId }`): writes only `player.studioProfile`, then saves |
| POST | `/api/studio/player/:id/clear` | Back to his own look |
| GET | `/api/studio/kits` | Your club's home, away, third and goalkeeper kits |
| PUT | `/api/studio/kits` | Save kit colours (`#rrggbb`) and patterns (`plain`, `vertical-stripes`, `horizontal-stripes`, `yoke`) |

## Data and storage

* **Library:** the document `player-studio-library` in the save store (a file or MongoDB on the
  server; IndexedDB in the browser). Asset ids match `^[a-zA-Z0-9_-]{1,64}$` and are never used
  as file paths.
* **Player look:** `player.studioProfile` (schema 1), saved with the career. It is optional, so
  players without one keep their permanent legacy look.
* **Club kits:** `club.kits`, saved with the career. It is optional, so clubs without one keep
  their colours.
* **3D assets:** none per character. Every character is drawn from the shared footballer model
  and animation set (`public/models/`), so no per-player GLB is stored or loaded. A .glb export is
  generated on demand in the browser.

## Separation of data

The Studio changes **appearance only**. These tests check that a player's id, name, age,
position, attributes, ability, potential, contract, club, history, season statistics, career
rows, moves, honours and legacy look are byte-for-byte unchanged by assigning or clearing a look
(`test/studio-api.test.js`).
