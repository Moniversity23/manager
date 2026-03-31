// server.js – The Gaffer v5 (fixed)

require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { GameWorld, TACTICS, FORMATIONS } = require("./index");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/thegaffer";
const SAVE_DIR = path.join(__dirname, "..", "data");

let db = null;
let savesCollection = null;
let leaderboardCollection = null;
let world = new GameWorld({ startCountry: "England" });

// ─── DB ─────────────────────────────────────────────────────────
async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db("thegaffer");
    savesCollection = db.collection("saves");
    leaderboardCollection = db.collection("leaderboard");
    await savesCollection.createIndex({ updatedAt: -1 });
    console.log("✓ MongoDB connected:", MONGODB_URI);
    return true;
  } catch (e) {
    console.warn("MongoDB unavailable, using file fallback:", e.message);
    return false;
  }
}

async function dbSave(slotId, gameState, meta) {
  try {
    if (savesCollection) {
      await savesCollection.updateOne(
        { _id: slotId },
        { $set: { gameState, meta, updatedAt: new Date() } },
        { upsert: true }
      );
      return true;
    }
  } catch (e) { console.error("dbSave error:", e.message); }
  // File fallback
  try {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SAVE_DIR, `${slotId}.json`),
      JSON.stringify({ gameState, meta, updatedAt: new Date().toISOString() }),
      "utf-8"
    );
    return true;
  } catch (e) { console.error("fileSave error:", e.message); return false; }
}

async function dbLoad(slotId) {
  try {
    if (savesCollection) {
      const doc = await savesCollection.findOne({ _id: slotId });
      return doc ? { gameState: doc.gameState, meta: doc.meta, updatedAt: doc.updatedAt } : null;
    }
  } catch (e) { console.error("dbLoad error:", e.message); }
  try {
    const fp = path.join(SAVE_DIR, `${slotId}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch (e) { return null; }
}

async function dbDelete(slotId) {
  try {
    if (savesCollection) await savesCollection.deleteOne({ _id: slotId });
    const fp = path.join(SAVE_DIR, `${slotId}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return true;
  } catch (e) { return false; }
}

async function dbListMeta() {
  const slots = ["auto", "slot_1", "slot_2", "slot_3"];
  const result = {};
  for (const slotId of slots) {
    try {
      if (savesCollection) {
        const doc = await savesCollection.findOne({ _id: slotId }, { projection: { meta: 1, updatedAt: 1 } });
        result[slotId] = doc ? { meta: doc.meta, updatedAt: doc.updatedAt } : null;
      } else {
        const fp = path.join(SAVE_DIR, `${slotId}.json`);
        if (fs.existsSync(fp)) {
          const d = JSON.parse(fs.readFileSync(fp, "utf-8"));
          result[slotId] = { meta: d.meta, updatedAt: d.updatedAt || null };
        } else result[slotId] = null;
      }
    } catch (e) { result[slotId] = null; }
  }
  return result;
}

// ─── STARTUP RESTORE ────────────────────────────────────────────
async function tryRestoreAutoSave() {
  try {
    const saved = await dbLoad("auto");
    if (!saved || !saved.gameState) return false;
    const restored = GameWorld.fromSave(saved.gameState);
    if (restored) {
      world = restored;
      console.log(`✓ Auto-save restored: ${world.club().name}, Season ${GameWorld.season}, Week ${world.currentWeek}`);
      return true;
    }
  } catch (e) { console.error("Auto-restore failed:", e.message); }
  return false;
}

// ─── HELPERS ────────────────────────────────────────────────────
function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function serveFile(res, filePath, type) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 5e6) reject(new Error("Too large")); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function buildMeta() {
  const snap = world.snapshot();
  return {
    club: snap.club, country: snap.country, division: snap.division,
    season: snap.seasonLabel,
    week: snap.week, position: snap.position, points: snap.points,
    reputation: snap.reputation,
    trophies: snap.trophies,
    savedAt: new Date().toISOString()
  };
}

async function autoSave() {
  try {
    const gameState = world.toSave();
    const meta = buildMeta();
    await dbSave("auto", gameState, meta);
  } catch (e) { console.error("Auto-save error:", e.message); }
}

function setManualLineup(lineupSlots) {
  world.setManualLineup(lineupSlots);
  return { ok: true };
}
function clearManualLineup() {
  world.clearManualLineup();
  return { ok: true };
}

