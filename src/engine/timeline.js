// src/engine/timeline.js — the authoritative match event timeline (Phase 1 of docs/GAFFER_DEVELOPMENT_ROADMAP.md).
//
// The match engine decides the result in 15-minute segments: shots, goals (with scorer and
// assister), cards, injuries and substitutions. This module turns that into a second-by-second
// timeline of football actions between the actual players on the pitch: kick-offs, possession
// spells, passes (short, long, through balls, crosses), interceptions, tackles, fouls, the build-up
// that ends with the engine's shooter (the last pass coming from the engine's assister on goals),
// saves, goal kicks, free kicks, substitutions and the whistles.
//
// Rules:
// • It only adds detail around what the engine decided; it never changes a result, a scorer or a
//   card. It uses its own RNG seeded from the match id (state kept on the match), so the main
//   world RNG and every existing result stay exactly as they were, and the same match always
//   produces the same timeline.
// • Possession is measured from the timeline's possession spells (time each side had the ball),
//   not estimated from expected goals.
// • validate() checks the timeline: ordering, players on the pitch, possession changes, shots and
//   goals against the engine's events, nobody acting after being substituted or sent off.
//
// Coordinates: x 0..1 along the pitch (home attacks towards x = 1), y 0..1 across it; t in seconds.

const { RNG, hashString, clamp } = require('../utils');

// Formation spots shared with the match views (x depth from own goal, list of y lanes).
const SLOT_POS = { GK: [0.05, [0.5]], CB: [0.2, [0.38, 0.62, 0.5]], LB: [0.25, [0.12]], RB: [0.25, [0.88]], CDM: [0.36, [0.4, 0.6]], CM: [0.46, [0.35, 0.65, 0.5]], CAM: [0.6, [0.5]], LW: [0.7, [0.14]], RW: [0.7, [0.86]], ST: [0.8, [0.42, 0.58]], CF: [0.76, [0.5]] };
const LINE = { GK: 0, CB: 1, LB: 1, RB: 1, CDM: 2, CM: 2, CAM: 3, LW: 3, RW: 3, ST: 4, CF: 4 };
const POSSESSION_TILT = { possession: 0.07, high_press: 0.03, counter: -0.05, low_block: -0.06 };
const PASS_GAP = { possession: [4, 7], high_press: [3, 6], counter: [2.5, 5], low_block: [3.5, 6.5] };   // seconds between passes
const SPELL_MEAN = { possession: 34, high_press: 24, counter: 18, low_block: 22 };
// Team instructions (matchEngine): tempo changes passing speed and how long a side keeps the ball;
// width changes who gets it.
const TEMPO_GAP = { fast: 0.8, slow: 1.22 };
const TEMPO_TILT = { slow: 0.03, fast: -0.02 };
const instrOf = (m, side) => m[side].instr || {};                      // seconds a spell lasts on average
const TYPES = ['KICKOFF', 'PASS', 'INTERCEPTION', 'TACKLE', 'FOUL', 'FREE_KICK', 'SHOT', 'GOAL', 'SAVE', 'GOAL_KICK', 'YELLOW', 'RED', 'INJURY', 'SUB', 'HALF_TIME', 'FULL_TIME', 'RECOVERY', 'THROW_IN', 'DRIBBLE'];   // new types go on the end (packed by index)
const other = s => (s === 'home' ? 'away' : 'home');

// Who is on the pitch for one side at time t (seconds), from the starting XI and the engine's events.
// A substitution or red card takes effect at the second the timeline gives it (tl.leaves), or at
// the end of its minute before the timeline has placed it.
// Called for every action, so the line-ups after each change are cached per match and side, and
// rebuilt only when the engine's events or the timeline's leaving times change. Callers must not
// modify the returned map.
const LINEUPS = new WeakMap();
function lineupAt(m, side, t) {
  const leaves = (m.tl && m.tl.leaves) || {};
  let sum = 0, n = 0; for (const k in leaves) { sum += leaves[k]; n++; }
  const sig = `${m.events.length}|${n}|${sum}`;
  let c = LINEUPS.get(m); if (!c || c.sig !== sig) { c = { sig }; LINEUPS.set(m, c); }
  let s = c[side];
  if (!s) {
    const on = new Map(m[side].startXI.map(x => [x.playerId, x.slotKey.split('-')[0]]));
    const changes = m.events.filter(e => e.side === side && (e.type === 'sub' || e.type === 'red'))
      .map(e => ({ e, at: leaves[e.type === 'sub' ? e.offId : e.playerId] ?? e.min * 60 })).sort((a, b) => a.at - b.at);
    s = c[side] = { at: changes.map(x => x.at), maps: [new Map(on)] };
    for (const { e } of changes) {
      if (e.type === 'sub') { const slot = on.get(e.offId); on.delete(e.offId); on.set(e.onId ?? e.playerId, slot || 'CM'); }
      else on.delete(e.playerId);
      s.maps.push(new Map(on));
    }
  }
  let k = 0; while (k < s.at.length && s.at[k] <= t) k++;
  return s.maps[k];                                                                   // playerId → slot
}

