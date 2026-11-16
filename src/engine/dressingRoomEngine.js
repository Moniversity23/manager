// src/engine/dressingRoomEngine.js — happiness, promises, leaders and talks for the manager's squad.
//
// A player's morale (0–100) already feeds match strength. Each week the dressing room compares the
// playing time a player gets with the role he expects (or was promised), checks wage fairness, and
// lets leaders steady the group. Long unhappiness ends in a transfer request. Talks with a player
// or the whole squad move morale, depending on personality. All deterministic (no RNG).

const { clamp } = require('../utils');
const { isAvailable } = require('./selection');
const NEG = require('./negotiationEngine');

const NEED = { star: 0.7, first: 0.5, rotation: 0.25, backup: 0 };
const SENSITIVITY = { Temperamental: 1.5, Ambitious: 1.25, Lazy: 0.8, Balanced: 1, Leader: 0.9, Professional: 0.7, Determined: 0.85, 'Model Pro': 0.5 };
const LOG = 8;

function share(p) {
  const log = p.playLog || [];
  return log.length ? log.reduce((a, b) => a + b, 0) / log.length : null;
}

function roleOf(p, club) { return p.promise && p.promise.role ? p.promise.role : NEG.expectedRole(p, club); }

function captainOf(club) {
  const pool = club.squad.filter(p => !p.retired && !p.loan);
  const score = p => p.currentAbility + (p.personality === 'Leader' ? 14 : p.personality === 'Model Pro' ? 6 : 0) + Math.min(p.age, 32) * 0.6 + (p.history.appearances || 0) * 0.02;
  return pool.slice().sort((a, b) => score(b) - score(a) || a.id - b.id)[0] || null;
}

// Weekly update from this week's matches of the manager's club. Returns notable events.
function weekly(world, club, reports) {
  const events = [];
  const mine = reports.filter(r => r.myKey && r.lineups);
  const squad = club.squad.filter(p => !p.retired);
  for (const r of mine) {
    const starters = new Set(r.lineups[r.myKey].map(s => s.playerId));
    const subsOn = new Set(r.events.filter(e => e.type === 'sub' && e.side === r.myKey).map(e => e.playerId));
    for (const p of squad) {
      if (!isAvailable(p) && !starters.has(p.id)) continue;
      p.playLog = [...(p.playLog || []), starters.has(p.id) ? 1 : subsOn.has(p.id) ? 0.5 : 0].slice(-LOG);
    }
  }
  const wages = squad.map(p => ({ ovr: p.currentAbility, wage: p.weeklyWage }));
  const captain = captainOf(club);
  const leaders = squad.filter(p => p.personality === 'Leader' && p.age >= 25 && (p.playLog || []).some(v => v > 0));
  const avg = squad.length ? squad.reduce((s, p) => s + p.morale, 0) / squad.length : 60;
  for (const p of squad) {
    if (p.loan && p.loan.parentClubId === club.id) continue;
    const sens = SENSITIVITY[p.personality] || 1;
    const role = roleOf(p, club);
    const sh = share(p);
    const reasons = [];
    let delta = 0;
    if (sh != null && (p.playLog || []).length >= 4) {
      if (sh < NEED[role] - 0.15) { delta -= 2.2 * sens; reasons.push('playing time'); }
      else if (sh >= NEED[role]) delta += 0.6;
    }
    const richerWorse = wages.filter(w => w.ovr < p.currentAbility - 2 && w.wage > p.weeklyWage * 1.5).length;
    if (richerWorse >= 3) { delta -= 0.8 * sens; reasons.push('wages'); }
    if (leaders.length && p.morale < avg) delta += 0.4 * leaders.length;
    // A promise of playing time that is being broken.
    if (p.promise && !p.promise.broken && (p.playLog || []).length >= LOG && sh < NEED[p.promise.role] - 0.2 && p.promise.season === world.season) {
      p.promise.broken = true;
      delta -= 8;
      reasons.push('broken promise');
      for (const q of squad) if (q !== p) q.morale = clamp(q.morale - 1, 10, 100);
      events.push({ type: 'morale', playerId: p.id, text: `💢 ${p.name} says you broke your promise of ${NEG.ROLE_LABEL[p.promise.role].toLowerCase()} football. The squad noticed.` });
    }
    p.morale = clamp(p.morale + delta, 10, 100);
    p.unhappy = reasons.length && p.morale < 50 ? reasons : null;
    if (p.morale < 35) {
      p.unhappyWeeks = (p.unhappyWeeks || 0) + 1;
      if (p.unhappyWeeks === 4 && !p.wantsOut) {
        p.wantsOut = true;
        events.push({ type: 'contract', playerId: p.id, text: `📝 ${p.name} has handed in a transfer request (${(reasons[0] || 'unhappy')}).` });
      }
    } else if (p.morale >= 50) p.unhappyWeeks = 0;
  }
  if (captain) club.captainId = captain.id;
  return events;
}

function atmosphere(club) {
  const squad = club.squad.filter(p => !p.retired);
  const avg = squad.length ? squad.reduce((s, p) => s + p.morale, 0) / squad.length : 60;
  return { morale: Math.round(avg), label: avg >= 75 ? 'Buzzing' : avg >= 62 ? 'Good' : avg >= 50 ? 'Steady' : avg >= 38 ? 'Tense' : 'Toxic' };
}

