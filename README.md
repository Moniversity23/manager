# The Gaffer

**▶ Play now:** https://moniversity23.github.io/manager/ — runs in the browser, installs as an app (📲 Install), plays offline.

A football management game: start at a poor club in the lowest division and climb to the top.
Node.js server (plain `http`), a deterministic simulation engine, a single-file web UI, and
MongoDB saves with a gzip-file fallback.

## What's in the game

- **Career:** start at a poor club in the lowest division (or create your own) and climb. Board objectives
  and a weekly confidence meter, ultimatums, sackings, job offers, a job centre, coaching licences (C → Pro),
  and a national team job alongside the club job once your reputation reaches 50.
- **Season:** 15-club divisions, 30 rounds, top 2 up automatically, 3rd–6th play-offs, bottom 3 down; the bottom
  two of each lowest division face the **re-election vote** and are replaced by newly generated regional clubs
  (your clubs always survive the vote). National cups, five continental competitions, season awards, records,
  15 achievements.
- **International football:** national teams pick their best 23; Nations League every season (two groups, five
  matchdays, a final), World Nations Cup every second summer, Elo world rankings, caps and international goals.
- **Matchday:** **3D stadium view** (three.js: day games and floodlit night games, stands and crowd, TV / close /
  tactical / behind-goal cameras, full-screen landscape on phones) with a broadcast score bug and clock, a radar
  minimap, a pre-match fly-over and slow-motion goal replays; or full 2D, key moments, commentary or instant;
  1×–8×. **Sound** (crowd, whistles, goal roars, near-miss "ooh"s),
  synthesised in the browser. A half-time dressing room with **team talks**,
  subs, tactic and formation; assistant subs; cards and bans.
- **Dressing room:** morale from playing time against expected or promised roles, wage fairness and leaders;
  captain; one-to-one talks (praise, demand, promise games, persuade to stay); team talks; transfer requests.
- **Scouting fog:** other clubs' players show rating ranges until scouted; scout assignments write full reports;
  a better chief scout adds scouts and speeds them up.
- **Agents and contracts:** every player has an agent who asks for wage, signing bonus, agent fee, length,
  squad role and sometimes a release clause; offers are accepted, countered (patience runs out) or walked out on.
  Cheap release clauses get triggered by other clubs.
- **Market and money:** bids for your players (accept, counter, reject), an itemised weekly ledger, a **season
  budget** (projected income — TV, shirt sponsor with performance bonuses, merchandise, gates, prize money — and
  costs, transfer and wage budgets), ticket prices, facilities, the debt rule, a second club. **Loans both
  ways:** borrow players, or send your own out to clubs that will play them (see the expected role, fee and wage
  share first), follow them in the "Out on loan" list, recall them while a window is open; they return at
  season end with a report.
- **One-click decisions:** the dashboard's action centre lists every pending decision with its buttons (bids,
  renewals on the agent's terms, unhappy players, sponsor, jobs, scout reports, lineup problems);
  keyboard shortcuts (Space plays on); delegation of key contracts and bids to the assistant.
- **News and challenges:** the Gaffer Gazette (transfers, title races, giant-killings, sackings, champions,
  re-election, international results); weekly and season challenges paid automatically; a manager score and a
  leaderboard; **challenge codes** start a friend in exactly the same world to compare scores.
- **Match realism:** the match view runs a possession-and-passing simulation (dribbles, passes, interceptions,
  pressing, keeper dives); every shot is built up to and struck on its minute; goals end in the conceding
  side's net, followed by a celebration and a kick-off. Player ratings and a man of the match after every game.
- **Golden Ball:** a live race for the world's player of the year, a top ten, Golden Boot, Golden Boy and a
  team of the season; a player-of-the-season race in your own league.
- **Progress:** manager levels and titles from your score; XP for every match (result, goals, clean sheets, win
  streaks, challenges) shown on an animated rewards screen at full time; player form (last five ratings) and ▲ growth this
  season, a sortable squad list (position, rating, potential, value, age, wage, form, goals, condition).
- **Play anywhere:** installs as a PWA; **offline mode** runs the whole game in the browser (Web Worker,
  saves in IndexedDB) and starts by itself when the server is unreachable; careers move between modes.
- **Look:** dark and light themes, larger text option, mobile bottom bar. All names are fictional; Settings
  renames anything.

## Run

