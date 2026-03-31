const { simulateMatch, knockout, squadStrength } = require('./engine/matchEngine');
const { runTransferMarket, playerValue }          = require('./engine/transferEngine');
const { generateYouthPlayers, promoteYouth, generateWonderkids } = require('./engine/youthEngine');
const { updateClubFinances, upgradeFacilities }   = require('./engine/financeEngine');
const { weeklyDevelopment, seasonDevelop, getExpiringContracts } = require('./engine/developmentEngine');
const { rng, clamp, POS_ALL, POS_ATTRS, FORMATION_SLOTS, selectBestXI, positionAbility } = require('./utils');

// ─── CONFIG ───────────────────────────────────────────────────────
const CFG = {
  startSeason:  2026,
  careerSeasons: 25,
  promoPerDiv:   3,    // clubs promoted each season
  relegPerDiv:   3,    // clubs relegated each season
  youthIntake:  [1, 3],
  wonderkids:   [8, 14],
  leagueSize:   15,    // 15 clubs per league
};

const PERSONALITY  = ['Professional','Ambitious','Lazy','Leader','Temperamental','Balanced','Determined','Model Pro'];
const TACTICS      = ['high_press','counter','possession','low_block'];
const FORMATIONS   = ['4-3-3','4-2-3-1','4-4-2','3-5-2','5-3-2','4-1-4-1'];
const TRAINING_FOCUS = ['technical','physical','tactical','mental','balanced'];

