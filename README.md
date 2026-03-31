# THE GAFFER v5

Modern football management game with Node.js backend + MongoDB.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — set your MongoDB URI
node src/server.js
# Open http://localhost:3000
```

## Requirements
- Node.js 18+
- MongoDB 6+ (local) OR MongoDB Atlas (cloud)

## Project Structure
```
gaffer_final/
├── src/
│   ├── server.js          ← Main server (API + save/load)
│   ├── index.js           ← Game engine (GameWorld, Player, Club, League)
│   ├── utils.js           ← RNG utilities
│   └── engine/
│       ├── matchEngine.js
│       ├── transferEngine.js
│       ├── youthEngine.js
│       └── financeEngine.js
├── public/
│   └── index.html         ← Complete frontend (single file)
├── data/                  ← File-based save fallback (auto-created)
├── package.json
└── .env.example
```

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/state | Full game snapshot |
| GET | /api/setup | Countries, clubs, tactics |
| POST | /api/step-week | Advance one week (auto-saves) |
| POST | /api/step | Full season simulation |
| POST | /api/reset | New game |
| POST | /api/tactics | Set tactic/formation |
| POST | /api/transfer | Buy a player |
| POST | /api/sell | Sell a player (AI buys) |
| POST | /api/release | Release player |
| POST | /api/upgrade | Upgrade facility |
| POST | /api/promote-youth | Promote from academy |
| POST | /api/scout | Scout a region ($50K) |
| POST | /api/list-player | Toggle listed for sale |
| GET | /api/league | Any league table |
| GET | /api/club/:id | Club detail + squad |
| GET | /api/saves | Save slot metadata |
| POST | /api/saves/:slot | Save to named slot |
| POST | /api/load/:slot | Load from named slot |
| DELETE | /api/saves/:slot | Delete slot |
| GET | /api/history | Career history |
| GET | /api/health | Server health |

## Save System
- **Auto-save**: After every week, saves to MongoDB (or file fallback)
- **Manual slots**: slot_1, slot_2, slot_3
- **Restore**: Automatically restores auto-save on server restart
- **File fallback**: If MongoDB unavailable, saves to `/data/*.json`

## Deploy to Railway / Render / Fly.io
1. Push to GitHub
2. Connect to Railway/Render
3. Set `MONGODB_URI` env var (MongoDB Atlas)
4. Deploy — auto-serves on port from `$PORT`

## MongoDB Atlas (Free Tier)
```
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/thegaffer
```
