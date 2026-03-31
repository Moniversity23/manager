const { rng, clamp } = require('../utils');

// How much a club needs a player of this position
function posNeed(club, position) {
  const posGroup = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', CDM: 'MID', CM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT', CF: 'ATT' };
  const group = posGroup[position] || 'MID';
  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  club.squad.filter(p => !p.retired).forEach(p => { const g = posGroup[p.position] || 'MID'; counts[g] = (counts[g] || 0) + 1; });
  const targets = { GK: 2, DEF: 6, MID: 6, ATT: 4 };
  const current = counts[group] || 0;
  const target  = targets[group] || 4;
  return Math.max(0, target - current); // higher = more need
}

function playerValue(player) {
  const ageMultiplier = player.age < 22 ? 1.6 : player.age < 26 ? 1.3 : player.age < 30 ? 1.0 : player.age < 33 ? 0.65 : 0.35;
  const potBonus = Math.max(0, (player.hiddenPotential - player.currentAbility)) * 8000;
  return Math.max(50000, Math.round((player.currentAbility * 25000 + potBonus) * ageMultiplier));
}

function runTransferMarket(clubs, season) {
  const pool = [];

  clubs.forEach(c => {
    const sorted = c.squad.filter(p => !p.retired).sort((a, b) => a.currentAbility - b.currentAbility);
    const weakLinks = sorted.slice(0, 3);
    const fringePlayers = sorted.slice(3, 5).filter(() => rng.chance(0.55));
    const agingPlayers = c.squad.filter(p => !p.retired && p.age >= 31 && rng.chance(0.28));
    const listedPlayers = c.squad.filter(p => !p.retired && p.listedForSale);

    // Sell bottom players + fringe options + contract expiries + listed players
    const forSale = [
      ...weakLinks,
      ...fringePlayers,
      ...agingPlayers,
      ...listedPlayers,
      ...c.squad.filter(p => !p.retired && p.contractYears <= 0 && !weakLinks.includes(p)),
    ].filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i); // unique

    forSale.forEach(p => {
      const saleChance =
        p.listedForSale ? 1 :
        p.contractYears <= 0 ? 0.9 :
        p.wantsOut ? 0.85 :
        p.age >= 31 ? 0.5 : 0.42;
      if (rng.chance(saleChance)) {
        pool.push({ p, seller: c, ask: playerValue(p) });
      }
    });

    // Also: players who asked to leave
    c.squad.filter(p => p.wantsOut && !p.retired).forEach(p => {
      if (!pool.find(x => x.p.id === p.id)) {
        pool.push({ p, seller: c, ask: Math.round(playerValue(p) * 0.85) });
      }
    });
  });

  pool.forEach(offer => {
    // Find suitable buyers
    const buyers = clubs.filter(c => {
      if (c.id === offer.seller.id) return false;
      if (c.finance.transferBudget < offer.ask) return false;
      const need = posNeed(c, offer.p.position);
      if (need <= 0 && !rng.chance(0.15)) return false; // unlikely to buy if no need
      if (c.squad.filter(p => !p.retired).length >= 28) return false; // squad full
      // Reputation filter: low-prestige clubs can't easily attract stars
      if (offer.p.currentAbility > 75 && c.prestige < offer.p.currentAbility - 20) return false;
      return true;
    }).sort((a, b) => (posNeed(b, offer.p.position) * 10 + b.prestige) - (posNeed(a, offer.p.position) * 10 + a.prestige));

    if (!buyers.length || !rng.chance(0.68)) return;

    const buyer = buyers[0];
    const idx = offer.seller.squad.findIndex(x => x.id === offer.p.id);
    if (idx < 0) return;

    const sold = offer.seller.squad.splice(idx, 1)[0];
    sold.clubId = buyer.id;
    sold.wantsOut = false;
    sold.contractYears = rng.int(2, 4);
    sold.history.clubs.push({ clubId: buyer.id, season: season || 2026 });

    buyer.squad.push(sold);
    buyer.finance.transferBudget -= offer.ask;
    buyer.finance.balance        -= offer.ask;

    offer.seller.finance.balance        += offer.ask;
    offer.seller.finance.transferBudget += Math.round(offer.ask * 0.4);
  });

  // Free agents: players whose contracts expired (not sold)
  clubs.forEach(c => {
    const expired = c.squad.filter(p => !p.retired && p.contractYears <= 0);
    expired.forEach(p => {
      if (rng.chance(0.5)) {
        // Leave on free transfer to random club
        const dest = rng.pick(clubs.filter(x => x.id !== c.id && x.squad.filter(q => !q.retired).length < 26));
        if (dest) {
          const idx = c.squad.findIndex(x => x.id === p.id);
          if (idx >= 0) {
            const gone = c.squad.splice(idx, 1)[0];
            gone.clubId = dest.id;
            gone.contractYears = rng.int(1, 3);
            dest.squad.push(gone);
          }
        }
      }
    });
  });
}

module.exports = { runTransferMarket, playerValue, posNeed };