// Where a player stands when his side has the ball, `adv` (0..1) into the attack.
function spot(side, slot, k, adv, rng) {
  const [x0, ys] = SLOT_POS[slot] || [0.46, [0.5]];
  const y = ys[k % ys.length] + rng.float(-0.05, 0.05);
  const x = clamp(x0 + adv * (slot === 'GK' ? 0.04 : 0.28) + rng.float(-0.03, 0.03), 0.02, 0.98);
  return [side === 'home' ? x : 1 - x, clamp(y, 0.03, 0.97)];
}

// Expected share of the ball for the home side: midfield passing and vision, and the two tactics.
function possessionShare(m, ctx) {
  const mid = side => {
    let s = 0, n = 0;
    for (const sl of m[side].onPitch) { if (!['CM', 'CDM', 'CAM', 'CB'].includes(sl.slot)) continue; const p = ctx.getPlayer(sl.playerId); if (p) { s += (p.attributes.passing + p.attributes.vision) / 2; n++; } }
    return n ? s / n : 50;
  };
  const h = mid('home'), a = mid('away');
  let share = 0.5 + (h - a) / 160 + (POSSESSION_TILT[m.home.tactic] || 0) - (POSSESSION_TILT[m.away.tactic] || 0)
    + (TEMPO_TILT[instrOf(m, 'home').tempo] || 0) - (TEMPO_TILT[instrOf(m, 'away').tempo] || 0);
  if (!m.neutral) share += 0.02;
  return clamp(share, 0.3, 0.7);
}

function createState(m, ctx) {
  return { events: [], seq: 0, leaves: {}, rng: hashString(`timeline:${m.id}`), poss: 'home', holder: null, spells: [], spellStart: 0, share: possessionShare(m, ctx),
    stats: { home: { passes: 0, completed: 0, interceptions: 0, tackles: 0, fouls: 0 }, away: { passes: 0, completed: 0, interceptions: 0, tackles: 0, fouls: 0 } }, players: {} };
}