function view(world, club) {
  const captain = club.captainId ? world.players.get(club.captainId) : captainOf(club);
  const squad = club.squad.filter(p => !p.retired);
  const rows = squad.map(p => {
    const role = roleOf(p, club);
    const sh = share(p);
    return { id: p.id, name: p.name, position: p.position, morale: Math.round(p.morale), personality: p.personality, role, roleLabel: NEG.ROLE_LABEL[role],
      share: sh == null ? null : Math.round(sh * 100), need: Math.round(NEED[role] * 100), promise: p.promise || null, unhappy: p.unhappy || null, wantsOut: !!p.wantsOut,
      talked: p.talkWeek === `${world.season}-${world.currentWeek}` };
  }).sort((a, b) => a.morale - b.morale);
  return { ...atmosphere(club), captain: captain ? { id: captain.id, name: captain.name } : null,
    leaders: squad.filter(p => p.personality === 'Leader').map(p => p.name), players: rows,
    teamTalkDone: world.flags.teamTalk === `${world.season}-${world.currentWeek}` };
}

// One-to-one talk. kind: praise | demand | promise | stay
function talk(world, club, p, kind) {
  const key = `${world.season}-${world.currentWeek}`;
  if (p.talkWeek === key) return { ok: false, error: `You already spoke to ${p.name} this week` };
  const pers = p.personality;
  const tough = ['Determined', 'Professional', 'Model Pro', 'Leader'].includes(pers);
  let delta = 0, reaction;
  if (kind === 'praise') { delta = p.morale >= 80 ? 2 : pers === 'Temperamental' ? 8 : pers === 'Lazy' ? 3 : 6; reaction = delta >= 6 ? 'is delighted' : 'appreciates it'; }
  else if (kind === 'demand') { delta = tough ? 5 : pers === 'Temperamental' ? -9 : pers === 'Lazy' ? -5 : -2; reaction = delta > 0 ? 'is fired up' : 'did not take it well'; }
  else if (kind === 'promise') {
    const cur = roleOf(p, club);
    const up = NEG.ROLES[Math.max(0, NEG.ROLES.indexOf(cur) - 1)];
    const brokenBefore = p.promise && p.promise.broken && p.promise.season === world.season;
    p.promise = { role: up, season: world.season, week: world.currentWeek, broken: false };
    p.playLog = [];
    delta = brokenBefore ? 3 : 10;
    reaction = brokenBefore ? 'does not really believe you' : `believes you (${NEG.ROLE_LABEL[up].toLowerCase()} promised)`;
  } else if (kind === 'stay') {
    if (!p.wantsOut) return { ok: false, error: `${p.name} is not asking to leave` };
    if (p.morale >= 40 || pers === 'Leader' || pers === 'Model Pro') { p.wantsOut = false; p.unhappyWeeks = 0; delta = 5; reaction = 'agrees to stay and fight for his place'; }
    else { delta = -3; reaction = 'still wants to leave'; }
  } else return { ok: false, error: 'Unknown talk' };
  p.talkWeek = key;
  p.morale = clamp(p.morale + delta, 10, 100);
  return { ok: true, player: p.name, reaction, morale: Math.round(p.morale), delta };
}

// Team talk before the week's matches. kind: motivate | calm | demand
function teamTalk(world, club, kind) {
  const key = `${world.season}-${world.currentWeek}`;
  if (world.flags.teamTalk === key) return { ok: false, error: 'You already gave a team talk this week' };
  let up = 0, down = 0;
  for (const p of club.squad.filter(x => !x.retired)) {
    const tough = ['Determined', 'Professional', 'Model Pro', 'Leader'].includes(p.personality);
    let d = 0;
    if (kind === 'motivate') d = p.personality === 'Lazy' ? 1 : 3;
    else if (kind === 'calm') d = p.morale < 50 ? 4 : 0.5;
    else if (kind === 'demand') d = tough ? 4 : p.personality === 'Temperamental' ? -4 : -1;
    else return { ok: false, error: 'Unknown team talk' };
    if (d > 0) up++; else if (d < 0) down++;
    p.morale = clamp(p.morale + d, 10, 100);
  }
  world.flags.teamTalk = key;
  return { ok: true, kind, liked: up, disliked: down, atmosphere: atmosphere(club).label };
}

// Half-time talk: changes the side's form for the second half, depending on the score.
function halftimeTalk(side, myGoals, theirGoals, kind) {
  const diff = myGoals - theirGoals;
  const table = {
    encourage: diff < 0 ? 1.03 : diff === 0 ? 1.03 : 1.01,
    demand: diff < 0 ? 1.05 : diff === 0 ? 1.02 : 0.98,
    calm: diff > 0 ? 1.03 : 1.0,
    praise: diff > 0 ? 1.02 : diff === 0 ? 1.0 : 0.97,
  };
  const f = table[kind];
  if (!f) return null;
  side.form = Math.round(side.form * f * 1e4) / 1e4;
  return { kind, effect: f > 1.015 ? 'fired up' : f < 0.995 ? 'flat' : 'focused' };
}

module.exports = { weekly, view, talk, teamTalk, halftimeTalk, atmosphere, captainOf, NEED };