// ─── WORLD DATA (15 clubs per league = CFG.leagueSize) ───────────
const WORLD = {
  Europe: [
    { country:'England', leagues:['Premier','Championship','League One','League Two'], clubs:[
      ['London Crown','Manchester Union','Merseyside Kings','Northbridge FC','Birmingham Steel','Leeds Borough','Brighton Coast','Newcastle Forge','Bristol Albion','Southport City','Coventry Core','Crystal Palace','Brentford United','Nottingham Forest','Fulham Rise'],
      ['Derby Town','Blackpool Athletic','Norwich Gate','Hull Mariners','Sunderland Red','Stoke Rivers','Sheffield Metro','Reading Royals','Middlesborough','Cardiff Harbor','Ipswich Town','Burnley','West Brom','Preston North','Swansea'],
      ['Portsmouth Dock','Plymouth Green','Oxford Scholars','Cambridge Utd','Bolton Strikers','Wigan Vale','Luton Park','Watford Vale','Lincoln City','Swindon Town','MK Dons','Peterborough','Cheltenham','Exeter City','Shrewsbury'],
      ['Charlton Gate','Milton Rovers','Bradford Bulls','Rochdale Rise','Tranmere Bay','Salford Peak','Crewe Motion','Forest Green','Barnet','Grimsby Town','Colchester','Crawley','Sutton Utd','Newport','Accrington'],
    ]},
    { country:'Spain', leagues:['Primera','Segunda','RFE1','RFE2'], clubs:[
      ['Madrid Blanco','Catalonia Blau','Sevilla Sol','Valencia Stars','Bilbao Iron','Atletico Capital','Real Coast','Vigo Wave','Mallorca Sun','Girona Pulse','Celta Vigo','Sociedad Real','Villarreal','Alaves','Osasuna'],
      ['Zaragoza Lions','Granada Red','Almeria South','Oviedo North','Santander Wind','Malaga Bay','Cordoba Town','Murcia Lake','Tenerife Sky','Huesca Peak','Cartagena','Valladolid','Cadiz','Mirandes','Ponferradina'],
      ['Ferrol Union','Sabadell Point','Lugo Rail','Castellon Orange','Leon Fighters','Toledo Forge','Badajoz Stone','Ibiza Breeze','Jaen Force','Alcoyano','Merida City','Burgos','San Roque','Ceuta','Linense'],
      ['Celta B','Racing B','Getafe B','Leganes B','Eibar B','Numancia','Sociedad B','Osasuna B','Huesca B','Pontevedra','Arenteiro','Zamora','Salmantino','Cacereno','Talavera'],
    ]},
    { country:'Germany', leagues:['Bundesliga','2.Bundesliga','3.Liga','Regionalliga'], clubs:[
      ['Bayern Munich','Dortmund United','RB Leipzig','Leverkusen','Frankfurt Stars','Wolfsburg City','Union Berlin','Gladbach','Freiburg','Hoffenheim','Werder Bremen','Stuttgart','Mainz','Augsburg','Bochum'],
      ['Kaiserslautern','Schalke Blue','Hansa Rostock','Darmstadt','Hamburg Sport','Hannover 96','Paderborn','Greuther Furth','Braunschweig','Wiesbaden','Elversberg','Osnabruck','Magdeburg','Nurnberg','Hertha Berlin'],
      ['Ingolstadt','Wehen','Munich 1860','Preussen Munster','Dynamo Dresden','Halle','Rot-Weiss Essen','VfL Osnabruck','Sandhausen','Unterhaching','Saarbrucken','Lubeck','Waldhof Mannheim','Cottbus','Mannheim'],
      ['Alemannia Aachen','Rot-Weiss Koblenz','TuS Koblenz','FC Homburg','Wormatia Worms','SF Lotte','Viktoria Koln','Teutonia Hamburg','Gladbacher BC','Alemannia Worms','West Oldenburg','Hildesheim','FC Duren','Bonner SC','VfR Aalen'],
    ]},
  ],
  'South America': [
    { country:'Brazil', leagues:['Serie A','Serie B','Serie C','Serie D'], clubs:[
      ['Rio Samba','Sao Capital','Belo Horizonte','Porto Alegre','Recife Power','Curitiba Green','Fortaleza Sun','Bahia Storm','Manaus River','Goias Central','Flamengo','Vasco da Gama','Botafogo','Fluminense','Cruzeiro'],
      ['Campinas Gold','Natal Wave','Santos Harbor','Florianopolis Blue','Londrina Core','Para Fire','Cuiaba North','Maceio Rise','Vitoria Reds','Joinville AC','Atletico Mineiro','Sport Recife','Santa Cruz','Nautico','Cebolinha'],
      ['Sao Jose','Volta Redonda','Juazeiro','Marilia','Ponte Nova','Ribeirao','Pelotas','Sergipe','Acre Utd','Rondonia','Paciencia','Luverdense','Goiania','Anapolis','Tocantinopolis'],
      ['Iguacu','Parana East','Mato Pro','Piaui FC','Amapa','Roraima','Rondon Vale','Belem Tide','Amazonia FC','Rio Branco','Porto Velho','Boa Vista','Macapa Hearts','Palmas FC','Ji-Parana'],
    ]},
    { country:'Argentina', leagues:['Primera','Nacional','Federal A','Metro'], clubs:[
      ['Buenos Fire','Rosario Light','Cordoba River','Mendoza Vine','La Plata Gold','San Juan Steel','Tucuman Heat','Mar del Plata','Santa Fe North','Patagonia South','River Plate','Boca Juniors','Racing Club','Independiente','Estudiantes'],
      ['Quilmes Park','Belgrano Wave','Chaco Pride','Salta Peaks','Jujuy Utd','Rafaela Sun','Neuquen Ice','Formosa Green','Misiones Red','Catamarca Stone','Tigre United','Velez Sarsfield','Arsenal Sarandi','Banfield','Lanus'],
      ['Lanus B','Banfield B','Tigre B','Almagro','Chacarita','Temperley','Sarmiento','All Boys','Moron','Platense B','San Martin','Los Andes','Argentinos Jr','Atlanta','Villa Dalmine'],
      ['Dock Sud','Ituzaingo','San Miguel','Flandria','Comunicaciones','Laferrere','Merlo','Victoriano','Armenio','Caballito','Villa Urquiza','Flores','Mataderos','Ramos','Sacachispas'],
    ]},
  ],
  'North America': [
    { country:'USA', leagues:['Premier','Championship','League One','League Two'], clubs:[
      ['New York Empire','Los Angeles Stars','Miami Tide','Seattle Rain','Chicago Forge','Dallas Bulls','Houston Heat','Atlanta Metro','Boston Harbor','Denver Peaks','New England Rev','Philadelphia Union','San Jose Quakes','DC United','Toronto FC'],
      ['Austin Wolves','Phoenix Desert','Portland Pines','Charlotte Crown','Orlando Pulse','San Diego Coast','Nashville Sound','Kansas City Blue','Salt Lake Gold','Columbus Crew','Cincinnati FC','Houston Dynamo','LA Galaxy II','Vancouver WC','Montreal Impact'],
      ['Tampa Bay Rtd','Louisville City','Sacramento Rep','San Antonio FC','Detroit City','Oakland Roots','Memphis 901','Las Vegas Lights','Pittsburgh River','El Paso Locos','Austin Bold','Phoenix Rising','Albuquerque','Rhode Island','Hartford Athl'],
      ['Tulsa Rough','Indy Eleven','Monterey Bay','Birmingham Legion','Reno 1868','Chattanooga','Richmond Kickers','OKC Energy','Tacoma Defiance','Greenville Tri','South Georgia','Union Omaha','Detroit City II','FC Tucson','Loudoun Utd'],
    ]},
  ],
  Africa: [
    { country:'Nigeria', leagues:['Premier','Division 1','Division 2','Division 3'], clubs:[
      ['Lagos Harbor FC','Abuja Eagles','Kano Warriors','Enugu Rangers','Port Harcourt Oilers','Ibadan City','Benin Bronze','Kaduna Forge','Owerri Stars','Jos Plateau','Warri Wolves','Akure City','Ilorin United','Oyo State','Uyo City'],
      ['Uyo Storm','Calabar Coast','Abeokuta Utd','Ilorin Royals','Maiduguri North','Yola Frontier','Akure Waves','Warri Steel','Nsukka Scholars','Lokoja Rivers','Makurdi United','Bauchi Tigers','Sokoto United','Zaria Lions','Gombe Stars'],
      ['Makurdi Bulls','Bauchi Bridge','Sokoto Desert','Ado Ekiti','Asaba Gold','Onitsha Market','Osogbo Athletic','Minna Utd','Jalingo Tigers','Iseyin City','Ogbomoso','Shagamu','Ijebu Utd','Abeokuta City','Keffi Town'],
      ['Ikom Green','Yenagoa Blue','Abakaliki','Gombe Metro','Damaturu','Birnin Kebbi','Lafia Rovers','Umuahia','Awka United','Uzezi FC','Ukiriya','Aba Rangers','Asaba Lions','Benin City II','Calabar United'],
    ]},
    { country:'Ghana', leagues:['Premier','Division 1','Division 2','Division 3'], clubs:[
      ['Asante Kotoko','Hearts of Oak','Medeama SC','Aduana Stars','Dreams FC','Berekum Chelsea','Ashantigold','Legon Cities','Bechem United','WAFA','Karela United','RTU','Accra Lions','Bibiani Gold Stars','Nations FC'],
      ['Young Apostles','Nsoatreman','Phar Rangers','Wa All Stars','Tamale City','Bofoakwa Tano','Ebusua Dwarfs','Real Tamale','Inter Allies','Gold Stars','Accra Hearts II','Kotoko II','Great Olympics','Hasaacas','Bibiani United'],
      ['Mighty Royals','Cape Coast Academicals','Wa All Stars II','Skyy FC','Eleven Wonders','Bassike FC','Tema Youth','Nkoranza Warriors','Techiman Eleven Wonders','Tema FC','Tudu Mighty Jets','Okwahu United','Kpone City','Bolga All Stars','Okyeman Planners'],
      ['Kessben FC','Sekondi Hasaacas II','Swedru All Blacks','Dimamaf FC','Upper West Stars','Damongo United','Obuasi Goldfields','Brong Ahafo United','Wenchi FC','Brekum Chelsea II','Dun-Buo Utd','Abokobi FC','Tano Bofoakwa','Dormaa Aduana','Sunyani United'],
    ]},
  ],
  Asia: [
    { country:'Japan', leagues:['J1','J2','J3','J4'], clubs:[
      ['Tokyo Pulse','Osaka Steel','Yokohama Bay','Nagoya Sun','Sapporo Snow','Fukuoka South','Kobe Harbor','Kyoto Blossom','Sendai North','Hiroshima Peace','Kawasaki River','Urawa Reds','Gamba Osaka','FC Tokyo','Sagan Tosu'],
      ['Shizuoka Blue','Okayama FC','Niigata Snow','Kumamoto','Nara Utd','Oita Tri','Akita Bloom','Mito Hollyhock','Matsumoto Ymga','Nagano Parceiro','Tokushima Vortis','Omiya Ardija','Shonan Bellmare','Montedio Yamagata','Roasso Kumamoto'],
      ['Tochigi SC','Gunma Thespa','Gifu FC','Toyama Grouse','Ehime FC','Kochi Utd','Yamaguchi Renofa','Okinawa SV','Kagawa Five Arrows','Nagasaki Verspah','Kanazawa Toolson','Iwate Grulla','Aomori Buffaloes','Fukui FC','Wakayama Infini'],
      ['Nagasaki II','Miyazaki FC','Kagoshima Utd','Saga Lotte','Tottori Gainare','Shimane Reala','Okayama II','Hiroshima II','Yamagata II','Niigata II','Sapporo II','Osaka II','Kobe II','Nagoya II','Tokyo II'],
    ]},
  ],
  Oceania: [
    { country:'Australia', leagues:['A-League','National 2','National 3','National 4'], clubs:[
      ['Sydney Coast','Melbourne Metro','Brisbane River','Perth West','Adelaide Heat','Canberra Capital','Hobart South','Darwin North','Gold Coast Suns','Newcastle AU','Western Sydney','Central Coast','Wellington Phoenix','Auckland City','Macarthur FC'],
      ['Wollongong FC','Geelong Utd','Townsville Heat','Cairns FC','Toowoomba Rovers','Launceston City','Bendigo City','Ballarat SC','Albury Utd','Rockhampton FC','Coffs Harbour','Dubbo City','Tamworth FC','Orange SC','Wagga FC'],
      ['Mackay FC','Bunbury FC','Shepparton Utd','Mildura City','Broome FC','Devonport City','Armidale SC','Lismore FC','Albany City','Sunbury Utd','Footscray FC','Coburg Utd','Williamstown FC','Brunswick FC','Keilor Park'],
      ['Queanbeyan City','Goulburn Utd','Batemans Bay','Moruya FC','Nowra-Edgeworth','Port Lincoln','Kalgoorlie FC','Karratha City','Geraldton Utd','Bathurst City','Dubbo II','Wagga II','Tamworth II','Goulburn II','Yass FC'],
    ]},
  ],
};