// Adds the timeline for minutes [from, to) to m.tl. Called after each half is simulated.
function extend(m, ctx, from, to) {
  const tl = m.tl || (m.tl = createState(m, ctx));
  const rng = new RNG(tl.rng);
  const T = { from: from * 60, to: to * 60 };
  const pstat = (id, k) => { const s = tl.players[id] || (tl.players[id] = { passes: 0, completed: 0, interceptions: 0, tackles: 0, fouls: 0 }); s[k] = (s[k] || 0) + 1; };
  const push = (t, type, side, pid, extra = {}) => {
    const tt = Math.max(Math.round(t * 10) / 10, tl.events.length ? tl.events[tl.events.length - 1].t : 0);   // never back in time
    const e = { id: `${m.id}#${tl.seq + 1}`, seq: ++tl.seq, t: tt, type, side, team: m[side].clubId, pid: pid ?? null, ...extra };
    tl.events.push(e);
    return e;
  };
  const players = (side, t) => [...lineupAt(m, side, t).entries()];                // [[id, slot]…]
  const slotIndex = (side, t, id) => { const list = players(side, t); const slot = list.find(x => x[0] === id)?.[1]; return [slot, list.filter(x => x[1] === slot).findIndex(x => x[0] === id)]; };
  const posOf = (side, t, id, adv) => { const [slot, k] = slotIndex(side, t, id); return spot(side, slot || 'CM', Math.max(0, k), adv, rng); };
  // Width: a wide side plays it to its wingers and full-backs more, a narrow one less.
  const widthWeight = (side, slot) => (['LW', 'RW', 'LB', 'RB'].includes(slot) ? ({ wide: 1.35, narrow: 0.7 }[instrOf(m, side).width] || 1) : 1);
  const pickReceiver = (side, t, fromId, attack) => {
    const list = players(side, t).filter(([id]) => id !== fromId);
    const fromSlot = lineupAt(m, side, t).get(fromId) || 'CM';
    return rng.weighted(list, ([, slot]) => { const d = LINE[slot] - LINE[fromSlot]; const w = d === 1 ? 4 : d === 0 ? 3 : d === 2 ? 1.6 : d === -1 ? 1.4 : 0.4; return (slot === 'GK' ? 0.15 : 1) * (attack ? (d > 0 ? w * 1.6 : w * 0.6) : w) * widthWeight(side, slot); })?.[0] ?? null;
  };
  const defenderNear = (side, t, adv) => {                                         // an opponent who could win the ball where play is
    const list = players(side, t).filter(([, s]) => s !== 'GK');
    const want = adv < 0.35 ? 4 : adv < 0.7 ? 2.5 : 1;                               // their forwards press high; their defenders defend deep
    return rng.weighted(list, ([, s]) => 1 / (0.6 + Math.abs(LINE[s] - want)))?.[0] ?? null;
  };
  const keeper = (side, t) => (players(side, t).find(([, s]) => s === 'GK') || players(side, t)[0] || [null])[0];
  const centre = (side, t) => { const list = players(side, t); return (list.find(([, s]) => s === 'ST' || s === 'CF') || list.find(([, s]) => s === 'CM') || list[0] || [null])[0]; };
  const changePossession = (t, side, holder) => {
    if (tl.poss !== side) { tl.spells.push([tl.poss, tl.spellStart, t]); tl.spellStart = t; tl.poss = side; }
    tl.holder = holder;
  };
  // One pass from the holder; `attack` biases it forward; returns the receiver (or null if lost).
  let adv = 0.2;
  const pass = (t, attack, forced = null, kindHint = null) => {
    const side = tl.poss, from = tl.holder;
    const to = forced ?? pickReceiver(side, t, from, attack);
    if (to == null) return null;
    const f = posOf(side, t, from, adv), dest = posOf(side, t, to, Math.min(1, adv + 0.12));
    const dist = Math.hypot(dest[0] - f[0], (dest[1] - f[1]) * 0.65);
    const fromSlot = lineupAt(m, side, t).get(from), toSlot = lineupAt(m, side, t).get(to);
    const kind = kindHint || (['LW', 'RW', 'LB', 'RB'].includes(fromSlot) && ['ST', 'CF'].includes(toSlot) && adv > 0.6 ? 'cross' : dist > 0.32 ? 'long' : attack && LINE[toSlot] >= 4 ? 'through' : 'short');
    tl.stats[side].passes++; tl.stats[side].completed++; pstat(from, 'passes'); pstat(from, 'completed');
    push(t, 'PASS', side, from, { tid: to, from: f, to: dest, kind, out: 'complete' });
    tl.holder = to;
    adv = Math.min(1, adv + (attack ? 0.18 : 0.07) + rng.float(-0.04, 0.06));
    return to;
  };
  // The holder loses the ball. Most possession changes in real football are not tackles or
  // interceptions: a misplaced pass picked up by an opponent, or a pass that runs out of play.
  // Split: 18% interception, 22% tackle, 32% loose/misplaced pass recovered, 28% out for a throw-in.
  // (That gives about 15 interceptions, 18 tackles and 80-88% pass accuracy a side, as in real matches.)
  const turnover = (t) => {
    const side = tl.poss, opp = other(side), from = tl.holder;
    const winner = defenderNear(opp, t, adv);
    if (winner == null || from == null) return;
    const where = posOf(side, t, from, adv);
    const r = rng.next();
    const kind = r < 0.18 ? 'interception' : r < 0.40 ? 'tackle' : r < 0.72 ? 'recovery' : 'out';
    if (kind !== 'tackle') {
      const to = pickReceiver(side, t, from, false);
      const dest = to != null ? posOf(side, t, to, adv) : where;
      const cut = [where[0] + (dest[0] - where[0]) * 0.55, where[1] + (dest[1] - where[1]) * 0.55];
      tl.stats[side].passes++; pstat(from, 'passes');
      if (kind === 'interception') {
        push(t, 'PASS', side, from, { tid: to, from: where, to: dest, kind: 'short', out: 'intercepted', by: winner });
        tl.stats[opp].interceptions++; pstat(winner, 'interceptions');
        push(t + 0.6, 'INTERCEPTION', opp, winner, { tid: from, from: cut, to: cut, rel: tl.seq });
      } else if (kind === 'recovery') {
        push(t, 'PASS', side, from, { tid: to, from: where, to: dest, kind: rng.chance(0.4) ? 'long' : 'short', out: 'lost', by: winner });
        push(t + 0.6, 'RECOVERY', opp, winner, { tid: from, from: cut, to: cut, rel: tl.seq });
      } else {
        const line = [clamp(cut[0], 0.03, 0.97), where[1] < 0.5 ? 0 : 1];
        push(t, 'PASS', side, from, { tid: to, from: where, to: line, kind: 'short', out: 'off' });
        push(t + 0.6, 'THROW_IN', opp, winner, { from: line, to: line, rel: tl.seq });
      }
    } else {
      tl.stats[opp].tackles++; pstat(winner, 'tackles');
      push(t, 'TACKLE', opp, winner, { tid: from, from: where, to: where, kind: rng.chance(0.25) ? 'sliding' : 'standing', out: 'won' });
    }
    changePossession(t + 0.6, opp, winner);
    adv = clamp(1 - adv - 0.1, 0.05, 0.6);
  };
  const DRIBBLE_SLOT = { LW: 1.8, RW: 1.8, CAM: 1.5, ST: 1.2, CF: 1.3, CM: 0.8, LB: 0.7, RB: 0.7, CDM: 0.45, CB: 0.25, GK: 0 };
  const dribble = (t, t1) => {
    const side = tl.poss, who = tl.holder;
    if (who == null || t + 4 >= t1) return false;
    const slot = lineupAt(m, side, t).get(who), p = ctx.getPlayer(who);
    if (!p || !slot) return false;
    const skill = (p.attributes.dribbling * 0.7 + p.attributes.pace * 0.3) / 70;
    if (!rng.chance(0.075 * (DRIBBLE_SLOT[slot] ?? 0.5) * skill * skill * (adv > 0.5 ? 1.4 : 0.8))) return false;
    const f = posOf(side, t, who, adv), dir = side === 'home' ? 1 : -1;
    const carry = rng.float(0.04, 0.11), to = [clamp(f[0] + dir * carry, 0.03, 0.97), clamp(f[1] + rng.float(-0.06, 0.06), 0.04, 0.96)];
    const takeOn = rng.chance(0.45);
    const beaten = takeOn ? defenderNear(other(side), t, adv) : null;
    const dur = rng.float(1.6, 3.2);
    tl.stats[side].dribbles = (tl.stats[side].dribbles || 0) + 1; pstat(who, 'dribbles');
    push(t, 'DRIBBLE', side, who, { from: f, to, kind: beaten != null ? 'take-on' : 'carry', by: beaten });
    adv = Math.min(1, adv + carry * 1.6);
    tl.lastDribbleEnd = t + dur;
    return true;
  };
  // Ordinary football between t0 and t1: passes, and the spell ending in a turnover when it runs out.
  const play = (t0, t1) => {
    let t = t0;
    let spellLeft = tl.spellLeft ?? 20;
    while (t < t1) {
      const tac = m[tl.poss].tactic, gap = PASS_GAP[tac] || [3, 6];
      t += rng.float(gap[0], gap[1]) * (TEMPO_GAP[instrOf(m, tl.poss).tempo] || 1);
      if (t >= t1) break;
      spellLeft -= t - (tl.lastT ?? t0); tl.lastT = t;
      if (tl.holder == null) changePossession(t, tl.poss, centre(tl.poss, t));
      if (spellLeft <= 0) {
        turnover(t);
        const share = tl.poss === 'home' ? tl.share : 1 - tl.share;
        spellLeft = (SPELL_MEAN[m[tl.poss].tactic] || 24) * (share / 0.5) * rng.float(0.4, 1.7);
        t += 0.6;
        continue;
      }
      // An ordinary foul on the man on the ball (no card): a free kick, and his side keeps it.
      // About 11 a side per match, more against a pressing team, as in real football.
      const opp = other(tl.poss);
      if (rng.chance(m[opp].tactic === 'high_press' ? 0.03 : 0.024) && t + 9 < t1) {
        const fouler = defenderNear(opp, t, adv), victim = tl.holder;
        if (fouler != null && victim != null) {
          const where = posOf(tl.poss, t, victim, adv);
          tl.stats[opp].fouls++; pstat(fouler, 'fouls');
          const foul = push(t, 'FOUL', opp, fouler, { tid: victim, from: where, to: where });
          t += rng.float(5, 9);
          push(t, 'FREE_KICK', tl.poss, victim, { rel: foul.seq, from: where, to: where });
          continue;
        }
      }
      // On the ball: carry it forward or take a man on instead of passing, by the player's
      // dribbling, pace and position, and where he is on the pitch (more in the final third).
      if (dribble(t, t1)) { t = tl.lastDribbleEnd; continue; }
      pass(t, adv > 0.45);
    }
    tl.spellLeft = spellLeft;
  };

  // Anchors: the engine's events in this half, at a second inside their minute.
  // Half-time substitutions (minute 45) belong to the second half.
  const inHalf = e => (e.min * 60 > T.from || (e.type === 'sub' && e.min * 60 === T.from && from > 0)) && e.min * 60 <= T.to;
  const anchors = m.events.filter(e => inHalf(e) && ['goal', 'shot', 'yellow', 'red', 'injury', 'sub'].includes(e.type))
    .map(e => ({ e, t: e.type === 'sub' ? Math.max(T.from, e.min * 60) : (e.min - 1) * 60 + rng.int(12, 55) }));
  // An injured player's replacement comes on shortly after the injury, in the same stoppage.
  for (const a of anchors) if (a.e.type === 'sub') {
    const inj = anchors.find(b => b.e.type === 'injury' && b.e.side === a.e.side && b.e.playerId === a.e.offId && b.e.min === a.e.min);
    if (inj) a.t = inj.t + 20;
  }
  // The engine settles a segment's shots before its cards and injuries, so a player can be sent off
  // or hurt earlier in the 15 minutes than a shot he takes. Here a dismissal or injury happens
  // after that player's last shot; a second yellow and its red are one incident.
  for (const a of anchors) {
    if (a.e.type === 'red' && a.e.reason === 'second yellow') {
      const y = anchors.find(b => b.e.type === 'yellow' && b.e.playerId === a.e.playerId && b.e.min === a.e.min && b.e.side === a.e.side);
      if (y) { y.second = true; a.drop = true; }
    }
  }
  for (const a of anchors) {
    if (a.drop || !(a.e.type === 'red' || a.e.type === 'injury' || (a.e.type === 'yellow' && a.second))) continue;
    const acts = anchors.filter(b => (b.e.type === 'goal' || b.e.type === 'shot') && b.e.playerId === a.e.playerId && b.e.side === a.e.side).map(b => b.t);
    const last = acts.length ? Math.max(...acts) : -1;
    if (last >= a.t - 4) a.t = last + 10;
  }
  for (const a of anchors) if (a.e.type === 'sub') {
    const inj = anchors.find(b => b.e.type === 'injury' && b.e.side === a.e.side && b.e.playerId === a.e.offId && b.e.min === a.e.min);
    if (inj) a.t = Math.max(a.t, inj.t + 20);
  }
  for (let i = anchors.length - 1; i >= 0; i--) if (anchors[i].drop) anchors.splice(i, 1);
  anchors.sort((a, b) => a.t - b.t || a.e.min - b.e.min);
  for (const a of anchors) {
    if (a.e.type === 'sub') tl.leaves[a.e.offId] = a.t;
    if (a.e.type === 'red' || (a.e.type === 'yellow' && a.second)) tl.leaves[a.e.playerId] = a.t + 2;
  }
  // Kick-off: home in the first half, away in the second (and in extra time, home again).
  const kickSide = from === 0 || from === 90 ? 'home' : from === 45 ? 'away' : 'home';
  if (from === 0 || from === 45 || from === 90) {
    const taker = centre(kickSide, T.from);
    if (tl.poss !== kickSide) changePossession(T.from, kickSide, taker); else { tl.holder = taker; tl.spellStart = tl.spellStart || T.from; }
    adv = 0.45;
    push(T.from, 'KICKOFF', kickSide, taker, { from: [0.5, 0.5], to: [0.5, 0.5] });
  }
  let t = T.from + 1;
  let lastAnchor = -1;
  for (let ai = 0; ai < anchors.length; ai++) {
    const { e, t: at0 } = anchors[ai];
    // Everything an event sets off (kick-off, free kick, goal kick) finishes before the next one.
    const next = ai + 1 < anchors.length ? anchors[ai + 1].t : T.to;
    const cap = x => Math.min(x, next - 0.6);
    const at = e.type === 'sub' ? Math.max(at0, t) : Math.max(t + 0.5, Math.min(Math.max(at0, lastAnchor + 6, t + 1), next - 1));
    lastAnchor = at;
    const side = e.side;
    if (e.type === 'goal' || e.type === 'shot') {
      // Normal play up to the build-up, then the shooting side has (or wins) the ball and works it to the shooter.
      const build = Math.min(18, Math.max(6, at - t - 2));
      play(t, at - build);
      let bt = at - build + 1;
      if (tl.poss !== side) { tl.holder = tl.holder ?? centre(tl.poss, bt); turnover(bt); bt += 1.5; }
      adv = Math.max(adv, 0.55);
      const shooter = e.playerId, assister = e.type === 'goal' ? e.assistId : null;
      const passesTo = assister != null && assister !== shooter ? [assister, shooter] : [shooter];
      // A pass or two to get there, then the final ball(s) from the assister to the scorer.
      while (bt < at - 2.5 * passesTo.length && tl.holder !== passesTo[0] && tl.events.length && rng.chance(0.7)) { pass(bt, true); bt += rng.float(1.6, 3); }
      // The final ball comes from the assister: if the scorer already has it, he lays it off first.
      if (assister != null && assister !== shooter && tl.holder === shooter) { pass(Math.max(bt, at - 3.6), false, assister, 'short'); bt = Math.max(bt, at - 3.6) + 1.2; }
      for (const target of passesTo) {
        if (tl.holder === target) continue;
        bt = Math.min(Math.max(bt, at - 2.4), at - 0.8);
        pass(bt, true, target, adv > 0.75 && rng.chance(0.3) ? 'cross' : 'through');
        bt += 1.2;
      }
      const shotFrom = posOf(side, at, shooter, 1);
      const gx = side === 'home' ? 1 : 0;
      const outcome = e.type === 'goal' ? 'goal' : e.outcome === 'saved' ? 'saved' : 'off';
      const target = [gx, outcome === 'off' ? 0.5 + (rng.chance(0.5) ? -1 : 1) * rng.float(0.07, 0.13) : 0.5 + rng.float(-0.04, 0.04)];
      const shot = push(at, 'SHOT', side, shooter, { from: shotFrom, to: target, xg: e.xg ?? null, out: outcome, kind: tl.holder === shooter && adv > 0.85 && rng.chance(0.2) ? 'header' : 'foot' });
      const opp = other(side), gk = keeper(opp, at + 1);
      if (outcome === 'goal') {
        push(at + 0.8, 'GOAL', side, shooter, { tid: assister ?? null, rel: shot.seq, from: target, to: target });
        const ko = Math.max(at + 1, cap(at + 45));
        const taker = centre(opp, ko);
        changePossession(ko, opp, taker); adv = 0.45;
        push(ko, 'KICKOFF', opp, taker, { from: [0.5, 0.5], to: [0.5, 0.5] });
        t = ko + 1;
      } else if (outcome === 'saved') {
        push(at + 0.8, 'SAVE', opp, gk, { tid: shooter, rel: shot.seq, from: target, to: target, kind: rng.chance(0.5) ? 'catch' : rng.chance(0.5) ? 'parry' : 'dive' });
        changePossession(at + 1, opp, gk); adv = 0.05;
        t = Math.max(at + 1.2, cap(at + 4));
      } else {
        const gkT = Math.max(at + 1, cap(at + 6));
        push(gkT, 'GOAL_KICK', opp, gk, { rel: shot.seq, from: [opp === 'home' ? 0.06 : 0.94, 0.5], to: [opp === 'home' ? 0.06 : 0.94, 0.5] });
        changePossession(gkT, opp, gk); adv = 0.05;
        t = Math.max(gkT + 0.5, cap(at + 9));
      }
    } else if (e.type === 'yellow' || e.type === 'red') {
      play(t, at - 1);
      const opp = other(side);
      if (tl.poss !== opp) { tl.holder = tl.holder ?? centre(tl.poss, at); }
      const victim = tl.poss === opp && tl.holder != null ? tl.holder : centre(opp, at);
      const where = posOf(opp, at, victim, adv);
      tl.stats[side].fouls++;
      const foul = push(at, 'FOUL', side, e.playerId, { tid: victim, from: where, to: where });
      const card = push(at + 1, e.type === 'red' ? 'RED' : 'YELLOW', side, e.playerId, { rel: foul.seq, reason: e.reason || null });
      if (anchors[ai].second) { push(at + 2, 'RED', side, e.playerId, { rel: card.seq, reason: 'second yellow' }); tl.leaves[e.playerId] = at + 2; }
      else if (e.type === 'red') tl.leaves[e.playerId] = at + 2;
      const fk = Math.max(at + 2.5, cap(at + 20));
      changePossession(fk, opp, victim);
      push(fk, 'FREE_KICK', opp, victim, { rel: foul.seq, from: where, to: where });
      t = fk + 0.5;
    } else if (e.type === 'injury') {
      play(t, at - 1);
      push(at, 'INJURY', side, e.playerId, { weeks: e.weeks ?? null });
      t = Math.max(at + 1, cap(at + 25));
    } else if (e.type === 'sub') {
      play(t, at - 1);
      const on = e.onId ?? e.playerId;
      push(at, 'SUB', side, on, { tid: e.offId });
      if (tl.holder === e.offId) tl.holder = on;
      t = Math.max(at + 0.5, cap(at + 8));
    }
  }
  play(t, T.to - 1);
  push(T.to, to <= 45 ? 'HALF_TIME' : 'FULL_TIME', tl.poss, null);
  tl.spells.push([tl.poss, tl.spellStart, T.to]); tl.spellStart = T.to;
  tl.rng = rng.getState();
  delete tl.lastT;
  return tl;
}

