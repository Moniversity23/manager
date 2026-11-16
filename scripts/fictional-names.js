// Regenerates every club, league and competition name in src/data/world.json as fictional
// "<real place> <invented nickname>" names (places are not licensable; club names are), and writes
// src/data/renames.json (old → new per nation) so existing saves are renamed on load.
// Usage: node scripts/fictional-names.js   (deterministic: same output every run)
const fs = require('fs');
const path = require('path');
const { RNG, hashString } = require('../src/utils');

const FILE = path.join(__dirname, '..', 'src', 'data', 'world.json');
const RENAMES = path.join(__dirname, '..', 'src', 'data', 'renames.json');

const NATIONS = {
  England: {
    leagues: ['Premier Division', 'Championship', 'League One', 'League Two'],
    places: ['Ashford', 'Barnsdale', 'Bramley', 'Carlisle', 'Chesterton', 'Dorchester', 'Durham', 'Eastbourne', 'Falmouth', 'Gloucester', 'Grantham', 'Harrogate', 'Hereford', 'Kendal', 'Kingsbridge', 'Lancaster', 'Ludlow', 'Maidstone', 'Marlow', 'Newbury', 'Norwich', 'Penrith', 'Plymouth', 'Redditch', 'Salisbury', 'Scarborough', 'Shrewsbury', 'Stafford', 'Taunton', 'Truro', 'Wakefield', 'Whitby', 'Winchester', 'Worcester', 'York', 'Bath'],
    names: ['Crown', 'Forge', 'Harbour', 'Kings', 'Comets', 'Sentinels', 'Lanterns', 'Pilgrims', 'Ironworks', 'Vanguard', 'Brigade', 'Heralds'],
  },
  Spain: {
    leagues: ['Primera', 'Segunda', 'Tercera A', 'Tercera B'],
    places: ['Albacete', 'Alicante', 'Almería', 'Ávila', 'Badajoz', 'Burgos', 'Cáceres', 'Córdoba', 'Cuenca', 'Elche', 'Girona', 'Granada', 'Huelva', 'Jaén', 'León', 'Lleida', 'Logroño', 'Lugo', 'Málaga', 'Mérida', 'Murcia', 'Ourense', 'Palencia', 'Pamplona', 'Salamanca', 'Santander', 'Segovia', 'Soria', 'Tarragona', 'Teruel', 'Toledo', 'Valencia', 'Vigo', 'Zamora', 'Zaragoza', 'Cádiz'],
    names: ['Faro', 'Corsarios', 'Halcones', 'Olivar', 'Cometas', 'Sierra', 'Mareas', 'Centellas', 'Atalaya', 'Molinos', 'Vientos', 'Toreros'],
  },
  Germany: {
    leagues: ['Erste Liga', 'Zweite Liga', 'Dritte Liga', 'Regionalklasse'],
    places: ['Aachen', 'Augsburg', 'Bamberg', 'Bielefeld', 'Bonn', 'Bremen', 'Chemnitz', 'Cottbus', 'Darmstadt', 'Dresden', 'Erfurt', 'Essen', 'Freiburg', 'Fulda', 'Göttingen', 'Hagen', 'Halle', 'Hamburg', 'Hannover', 'Heidelberg', 'Jena', 'Kassel', 'Kiel', 'Koblenz', 'Leipzig', 'Lübeck', 'Mainz', 'Münster', 'Oldenburg', 'Potsdam', 'Regensburg', 'Rostock', 'Trier', 'Ulm', 'Würzburg', 'Zwickau'],
    names: ['Sterne', 'Falken', 'Bergleute', 'Schmiede', 'Löwen', 'Kometen', 'Turm', 'Wellen', 'Eisen', 'Funken', 'Greifen', 'Wanderer'],
  },
  Brazil: {
    leagues: ['Série A', 'Série B', 'Série C', 'Série D'],
    places: ['Aracaju', 'Belém', 'Blumenau', 'Campina', 'Campos', 'Cuiabá', 'Feira', 'Florianópolis', 'Fortaleza', 'Goiânia', 'Ilhéus', 'Itajaí', 'Joinville', 'Juiz de Fora', 'Londrina', 'Macapá', 'Maceió', 'Manaus', 'Maringá', 'Natal', 'Niterói', 'Olinda', 'Palmas', 'Pelotas', 'Petrópolis', 'Recife', 'Salvador', 'Santarém', 'Santos', 'Sorocaba', 'Teresina', 'Uberlândia', 'Vitória', 'Volta Grande', 'Caxias', 'Porto Velho'],
    names: ['Estrela', 'Trovão', 'Cometa', 'Farol', 'Leões', 'Maré', 'Ventania', 'Garra', 'Raio', 'Corsários', 'Aurora', 'Tucanos'],
  },
  Argentina: {
    leagues: ['Primera', 'Nacional', 'Federal A', 'Metropolitana'],
    places: ['Azul', 'Bahía Blanca', 'Bariloche', 'Catamarca', 'Chivilcoy', 'Comodoro', 'Concordia', 'Corrientes', 'Formosa', 'Junín', 'La Rioja', 'Luján', 'Mendoza', 'Mercedes', 'Neuquén', 'Olavarría', 'Paraná', 'Pergamino', 'Posadas', 'Rafaela', 'Resistencia', 'Río Cuarto', 'Rosario', 'Salta', 'San Juan', 'San Luis', 'Santa Rosa', 'Tandil', 'Trelew', 'Tucumán', 'Ushuaia', 'Viedma', 'Villa María', 'Zárate', 'Jujuy', 'Tigre'],
    names: ['Cóndores', 'Pampa', 'Centella', 'Andinos', 'Rayo', 'Tormenta', 'Halcones', 'Cometas', 'Fortaleza', 'Aurora', 'Pumas', 'Gauchos'],
  },
  USA: {
    leagues: ['Premier', 'Championship', 'League One', 'League Two'],
    places: ['Albany', 'Amarillo', 'Anchorage', 'Asheville', 'Billings', 'Boise', 'Buffalo', 'Charleston', 'Chattanooga', 'Des Moines', 'Duluth', 'El Paso', 'Eugene', 'Fargo', 'Fresno', 'Galveston', 'Lexington', 'Lincoln', 'Madison', 'Memphis', 'Mobile', 'Omaha', 'Provo', 'Raleigh', 'Reno', 'Richmond', 'Rochester', 'Savannah', 'Spokane', 'Syracuse', 'Tacoma', 'Toledo', 'Tucson', 'Tulsa', 'Wichita', 'Yonkers'],
    names: ['Riveters', 'Surge', 'Frontier', 'Summit', 'Pulse', 'Beacons', 'Vanguard', 'Torchbearers', 'Bolt', 'Ascent', 'Drift', 'Pioneers'],
  },
  Nigeria: {
    leagues: ['Premier', 'Division 1', 'Division 2', 'Division 3'],
    places: ['Aba', 'Abeokuta', 'Abuja', 'Ado-Ekiti', 'Akure', 'Asaba', 'Awka', 'Bauchi', 'Benin City', 'Calabar', 'Damaturu', 'Enugu', 'Gombe', 'Ibadan', 'Ijebu', 'Ilorin', 'Jos', 'Kaduna', 'Kano', 'Katsina', 'Lafia', 'Lagos', 'Lokoja', 'Makurdi', 'Minna', 'Nsukka', 'Ogbomoso', 'Onitsha', 'Osogbo', 'Owerri', 'Oyo', 'Port Harcourt', 'Sokoto', 'Umuahia', 'Uyo', 'Warri'],
    names: ['Comets', 'Gazelles', 'Kings', 'Lightning', 'Pride', 'Thunder', 'Royals', 'Hawks', 'Sentinels', 'Crocodiles', 'Lanterns', 'Torches'],
  },
  Ghana: {
    leagues: ['Premier', 'Division 1', 'Division 2', 'Division 3'],
    places: ['Accra', 'Aflao', 'Akim Oda', 'Axim', 'Bawku', 'Bolgatanga', 'Berekum', 'Cape Coast', 'Damongo', 'Dambai', 'Dormaa', 'Ejura', 'Elmina', 'Ho', 'Hohoe', 'Keta', 'Kintampo', 'Koforidua', 'Konongo', 'Kumasi', 'Mampong', 'Navrongo', 'Nkawkaw', 'Nsawam', 'Obuasi', 'Prestea', 'Salaga', 'Sefwi', 'Sekondi', 'Sunyani', 'Tamale', 'Tarkwa', 'Techiman', 'Tema', 'Wa', 'Winneba'],
    names: ['Kingsmen', 'Lanterns', 'Gazelles', 'Falcons', 'Thunder', 'Pride', 'Hawks', 'Torches', 'Royals', 'Meteors', 'Pioneers', 'Spears'],
  },
  Japan: {
    leagues: ['First Division', 'Second Division', 'Third Division', 'Fourth Division'],
    places: ['Akita', 'Aomori', 'Asahikawa', 'Chiba', 'Fukui', 'Fukuyama', 'Gifu', 'Hachioji', 'Hakodate', 'Himeji', 'Iwaki', 'Kagoshima', 'Kanazawa', 'Kochi', 'Kofu', 'Kumamoto', 'Kurashiki', 'Matsue', 'Matsuyama', 'Miyazaki', 'Morioka', 'Nagano', 'Nagasaki', 'Nara', 'Niigata', 'Oita', 'Okayama', 'Otaru', 'Saga', 'Sendai', 'Shizuoka', 'Takamatsu', 'Tottori', 'Toyama', 'Utsunomiya', 'Wakayama'],
    names: ['Blossom', 'Tide', 'Spark', 'Wings', 'Crest', 'Arrows', 'Horizon', 'Rising', 'Lantern', 'Breeze', 'Pulse', 'Comet'],
  },
  Australia: {
    leagues: ['National Premier', 'National 2', 'National 3', 'National 4'],
    places: ['Albury', 'Armidale', 'Ballarat', 'Bendigo', 'Bunbury', 'Bundaberg', 'Cairns', 'Darwin', 'Dubbo', 'Geelong', 'Geraldton', 'Gladstone', 'Hobart', 'Kalgoorlie', 'Launceston', 'Lismore', 'Mackay', 'Mandurah', 'Mildura', 'Newcastle', 'Orange', 'Perth', 'Port Lincoln', 'Rockhampton', 'Shepparton', 'Tamworth', 'Toowoomba', 'Townsville', 'Wagga', 'Warrnambool', 'Wollongong', 'Adelaide', 'Brisbane', 'Canberra', 'Broome', 'Bathurst'],
    names: ['Reef', 'Gale', 'Surf', 'Blaze', 'Rays', 'Drifters', 'Comets', 'Ironbarks', 'Wattles', 'Kookaburras', 'Saltwater', 'Southerlies'],
  },
};

