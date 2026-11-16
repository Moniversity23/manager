// src/engine/transferEngine.js — valuation, AI market, incoming bids, forced sales, free agents.
// Every fee moves through finance.post() so both clubs' ledgers explain it.

const { POS_GROUP, wageFor } = require('../utils');
const { post, spendingFrozen, DIVISION_WAGE } = require('./financeEngine');
const AW = require('./awardsEngine');

const divWage = (club) => DIVISION_WAGE[Math.min(4, Math.max(1, club.division)) - 1];

const MAX_SQUAD = 28;
const MIN_SQUAD = 18;
const FREE_AGENT_CAP = 0.03;
const MAX_PENDING_BIDS = 5;
const BID_LIFETIME_WEEKS = 2;

function playerValue(p, econ = 1) {
  const ca = p.currentAbility;
  const base = 40_000 * Math.pow(1.085, ca - 40);
  const potBonus = p.age < 24 ? base * Math.max(0, p.hiddenPotential - ca) * 0.025 : 0;
  const ageMult = p.age < 20 ? 1.3 : p.age < 24 ? 1.15 : p.age < 28 ? 1.05 : p.age < 31 ? 0.9 : p.age < 34 ? 0.65 : 0.4;
  const cy = p.contractYears ?? 2;
  const contract = cy <= 0 ? 0.5 : cy === 1 ? 0.8 : cy >= 4 ? 1.1 : 1;
  const v = (base + potBonus) * ageMult * contract * econ;
  return Math.max(10_000, Math.round(v / 1000) * 1000);
}

function groupCounts(club) {
  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const p of club.squad) if (!p.retired) counts[POS_GROUP[p.position] || 'MID']++;
  return counts;
}
const GROUP_TARGET = { GK: 2, DEF: 7, MID: 7, ATT: 5 };

function posNeed(club, position) {
  const g = POS_GROUP[position] || 'MID';
  return Math.max(0, GROUP_TARGET[g] - groupCounts(club)[g]);
}

function squadAverage(club) {
  const s = club.squad.filter(p => !p.retired);
  return s.length ? s.reduce((a, p) => a + p.currentAbility, 0) / s.length : 40;
}

// Moves a player and posts the fee to both ledgers. fromClub may be null (free agent).
function executeTransfer(world, p, fromClub, toClub, fee, kind = 'transfer') {
  if (fromClub) {
    fromClub.squad = fromClub.squad.filter(x => x.id !== p.id);
    fromClub.youth = fromClub.youth.filter(x => x.id !== p.id);
    if (fee > 0) post(fromClub, 'Transfer income', fee, `${p.name} sold to ${toClub.name}`);
  }
  if (fee > 0) post(toClub, 'Transfer spending', -fee, `${p.name} signed from ${fromClub ? fromClub.name : 'free agency'}`);
  toClub.squad.push(p);
  p.clubId = toClub.id;
  p.loan = null;
  p.listedForSale = false;
  p.wantsOut = false;
  // New contract at the buying club's level; players accept at most a 20% pay cut to move.
  const offer = Math.round(wageFor(p.currentAbility) * divWage(toClub) * (0.9 + toClub.prestige / 400));
  p.weeklyWage = Math.max(offer, Math.round(p.weeklyWage * 0.8));
  AW.recordTransfer(world, p, fromClub, toClub, fee);
  if (world.onTransfer) world.onTransfer(p, fromClub, toClub, fee);
  p.lastFee = fee;
  p.releaseClause = null;
  p.promise = null;
  p.playLog = [];
  if (kind === 'transfer' || kind === 'free') p.contractYears = Math.max(p.contractYears, world.rng.int(2, 4));
  p.history.clubs.push({ clubId: toClub.id, season: world.season });
  world.pendingBids = (world.pendingBids || []).filter(b => b.playerId !== p.id);
  if (!world.players.has(p.id)) world.players.set(p.id, p);
  return { ok: true, player: p.name, fee, from: fromClub ? fromClub.name : 'Free agent', to: toClub.name };
}

function canBuy(club, fee) {
  return !spendingFrozen(club) && club.finance.balance >= fee && club.squad.filter(p => !p.retired).length < MAX_SQUAD;
}