```bash
npm install
cp .env.example .env      # optional: set MONGODB_URI; without it saves go to ./data
npm start                 # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm start` | Build the offline engine and start the server |
| `npm run build` | Build `public/engine.worker.js` (offline engine) and vendor three.js into `public/vendor/` |
| `npm test` | Build + ESLint (`no-undef`, no `Math.random` in the engine) + all Vitest suites, including the 3-season soak |
| `npm run soak -- 10` | 10-season headless soak with a per-season world-health report |
| `SOAK_SEASONS=10 npx vitest run test/soak.test.js` | The gate soak with more seasons |

Environment: `PORT` (0 = random), `MONGODB_URI`, `SAVE_BACKEND=file` (force file saves), `SAVE_DIR`.

**Without a server:** after `npm run build`, the `public/` folder is a complete static site. Host it anywhere
(or open it from any local static server) and the game runs fully in the browser in offline mode.

## Install it like an app

Open the game in a browser and use the **📲 Install** button (welcome screen, home banner, sidebar or
Settings). Chrome, Edge and Android install it straight away; on iPhone/iPad the button explains
Safari → Share → **Add to Home Screen**. The installed app opens full screen, has its own icon, and plays
offline with the career saved on the device.

## Deploy

A server holds **one** career, so a public site must let every visitor play in their own browser.
Both options below do that; saves stay on each player's device.

| Option | How |
|---|---|
| **GitHub Pages** (included) | `.github/workflows/pages.yml` publishes `public/` on every push to `main`. One-time: repository **Settings → Pages → Source: GitHub Actions**. The game appears at `https://<user>.github.io/<repo>/`. |
| **Static site** (free tiers of Netlify, Vercel, Cloudflare Pages, GitHub Pages) | `npm install && npm run build`, publish the `public/` folder. `netlify.toml` is included. |
| **Docker** | `docker build -t the-gaffer .` then `docker run -p 3000:3000 -e GAFFER_PUBLIC=1 the-gaffer` |
| **Render.com** | `render.yaml` is included (sets `GAFFER_PUBLIC=1`). |
| **Private server** (one career, saves on the server, optional MongoDB) | `npm start`, or the Docker image without `GAFFER_PUBLIC` and with `-v gaffer-data:/app/data` |

`GAFFER_PUBLIC=1` makes the server host the app only: `/api/health` answers `public: true`, every other
endpoint answers 403, and the UI runs the offline engine. Android: the site installs from Chrome as an app
(PWA); to list it on Google Play, wrap the deployed URL with Bubblewrap / PWABuilder (Trusted Web Activity).

## Layout

```
src/
  server.js            HTTP server: static files + api.handle(); save pattern names kept
  api.js               Every endpoint, transport-free — shared by the server and the offline engine
  webEngine.js         Offline engine entry (Web Worker, IndexedDB store) → public/engine.worker.js
  saveStore.js         Mongo-first / gzip-file fallback, atomic writes, 3 auto-save generations
  index.js             GameWorld: build, weekly tick, season end, snapshot, toSave/fromSave
  migrations.js        Save-schema migrations (_v); v6 → v7 → v8 → v9
  models.js            Player, Club
  utils.js             Seedable RNG (state is saved), positions, formations, wage curve
  data/world.json      Nations, divisions, club names, continental competitions (data pack)
  engine/
    selection.js       Starting XI and bench (manual overrides, stable first XI)
    matchEngine.js     Segment-based match: xG shots, fatigue, injuries, subs, halftime, ET, pens
    developmentEngine.js  Weekly training (never lowers attributes), age decline, ageing
    financeEngine.js   Itemised weekly ledger, gate receipts, facilities, debt rule
    transferEngine.js  Valuation, AI market, incoming bids, forced sales, free-agent cap
    contractEngine.js  Renewals, final-year warnings, season-end expiry
    youthEngine.js     Intake with rating caps, promotion, wonderkids
    seasonEngine.js    Leagues, fixtures, promotion/relegation, world invariants
    competitionEngine.js  Continental competitions with group tables and knockouts
    cupEngine.js, boardEngine.js, awardsEngine.js, staffEngine.js   Cups, board and jobs, awards, staff
    scoutingEngine.js  Knowledge fog, scout assignments and reports
    negotiationEngine.js  Agents, demands, offers, counters and walk-outs
    dressingRoomEngine.js Morale, roles and promises, leaders, one-to-one and half-time talks
    internationalEngine.js National teams, Nations League, World Nations Cup, Elo, national job
    regionalEngine.js  Re-election and generated regional clubs
    newsEngine.js      The newspaper
    challengeEngine.js Weekly and season challenges, manager score, challenge codes
public/index.html      UI (two inline scripts: core screens, then next-level screens)
public/match3d.js      3D match view (three.js from public/vendor)
public/sound.js        WebAudio sound engine
public/sw.js           Service worker (offline app shell)
test/                  Vitest suites + a v6 save fixture
scripts/soak.js        Long soak report
```

