// src/names.js — player name pools, one per football nation. Every player is fictional: a name
// is one first name and one surname drawn from his nation's pool, so a Nigerian side reads
// differently from a German or Japanese one. Pools are large (40+ first names, 50+ surnames per
// nation) so squads rarely repeat a name.

const POOLS = {
  England: {
    first: ['Alfie', 'Archie', 'Ashton', 'Bailey', 'Barnaby', 'Callum', 'Charlie', 'Conor', 'Declan', 'Dominic', 'Eddie', 'Elliot', 'Ellis', 'Finley', 'Freddie', 'Gareth', 'George', 'Harvey', 'Harry', 'Hayden', 'Jadon', 'Jamal', 'Jenson', 'Jude', 'Kieran', 'Kyle', 'Lewis', 'Luca', 'Marcus', 'Mason', 'Morgan', 'Nathan', 'Ollie', 'Oscar', 'Reece', 'Rhys', 'Rio', 'Rowan', 'Ruben', 'Spencer', 'Tobias', 'Trent', 'Tyrone', 'Wesley', 'Zak'],
    last: ['Ainsworth', 'Appleby', 'Ashcroft', 'Barlow', 'Beckett', 'Blackwood', 'Bradshaw', 'Brennan', 'Calloway', 'Cartwright', 'Chadwick', 'Colby', 'Crane', 'Dalton', 'Dempsey', 'Eastwood', 'Fairclough', 'Fenwick', 'Garside', 'Greaves', 'Hadley', 'Halliwell', 'Hargreaves', 'Holloway', 'Ibbotson', 'Kendrick', 'Langford', 'Lockwood', 'Marlow', 'Mercer', 'Nettleton', 'Oakley', 'Okafor-Reid', 'Pemberton', 'Prescott', 'Quigley', 'Radcliffe', 'Rainford', 'Redfern', 'Sandford', 'Sharpe', 'Stanton', 'Thackeray', 'Thornley', 'Underhill', 'Varley', 'Wainwright', 'Westbrook', 'Whitlock', 'Winstanley', 'Yardley', 'Adeyinka', 'Bassey-Cole', 'Mbeki-Hall'],
  },
  Spain: {
    first: ['Adrián', 'Aitor', 'Alejo', 'Álvaro', 'Ander', 'Beñat', 'Borja', 'Bruno', 'César', 'Dani', 'Darío', 'Eder', 'Enzo', 'Ferran', 'Gael', 'Gonzalo', 'Hugo', 'Ibai', 'Iker', 'Ismael', 'Joan', 'Joel', 'Jorge', 'Julen', 'Leandro', 'Manu', 'Marc', 'Mikel', 'Nacho', 'Néstor', 'Oier', 'Oriol', 'Pau', 'Pelayo', 'Quique', 'Raúl', 'Rubén', 'Samu', 'Saúl', 'Sergi', 'Unai', 'Víctor', 'Xabi', 'Yeray', 'Zigor'],
    last: ['Abascal', 'Aguirre', 'Alcázar', 'Arriaga', 'Balaguer', 'Barrios', 'Beltrán', 'Cabrera', 'Calderón', 'Carrasco', 'Cifuentes', 'Cortés', 'Delgado', 'Echeverría', 'Escobar', 'Espinosa', 'Fuentes', 'Gallardo', 'Guerrero', 'Ibáñez', 'Ibarrola', 'Larrañaga', 'Lozano', 'Manzano', 'Madrazo', 'Mendizábal', 'Montoya', 'Navarro', 'Olmedo', 'Ortega', 'Palacios', 'Peñalver', 'Quintana', 'Rivas', 'Robledo', 'Salcedo', 'Santamaría', 'Segura', 'Soler', 'Tejada', 'Urrutia', 'Valverde', 'Velasco', 'Villanueva', 'Yáñez', 'Zabaleta', 'Zamora', 'Bengoetxea', 'Casals', 'Puigdoménech', 'Roselló', 'Vidal-Serra'],
  },
  Germany: {
    first: ['Anton', 'Arne', 'Bastian', 'Benno', 'Cedric', 'Dennis', 'Emil', 'Erik', 'Fabian', 'Felix', 'Florian', 'Finn', 'Gregor', 'Hannes', 'Henrik', 'Jannik', 'Jonas', 'Julian', 'Kai', 'Karim', 'Konrad', 'Lennart', 'Leon', 'Linus', 'Malik', 'Marvin', 'Mats', 'Maximilian', 'Moritz', 'Niklas', 'Nils', 'Ole', 'Pascal', 'Philipp', 'Robin', 'Ruben', 'Serge', 'Silas', 'Tim', 'Till', 'Timo', 'Valentin', 'Yannick', 'Jascha', 'Deniz'],
    last: ['Ackermann', 'Albrecht', 'Bachmann', 'Baumgartner', 'Brandstetter', 'Brückner', 'Dietrich', 'Dorn', 'Eberhardt', 'Engel', 'Falk', 'Feldmann', 'Gebhardt', 'Grünewald', 'Hartmann', 'Heidenreich', 'Hoffmeister', 'Jäger', 'Kessler', 'Kirchner', 'Klostermann', 'Krämer', 'Lindner', 'Lorenz', 'Mertens', 'Nordhoff', 'Overbeck', 'Pfeiffer', 'Rademacher', 'Reinhardt', 'Rosenthal', 'Sattler', 'Schreiber', 'Schwarzkopf', 'Seidel', 'Steinbach', 'Thalmann', 'Ullrich', 'Vogelsang', 'Wagenknecht', 'Weidner', 'Winkler', 'Zeller', 'Ziegler', 'Aydemir', 'Öztürk', 'Kowalczyk', 'Mbemba-Krause', 'Adeyemi-Lang', 'Çelik'],
  },
  Brazil: {
    first: ['Adriano', 'Alisson', 'Anderson', 'Bernardo', 'Breno', 'Caio', 'Cauã', 'Davi', 'Denílson', 'Douglas', 'Éder', 'Edson', 'Everton', 'Fabrício', 'Gabriel', 'Geovane', 'Gustavo', 'Heitor', 'Igor', 'Jefferson', 'João Pedro', 'Juninho', 'Kauê', 'Léo', 'Lucas', 'Luan', 'Marcelo', 'Matheus', 'Murilo', 'Neto', 'Otávio', 'Pedro', 'Rafinha', 'Raí', 'Renan', 'Ronaldo', 'Samuel', 'Thiago', 'Vinícius', 'Vitor', 'Wallace', 'Wendell', 'Yago', 'Yuri', 'Zé Carlos'],
    last: ['Abreu', 'Albuquerque', 'Amaral', 'Aragão', 'Barbosa', 'Bittencourt', 'Brandão', 'Cardoso', 'Carvalho', 'Cavalcanti', 'Coutinho', 'Damasceno', 'Dantas', 'Espíndola', 'Falcão', 'Figueiredo', 'Fonseca', 'Guimarães', 'Lacerda', 'Leite', 'Macedo', 'Maranhão', 'Medeiros', 'Mendonça', 'Monteiro', 'Nascimento', 'Nogueira', 'Pacheco', 'Paiva', 'Peixoto', 'Queiroz', 'Rangel', 'Rebouças', 'Rezende', 'Sampaio', 'Sardinha', 'Siqueira', 'Tavares', 'Teixeira', 'Toledo', 'Valadares', 'Vasconcelos', 'Viana', 'Ximenes', 'Zanetti', 'do Vale', 'da Mata', 'dos Anjos', 'de Paula', 'Bragança'],
  },
  Argentina: {
    first: ['Agustín', 'Alan', 'Alexis', 'Bautista', 'Benjamín', 'Braian', 'Cristian', 'Dylan', 'Emiliano', 'Enzo', 'Exequiel', 'Facundo', 'Franco', 'Gastón', 'Germán', 'Gonzalo', 'Ignacio', 'Joaquín', 'Juan Cruz', 'Julián', 'Lautaro', 'Leandro', 'Lisandro', 'Luciano', 'Maxi', 'Matías', 'Mauro', 'Nahuel', 'Nicolás', 'Octavio', 'Pablo', 'Ramiro', 'Rodrigo', 'Santiago', 'Sebastián', 'Thiago', 'Tobías', 'Tomás', 'Valentín', 'Walter', 'Lucas', 'Ezequiel', 'Iván', 'Marcos'],
    last: ['Achával', 'Aguilera', 'Albornoz', 'Arce', 'Balbuena', 'Barrenechea', 'Benedetto', 'Bustos', 'Cabral', 'Cardozo', 'Castañeda', 'Coronel', 'Durañona', 'Echeverri', 'Fariña', 'Figueroa', 'Galván', 'Godoy', 'Ibarra', 'Insaurralde', 'Lezcano', 'Ludueña', 'Maidana', 'Mansilla', 'Mendiondo', 'Monzón', 'Nardelli', 'Ojeda', 'Pedernera', 'Pereyra', 'Quiroga', 'Rattalino', 'Rojas', 'Romagnoli', 'Saravia', 'Scarpetta', 'Sarmiento', 'Tagliaferro', 'Toledo', 'Ugarte', 'Vallejos', 'Vera', 'Villalba', 'Zalazar', 'Zubeldía', 'Bianchi', 'Colombo', 'Ferraro', 'Giuliani', 'Lombardi'],
  },
  USA: {
    first: ['Aidan', 'Anthony', 'Austin', 'Brandon', 'Brenden', 'Caden', 'Cameron', 'Chase', 'Cole', 'DeAndre', 'Diego', 'Dylan', 'Ethan', 'Gianluca', 'Griffin', 'Hunter', 'Jalen', 'Jesús', 'Jordan', 'Josh', 'Kelvin', 'Kevin', 'Landon', 'Logan', 'Malik', 'Mateo', 'Miles', 'Paxton', 'Quinn', 'Ricardo', 'Riley', 'Sergio', 'Tanner', 'Taylor', 'Trey', 'Tyler', 'Walker', 'Weston', 'Xavier', 'Zack', 'Darnell', 'Emmanuel', 'Kwadwo', 'Santiago'],
    last: ['Alvarado', 'Banks', 'Beaumont', 'Bridges', 'Calhoun', 'Castellano', 'Dawkins', 'Delgado', 'Easton', 'Fairbanks', 'Garrison', 'Hawthorne', 'Holloway', 'Jefferson', 'Kowalski', 'Landry', 'Mackenzie', 'Maddox', 'Navarrete', 'Oduro', 'Okonjo', 'Pruitt', 'Ramsey', 'Redmond', 'Sandoval', 'Sterling', 'Thibodeaux', 'Underwood', 'Valdivia', 'Whitaker', 'Yoon', 'Zeigler', 'Abernathy', 'Boateng-Price', 'Carmichael', 'Donnelly', 'Esposito', 'Fitzgerald', 'Gallagher', 'Huang', 'Ibekwe', 'Jankowski', 'Kessler', 'Lindqvist', 'Montgomery', 'Nakashima', 'Ostrowski', 'Petrosyan', 'Rosales', 'Stratton'],
  },
  Nigeria: {
    first: ['Abiodun', 'Adebayo', 'Akin', 'Bamidele', 'Chidera', 'Chidi', 'Chigozie', 'Chinedu', 'Chukwuma', 'Damilola', 'Ebuka', 'Efe', 'Ejike', 'Emeka', 'Femi', 'Gbenga', 'Ifeanyi', 'Ikenna', 'Jide', 'Kelechi', 'Kunle', 'Lekan', 'Nnamdi', 'Obinna', 'Odion', 'Olamide', 'Olumide', 'Onyeka', 'Osaze', 'Segun', 'Somto', 'Taiwo', 'Tobi', 'Tochukwu', 'Uzoma', 'Ugochukwu', 'Umar', 'Victor', 'Wale', 'Yakubu', 'Zubair', 'Ahmed', 'Sadiq', 'Kayode', 'Babatunde'],
    last: ['Abubakar', 'Adeleke', 'Adesanya', 'Agbaje', 'Ajayi', 'Akande', 'Akpan', 'Aluko', 'Amadi', 'Anyanwu', 'Babangida', 'Balogun', 'Chukwudi', 'Danjuma', 'Ebong', 'Egbuna', 'Ekpo', 'Ezenwa', 'Falade', 'Gambo', 'Ibekwe', 'Idowu', 'Igwe', 'Ihejirika', 'Ikemefuna', 'Kanayo', 'Lawal', 'Madu', 'Nwachukwu', 'Nwankwo', 'Nwosu', 'Obi', 'Odukoya', 'Ogbonna', 'Ogunleye', 'Okafor', 'Okeke', 'Olaniyan', 'Oloyede', 'Onuoha', 'Onwuzurike', 'Oyelaran', 'Salami', 'Sanusi', 'Tijani', 'Uchenna', 'Udoh', 'Umeh', 'Usman', 'Yusuf', 'Nwaogu', 'Chigoziri'],
  },
  Ghana: {
    first: ['Abdul', 'Abeiku', 'Afriyie', 'Agyeman', 'Akwasi', 'Baba', 'Bernard', 'Derrick', 'Ebo', 'Edmund', 'Emmanuel', 'Fiifi', 'Gideon', 'Ibrahim', 'Isaac', 'Jojo', 'Jordan', 'Kobina', 'Kojo', 'Kwabena', 'Kwadwo', 'Kwaku', 'Kwesi', 'Kweku', 'Majeed', 'Mohammed', 'Nana', 'Nii', 'Osei', 'Papa', 'Prince', 'Richmond', 'Salis', 'Samuel', 'Selorm', 'Sulley', 'Thomas', 'Yaw', 'Yoofi', 'Kofi', 'Kwame', 'Ekow', 'Fuseini', 'Elvis'],
    last: ['Abankwah', 'Acheampong', 'Adomako', 'Adjei', 'Afful', 'Agyapong', 'Agyei', 'Akoto', 'Amankwah', 'Amponsah', 'Ampofo', 'Annan', 'Ansah', 'Antwi', 'Aboagye', 'Asiedu', 'Asante', 'Ayensu', 'Baffour', 'Boadu', 'Bonsu', 'Darko', 'Danso', 'Dwamena', 'Eshun', 'Fosu-Mensah', 'Gyamfi', 'Gyimah', 'Kyei', 'Lartey', 'Nkansah', 'Nketia', 'Nyarko', 'Ofori', 'Oppong', 'Otoo', 'Owusu-Ansah', 'Paintsil', 'Quartey', 'Sarpong', 'Sowah', 'Tandoh', 'Tetteh', 'Wiredu', 'Yamoah', 'Yiadom', 'Zakaria', 'Abdulai', 'Iddrisu', 'Tawiah'],
  },
  Japan: {
    first: ['Akira', 'Ao', 'Daichi', 'Daiki', 'Eiji', 'Gaku', 'Genki', 'Hayato', 'Hideki', 'Hiroki', 'Itsuki', 'Junya', 'Kaito', 'Kaoru', 'Keito', 'Kento', 'Koki', 'Kota', 'Kyosuke', 'Makoto', 'Masaya', 'Minato', 'Naoki', 'Reo', 'Riku', 'Ritsu', 'Ryo', 'Ryota', 'Shogo', 'Shuto', 'Sota', 'Taiga', 'Takeru', 'Takehiro', 'Takuma', 'Tatsuya', 'Wataru', 'Yuito', 'Yuma', 'Yuta', 'Yuto', 'Zento', 'Haruto', 'Ren'],
    last: ['Aoyama', 'Arakawa', 'Enomoto', 'Fujimoto', 'Fukuda', 'Hamada', 'Hasegawa', 'Hayashi', 'Hirano', 'Ikeda', 'Imai', 'Inoue', 'Ishikawa', 'Iwata', 'Kaneshiro', 'Kawasaki', 'Kikuchi', 'Kimura', 'Kondo', 'Kuwabara', 'Maeda', 'Matsumoto', 'Minagawa', 'Miyamoto', 'Morita', 'Murakami', 'Nagai', 'Nishimura', 'Noguchi', 'Ogawa', 'Okada', 'Onishi', 'Sakurai', 'Sakamoto', 'Shibata', 'Shimizu', 'Sugiyama', 'Tanimoto', 'Tsukamoto', 'Uchida', 'Ueda', 'Wakabayashi', 'Watanabe', 'Yamada', 'Yamaguchi', 'Yoshida', 'Hoshino', 'Kurosawa', 'Tachibana', 'Furukawa'],
  },
  Australia: {
    first: ['Aiden', 'Angus', 'Archer', 'Bailey', 'Blake', 'Brodie', 'Cooper', 'Callan', 'Darcy', 'Declan', 'Flynn', 'Fraser', 'Harrison', 'Hamish', 'Jackson', 'Jai', 'Jordy', 'Kai', 'Koby', 'Lachlan', 'Liam', 'Marco', 'Mitch', 'Nash', 'Nikita', 'Oli', 'Patrick', 'Riley', 'Rory', 'Sam', 'Tate', 'Thomas', 'Trent', 'Xavier', 'Zac', 'Dimitri', 'Stefan', 'Tomi', 'Kosta', 'Luka', 'Jaxon', 'Lucas', 'Deng', 'Yianni'],
    last: ['Anastasiou', 'Atkinson', 'Ballantyne', 'Brannigan', 'Caruso', 'Cavallaro', 'Corrigan', 'Dalgleish', 'Delaney', 'Everingham', 'Farrugia', 'Galloway', 'Giannopoulos', 'Halloran', 'Hartigan', 'Jovanovic', 'Kavanagh', 'Kingsford', 'Lamberti', 'Lindeman', 'Macarthur', 'McTavish', 'Milanovic', 'Mulvaney', 'Nolan', 'Novak', 'Rourke', 'Papadopoulos', 'Paterson', 'Pellegrino', 'Rafferty', 'Ryder', 'Stojanovski', 'Talbot', 'Tavita', 'Toure', 'Vella', 'Warburton', 'Wentworth', 'Whitlam', 'Yilmaz', 'Zammit', 'Zoricich', 'Abernethy', 'Blackall', 'Coolibah', 'Dunstan', 'Fitzroy', 'Marangoni', 'Deng-Harris'],
  },
};

// Used for a nation that has no pool of its own.
const FALLBACK = {
  first: [...POOLS.England.first.slice(0, 12), ...POOLS.Spain.first.slice(0, 12), ...POOLS.Nigeria.first.slice(0, 12), ...POOLS.Japan.first.slice(0, 12)],
  last: [...POOLS.England.last.slice(0, 14), ...POOLS.Spain.last.slice(0, 14), ...POOLS.Nigeria.last.slice(0, 14), ...POOLS.Japan.last.slice(0, 14)],
};

const poolFor = nation => POOLS[nation] || FALLBACK;

// A name that depends only on the nation and a number (no RNG): used to rename existing saves.
function nameFromHash(nation, h) {
  const pool = poolFor(nation);
  return `${pool.first[h % pool.first.length]} ${pool.last[(h >>> 9) % pool.last.length]}`;
}

module.exports = { POOLS, poolFor, nameFromHash };