// One round of AI buying and selling. intensity 1 = summer market, ~0.25 = in-season window week.
function aiMarketRound(world, intensity = 1) {
  const rng = world.rng;
  const managerId = world.manager.clubId;
  const econ = world.econ || 1;
  const pool = [];

  for (const c of world.clubs) {
    if (c.id === managerId) continue;
    const active = c.squad.filter(p => !p.retired && !p.loan);
    if (active.length <= MIN_SQUAD) continue;
    const avg = squadAverage(c);
    const sorted = active.slice().sort((a, b) => a.currentAbility - b.currentAbility);
    const fringe = new Set(active.length > 22 ? sorted.slice(0, 3).map(p => p.id) : []);
    // Clubs in debt put their non-core earners on the market.
    const inDebt = c.finance.balance < 0;
    const core = new Set(sorted.slice(-14).map(p => p.id));
    for (const p of active) {
      let chance = 0;
      if (p.listedForSale || p.wantsOut) chance = 0.8;
      else if (inDebt && !core.has(p.id)) chance = 0.5;
      // Stand-outs at small clubs attract bigger ones, so talent moves up the pyramid.
      else if (p.age <= 27 && p.currentAbility >= avg + 7) { chance = 0.3; }
      else if (p.contractYears <= 1) chance = 0.25;
      else if (fringe.has(p.id)) chance = 0.4;
      else if (p.age >= 31 && p.currentAbility <= avg) chance = 0.2;
      if (chance > 0 && rng.chance(chance * intensity)) {
        const standout = p.age <= 27 && p.currentAbility >= avg + 7 && !p.listedForSale;
        pool.push({ p, seller: c, ask: Math.round(playerValue(p, econ) * (p.wantsOut ? 0.85 : standout ? 1.3 : 1)) });
      }
    }
  }
  for (const p of world.players.values()) {
    if (!p.retired && p.clubId == null) pool.push({ p, seller: null, ask: 0 });
  }
  const byGroup = { GK: [], DEF: [], MID: [], ATT: [] };
  for (const o of pool) byGroup[POS_GROUP[o.p.position] || 'MID'].push(o);
  for (const g of Object.keys(byGroup)) byGroup[g].sort((a, b) => b.p.currentAbility - a.p.currentAbility);

  const sold = new Set();
  const buyers = rng.shuffle(world.clubs.filter(c => c.id !== managerId && !spendingFrozen(c)));
  let deals = 0;
  for (const buyer of buyers) {
    if (!rng.chance(0.7 * Math.max(intensity, 0.3))) continue;
    const counts = groupCounts(buyer);
    const size = buyer.squad.filter(p => !p.retired).length;
    if (size >= MAX_SQUAD) continue;
    let group = Object.keys(GROUP_TARGET).sort((a, b) => (counts[a] - GROUP_TARGET[a]) - (counts[b] - GROUP_TARGET[b]))[0];
    const hasNeed = counts[group] < GROUP_TARGET[group];
    if (!hasNeed && (size >= 24 || !rng.chance(0.35))) continue;
    if (!hasNeed) group = rng.pick(['DEF', 'MID', 'ATT']);
    const avg = squadAverage(buyer);
    const budget = Math.max(0, buyer.finance.balance) * 0.45;
    // Wage affordability: the club's last closed week must cover the new wage, or the cash
    // buffer must cover it for a whole season.
    const last = buyer.ledger[buyer.ledger.length - 1];
    const weeklyNet = last ? last.income - last.costs : 0;
    let choice = null;
    for (const o of byGroup[group]) {
      if (sold.has(o.p.id) || (o.seller && o.seller.id === buyer.id)) continue;
      const ca = o.p.currentAbility;
      if (ca > avg + 12 || ca < avg - 3) continue;
      if (ca > buyer.prestige + 30) continue;
      const fee = o.ask;
      const signOn = o.seller ? 0 : o.p.weeklyWage * 4;
      if (fee + signOn > budget) continue;
      const wage = Math.round(wageFor(ca) * divWage(buyer));
      if (weeklyNet < wage && buyer.finance.balance < fee + signOn + wage * 30) continue;
      if (o.seller && o.seller.squad.filter(p => !p.retired).length <= MIN_SQUAD) continue;
      const domestic = o.seller ? o.seller.country === buyer.country : true;
      if (!domestic && !rng.chance(0.25)) continue;
      choice = o; break;
    }
    if (!choice) continue;
    sold.add(choice.p.id);
    if (choice.seller) executeTransfer(world, choice.p, choice.seller, buyer, choice.ask, 'transfer');
    else {
      post(buyer, 'Signing bonus', -choice.p.weeklyWage * 4, `${choice.p.name} (free agent)`);
      executeTransfer(world, choice.p, null, buyer, 0, 'free');
    }
    deals++;
  }
  return deals;
}

