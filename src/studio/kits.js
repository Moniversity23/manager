'use strict';
// Club kits: home, away, third and goalkeeper, edited in the Player Studio's kit workshop and worn in
// matches. A club that never edited its kits has none stored (club.kits is optional) and keeps the
// colours it always had (from its club id). Kits are visual only — nothing else reads them.

const PATTERNS = ['plain', 'vertical-stripes', 'horizontal-stripes', 'yoke'];
const SLOTS = ['home', 'away', 'third'];
const HEX = /^#[0-9a-f]{6}$/i;
const BRANDS = ['Apex Logistics', 'Northwind Air', 'Bluefin Bank', 'Kora Telecom', 'Sunrise Foods', 'Vela Energy', 'Ironleaf Tools', 'Marlow Motors', 'Okapi Mobile', 'Harbourline Shipping', 'Tidewater Insurance', 'Brightpath Fintech', 'Crestway Rail', 'Pillar Cement', 'Lumen Solar', 'Granite Mutual'];

function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function clash(a, b) { const [x, y] = [rgb(a), rgb(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 110; }

// The kits a club wears when it has not designed its own (the same colours as before).
function defaults(club) {
  const h = (club.id * 137) % 360, shirt = hslHex(h, 78, 48);
  const awayH = (h + 150) % 360;
  return {
    home: { shirt, second: '#ffffff', shorts: '#f4f4f4', socks: shirt, pattern: PATTERNS[Math.round(h / 7) % 4] },
    away: { shirt: hslHex(awayH, 78, 48), second: '#1d2330', shorts: '#1d2330', socks: '#1d2330', pattern: 'plain' },
    third: { shirt: '#20242c', second: shirt, shorts: '#20242c', socks: shirt, pattern: 'plain' },
    gk: '#f2d21f',
  };
}
function kitsOf(club) { return club.kits ? { ...defaults(club), ...club.kits } : defaults(club); }

// Validates a kit edit; returns the clean kit or throws. Only colours and a known pattern.
function cleanKit(k) {
  if (!k || typeof k !== 'object') throw new Error('kit required');
  const out = {};
  for (const f of ['shirt', 'second', 'shorts', 'socks']) {
    if (k[f] == null) continue;
    if (typeof k[f] !== 'string' || !HEX.test(k[f])) throw new Error(`invalid ${f} colour`);
    out[f] = k[f].toLowerCase();
  }
  if (k.pattern != null) { if (!PATTERNS.includes(k.pattern)) throw new Error('invalid pattern'); out.pattern = k.pattern; }
  return out;
}
function setKits(club, edit) {
  const cur = kitsOf(club), next = { ...cur };
  for (const slot of SLOTS) if (edit[slot]) next[slot] = { ...cur[slot], ...cleanKit(edit[slot]) };
  if (edit.gk != null) { if (typeof edit.gk !== 'string' || !HEX.test(edit.gk)) throw new Error('invalid goalkeeper colour'); next.gk = edit.gk.toLowerCase(); }
  club.kits = { home: next.home, away: next.away, third: next.third, gk: next.gk };
  return club.kits;
}

const initials = name => String(name || '').split(/\s+/).filter(w => w && /[A-Za-z]/.test(w[0])).map(w => w[0].toUpperCase()).slice(0, 3).join('') || 'FC';
function sponsorOf(club) { return club.sponsor && club.sponsor.name ? club.sponsor.name : BRANDS[club.id % BRANDS.length]; }

// What the two teams wear in a match. Clubs with their own kits send them (the away side changes to
// its away or third kit when the colours clash); others keep the renderer's hue-based kits (null).
function forMatch(hc, ac, homeHue, awayHue) {
  if (!hc || !ac) return {};
  const hk = kitsOf(hc), ak = kitsOf(ac);
  const homeKit = hc.kits ? { ...hk.home, gk: hk.gk } : null;
  const homeShirt = hk.home.shirt;
  let awayKit = null;
  if (ac.kits) {
    const pick = !clash(ak.home.shirt, homeShirt) ? ak.home : !clash(ak.away.shirt, homeShirt) ? ak.away : ak.third;
    awayKit = { ...pick, gk: ak.gk };
  }
  const badge = (c, k, hue) => ({ sponsor: sponsorOf(c), crest: { initials: initials(c.name), c1: k ? k.shirt : hslHex(hue, 78, 48), c2: k && k.second && !clash(k.second, k.shirt) ? k.second : '#ffffff' } });
  return { kits: { home: homeKit, away: awayKit }, badges: { home: badge(hc, homeKit, homeHue), away: badge(ac, awayKit, awayHue) } };
}

module.exports = { PATTERNS, SLOTS, defaults, kitsOf, cleanKit, setKits, forMatch, initials, hslHex, clash };