// Player ID counter
let pid = 1;

// ─── PLAYER ───────────────────────────────────────────────────────
const NAME_POOL = {
  first: ['Ayo','Liam','Diego','Kenji','Musa','Noah','Rafa','Iker','Nico','Kofi','Omar','Leo','Javi','Kike','Tunde','Emeka','Sven','Lars','Paulo','Marco','Ahmed','Yuki','Carlos','Andres','Mike','Jake','James','Sam','Tom','Alex','Luis','Felipe','Rodrigo','Matheus','Takumi','Hiroshi','Kwame','Ekow','Seun','Bisi'],
  last:  ['Okoye','Garcia','Tanaka','Silva','Johnson','Ibrahim','Santos','Khan','Dubois','Rossi','Ali','Brown','Müller','Andersen','Osei','Mensah','Ferreira','Diaz','Nakamura','Kim','Schmidt','Fischer','Okonkwo','Adeyemi','Hernandez','Rodriguez','Yamamoto','Kobayashi','Williams','Jones','Taylor','Davies','Wilson','Evans'],
};
function genName() {
  return `${rng.pick(NAME_POOL.first)} ${rng.pick(NAME_POOL.last)}`;
}

class Player {
  constructor({ age, nation, clubId, wonderkid = false, position = null }) {
    this.id          = pid++;
    this.name        = genName();
    this.age         = age;
    this.nation      = nation || 'Unknown';
    this.clubId      = clubId;
    this.position    = position || rng.pick(POS_ALL);
    this.personality = rng.pick(PERSONALITY);
    this.morale      = rng.int(45, 85);
    this.fitness     = rng.int(65, 100);
    this.injuryRisk  = rng.int(1, 15);
    this.contractYears = rng.int(1, 5);
    this.weeklyMinutes = 0;
    this.wantsOut    = false;
    this.retired     = false;
    this.region      = null;

    // Hidden potential — wonderkids get higher ceiling
    this.hiddenPotential = wonderkid
      ? rng.int(84, 99)
      : rng.int(50, 92);

    // Base attributes (slightly position-skewed)
    const isPOS = (p) => this.position === p;
    this.attributes = {
      pace:      rng.int(30, 78),
      finishing: rng.int(25, 75),
      passing:   rng.int(28, 76),
      dribbling: rng.int(28, 76),
      defending: rng.int(25, 76),
      strength:  rng.int(28, 78),
      vision:    rng.int(28, 76),
      workRate:  rng.int(32, 80),
    };

    // Position-specific attribute boosts
    const posBoosts = {
      GK:  ['strength','defending','vision'],
      CB:  ['defending','strength'],
      LB:  ['pace','defending','passing'],
      RB:  ['pace','defending','passing'],
      CDM: ['defending','workRate','passing'],
      CM:  ['passing','vision','workRate'],
      CAM: ['vision','passing','dribbling'],
      LW:  ['pace','dribbling','finishing'],
      RW:  ['pace','dribbling','finishing'],
      ST:  ['finishing','pace','strength'],
      CF:  ['finishing','vision','dribbling'],
    };
    (posBoosts[this.position] || []).forEach(attr => {
      this.attributes[attr] = clamp(this.attributes[attr] + rng.int(5, 14), 25, 85);
    });

    this.currentAbility = this.overall();

    // Weekly wage scales with ability
    this.weeklyWage = Math.round(clamp(this.currentAbility * rng.int(50, 110), 200, 80000));

    this.history = { clubs: [{ clubId, season: CFG.startSeason }], appearances: 0, goals: 0, assists: 0, trophies: 0, caps: 0 };
  }

  overall() {
    const vals = Object.values(this.attributes);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  posAbility(pos) {
    return positionAbility(this, pos || this.position);
  }

  hint() {
    const gap = this.hiddenPotential - this.currentAbility;
    return gap > 22 ? 'Explosive upside' : gap > 13 ? 'Strong upside' : gap > 5 ? 'Modest upside' : 'Near peak';
  }

  toJSON() {
    return {
      id: this.id, name: this.name, age: this.age, nation: this.nation,
      clubId: this.clubId, position: this.position, personality: this.personality,
      morale: Math.round(this.morale), fitness: Math.round(this.fitness),
      injuryRisk: this.injuryRisk, contractYears: this.contractYears,
      weeklyWage: this.weeklyWage, wantsOut: this.wantsOut, retired: this.retired,
      hiddenPotential: this.hiddenPotential, currentAbility: Math.round(this.currentAbility),
      attributes: Object.fromEntries(Object.entries(this.attributes).map(([k,v])=>[k,Math.round(v)])),
      history: this.history, region: this.region,
      hint: this.hint(),
      marketValue: playerValue(this),
      // Frontend-friendly aliases
      ovr: Math.round(this.currentAbility),
      pot: this.hiddenPotential,
      fit: Math.round(this.fitness),
      mor: Math.round(this.morale),
      pers: this.personality,
      apps: this.history.appearances,
      goals: this.history.goals,
      assists: this.history.assists,
      trophies: this.history.trophies,
      attrs: Object.fromEntries(Object.entries(this.attributes).map(([k,v])=>[k,Math.round(v)])),
    };
  }
}

// ─── CLUB ─────────────────────────────────────────────────────────
let cid = 1;
class Club {
  constructor({ name, country, continent, division }) {
    this.id        = cid++;
    this.name      = name;
    this.country   = country;
    this.continent = continent;
    this.division  = division;

    this.tactic         = rng.pick(TACTICS);
    this.formation      = rng.pick(FORMATIONS);
    this.trainingFocus  = 'balanced';
    this.trainingIntensity = rng.int(2, 4);
    this.identity       = rng.pick(['youth','defensive','attacking','trading','balanced']);

    // Prestige scales with division (Div 1 = more prestige)
    this.prestige  = clamp(18 + (4 - Math.min(division, 4)) * 12 + rng.int(-5, 8), 5, 88);
    this.fanMood   = rng.int(40, 70);
    this.boardTrust = rng.int(40, 68);
    this.chemistry  = rng.int(35, 65);

    // Finances: Div 1 clubs are richer
    const divMult  = Math.max(0.15, 1 / division);
    this.finance = {
      balance:        Math.round((1_000_000 + rng.int(200_000, 1_500_000)) * divMult * (1 + this.prestige / 40)),
      transferBudget: Math.round(800_000 * divMult),
      wageBudget:     Math.round(400_000 * divMult),
      debt:           0,
      sponsorship:    Math.round(300_000 * divMult * (1 + this.prestige / 60)),
    };

    // Facilities: lower division = worse facilities
    this.facilities = {
      training: clamp(rng.int(1, 3) + (4 - Math.min(division, 4)), 1, 8),
      youth:    clamp(rng.int(1, 3) + (4 - Math.min(division, 4)), 1, 7),
      medical:  clamp(rng.int(1, 2) + (4 - Math.min(division, 4)), 1, 7),
      stadium:  Math.round((5000 + rng.int(1000, 8000)) * divMult),
    };

    this.squad       = [];
    this.youth       = [];
    this._manualXI   = null; // manager-set lineup
    this._currentXI  = null; // last used XI
  }