// AI clubs bid for the manager's players — listed ones near value, unlisted ones 30–80% over value.
function generateIncomingBids(world, week) {
  const rng = world.rng;
  const club = world.club();
  const econ = world.econ || 1;
  world.pendingBids = (world.pendingBids || []).filter(b => b.expiresWeek >= week);
  const made = [];
  const pool = [...club.squad, ...club.youth.filter(p => p.age >= 20)].filter(p => !p.retired && !p.loan);
  if (!pool.length) return made;
  const sorted = club.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility);
  const keyIds = new Set(sorted.slice(0, 3).map(p => p.id));
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].currentAbility : 0;
  for (const p of pool) {
    if (world.pendingBids.length >= MAX_PENDING_BIDS) break;
    if (world.pendingBids.some(b => b.playerId === p.id)) continue;
    let chance, lo, hi, unsolicited;
    if (p.listedForSale) { chance = 0.35; lo = 0.85; hi = 1.05; unsolicited = false; }
    else if (p.currentAbility >= median) { chance = keyIds.has(p.id) ? 0.04 : 0.025; lo = keyIds.has(p.id) ? 1.5 : 1.3; hi = 1.8; unsolicited = true; }
    else continue;
    if (!rng.chance(chance)) continue;
    const value = playerValue(p, econ);
    const fee = Math.round(value * rng.float(lo, hi) / 1000) * 1000;
    const bidders = world.clubs.filter(c => c.id !== club.id && c.id !== world.manager.ownedClubId &&
      canBuy(c, fee * 1.1) && c.prestige >= p.currentAbility - 30 && posNeed(c, p.position) > 0);
    if (!bidders.length) continue;
    bidders.sort((a, b) => b.prestige - a.prestige);
    const bidder = rng.pick(bidders.slice(0, 5));
    // A cheap release clause is simply triggered: the player goes, no negotiation.
    if (p.releaseClause && p.releaseClause <= value * 1.4 && canBuy(bidder, p.releaseClause)) {
      const clause = p.releaseClause;
      executeTransfer(world, p, club, bidder, clause, 'transfer');
      made.push({ id: `c${world.season}-${week}-${p.id}`, playerId: p.id, clubId: bidder.id, fee: clause, clause: true, playerName: p.name });
      continue;
    }
    const maxFee = Math.round(fee * rng.float(1.05, 1.3) / 1000) * 1000;
    const bid = { id: `b${world.season}-${week}-${p.id}`, playerId: p.id, clubId: bidder.id, fee, maxFee, value, unsolicited, week, expiresWeek: week + BID_LIFETIME_WEEKS };
    world.pendingBids.push(bid);
    made.push(bid);
  }
  return made;
}

function acceptBid(world, bidId) {
  const bid = (world.pendingBids || []).find(b => b.id === bidId);
  if (!bid) return { ok: false, error: 'Bid no longer available' };
  const club = world.club();
  const p = [...club.squad, ...club.youth].find(x => x.id === bid.playerId);
  const buyer = world.clubById(bid.clubId);
  if (!p || !buyer) { world.pendingBids = world.pendingBids.filter(b => b.id !== bidId); return { ok: false, error: 'Bid no longer valid' }; }
  if (!canBuy(buyer, bid.fee)) { world.pendingBids = world.pendingBids.filter(b => b.id !== bidId); return { ok: false, error: `${buyer.name} can no longer afford the fee` }; }
  return executeTransfer(world, p, club, buyer, bid.fee, 'transfer');
}

// Counter an incoming bid. Within their limit they accept and the deal is done; a little above it
// they come back with their final offer; far above it they walk away.
function counterBid(world, bidId, fee) {
  const bid = (world.pendingBids || []).find(b => b.id === bidId);
  if (!bid) return { ok: false, error: 'Bid no longer available' };
  fee = Math.round(Number(fee) || 0);
  const buyer = world.clubById(bid.clubId);
  const limit = bid.maxFee || bid.fee;
  if (fee <= bid.fee) return acceptBid(world, bidId);
  if (fee <= limit && canBuy(buyer, fee)) { bid.fee = fee; return { ...acceptBid(world, bidId), action: 'accepted' }; }
  if (fee <= limit * 1.15 && !bid.countered && canBuy(buyer, limit)) { bid.fee = limit; bid.countered = true; return { ok: false, action: 'counter', fee: limit, error: `${buyer.name} will go to ${Math.round(limit / 1000)}K and no further.` }; }
  world.pendingBids = world.pendingBids.filter(b => b.id !== bidId);
  return { ok: false, action: 'withdrawn', error: `${buyer.name} withdrew their bid.` };
}

