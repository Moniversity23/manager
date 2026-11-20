# The Gaffer — asset and licence audit

*2026-11-20. The full register is [`assets/licences/ASSET_REGISTER.md`](../assets/licences/ASSET_REGISTER.md)
(machine-readable: `assets/licences/asset-register.json`). The animation-specific register with the
clip-by-clip list is [`assets/animations/licenses/REGISTER.md`](../assets/animations/licenses/REGISTER.md).*

## Summary
* **No paid, proprietary or unknown-licence asset ships in the game.**
* **Shipped third-party content:**
  * three.js r170 and its example modules (MIT);
  * the Mesh2Motion human model and 38 clips (CC0 1.0);
  * Google Fonts loaded at run time (SIL Open Font License 1.1): Barlow, Barlow Condensed, Space Mono.
* **Generated in code, with no files:**
  * all textures (pitch, nets, sky, shirts, boards, faces);
  * the stadium, crowd and ball;
  * all sound (Web Audio synthesis);
  * commentary text;
  * player names, clubs and leagues (fictional, generated from seeds).
* **Downloaded but not shipped:** the KinemIQ CC0 pack (kept out of git, verified by SHA-256). The
  Quaternius library was not downloaded.
* **No new assets were added in Phase 1.**

## Rules for future assets
1. Use only CC0, public-domain, MIT or another licence that allows commercial use without payment.
   Record attribution even when it is not required.
2. Keep originals in `assets/<kind>/source/` and processed files in `public/`. Record the SHA-256
   of each original.
3. Add a row to `ASSET_REGISTER.md` and to `asset-register.json` before the asset is used.
4. Never use real club names, crests, kits, player likenesses, broadcaster graphics or stadium
   designs.
5. Never scrape sites whose terms forbid it, and never bypass a login or paywall to download.

## Real-world likeness check
* Club, player and competition names are generated. The game includes no real crests, kits or
  sponsor marks: sponsor names on boards are generated words.
* The motion-captured model is a generic mannequin, and faces are drawn in code from each player's
  generated look.