  strength() { return squadStrength(this, false); }
}

// ─── LEAGUE ───────────────────────────────────────────────────────
class League {
  constructor({ continent, country, name, level, clubs }) {
    this.continent = continent;
    this.country   = country;
    this.name      = name;
    this.level     = level;
    this.clubs     = clubs;
    this.table     = [];
    this.schedule  = [];
    this.weekIdx   = 0;
    this.results   = [];
  }

  reset() {
    this.table    = this.clubs.map(c => ({ club: c, points: 0, gf: 0, ga: 0, wins: 0, draws: 0, losses: 0 }));
    this.schedule = [];
    this.weekIdx  = 0;
    this.results  = [];
  }

  buildSchedule() {
    // Round-robin double fixture (home + away)
    const teams = [...this.clubs];
    if (teams.length % 2 !== 0) teams.push(null);
    const n = teams.length;
    const rounds = [];
    let rot = [...teams];

    // Single round-robin first
    for (let r = 0; r < n - 1; r++) {
      const wk = [];
      for (let i = 0; i < n / 2; i++) {
        const a = rot[i], b = rot[n - 1 - i];
        if (a && b) wk.push([a, b]);
      }
      rounds.push(wk);
      const fixed = rot[0];
      const rest  = rot.slice(1);
      rest.unshift(rest.pop());
      rot = [fixed, ...rest];
    }
    // Reverse for second half (swap home/away)
    const secondHalf = rounds.map(wk => wk.map(([a, b]) => [b, a]));
    this.schedule = [...rounds, ...secondHalf];
  }

  startSeason() {
    this.reset();
    this.buildSchedule();
  }

  playNextWeek() {
    if (!this.schedule.length) this.startSeason();
    const fixtures = this.schedule[this.weekIdx] || [];
    const wkResults = fixtures.map(([a, b]) => simulateMatch(a, b, this.table));
    this.results.push(...wkResults);
    this.weekIdx++;
    return { done: this.weekIdx >= this.schedule.length, week: this.weekIdx, totalWeeks: this.schedule.length };
  }

  play() {
    this.startSeason();
    while (this.weekIdx < this.schedule.length) this.playNextWeek();
    this.table.sort(sortRow);
    return this.table;
  }

  getSortedTable() {
    return [...this.table].sort(sortRow);
  }
}

function sortRow(a, b) {
  return b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf;
}

function leagueZone(league, idx, size) {
  if (idx < 0) return '';
  if (league.level === 1) {
    if (idx === 0) return 'champion';
    if (idx < 2) return 'continental';
    if (idx >= size - CFG.relegPerDiv) return 'relegation';
    return '';
  }
  if (idx < CFG.promoPerDiv) return 'promotion';
  if (idx >= size - CFG.relegPerDiv) return 'relegation';
  return '';
}

function zoneLabel(zone) {
  return {
    champion: 'Champions Cup Winner',
    continental: 'Champions Cup Spot',
    promotion: 'Promotion Spot',
    relegation: 'Relegation Zone',
  }[zone] || '';
}

// ─── GAME WORLD ───────────────────────────────────────────────────
class GameWorld {
  static season = CFG.startSeason;

  constructor(opts = {}) {
    this.opts    = opts;
    this.clubs   = [];
    this.leagues = [];
    this.players = new Map();
    this.history = { leagueWinners: [], continentalWinners: [], topScorers: [], sackings: [] };
    this.managerHistory = [];
    this.manager = { name: opts.managerName || 'You', reputation: 25, clubId: null, trophies: 0, sacks: 0 };
    this.econ    = 1;
    this.completedSeasons = 0;
    this.seasonInProgress = false;
    this.currentWeek      = 0;
    this.totalWeeks       = 0;
    this._expiringNotified = false;

    if (!opts._fromSave) this._build();
  }

  _build() {
    for (const [continent, countries] of Object.entries(WORLD)) {
      for (const cd of countries) {
        const refs = [];
        for (let div = 0; div < cd.leagues.length; div++) {
          // Enforce exactly 15 clubs (CFG.leagueSize)
          const clubNames = cd.clubs[div] ? cd.clubs[div].slice(0, CFG.leagueSize) : [];
          while (clubNames.length < CFG.leagueSize) clubNames.push(`${cd.country} Club ${clubNames.length + 1}`);

          const clubs = clubNames.map(name => {
            const c = new Club({ name, country: cd.country, continent, division: div + 1 });
            this._seedSquad(c, div + 1);
            this.clubs.push(c);
            return c;
          });

          const lg = new League({ continent, country: cd.country, name: cd.leagues[div], level: div + 1, clubs });
          this.leagues.push(lg);
          refs.push(lg);
        }
        cd._refs = refs;
      }
    }
    this._configureManager(this.opts);
  }

  _seedSquad(club, division) {
    // How many players and their quality depends on division
    const squadSize = 20;
    const baseLow   = Math.max(28, 62 - division * 8);
    const baseHigh  = Math.max(40, 80 - division * 8);

    // One GK always
    const gk = new Player({ age: rng.int(20, 34), nation: club.country, clubId: club.id, position: 'GK' });
    this._adjustAbility(gk, baseLow, baseHigh);
    club.squad.push(gk);
    this.players.set(gk.id, gk);

    const outfieldPositions = ['CB','CB','LB','RB','CDM','CM','CM','CAM','LW','RW','ST','CB','CM','ST','LW','RB','CDM','LW','ST','CF'];
    for (let i = 0; i < squadSize - 1; i++) {
      const pos = outfieldPositions[i] || rng.pick(POS_ALL);
      const p = new Player({ age: rng.int(17, 34), nation: club.country, clubId: club.id, position: pos });
      this._adjustAbility(p, baseLow, baseHigh);
      club.squad.push(p);
      this.players.set(p.id, p);
    }

    // 2-4 youth players
    for (let i = 0; i < rng.int(2, 4); i++) {
      const pos = rng.pick(POS_ALL);
      const y = new Player({ age: rng.int(15, 19), nation: club.country, clubId: club.id, position: pos });
      this._adjustAbility(y, Math.max(22, baseLow - 15), Math.max(35, baseLow));
      club.youth.push(y);
      this.players.set(y.id, y);
    }
  }

  _adjustAbility(player, low, high) {
    const target = rng.int(low, high);
    const scale  = target / Math.max(player.currentAbility, 1);
    Object.keys(player.attributes).forEach(k => {
      player.attributes[k] = clamp(Math.round(player.attributes[k] * scale * rng.float(0.88, 1.12)), 18, 98);
    });
    player.currentAbility = player.overall();
    player.weeklyWage = Math.round(clamp(player.currentAbility * rng.int(40, 90), 150, 60000));
  }