function rejectBid(world, bidId) {
  const before = (world.pendingBids || []).length;
  world.pendingBids = (world.pendingBids || []).filter(b => b.id !== bidId);
  return { ok: world.pendingBids.length < before };
}

// "Sell to highest bidder": up to 3 AI clubs make offers from valuation; the best one is taken.
function sellToHighestBidder(world, club, p) {
  const rng = world.rng;
  const value = playerValue(p, world.econ || 1);
  const candidates = world.clubs.filter(c => c.id !== club.id && c.id !== world.manager.ownedClubId && canBuy(c, value * 0.8) && c.prestige >= p.currentAbility - 30);
  if (!candidates.length) return { ok: false, error: 'No club can afford him right now' };
  candidates.sort((a, b) => (posNeed(b, p.position) * 10 + b.prestige) - (posNeed(a, p.position) * 10 + a.prestige));
  const offers = candidates.slice(0, 3).map(c => ({ c, fee: Math.min(Math.round(value * rng.float(0.8, 1.0) / 1000) * 1000, Math.floor(c.finance.balance)) }));
  offers.sort((a, b) => b.fee - a.fee);
  const best = offers[0];
  const res = executeTransfer(world, p, club, best.c, best.fee, 'transfer');
  return { ...res, buyer: best.c.name, offers: offers.map(o => ({ club: o.c.name, fee: o.fee })) };
}

// Debt rule, stage 3: sell the most valuable players to the best bids until solvent.
function forcedSales(world, club) {
  const sales = [];
  const econ = world.econ || 1;
  let guard = 0;
  while (club.finance.balance < 0 && guard++ < 12) {
    const active = club.squad.filter(p => !p.retired && !p.loan);
    if (active.length <= 16) break;
    const keepers = active.filter(p => p.position === 'GK').length;
    const candidates = active.filter(p => !(p.position === 'GK' && keepers <= 1)).sort((a, b) => playerValue(b, econ) - playerValue(a, econ));
    let done = false;
    for (const p of candidates) {
      const fee = Math.round(playerValue(p, econ) * 0.85 / 1000) * 1000;
      const buyer = world.clubs.filter(c => c.id !== club.id && canBuy(c, fee) && c.prestige >= p.currentAbility - 30)
        .sort((a, b) => b.finance.balance - a.finance.balance)[0];
      if (!buyer) continue;
      executeTransfer(world, p, club, buyer, fee, 'transfer');
      sales.push({ player: p.name, buyer: buyer.name, fee });
      done = true;
      break;
    }
    if (!done) break;
  }
  return sales;
}

function releasePlayer(world, club, p) {
  club.squad = club.squad.filter(x => x.id !== p.id);
  club.youth = club.youth.filter(x => x.id !== p.id);
  p.clubId = null;
  p.listedForSale = false;
  p.wantsOut = false;
  p.loan = null;
  p.contractYears = 0;
  world.pendingBids = (world.pendingBids || []).filter(b => b.playerId !== p.id);
  if (!world.players.has(p.id)) world.players.set(p.id, p);
}

// Keep free agents rare: at most 3% of active players. Excess (weakest, oldest first) retire.
function enforceFreeAgentCap(world) {
  let active = 0;
  const free = [];
  for (const p of world.players.values()) {
    if (p.retired) continue;
    active++;
    if (p.clubId == null) free.push(p);
  }
  // Retiring a free agent also shrinks the active pool, so count down until the cap holds afterwards.
  let excess = 0;
  while (free.length - excess > Math.floor((active - excess) * FREE_AGENT_CAP)) excess++;
  if (!excess) return 0;
  free.sort((a, b) => (a.currentAbility - a.age) - (b.currentAbility - b.age));
  for (let i = 0; i < excess; i++) free[i].retired = true;
  return excess;
}

module.exports = {
  playerValue, posNeed, squadAverage, executeTransfer, canBuy, aiMarketRound,
  generateIncomingBids, acceptBid, rejectBid, counterBid, divWage, sellToHighestBidder, forcedSales, releasePlayer,
  enforceFreeAgentCap, MAX_SQUAD, FREE_AGENT_CAP,
};
