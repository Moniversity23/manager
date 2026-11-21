# Player Studio architecture

> **Updated 2026-11-21:** the Studio preview now uses the match renderer itself (`public/match3d.js`: `createStudioView`, `createAwardView`), Studio fields are mapped to the renderer by `public/appearance.js` (shared by server and browser), and club kits live in `src/studio/kits.js`. See `PLAYER_STUDIO_HANDOVER_AUDIT.md` for what changed and why, and `PLAYER_STUDIO_API.md` for the current routes.


## Separation

THE GAFFER remains the authority for player identities, IDs, clubs, contracts, attributes and statistics. The Studio owns visual profiles and optional visual assets.

## Modules

- `src/studio/profileSchema.js`: versioned appearance validation and defaults.
- `src/studio/characterService.js`: natural-language parsing and deterministic fallback generation.
- `src/studio/studioApi.js`: library and player-link API routes.
- `studio/index.html`, `studio/css/studio.css`, `studio/js/app.js`: independent browser interface.
- `public/models/footballer.glb`: compatible shared model preview and match fallback.
- `public/models/footballer-anims.json`: verified 38-clip animation library.

## Identity link

A player stores an optional `studioProfile` field. It never changes `id`, attributes or contracts. The Studio asset library may link that profile to a game player. Linked assets cannot be deleted; archive or unlink operations are required instead.

## Determinism

Description parsing is pure and profile data is seedable. Automatic game-player visuals derive from permanent player ID through profile generation; existing legacy `src/look.js` stays unchanged.

## Save and fallback

Legacy saves load without `studioProfile`. If a profile or model is missing/corrupt, the match uses `src/look.js` and the classic/mocap fallback. Studio API library documents use the existing save-store document interface.

## Offline

All modules use APIs that bundle into `engine.worker.js`. The standalone Studio is also independent of the game career and static-host safe.