  _configureManager(opts) {
    const country = opts.startCountry || 'Nigeria';
    const divStart = 4; // ALWAYS start in the lowest division

    // Find bottom-division clubs in the chosen country
    const bottomDiv = this.leagues.filter(l => l.country === country).reduce((max, l) => l.level > max ? l.level : max, 1);
    let candidates  = this.clubs.filter(c => c.country === country && c.division === bottomDiv);
    if (!candidates.length) candidates = this.clubs.filter(c => c.country === country);
    if (!candidates.length) candidates = [this.clubs[0]];

    // Pick weakest club (least prestige)
    candidates.sort((a, b) => a.prestige - b.prestige);

    let selected;
    if (opts.mode === 'create' && opts.customClubName) {
      // Create a brand new club and replace the weakest
      selected = candidates[0];
      const oldSquad = [...selected.squad, ...selected.youth];
      oldSquad.forEach(p => this.players.delete(p.id));
      selected.name = opts.customClubName.trim();
      selected.prestige = 8 + rng.int(0, 6);
      selected.fanMood  = 45;
      selected.boardTrust = 50;
      selected.chemistry = 38;
      selected.identity = rng.pick(['youth','balanced','trading']);
      // Poor finances
      selected.finance.balance = rng.int(100_000, 400_000);
      selected.finance.transferBudget = rng.int(30_000, 100_000);
      selected.finance.wageBudget = rng.int(80_000, 180_000);
      selected.finance.sponsorship = rng.int(120_000, 260_000);
      selected.finance.debt = rng.int(0, 80_000);
      // Poor facilities
      selected.facilities = { training: 1, youth: 1, medical: 1, stadium: rng.int(1200, 3000) };
      // Weak squad
      selected.squad = [];
      selected.youth = [];
      const poss = ['GK','CB','CB','LB','RB','CDM','CM','CM','LW','RW','ST','CB','CM','LW','ST','RB','CDM','RW','ST','GK'];
      poss.forEach(pos => {
        const p = new Player({ age: rng.int(17, 30), nation: selected.country, clubId: selected.id, position: pos });
        this._adjustAbility(p, 28, 48);
        selected.squad.push(p);
        this.players.set(p.id, p);
      });
      for (let i = 0; i < rng.int(2, 4); i++) {
        const y = new Player({ age: rng.int(15, 18), nation: selected.country, clubId: selected.id, position: rng.pick(POS_ALL) });
        this._adjustAbility(y, 22, 38);
        selected.youth.push(y);
        this.players.set(y.id, y);
      }
    } else if (opts.mode === 'existing' && opts.startClubName) {
      selected = this.clubs.find(c => c.country === country && c.name === opts.startClubName) || candidates[0];
    } else {
      selected = candidates[0];
      // Make the default start club poor
      selected.finance.balance = rng.int(80_000, 350_000);
      selected.finance.transferBudget = rng.int(20_000, 80_000);
      selected.finance.debt = rng.int(0, 60_000);
      selected.facilities = { training: 1, youth: 1, medical: 1, stadium: rng.int(1000, 2500) };
    }

    this.manager.clubId = selected.id;
  }

  static availableCountries() {
    return [...new Set(Object.values(WORLD).flatMap(cs => cs.map(c => c.country)))].sort();
  }

  countryTopClubs(country) {
    return this.clubs.filter(c => c.country === country && c.division === 1).map(c => c.name).sort();
  }

  club() { return this.clubs.find(c => c.id === this.manager.clubId) || this.clubs[0]; }
  league() { return this.leagues.find(l => l.clubs.some(c => c.id === this.club().id)); }

  _recentResults(league, club) {
    if (!league) return [];
    return league.results
      .filter(r => r.home === club.name || r.away === club.name)
      .slice(-5)
      .map(r => {
        const isHome = r.home === club.name;
        const gf = isHome ? r.homeGoals : r.awayGoals;
        const ga = isHome ? r.awayGoals : r.homeGoals;
        return {
          opponent: isHome ? r.away : r.home,
          venue: isHome ? 'H' : 'A',
          gf,
          ga,
          result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
          shotsFor: isHome ? r.homeShots : r.awayShots,
          shotsAgainst: isHome ? r.awayShots : r.homeShots,
          xgFor: isHome ? r.homeXg : r.awayXg,
          xgAgainst: isHome ? r.awayXg : r.homeXg,
        };
      });
  }

  _nextFixture(league, club) {
    if (!league || !league.schedule?.length) return null;
    const fixtures = league.schedule[league.weekIdx] || [];
    const game = fixtures.find(([home, away]) => home?.id === club.id || away?.id === club.id);
    if (!game) return null;
    const [home, away] = game;
    return {
      home: home.name,
      away: away.name,
      venue: home.id === club.id ? 'H' : 'A',
      opponent: home.id === club.id ? away.name : home.name,
    };
  }

  // ── RICH SNAPSHOT (for API) ──────────────────────────────────────
  snapshot() {
    const c   = this.club();
    const lg  = this.league();
    const sq  = c.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility);
    let pos = null, pts = null, gd = null, table = [];

    if (lg && lg.table.length) {
      const sorted = lg.getSortedTable();
      const myIdx  = sorted.findIndex(r => r.club.id === c.id);
      pos = myIdx + 1;
      pts = sorted[myIdx]?.points ?? 0;
      gd  = (sorted[myIdx]?.gf ?? 0) - (sorted[myIdx]?.ga ?? 0);
      const show = Math.max(12, myIdx + 3);
      table = sorted.slice(0, show).map((r, i) => ({
        pos: i + 1, club: r.club.name, clubId: r.club.id, isMe: r.club.id === c.id,
        pts: r.points, gd: r.gf - r.ga, w: r.wins, d: r.draws, l: r.losses,
        gf: r.gf, ga: r.ga, played: r.wins + r.draws + r.losses,
        zone: leagueZone(lg, i, sorted.length),
        zoneLabel: zoneLabel(leagueZone(lg, i, sorted.length)),
      }));
    }

    // Market: listed + free agents + expiring contracts
    const market = [];
    this.clubs.forEach(cl => {
      cl.squad.filter(p => !p.retired && (p.contractYears <= 0 || p.wantsOut)).forEach(p => {
        market.push({ ...p.toJSON(), fromClub: cl.name, fromClubId: cl.id });
      });
    });
    this.players.forEach(p => {
      if (!p.retired && !p.clubId) market.push({ ...p.toJSON(), fromClub: 'Free Agent', fromClubId: null });
    });
    market.sort((a, b) => b.currentAbility - a.currentAbility);

    // Top scorers across all leagues
    const topScorers = [];
    this.clubs.forEach(cl => {
      cl.squad.filter(p => !p.retired && p.history.goals > 0).forEach(p => {
        topScorers.push({ name: p.name, goals: p.history.goals, assists: p.history.assists, club: cl.name, ovr: p.currentAbility, position: p.position });
      });
    });
    topScorers.sort((a, b) => b.goals - a.goals);

    // Expiring contracts
    const expiring = getExpiringContracts(sq);

    // All leagues for browse
    const allLeagues = this.leagues.map(l => ({
      name: l.name, country: l.country, level: l.level, clubs: l.clubs.slice(0, 8).map(cl => ({ id: cl.id, name: cl.name, prestige: cl.prestige, division: cl.division }))
    }));

    // Manual XI
    const manualXI = c._manualXI ? c._manualXI.map(s => ({ slot: s.slot, playerId: s.player?.id, playerName: s.player?.name, playerOvr: s.player ? Math.round(s.player.currentAbility) : null })) : null;

    // Formation slots
    const formationSlots = FORMATION_SLOTS[c.formation] || FORMATION_SLOTS['4-4-2'];
    const autoXI = selectBestXI(sq, c.formation).map(s => ({ slot: s.slot, playerId: s.player?.id, playerName: s.player?.name, playerOvr: s.player ? Math.round(s.player.currentAbility) : null, playerPos: s.player?.position }));
    const recentResults = this._recentResults(lg, c);
    const nextFixture = this._nextFixture(lg, c);
    const currentZone = lg && pos ? leagueZone(lg, pos - 1, lg.clubs.length) : '';
    const contractAlerts = getExpiringContracts(sq);