// Possession share measured from the spells: seconds each side had the ball.
function possession(m) {
  const tl = m.tl; if (!tl) return null;
  let h = 0, a = 0;
  for (const [side, t0, t1] of tl.spells) { if (side === 'home') h += t1 - t0; else a += t1 - t0; }
  return h + a > 0 ? Math.round(h / (h + a) * 100) : 50;
}

function summary(m) {
  const tl = m.tl; if (!tl) return null;
  const s = tl.stats, pct = x => (x.passes ? Math.round(x.completed / x.passes * 100) : 0);
  return { possession: possession(m), passes: [s.home.passes, s.away.passes], passAccuracy: [pct(s.home), pct(s.away)], tackles: [s.home.tackles, s.away.tackles], interceptions: [s.home.interceptions, s.away.interceptions], fouls: [s.home.fouls, s.away.fouls], dribbles: [s.home.dribbles || 0, s.away.dribbles || 0] };
}

// Checks that the timeline is a coherent football match and agrees with the engine. Returns a list of problems.
function validate(m) {
  const tl = m.tl, out = [];
  if (!tl) return ['no timeline'];
  const ev = tl.events;
  let poss = null, holder = null, last = -1;
  const gone = { home: new Set(), away: new Set() };
  const shotsBySide = { home: 0, away: 0 }, goalsBySide = { home: 0, away: 0 };
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (!TYPES.includes(e.type)) out.push(`${e.id}: unknown type ${e.type}`);
    if (e.seq !== i + 1) out.push(`${e.id}: sequence gap`);
    if (e.t < last - 0.01) out.push(`${e.id}: out of order (${e.t} < ${last})`);
    last = e.t;
    const onSide = side => lineupAt(m, side, e.t);
    if (e.pid != null && !['SUB', 'HALF_TIME', 'FULL_TIME'].includes(e.type)) {
      if (!onSide(e.side).has(e.pid) && !(e.type === 'RED' || e.type === 'YELLOW')) out.push(`${e.id}: ${e.type} by player ${e.pid} who is not on the pitch for ${e.side}`);
      if (gone[e.side].has(e.pid) && e.type !== 'RED') out.push(`${e.id}: player ${e.pid} acts after leaving`);
    }
    if (e.type === 'PASS') {
      if (poss && e.side !== poss) out.push(`${e.id}: pass by ${e.side} while ${poss} has the ball`);
      if (holder != null && e.pid !== holder) out.push(`${e.id}: pass by ${e.pid} but ${holder} has the ball`);
      if (e.out === 'complete') { if (!onSide(e.side).has(e.tid)) out.push(`${e.id}: pass to ${e.tid} who is not a team-mate on the pitch`); holder = e.tid; }
    } else if (e.type === 'DRIBBLE') {
      if (poss && e.side !== poss) out.push(`${e.id}: dribble by ${e.side} while ${poss} has the ball`);
      if (holder != null && e.pid !== holder) out.push(`${e.id}: dribble by ${e.pid} but ${holder} has the ball`);
    } else if (e.type === 'INTERCEPTION' || e.type === 'TACKLE' || e.type === 'RECOVERY') {
      if (poss && e.side === poss) out.push(`${e.id}: ${e.type} by the side already in possession`);
      poss = e.side; holder = e.pid;
    } else if (['KICKOFF', 'FREE_KICK', 'GOAL_KICK', 'SAVE', 'THROW_IN'].includes(e.type)) { poss = e.side; holder = e.pid; }
    else if (e.type === 'SHOT') {
      shotsBySide[e.side]++;
      if (poss && e.side !== poss) out.push(`${e.id}: shot by ${e.side} without the ball`);
      if (holder != null && e.pid !== holder) out.push(`${e.id}: shot by ${e.pid} but ${holder} has the ball`);
    } else if (e.type === 'GOAL') {
      goalsBySide[e.side]++;
      const prev = ev[i - 1];
      if (!prev || prev.type !== 'SHOT' || prev.pid !== e.pid || prev.out !== 'goal') out.push(`${e.id}: goal without its shot`);
    } else if (e.type === 'SUB') { gone[e.side].add(e.tid); if (holder === e.tid) holder = e.pid; }
    else if (e.type === 'RED') gone[e.side].add(e.pid);
    if (e.type === 'SUB' && e.pid != null && !onSide(e.side).has(e.pid)) out.push(`${e.id}: substitute ${e.pid} not on after his sub`);
  }
  // Agreement with the engine's own record for the minutes covered.
  const upto = ev.length ? ev[ev.length - 1].t / 60 : 0;
  for (const side of ['home', 'away']) {
    const goals = m.events.filter(e => e.type === 'goal' && e.side === side && e.min <= upto + 0.01).length;
    const shots = m.events.filter(e => (e.type === 'goal' || e.type === 'shot') && e.side === side && e.min <= upto + 0.01).length;
    if (goals !== goalsBySide[side]) out.push(`${side}: ${goalsBySide[side]} goals in the timeline, ${goals} in the match`);
    if (m.recordShots && shots !== shotsBySide[side]) out.push(`${side}: ${shotsBySide[side]} shots in the timeline, ${shots} in the match`);
  }
  const total = tl.spells.reduce((s, [, a, b]) => s + (b - a), 0);
  if (ev.length && Math.abs(total - upto * 60) > 2) out.push(`possession spells cover ${total}s of ${Math.round(upto * 60)}s`);
  return out;
}

