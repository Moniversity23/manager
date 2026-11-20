# Realism audit

This file is the entry point the first brief asked for. The detailed findings are split by area:

* [Full technical audit](GAFFER_FULL_TECHNICAL_AUDIT.md): stack, how every system works, status
  by category, the ten highest-impact problems, risks.
* [Match simulation audit](GAFFER_MATCH_SIMULATION_AUDIT.md): possession, events, player and ball
  movement, tactics, statistics, and the engine–view relationship before and after Phase 1.
* [Visual audit](GAFFER_VISUAL_AUDIT.md): stadium, players, animation, cameras, replays, quality
  settings.
* [Asset and licence audit](GAFFER_ASSET_AND_LICENCE_AUDIT.md): what ships, under which licence.
* [Baseline test results](BASELINE_TEST_RESULTS.md): what was run and what it measured.

## In one paragraph
* **The management game is complete and well tested.** That covers seasons, competitions,
  transfers, loans, youth, finances, history and saves.
* **The match engine decides results credibly.** It works from strength, form, tactics and
  fatigue.
* **The realism gap was in the match itself.**
  * Possession was a restatement of xG.
  * The match view invented its own passes and tackles, unrelated to the engine.
  * No passing or defensive statistics existed.
* **Phase 1 closes that gap at its root.** An authoritative, validated timeline of real actions
  between the actual players now drives the view and the statistics.
* **What remains:** tactical shape, ball physics, animation selection and presentation. See the
  [roadmap](GAFFER_DEVELOPMENT_ROADMAP.md).