    let boardObjective = 'Stabilise the club and build foundations.';
    if (c.division === 1) boardObjective = c.prestige >= 65 ? 'Challenge for Champions Cup qualification.' : 'Stay clear of relegation and remain competitive.';
    else if (c.division === 2) boardObjective = c.prestige >= 55 ? 'Push for promotion this season.' : 'Build into the top half and improve the squad.';
    else boardObjective = c.facilities.youth >= 3 ? 'Develop academy talent and chase promotion.' : 'Avoid relegation while building a stronger squad.';

    return {
      ok: true,
      tactics: TACTICS, formations: FORMATIONS, trainingFocuses: TRAINING_FOCUS,
      season: GameWorld.season, seasonLabel: `${GameWorld.season}/${GameWorld.season + 1}`,
      club: c.name, clubId: c.id, country: c.country, division: c.division,
      leagueName: lg?.name || '', week: this.currentWeek,
      totalWeeks: this.totalWeeks || lg?.schedule?.length || 28,
      position: pos, points: pts, gd,
      reputation: this.manager.reputation, fans: c.fanMood, board: c.boardTrust,
      finances: Math.round(c.finance.balance), debt: Math.round(c.finance.debt),
      transferBudget: Math.round(c.finance.transferBudget),
      wageBudget: Math.round(c.finance.wageBudget),
      tactic: c.tactic, formation: c.formation, trainingFocus: c.trainingFocus,
      trainingIntensity: c.trainingIntensity, chemistry: c.chemistry, prestige: c.prestige,
      trophies: this.manager.trophies, completedSeasons: this.completedSeasons,
      facilities: c.facilities, table, market: market.slice(0, 110),
      topScorers: topScorers.slice(0, 25), allLeagues,
      squad: sq.map(p => p.toJSON()),
      youth: c.youth.filter(p => !p.retired).map(p => p.toJSON()),
      expiringContracts: expiring.map(p => ({ id: p.id, name: p.name, age: p.age, ovr: Math.round(p.currentAbility), contractYears: p.contractYears })),
      manualXI, autoXI, formationSlots,
      boardObjective,
      seasonStatus: currentZone ? zoneLabel(currentZone) : 'Mid-table fight',
      currentZone,
      recentResults,
      nextFixture,
      contractAlerts: contractAlerts.length,
    };
  }

  // ── WEEK STEP ────────────────────────────────────────────────────
  stepWeek(decisions = {}) {
    this._ensureSeasonStarted(decisions);
    this._applyDecisions(decisions);

    // Weekly development for manager's club
    weeklyDevelopment(this.club());

    // Advance one week in all leagues
    const states  = this.leagues.map(l => l.playNextWeek());
    this.currentWeek++;

    const events  = this._weeklyEvents();
    const allDone = states.every(s => s.done);

    if (allDone) {
      const endSummary = this._endSeason();
      return { seasonComplete: true, week: this.currentWeek, totalWeeks: this.totalWeeks, events, endSummary };
    }

    return { seasonComplete: false, week: this.currentWeek, totalWeeks: this.totalWeeks, events };
  }

  // ── FULL SEASON ──────────────────────────────────────────────────
  stepSeason(decisions = {}) {
    this._ensureSeasonStarted(decisions);
    this._applyDecisions(decisions);
    while (this.currentWeek < this.totalWeeks) {
      this.leagues.forEach(l => l.playNextWeek());
      this.currentWeek++;
      weeklyDevelopment(this.club());
    }
    return this._endSeason();
  }

  // ── MANUAL LINEUP ────────────────────────────────────────────────
  setManualLineup(lineupSlots) {
    // lineupSlots: [{ slot: 'GK', playerId: 123 }, ...]
    const c   = this.club();
    const map = new Map(c.squad.map(p => [p.id, p]));
    c._manualXI = lineupSlots.map(s => ({
      slot: s.slot,
      player: map.get(parseInt(s.playerId)) || null,
    }));
    return { ok: true };
  }

  clearManualLineup() {
    this.club()._manualXI = null;
    return { ok: true };
  }

  _ensureSeasonStarted(decisions) {
    if (this.seasonInProgress) return;
    GameWorld.season = CFG.startSeason + this.completedSeasons;
    this._applyDecisions(decisions);
    this._economy();
    this._drama();
    this.leagues.forEach(l => l.startSeason());
    this.seasonInProgress = true;
    this.currentWeek  = 0;
    const lg = this.league();
    this.totalWeeks = lg?.schedule?.length || 28;
    this._expiringNotified = false;
  }

  _applyDecisions(d = {}) {
    const c = this.club();
    if (d.tactic && TACTICS.includes(d.tactic)) c.tactic = d.tactic;
    if (d.formation && FORMATIONS.includes(d.formation)) c.formation = d.formation;
    if (d.trainingFocus && TRAINING_FOCUS.includes(d.trainingFocus)) c.trainingFocus = d.trainingFocus;
    if (d.trainingIntensity !== undefined) c.trainingIntensity = clamp(parseInt(d.trainingIntensity) || 3, 1, 5);
  }

  _weeklyEvents() {
    const c = this.club();
    const events = [];

    // Contract expiry warning (once per season)
    if (!this._expiringNotified && this.currentWeek === 4) {
      const exp = getExpiringContracts(c.squad.filter(p => !p.retired));
      if (exp.length) {
        events.push({ type: 'contract_warning', text: `⚠️ ${exp.length} player${exp.length > 1 ? 's' : ''} contract${exp.length > 1 ? 's' : ''} expire this season: ${exp.slice(0, 3).map(p => p.name).join(', ')}${exp.length > 3 ? ` +${exp.length - 3} more` : ''}.` });
        this._expiringNotified = true;
      }
    }

    // Random injury
    if (rng.chance(0.18)) {
      const p = rng.pick(c.squad.filter(pl => !pl.retired && pl.fitness > 40));
      if (p) {
        p.fitness = clamp(p.fitness - rng.int(12, 35), 20, 100);
        events.push({ type: 'injury', text: `🏥 ${p.name} picked up a knock in training. Fitness dropped to ${Math.round(p.fitness)}%.` });
      }
    }

    // Random morale boost
    if (rng.chance(0.12)) {
      const p = rng.pick(c.squad.filter(pl => !pl.retired));
      if (p) {
        p.morale = clamp(p.morale + rng.int(5, 14), 0, 100);
        events.push({ type: 'morale', text: `💪 ${p.name} is in great spirits this week!` });
      }
    }

    // Contract demand
    if (rng.chance(0.08)) {
      const star = c.squad.filter(p => !p.retired && p.currentAbility > 65).sort((a, b) => b.currentAbility - a.currentAbility)[0];
      if (star) {
        star.wantsOut = rng.chance(0.3);
        events.push({ type: 'demand', text: `📋 ${star.name} wants a contract review. ${star.wantsOut ? 'He has asked to leave.' : 'He is looking for a wage rise.'}` });
      }
    }

    // Board update
    if (rng.chance(0.10)) {
      const boost = rng.int(-5, 8);
      c.boardTrust = clamp(c.boardTrust + boost, 0, 100);
      events.push({ type: 'board', text: boost > 0 ? `🏢 Board expresses confidence in your management.` : `🏢 Board growing impatient with recent results.` });
    }

    // Wonderkid spotted
    if (rng.chance(0.05)) {
      const y = c.youth.filter(p => !p.retired && p.hiddenPotential >= 78)[0];
      if (y) events.push({ type: 'wonderkid', text: `⭐ Academy scouts rave about ${y.name} (${y.age})! Potential: ${y.hint()}.` });
    }

    return events;
  }