function renewContract(playerId, years = 2) {
  const club = world.club();
  const player = club.squad.find(p => p.id === playerId && !p.retired);
  if (!player) return { ok: false, error: "Player not found" };
  const extension = Math.max(1, Math.min(4, parseInt(years, 10) || 2));
  const signingBonus = Math.round(player.weeklyWage * (8 + extension * 2) + player.currentAbility * 2500);
  if (club.finance.balance < signingBonus) return { ok: false, error: `Need $${Math.round(signingBonus / 1000)}K` };

  const currentWage = player.weeklyWage;
  const raiseFactor = 1 + extension * 0.08 + Math.max(0, player.hiddenPotential - player.currentAbility) / 180;
  player.weeklyWage = Math.round(player.weeklyWage * raiseFactor);
  player.contractYears = Math.min(5, Math.max(player.contractYears || 0, 0) + extension);
  player.wantsOut = false;
  player.morale = Math.min(100, player.morale + 8);

  club.finance.balance -= signingBonus;
  club.finance.wageBudget = Math.max(0, club.finance.wageBudget - Math.max(0, player.weeklyWage - currentWage) * 26);
  return { ok: true, player: player.name, contractYears: player.contractYears, weeklyWage: player.weeklyWage, signingBonus };
}

function getLastMatchResult() {
  const club = world.club();
  const league = world.leagues.find(l => l.clubs.some(c => c.id === club.id));
  if (!league || !league.results.length) return null;

  const last = league.results[league.results.length - 1];
  if (last.home === club.name || last.away === club.name) {
    return {
      home: last.home,
      away: last.away,
      homeGoals: last.homeGoals,
      awayGoals: last.awayGoals,
      ourClub: club.name,
      result: (last.home === club.name)
        ? (last.homeGoals > last.awayGoals ? 'W' : last.homeGoals < last.awayGoals ? 'L' : 'D')
        : (last.awayGoals > last.homeGoals ? 'W' : last.awayGoals < last.homeGoals ? 'L' : 'D')
    };
  }
  return null;
}

// ─── EXTENDED GAME ACTIONS (unchanged) ───────────────────────────
function transferPlayer(playerId, fromClubId, toClubId, fee) {
  const fromClub = world.clubs.find(c => c.id === fromClubId);
  const toClub = world.clubs.find(c => c.id === toClubId);
  if (!fromClub || !toClub) return { ok: false, error: "Club not found" };
  const playerIdx = fromClub.squad.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return { ok: false, error: "Player not in squad" };
  const player = fromClub.squad[playerIdx];
  if (toClub.finance.transferBudget < fee) return { ok: false, error: "Insufficient transfer budget" };
  fromClub.squad.splice(playerIdx, 1);
  player.clubId = toClubId;
  toClub.squad.push(player);
  toClub.finance.transferBudget -= fee;
  toClub.finance.balance -= fee;
  fromClub.finance.balance += fee;
  player.history.clubs.push({ clubId: toClubId, season: GameWorld.season });
  world.players.set(player.id, player);
  return { ok: true, player: player.name };
}

function getFacilityUpgradeCost(level) {
  const costs = [0, 500000, 1200000, 2500000, 5000000, 10000000];
  return costs[Math.min(level, costs.length - 1)] || 10000000;
}

function upgradeFacility(clubId, facilityType) {
  const club = world.clubs.find(c => c.id === clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const validTypes = ["training", "youth", "medical", "stadium"];
  if (!validTypes.includes(facilityType)) return { ok: false, error: "Invalid facility" };
  const currentLevel = club.facilities[facilityType];
  if (currentLevel >= 5) return { ok: false, error: "Already at max level" };
  const cost = getFacilityUpgradeCost(currentLevel);
  if (club.finance.balance < cost) return { ok: false, error: `Need $${Math.round(cost / 1000)}K` };
  club.finance.balance -= cost;
  club.facilities[facilityType] = currentLevel + 1;
  return { ok: true, newLevel: club.facilities[facilityType], cost };
}

function promoteYouthPlayer(clubId, playerId) {
  const club = world.clubs.find(c => c.id === clubId);
  if (!club) return { ok: false, error: "Club not found" };
  const idx = club.youth.findIndex(p => p.id === playerId);
  if (idx === -1) return { ok: false, error: "Player not in youth" };
  const player = club.youth.splice(idx, 1)[0];
  club.squad.push(player);
  return { ok: true, player: player.name };
}

function setTactics(decisions) {
  world.applyManagerDecisions(decisions);
  return { ok: true };
}

function getLeagueTable(country, leagueName) {
  const lg = world.leagues.find(l => l.country === country && l.name === leagueName);
  if (!lg || !lg.table.length) return [];
  return [...lg.table].sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga)).map((r, i) => ({
    pos: i + 1, club: r.club.name, pts: r.points, gd: r.gf - r.ga,
    w: r.wins, d: r.draws, l: r.losses, gf: r.gf, ga: r.ga,
    played: r.wins + r.draws + r.losses
  }));
}