const CONTINENTAL_NAMES = {
  UCL: 'European Champions Cup', LIB: 'South American Champions Cup', CAF: 'African Champions Cup',
  AFC: 'Asia-Pacific Champions Cup', CCC: 'North American Champions Cup',
};

if (fs.existsSync(RENAMES) && !process.argv.includes('--force')) {
  console.log('renames.json already exists (saves depend on it). Re-run with --force only on an original world.json.');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const renames = { clubs: {}, leagues: {}, competitions: {} };
for (const n of data.nations) {
  const spec = NATIONS[n.country];
  if (!spec) throw new Error(`No name spec for ${n.country}`);
  const rng = new RNG(hashString(`fictional|${n.country}`));
  const used = new Set();
  const perPlace = new Map();
  const make = () => {
    for (let guard = 0; guard < 500; guard++) {
      const place = rng.pick(spec.places);
      if ((perPlace.get(place) || 0) >= 2) continue;
      const name = `${place} ${rng.pick(spec.names)}`;
      if (used.has(name)) continue;
      used.add(name); perPlace.set(place, (perPlace.get(place) || 0) + 1);
      return name;
    }
    throw new Error(`Ran out of names for ${n.country}`);
  };
  renames.clubs[n.country] = {};
  renames.leagues[n.country] = {};
  n.clubs = n.clubs.map(div => div.map(old => {
    const nu = make();
    renames.clubs[n.country][old] = nu;
    return nu;
  }));
  n.leagues.forEach((old, i) => { renames.leagues[n.country][old] = spec.leagues[i]; });
  n.leagues = spec.leagues.slice(0, n.leagues.length);
  n.cup = `${n.country} National Cup`;
}
for (const c of data.continental) { renames.competitions[c.id] = CONTINENTAL_NAMES[c.id]; c.name = CONTINENTAL_NAMES[c.id]; }
data._note = 'All club, league and competition names are fictional (real place + invented nickname). Edit freely; every division needs leagueSize clubs.';
fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
fs.writeFileSync(RENAMES, JSON.stringify(renames, null, 1));
console.log('world.json and renames.json written');