  _endSeason() {
    this.seasonInProgress = false;
    const myClub = this.club();
    const myLeague = this.league();
    const finalTables = new Map(this.leagues.map(l => [l, l.getSortedTable()]));
    const myTable = myLeague ? finalTables.get(myLeague) || [] : [];
    const myIdx = myTable.findIndex(r => r.club.id === myClub.id);
    const myZone = myLeague ? leagueZone(myLeague, myIdx, myTable.length) : '';

    // --- Continental competition (simple) ---
    const contResults = this._continentals(finalTables);

    // --- Finance updates ---
    for (const [lg, sorted] of finalTables) {
      sorted.forEach((row, i) => {
        const pos = i + 1;
        const isContWinner = contResults.some(w => w.clubId === row.club.id);
        updateClubFinances(row.club, pos, sorted.length, false, isContWinner, this.econ);
      });
    }

    // --- Season development ---
    this.clubs.forEach(cl => {
      const tq = cl.facilities.training || 1;
      cl.squad.forEach(p => seasonDevelop(p, tq, p.weeklyMinutes || 0));
      cl.squad = cl.squad.filter(p => !p.retired);
      generateYouthPlayers(cl, Player, CFG);
      promoteYouth(cl);
      upgradeFacilities(cl);
    });
    generateWonderkids(this.clubs, Player);

    // --- Record ---
    this._record(finalTables);

    const summary = {
      season: GameWorld.season,
      seasonLabel: `${GameWorld.season}/${GameWorld.season + 1}`,
      club: myClub.name, country: myClub.country, division: myClub.division,
      league: myLeague?.name || '',
      position: myIdx + 1,
      points: myTable[myIdx]?.points ?? 0,
      gd: (myTable[myIdx]?.gf ?? 0) - (myTable[myIdx]?.ga ?? 0),
      finances: Math.round(myClub.finance.balance),
      debt: Math.round(myClub.finance.debt),
      fans: myClub.fanMood, board: myClub.boardTrust,
      reputation: this.manager.reputation,
      continentalChampion: contResults.some(r => r.clubId === myClub.id),
      trophies: this.manager.trophies,
      outcome: zoneLabel(myZone) || 'Season complete',
      promotion: myZone === 'promotion',
      relegation: myZone === 'relegation',
      continentalQualification: myZone === 'continental' || myZone === 'champion',
    };

    // --- Promotion / Relegation ---
    for (const cs of Object.values(WORLD)) {
      for (const cd of cs) {
        const refs = cd._refs;
        if (!refs || refs.length < 2) continue;
        for (let i = 0; i < refs.length - 1; i++) {
          const upper = refs[i], lower = refs[i + 1];
          const uTable = finalTables.get(upper) || upper.getSortedTable();
          const lTable = finalTables.get(lower) || lower.getSortedTable();
          const relegated = uTable.slice(-CFG.relegPerDiv).map(r => r.club);
          const promoted  = lTable.slice(0, CFG.promoPerDiv).map(r => r.club);

          upper.clubs = upper.clubs.filter(c => !relegated.some(r => r.id === c.id)).concat(promoted);
          lower.clubs = lower.clubs.filter(c => !promoted.some(p => p.id === c.id)).concat(relegated);

          promoted.forEach(c => {
            c.division = Math.max(1, c.division - 1);
            c.fanMood = clamp(c.fanMood + 12, 0, 100);
            c.boardTrust = clamp(c.boardTrust + 8, 0, 100);
            c.finance.sponsorship = Math.round(c.finance.sponsorship * 1.3);
          });
          relegated.forEach(c => {
            c.division += 1;
            c.fanMood = clamp(c.fanMood - 10, 0, 100);
            c.boardTrust = clamp(c.boardTrust - 8, 0, 100);
          });
        }
      }
    }

    const nextLeague = this.league();
    summary.nextLeague = nextLeague?.name || summary.league;
    summary.nextDivision = this.club().division;

    // --- Transfer market ---
    runTransferMarket(this.clubs, GameWorld.season);

    this.managerHistory.push(summary);
    this.completedSeasons++;
    this.currentWeek = 0;
    this.totalWeeks = 0;
    GameWorld.season++;

    return summary;
  }

  _continentals(finalTables = new Map()) {
    const out = [], byContinent = new Map();
    this.leagues.filter(l => l.level === 1).forEach(l => {
      const sorted = finalTables.get(l) || l.getSortedTable();
      const top2   = sorted.slice(0, 2).map(r => r.club);
      const cont   = l.continent;
      if (!byContinent.has(cont)) byContinent.set(cont, []);
      byContinent.get(cont).push(...top2);
    });
    for (const [cont, clubs] of byContinent) {
      if (clubs.length < 2) continue;
      let teams = rng.shuffle(clubs);
      while (teams.length > 1) {
        const next = [];
        for (let i = 0; i < teams.length; i += 2) next.push(knockout(teams[i], teams[i + 1] || teams[i]));
        teams = next;
      }
      const winner = teams[0];
      if (!winner) continue;
      winner.prestige = clamp(winner.prestige + 5, 1, 99);
      winner.finance.balance += 2_000_000;
      winner.squad.forEach(p => p.history.trophies++);
      out.push({ continent: cont, clubId: winner.id, winner: winner.name });
      this.history.continentalWinners.push({ season: GameWorld.season, continent: cont, club: winner.name, clubId: winner.id });
      if (winner.id === this.club().id) { this.manager.trophies++; this.manager.reputation = clamp(this.manager.reputation + 8, 1, 99); }
    }
    return out;
  }

  _record(finalTables) {
    for (const [lg, sorted] of finalTables) {
      const w = sorted[0]?.club;
      if (w) {
        this.history.leagueWinners.push({ season: GameWorld.season, league: `${lg.country} ${lg.name}`, club: w.name });
        if (w.id === this.club().id) { this.manager.trophies++; this.manager.reputation = clamp(this.manager.reputation + 5, 1, 99); }
      }
      // Top scorer
      const allPlayers = sorted.flatMap(r => r.club.squad.filter(p => !p.retired));
      const topScorer  = allPlayers.sort((a, b) => b.history.goals - a.history.goals)[0];
      if (topScorer && topScorer.history.goals > 0) {
        this.history.topScorers.push({ season: GameWorld.season, league: `${lg.country} ${lg.name}`, player: topScorer.name, goals: topScorer.history.goals });
      }
    }
    // Manager reputation update
    const myLg = this.league();
    if (myLg) {
      const myPos = (finalTables.get(myLg) || myLg.getSortedTable()).findIndex(r => r.club.id === this.club().id) + 1;
      const ls    = myLg.clubs.length;
      const repDelta = myPos <= 1 ? 8 : myPos <= 3 ? 4 : myPos <= Math.ceil(ls / 2) ? 0 : -3;
      this.manager.reputation = clamp(this.manager.reputation + repDelta, 1, 99);
    }
  }