function getClubSquad(clubId) {
  const club = world.clubs.find(c => c.id === clubId);
  if (!club) return null;
  return {
    name: club.name, country: club.country, division: club.division,
    prestige: club.prestige, finance: club.finance, facilities: club.facilities,
    squad: club.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility).map(p => ({
      id: p.id, name: p.name, age: p.age, ovr: p.currentAbility, pot: p.hiddenPotential,
      fit: p.fitness, mor: p.morale, pers: p.personality, contractYears: p.contractYears,
      goals: p.history.goals, apps: p.history.appearances, nation: p.nation, attrs: p.attributes
    }))
  };
}

// ─── SERVER ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  const publicDir = path.join(__dirname, "..", "public");

  // ── Static Files ──────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/") {
    return serveFile(res, path.join(__dirname, "..", "public", "index.html"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/app.js") {
    return serveFile(res, path.join(publicDir, "app.js"), "application/javascript; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/styles.css") {
    return serveFile(res, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
  }

  // ── Health ────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, db: db ? "connected" : "file-fallback", time: new Date().toISOString() });
  }

  // ── Game State (now uses world.snapshot) ──────────────────────
  if (req.method === "GET" && url.pathname === "/api/state") {
    try {
      return json(res, 200, world.snapshot());
    } catch (e) {
      console.error("Snapshot error:", e);
      return json(res, 500, { ok: false, error: "Internal server error" });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/export-save") {
    return json(res, 200, { ok: true, gameState: world.toSave(), meta: buildMeta() });
  }

  if (req.method === "POST" && url.pathname === "/api/import-save") {
    try {
      const body = await parseBody(req);
      if (!body?.gameState) return json(res, 400, { ok: false, error: "gameState required" });
      const restored = GameWorld.fromSave(body.gameState);
      if (!restored) return json(res, 400, { ok: false, error: "restore_failed" });
      world = restored;
      autoSave().catch(() => {});
      return json(res, 200, { ok: true, ...world.snapshot() });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  // ── Setup Data ────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/setup") {
    const countries = GameWorld.availableCountries().sort();
    const clubsByCountry = {};
    countries.forEach(country => { clubsByCountry[country] = world.countryTopClubs(country); });
    return json(res, 200, { ok: true, defaultCountry: "Nigeria", countries, clubsByCountry, tactics: TACTICS, formations: FORMATIONS });
  }

  // ── Save Slots Metadata ───────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/saves") {
    const meta = await dbListMeta();
    return json(res, 200, { ok: true, slots: meta });
  }

  // ── Save to Named Slot ────────────────────────────────────────
  if (req.method === "POST" && url.pathname.startsWith("/api/saves/")) {
    const slotId = url.pathname.split("/").pop();
    if (!["slot_1", "slot_2", "slot_3"].includes(slotId)) return json(res, 400, { ok: false, error: "invalid_slot" });
    const gameState = world.toSave();
    const meta = buildMeta();
    await dbSave(slotId, gameState, meta);
    return json(res, 200, { ok: true, meta });
  }

  // ── Load from Slot ────────────────────────────────────────────
  if (req.method === "POST" && url.pathname.startsWith("/api/load/")) {
    const slotId = url.pathname.split("/").pop();
    if (!["auto", "slot_1", "slot_2", "slot_3"].includes(slotId)) return json(res, 400, { ok: false, error: "invalid_slot" });
    const saved = await dbLoad(slotId);
    if (!saved || !saved.gameState) return json(res, 404, { ok: false, error: "no_save_found" });
    const restored = GameWorld.fromSave(saved.gameState);
    if (!restored) return json(res, 400, { ok: false, error: "restore_failed" });
    world = restored;
    return json(res, 200, { ok: true, ...world.snapshot() });
  }

  // ── Delete Slot ───────────────────────────────────────────────
  if (req.method === "DELETE" && url.pathname.startsWith("/api/saves/")) {
    const slotId = url.pathname.split("/").pop();
    await dbDelete(slotId);
    return json(res, 200, { ok: true });
  }

  // ── Advance One Week ──────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/step-week") {
    try {
      const body = await parseBody(req);
      const out = world.stepWeek({ tactic: body.tactic, formation: body.formation, trainingFocus: body.trainingFocus, trainingIntensity: body.trainingIntensity });
      autoSave().catch(() => {});
      const matchResult = getLastMatchResult();
      return json(res, 200, { ok: true, out, current: world.snapshot(), matchResult });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Full Season Sim ───────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/step") {
    try {
      const body = await parseBody(req);
      const summary = world.stepSeason({ tactic: body.tactic, formation: body.formation, trainingFocus: body.trainingFocus, trainingIntensity: body.trainingIntensity });
      autoSave().catch(() => {});
      return json(res, 200, { ok: true, summary, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── New Game / Reset ──────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/reset") {
    try {
      const body = await parseBody(req);
      world = new GameWorld({
        startCountry: body.country || "Nigeria",
        mode: body.mode,
        startClubName: body.mode === "existing" ? body.clubName : undefined,
        customClubName: body.mode === "create" ? body.customClubName : undefined,
      });
      autoSave().catch(() => {});
      return json(res, 200, { ok: true, ...world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Set Tactics ───────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/tactics") {
    try {
      const body = await parseBody(req);
      setTactics(body);
      return json(res, 200, { ok: true, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── MANUAL LINEUP ENDPOINTS ───────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/lineup") {
    try {
      const body = await parseBody(req);
      const result = setManualLineup(body.lineup || []);
      if (result.ok) autoSave().catch(() => {});
      return json(res, 200, { ok: true, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (req.method === "POST" && url.pathname === "/api/lineup/clear") {
    try {
      const result = clearManualLineup();
      if (result.ok) autoSave().catch(() => {});
      return json(res, 200, { ok: true, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Transfer Player ───────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/transfer") {
    try {
      const body = await parseBody(req);
      const { playerId, fromClubId, fee } = body;
      const myClub = world.club();
      const result = transferPlayer(playerId, fromClubId, myClub.id, fee || 0);
      if (result.ok) autoSave().catch(() => {});
      return json(res, result.ok ? 200 : 400, { ...result, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Release Player ────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/release") {
    try {
      const body = await parseBody(req);
      const myClub = world.club();
      const idx = myClub.squad.findIndex(p => p.id === body.playerId);
      if (idx === -1) return json(res, 404, { ok: false, error: "Player not found" });
      const player = myClub.squad.splice(idx, 1)[0];
      player.clubId = null;
      world.players.set(player.id, player);
      autoSave().catch(() => {});
      return json(res, 200, { ok: true, player: player.name, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Sell Player (AI bid) ──────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/sell") {
    try {
      const body = await parseBody(req);
      const myClub = world.club();
      const { playerId } = body;
      const player = myClub.squad.find(p => p.id === playerId);
      if (!player) return json(res, 404, { ok: false, error: "Player not found" });
      const buyers = world.clubs.filter(c => c.id !== myClub.id && c.finance.transferBudget > player.currentAbility * 15000);
      if (!buyers.length) return json(res, 400, { ok: false, error: "No interested clubs" });
      buyers.sort((a, b) => b.prestige - a.prestige);
      const buyer = buyers[0];
      const fee = Math.round(player.currentAbility * 20000 + Math.random() * player.currentAbility * 10000);
      const result = transferPlayer(playerId, myClub.id, buyer.id, fee);
      myClub.finance.balance += fee;
      autoSave().catch(() => {});
      return json(res, 200, { ok: true, player: player.name, buyer: buyer.name, fee, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Upgrade Facility ──────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/upgrade") {
    try {
      const body = await parseBody(req);
      const myClub = world.club();
      const result = upgradeFacility(myClub.id, body.facility);
      if (result.ok) autoSave().catch(() => {});
      return json(res, result.ok ? 200 : 400, { ...result, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Promote Youth ─────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/promote-youth") {
    try {
      const body = await parseBody(req);
      const myClub = world.club();
      const result = promoteYouthPlayer(myClub.id, body.playerId);
      if (result.ok) autoSave().catch(() => {});
      return json(res, result.ok ? 200 : 400, { ...result, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/renew-contract") {
    try {
      const body = await parseBody(req);
      const result = renewContract(body.playerId, body.years);
      if (result.ok) autoSave().catch(() => {});
      return json(res, result.ok ? 200 : 400, { ...result, current: world.snapshot() });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── List Player for Sale ──────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/list-player") {
    try {
      const body = await parseBody(req);
      const myClub = world.club();
      const player = myClub.squad.find(p => p.id === body.playerId);
      if (!player) return json(res, 404, { ok: false, error: "Not found" });
      player.listedForSale = !player.listedForSale;
      return json(res, 200, { ok: true, listed: player.listedForSale, player: player.name });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Scout Region ──────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/scout") {
    try {
      const body = await parseBody(req);
      const myClub = world.club();
      const cost = 50000;
      if (myClub.finance.balance < cost) return json(res, 400, { ok: false, error: "Need $50K for scouting" });
      myClub.finance.balance -= cost;
      const regions = {
        "West Africa": ["Nigeria"],
        "East Africa": ["Kenya", "Ethiopia"],
        "South America": ["Brazil", "Argentina"],
        "Eastern Europe": ["Poland", "Czech"],
        "Western Europe": ["England", "Spain", "Germany"],
        "Japan/Korea": ["Japan"],
        "North America": ["USA"]
      };
      const targetCountries = regions[body.region] || ["Nigeria"];
      const found = [];
      world.clubs.forEach(cl => {
        if (!targetCountries.includes(cl.country)) return;
        cl.squad.filter(p => !p.retired && p.age <= 21 && p.currentAbility > 50).forEach(p => {
          found.push({ id: p.id, name: p.name, age: p.age, ovr: p.currentAbility, pot: p.hiddenPotential, club: cl.name, clubId: cl.id, nation: p.nation, pers: p.personality, hint: p.hint() });
        });
      });
      found.sort((a, b) => b.pot - a.pot);
      return json(res, 200, { ok: true, players: found.slice(0, 8), region: body.region });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ── Get Any League Table ──────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/league") {
    const country = url.searchParams.get("country");
    const name = url.searchParams.get("name");
    if (!country || !name) return json(res, 400, { ok: false, error: "country and name required" });
    const table = getLeagueTable(country, name);
    return json(res, 200, { ok: true, table });
  }

  // ── Get Club Detail ───────────────────────────────────────────
  if (req.method === "GET" && url.pathname.startsWith("/api/club/")) {
    const clubId = parseInt(url.pathname.split("/").pop());
    const data = getClubSquad(clubId);
    if (!data) return json(res, 404, { ok: false, error: "Club not found" });
    return json(res, 200, { ok: true, ...data });
  }

  // ── History ───────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/history") {
    const limit = parseInt(url.searchParams.get("limit") || "10");
    return json(res, 200, { ok: true, ...world.historySnapshot(limit) });
  }

  // ── Leaderboard ───────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    try {
      if (leaderboardCollection) {
        const entries = await leaderboardCollection.find({}).sort({ trophies: -1, reputation: -1 }).limit(20).toArray();
        return json(res, 200, { ok: true, entries });
      }
      return json(res, 200, { ok: true, entries: [] });
    } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/leaderboard") {
    try {
      const body = await parseBody(req);
      if (leaderboardCollection) {
        await leaderboardCollection.updateOne({ sessionId: body.sessionId }, { $set: { ...body, postedAt: new Date() } }, { upsert: true });
      }
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }

  res.writeHead(404); res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

// ─── BOOT ───────────────────────────────────────────────────────
(async () => {
  await connectDB();
  await tryRestoreAutoSave();
  server.listen(PORT, () => console.log(`\n🏟  The Gaffer v5 running at http://localhost:${PORT}\n   Auto-save: every week  |  Slots: auto, slot_1, slot_2, slot_3`));
})();
