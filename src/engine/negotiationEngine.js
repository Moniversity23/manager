// src/engine/negotiationEngine.js — agents and personal terms.
//
// Every player is represented by an agent (fixed per player, derived from his id, so no RNG and no
// save state). The agent asks for a weekly wage, a signing bonus, an agent fee and a contract length,
// expects a squad role, and may want a release clause. The manager answers with an offer; the agent
// accepts, comes back once or twice with a revised demand, or walks out (talks blocked for 4 weeks).
// Everything is deterministic: the same offer in the same situation always gets the same answer.

const { clamp, hashString, wageFor } = require('../utils');
const { DIVISION_WAGE } = require('./financeEngine');

const AGENTS = [
  { name: 'Marco Benedetti', greed: 1.22, patience: 2, style: 'Hard bargainer' },
  { name: 'Ade Coker', greed: 1.08, patience: 3, style: 'Reasonable' },
  { name: 'Sofia Lindqvist', greed: 1.15, patience: 3, style: 'Shrewd' },
  { name: 'Kenji Mori', greed: 1.02, patience: 4, style: 'Patient' },
  { name: 'Dario Esposito', greed: 1.3, patience: 1, style: 'Ruthless' },
  { name: 'Grace Owusu', greed: 1.05, patience: 3, style: 'Fair' },
  { name: 'Luis Barreto', greed: 1.18, patience: 2, style: 'Demanding' },
  { name: 'Hannah Becker', greed: 1.1, patience: 3, style: 'Professional' },
  { name: 'Femi Adeleke', greed: 1.12, patience: 2, style: 'Ambitious' },
  { name: 'Pablo Rinaldi', greed: 1.25, patience: 2, style: 'Super-agent' },
  { name: 'Yuki Sato', greed: 1.0, patience: 4, style: 'Easy-going' },
  { name: 'Tom Hargreaves', greed: 1.14, patience: 3, style: 'Shrewd' },
];
const SELF = { name: 'Represents himself', greed: 1.0, patience: 3, style: 'Family adviser', self: true };

const ROLES = ['star', 'first', 'rotation', 'backup'];
const ROLE_LABEL = { star: 'Star player', first: 'First-team regular', rotation: 'Rotation', backup: 'Backup' };
const ROLE_WAGE = { star: 0.95, first: 1, rotation: 1.06, backup: 1.12 };
const PERSONALITY_WAGE = { Ambitious: 1.08, Temperamental: 1.05, Lazy: 1.03, Leader: 1.02, Balanced: 1, Professional: 0.99, Determined: 0.99, 'Model Pro': 0.97 };

function agentOf(p) {
  if (p.age <= 18) return SELF;
  return AGENTS[hashString(`agent:${p.id}`) % AGENTS.length];
}

const divWage = c => DIVISION_WAGE[clamp(c.division, 1, 4) - 1];

// The role a player expects at a club, from his rank in that squad.
// Keepers are ranked among keepers (only one plays), outfield players among outfield players.
function expectedRole(p, club) {
  const gk = p.position === 'GK';
  const peers = club.squad.filter(x => !x.retired && x.id !== p.id && (x.position === 'GK') === gk);
  const rank = peers.filter(x => x.currentAbility > p.currentAbility).length;
  if (gk) return rank === 0 ? (club.squad.filter(x => !x.retired && x.currentAbility > p.currentAbility).length < 3 ? 'star' : 'first') : 'backup';
  return rank < 3 ? 'star' : rank < 10 ? 'first' : rank < 15 ? 'rotation' : 'backup';
}

function preferredYears(p) { return p.age <= 23 ? 4 : p.age <= 29 ? 3 : p.age <= 32 ? 2 : 1; }