  _economy() {
    const r = rng.next();
    if      (r < 0.12) { this.econ = 1.20; }
    else if (r < 0.25) { this.econ = 0.82; }
    else               { this.econ = 1.00; }
  }

  _drama() {
    const c  = this.club();
    const ev = [];
    if (rng.chance(0.15)) {
      const star = c.squad.sort((a, b) => b.currentAbility - a.currentAbility)[0];
      if (star) { ev.push(`${star.name} demands a contract review before the season.`); c.finance.wageBudget += 100_000; }
    }
    if (rng.chance(0.10)) { ev.push('Board injects funds for upcoming transfer window.'); c.finance.transferBudget += rng.int(100_000, 500_000); }
    if (rng.chance(0.08)) { ev.push('Injury wave hits the squad in pre-season.'); c.squad.slice(0, 3).forEach(p => { p.fitness = clamp(p.fitness - rng.int(8, 20), 25, 100); }); }
    return ev;
  }

  historySnapshot(limit = 10) {
    const n = clamp(parseInt(limit) || 10, 1, 40);
    return {
      managerSeasons: this.managerHistory.slice(-n).reverse(),
      leagueWinners: this.history.leagueWinners.slice(-n).reverse(),
      continentalWinners: this.history.continentalWinners.slice(-n).reverse(),
      topScorers: this.history.topScorers.slice(-n).reverse(),
      hallOfFame: {
        status: this.manager.reputation >= 90 ? 'Legendary' : this.manager.reputation >= 75 ? 'Elite' : this.manager.reputation >= 55 ? 'Respected' : 'Developing',
        reputation: this.manager.reputation,
        trophies: this.manager.trophies,
        sacks: this.manager.sacks,
      }
    };
  }

  // ── SAVE / LOAD ──────────────────────────────────────────────────
  toSave() {
    return {
      _v: 6,
      season: GameWorld.season,
      completedSeasons: this.completedSeasons,
      manager: this.manager,
      history: this.history,
      managerHistory: this.managerHistory,
      econ: this.econ,
      seasonInProgress: this.seasonInProgress,
      currentWeek: this.currentWeek,
      totalWeeks: this.totalWeeks,
      expiringNotified: this._expiringNotified,
      clubs: this.clubs.map(c => ({
        id: c.id, name: c.name, country: c.country, continent: c.continent, division: c.division,
        tactic: c.tactic, formation: c.formation, trainingFocus: c.trainingFocus,
        trainingIntensity: c.trainingIntensity, fanMood: c.fanMood, boardTrust: c.boardTrust,
        prestige: c.prestige, chemistry: c.chemistry, identity: c.identity,
        finance: c.finance, facilities: c.facilities,
        squad: c.squad.map(p => p.id),
        youth:  c.youth.map(p => p.id),
        _manualXI: c._manualXI ? c._manualXI.map(s => ({ slot: s.slot, playerId: s.player?.id || null })) : null,
      })),
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, age: p.age, nation: p.nation, clubId: p.clubId,
        position: p.position, personality: p.personality, morale: p.morale,
        fitness: p.fitness, injuryRisk: p.injuryRisk, contractYears: p.contractYears,
        weeklyWage: p.weeklyWage, wantsOut: p.wantsOut, retired: p.retired,
        hiddenPotential: p.hiddenPotential, currentAbility: p.currentAbility,
        attributes: p.attributes, history: p.history, region: p.region, weeklyMinutes: p.weeklyMinutes || 0,
      })),
      leagueStates: this.leagues.map(l => ({
        country: l.country,
        name: l.name,
        level: l.level,
        weekIdx: l.weekIdx,
        results: l.results,
        schedule: (l.schedule || []).map(week => week.map(([home, away]) => [home?.id || null, away?.id || null])),
        table: (l.table || []).map(r => ({
          clubId: r.club.id,
          points: r.points,
          gf: r.gf,
          ga: r.ga,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
        })),
      })),
    };
  }

  static fromSave(data) {
    if (!data) return null;
    const w = new GameWorld({ _fromSave: true });
    w.clubs   = [];
    w.leagues = [];
    w.players = new Map();

    GameWorld.season = data.season || CFG.startSeason;
    w.completedSeasons = data.completedSeasons || 0;
    w.manager  = data.manager;
    w.history  = data.history || { leagueWinners: [], continentalWinners: [], topScorers: [] };
    w.managerHistory = data.managerHistory || [];
    w.econ     = data.econ || 1;
    w.seasonInProgress = !!data.seasonInProgress;
    w.currentWeek = data.currentWeek || 0;
    w.totalWeeks = data.totalWeeks || 0;
    w._expiringNotified = !!data.expiringNotified;

    // Restore players
    for (const pd of (data.players || [])) {
      const p = new Player({ age: pd.age, nation: pd.nation, clubId: pd.clubId, position: pd.position });
      Object.assign(p, pd);
      p.currentAbility = p.overall();
      w.players.set(p.id, p);
    }
    pid = Math.max(1, ...[...w.players.keys(), 0]) + 1;

    // Restore clubs
    for (const cd of (data.clubs || [])) {
      const c = new Club({ name: cd.name, country: cd.country, continent: cd.continent, division: cd.division });
      Object.assign(c, cd);
      c.squad = (cd.squad || []).map(id => w.players.get(id)).filter(Boolean);
      c.youth = (cd.youth || []).map(id => w.players.get(id)).filter(Boolean);
      // Restore manual lineup
      if (cd._manualXI) {
        c._manualXI = cd._manualXI.map(s => ({ slot: s.slot, player: w.players.get(s.playerId) || null }));
      }
      w.clubs.push(c);
    }
    cid = Math.max(1, ...w.clubs.map(c => c.id), 0) + 1;

    // Rebuild leagues
    for (const [continent, countries] of Object.entries(WORLD)) {
      for (const cd of countries) {
        const refs = [];
        for (let lv = 0; lv < cd.leagues.length; lv++) {
          const leagueClubs = w.clubs.filter(c => c.country === cd.country && c.division === lv + 1);
          const lg = new League({ continent, country: cd.country, name: cd.leagues[lv], level: lv + 1, clubs: leagueClubs });
          w.leagues.push(lg);
          refs.push(lg);
        }
        cd._refs = refs;
      }
    }

    const leagueStates = data.leagueStates || [];
    leagueStates.forEach(state => {
      const league = w.leagues.find(l => l.country === state.country && l.name === state.name && l.level === state.level);
      if (!league) return;
      league.weekIdx = state.weekIdx || 0;
      league.results = state.results || [];
      league.schedule = (state.schedule || []).map(week =>
        week
          .map(([homeId, awayId]) => [w.clubs.find(c => c.id === homeId), w.clubs.find(c => c.id === awayId)])
          .filter(([home, away]) => home && away)
      );
      league.table = (state.table || []).map(row => {
        const club = w.clubs.find(c => c.id === row.clubId);
        return club ? { club, points: row.points, gf: row.gf, ga: row.ga, wins: row.wins, draws: row.draws, losses: row.losses } : null;
      }).filter(Boolean);
    });

    return w;
  }
}

module.exports = { GameWorld, Player, Club, League, CFG, TACTICS, FORMATIONS, TRAINING_FOCUS, FORMATION_SLOTS };