## The week

`beginWeek()` → calendar → training/recovery for every club → your match's first half (pauses for
half-time decisions when the UI asks) → `finishWeek()` → second half → every other league and
continental fixture → AI market and bids for your players (window weeks) → weekly finance postings
and ledger close → news → season end after round 30. `stepWeek()` runs both halves with no input,
so the headless soak takes exactly the same path as a player.

## API

All endpoints answer `{ ok, error?, ... }`.

| Method | Route | |
|---|---|---|
| GET | `/api/state` | Snapshot (`hasCareer:false` before a career exists) |
| GET | `/api/state-hash` | SHA-256 of the canonical save state |
| GET | `/api/setup` | Countries and their **lowest-division** clubs |
| POST | `/api/reset` | New career `{country, mode: existing\|create, clubName, customClubName, seed?}`; `{challenge: 'GAF-…'}` starts a friend's exact world |
| POST | `/api/step-week` | Advance a week; `{interactive:true}` stops at your match's half-time |
| POST | `/api/match/resume` | Second half with `{tactic, formation, subs:[{offId,onId}], talk}` |
| POST | `/api/step` | Simulate the rest of the season |
| POST | `/api/tactics`, `/api/lineup`, `/api/lineup/clear` | Tactics, manual XI + bench |
| POST | `/api/transfer`, `/api/loan`, `/api/sell`, `/api/release`, `/api/list-player` | Market |
| GET / POST | `/api/loan-out/:id`, `/api/loan-out`, `/api/loan-recall` | Loan your players out (offers, agree, recall) |
| POST | `/api/bids/:id/accept`, `/api/bids/:id/reject` | Offers for your players |
| POST | `/api/renew-contract` | `{playerId, years, dryRun?}` |
| POST | `/api/upgrade`, `/api/promote-youth`, `/api/scout` | Club |
| GET/POST | `/api/second-club/options`, `/buy`, `/money`, `/upgrade`, `/sell` | Second club |
| POST | `/api/bids/:id/counter`, `/api/release {dryRun?}` | Counter a bid; release with payout preview |
| POST | `/api/jobs/accept`, `/api/jobs/decline`, `/api/jobs/apply`, `/api/course/start` | Career |
| GET/POST | `/api/staff/candidates?role=`, `/api/staff/hire`, `/api/staff/fire` | Staff |
| POST | `/api/sponsor/accept`, `/api/ticket-price`, `/api/rename` | Club and editor |
| GET/POST | `/api/player/:id`, `/api/scout/player`, `/api/scout/cancel` | Scouting (fogged profile, assignments) |
| POST | `/api/negotiate` `{playerId, fee?, wage, bonus, agentFee, years, role, releaseClause, dryRun?}` | Agent talks (sign or renew) |
| POST | `/api/talk`, `/api/team-talk`, `/api/delegate` | Dressing room, delegation |
| POST | `/api/national/accept`, `/api/national/leave`, `/api/national/squad` | National team job |
| GET | `/api/news?filter=`, `/api/leaderboard` | Newspaper, leaderboard |
| GET | `/api/saves`, `/api/history`, `/api/league`, `/api/club/:id`, `/api/export-save` | |
| POST/DELETE | `/api/saves/:slot`, `/api/load/:slot`, `/api/import-save`, `/api/autosave` | Saves |

## Saves

Auto-save after every week, every transfer/contract action, lineup/tactic edits (5 s debounce) and on
page close (`sendBeacon`). Offline, auto-saves wait until the worker is idle (1.5 s), a finished week is written
at once, and hiding or closing the tab flushes. Saves are gzipped JSON with `_v`, the RNG seed/state and id counters, so a
save/restart/load gives an identical state hash. The auto slot keeps 3 generations; a corrupt newest
save falls back to the previous one. Older saves are migrated on load and the original is kept as
`<slot>.v<N>.backup.json.gz`; saves from a newer version are refused.