// What the agent asks for. kind: 'sign' (joining club) or 'renew'.
function demands(world, p, kind, club) {
  const agent = agentOf(p);
  const role = expectedRole(p, club);
  let base;
  if (kind === 'renew') {
    const raise = 1 + 0.1 + Math.max(0, p.hiddenPotential - p.currentAbility) / 200;
    base = Math.max(Math.round(p.weeklyWage * raise), Math.round(wageFor(p.currentAbility) * divWage(club)));
  } else {
    const offer = Math.round(wageFor(p.currentAbility) * divWage(club) * (0.9 + club.prestige / 400));
    base = Math.max(offer, Math.round(p.weeklyWage * (p.clubId == null ? 0.85 : 1.05)));
  }
  let wage = base * Math.sqrt(agent.greed) * (PERSONALITY_WAGE[p.personality] || 1);
  if (kind === 'renew' && p.wantsOut) wage *= 1.2;
  if (kind === 'renew' && p.morale >= 75) wage *= 0.96;
  wage = Math.round(wage / 10) * 10;
  const years = preferredYears(p);
  const bonus = Math.round((kind === 'renew' ? wage * (6 + years * 2) + p.currentAbility * 1000 : wage * (4 + years * 2)) / 100) * 100;
  const agentFee = agent.self ? 0 : Math.round(wage * (kind === 'renew' ? 5 : 9) * agent.greed / 100) * 100;
  const wantsClause = p.personality === 'Ambitious' || p.hiddenPotential >= 75 || (club.prestige < 40 && p.currentAbility >= 60);
  return { kind, wage, bonus, agentFee, years, role, wantsClause, agent: { name: agent.name, style: agent.style, patience: agent.patience } };
}

// Utility of an offer against a demand, roughly 1.0 = exactly what they asked for.
function utility(offer, d) {
  const r = (a, b, cap) => (b > 0 ? clamp(a / b, 0, cap) : 1);
  let u = 0.62 * r(offer.wage, d.wage, 1.4) + 0.14 * r(offer.bonus, d.bonus, 1.3) + 0.14 * r(offer.agentFee, d.agentFee, 1.3);
  const dy = Math.abs((offer.years || d.years) - d.years);
  u += 0.05 * (1 - Math.min(1, dy * 0.35));
  const ro = ROLES.indexOf(offer.role || d.role), rd = ROLES.indexOf(d.role);
  u += 0.05 * (ro <= rd ? 1 + 0.08 * (rd - ro) : Math.max(0, 1 - 0.45 * (ro - rd)));
  if (d.wantsClause && !offer.releaseClause) u -= 0.04;
  if (offer.releaseClause && d.wantsClause) u += 0.02;
  return u;
}

// One round of talks. state = { round, demand } kept by the caller. Returns
// { result: 'accept' | 'counter' | 'walk', demand?, utility }.
function respond(offer, state) {
  const d = state.demand;
  const u = utility(offer, d);
  if (u >= 0.985) return { result: 'accept', utility: u };
  const patience = d.agent.patience;
  if (u < 0.82 || state.round >= patience) return { result: 'walk', utility: u };
  // The agent meets the manager 40% of the way on each money term.
  const mid = (a, b) => Math.round((b + (a - b) * 0.4) / 10) * 10;
  const next = { ...d, wage: Math.max(offer.wage, mid(offer.wage, d.wage)), bonus: Math.max(offer.bonus, mid(offer.bonus, d.bonus)), agentFee: Math.max(offer.agentFee, mid(offer.agentFee, d.agentFee)) };
  return { result: 'counter', demand: next, utility: u };
}

function cleanOffer(o, d) {
  const num = (v, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : dflt; };
  return {
    wage: num(o.wage, d.wage), bonus: num(o.bonus, d.bonus), agentFee: num(o.agentFee, d.agentFee),
    years: clamp(num(o.years, d.years), 1, 5), role: ROLES.includes(o.role) ? o.role : d.role,
    releaseClause: o.releaseClause ? Math.max(0, num(o.releaseClause, 0)) : 0,
  };
}

module.exports = { agentOf, demands, utility, respond, cleanOffer, expectedRole, preferredYears, ROLES, ROLE_LABEL, ROLE_WAGE, AGENTS };