// Compact form for sending to the match view: [t, typeIndex, side 0/1, pid, tid, fx, fy, tx, ty, outcome, kind].
const OUTS = ['', 'complete', 'intercepted', 'goal', 'saved', 'off', 'won', 'lost'];
function pack(m, fromMin = 0) {
  if (!m.tl) return null;
  const r = v => (v == null ? null : Math.round(v * 100) / 100);          // to the nearest metre or so
  return { v: 1, types: TYPES, outs: OUTS, events: m.tl.events.filter(e => e.t >= fromMin * 60).map(e => [e.t, TYPES.indexOf(e.type), e.side === 'home' ? 0 : 1, e.pid, e.tid ?? null, r(e.from && e.from[0]), r(e.from && e.from[1]), r(e.to && e.to[0]), r(e.to && e.to[1]), OUTS.indexOf(e.out || ''), e.kind || null, e.by ?? null]),
    spells: m.tl.spells.map(([s, a, b]) => [s === 'home' ? 0 : 1, a, b]), summary: summary(m), tactics: { home: m.home.tactic, away: m.away.tactic },
    instructions: { home: m.home.instr || null, away: m.away.instr || null } };
}

module.exports = { extend, possession, possessionShare, summary, validate, pack, lineupAt, SLOT_POS, TYPES };
