// The Gaffer's match commentary: the script the commentator's voice is recorded from
// (tools/commentary/build-commentary.py) and the game plays back (public/commentary.js).
// Original lines in a British football-broadcast style; no famous commentator's phrases.
//
// Every line is a complete utterance, so each recording has natural intonation. A call ties lines
// together: optionally a name call-out (his surname, recorded on its own), then a line, then for
// goals and results a context line. Intensity: 0 calm, 1 lively, 2 excited (goals, big moments).
//   [kind]: [ { id, text, i (intensity), name (a name call-out goes first: 'player', 'keeper', 'in') } ]
export const LINES = {
  kickoff: [
    { id: 'ko1', text: "And we're under way.", i: 1 }, { id: 'ko2', text: 'Here we go, then.', i: 1 }, { id: 'ko3', text: 'The referee gets us started.', i: 1 },
    { id: 'ko4', text: 'Kick-off, and the game is under way.', i: 1 }, { id: 'ko5', text: "And we're off and running.", i: 1 }, { id: 'ko6', text: 'Off we go. Plenty to play for today.', i: 1 },
  ],
  kickoff2: [
    { id: 'kt1', text: 'The second half is under way.', i: 1 }, { id: 'kt2', text: "And we're back under way for the second half.", i: 1 },
    { id: 'kt3', text: 'Here we go again. Forty-five minutes to play.', i: 1 }, { id: 'kt4', text: 'The second half gets going.', i: 1 },
  ],
  build: [
    { id: 'bu1', text: 'Takes his time on the ball.', i: 0, name: 'player' }, { id: 'bu2', text: 'Looks up, and picks his pass.', i: 0, name: 'player' },
    { id: 'bu3', text: 'Happy to keep it for now.', i: 0, name: 'player' }, { id: 'bu4', text: 'Plays it simply.', i: 0, name: 'player' },
    { id: 'bu5', text: 'Patient stuff, this.', i: 0 }, { id: 'bu6', text: "They're knocking it about at the back.", i: 0 }, { id: 'bu7', text: 'Nice and composed in possession.', i: 0 },
    { id: 'bu8', text: 'Just probing for an opening.', i: 0 }, { id: 'bu9', text: 'Plenty of the ball for them at the moment.', i: 0 }, { id: 'bu10', text: "They're in no hurry.", i: 0 },
  ],
  attack: [
    { id: 'at1', text: 'Here they come.', i: 1 }, { id: 'at2', text: 'This looks promising.', i: 1 }, { id: 'at3', text: "They've got numbers forward here.", i: 1 },
    { id: 'at4', text: 'Could be dangerous, this.', i: 1 }, { id: 'at5', text: 'Good space to attack.', i: 1 },
    { id: 'at6', text: "He's got room here.", i: 1, name: 'player' }, { id: 'at7', text: "He's away.", i: 1, name: 'player' }, { id: 'at8', text: 'Drives forward.', i: 1, name: 'player' },
  ],
  dribble: [
    { id: 'dr1', text: 'Takes him on!', i: 1, name: 'player' }, { id: 'dr2', text: 'Skips past one!', i: 1, name: 'player' }, { id: 'dr3', text: 'Lovely feet!', i: 1, name: 'player' },
    { id: 'dr4', text: 'Goes past him!', i: 1, name: 'player' }, { id: 'dr5', text: 'Beats his man!', i: 1, name: 'player' }, { id: 'dr6', text: 'Runs at the defence!', i: 1, name: 'player' },
  ],
  cross: [
    { id: 'cr1', text: 'Whips it in!', i: 1, name: 'player' }, { id: 'cr2', text: "Here's the cross!", i: 1, name: 'player' }, { id: 'cr3', text: 'Swings it in!', i: 1, name: 'player' },
    { id: 'cr4', text: 'Looking for a head in the middle!', i: 1, name: 'player' }, { id: 'cr5', text: 'The cross comes in.', i: 1 },
  ],
  through: [
    { id: 'th1', text: 'Threads it through!', i: 1, name: 'player' }, { id: 'th2', text: 'Picks out the run!', i: 1, name: 'player' },
    { id: 'th3', text: 'Lovely ball in behind!', i: 1 }, { id: 'th4', text: "That's a brilliant pass!", i: 1 },
  ],
  longball: [
    { id: 'lb1', text: 'Long ball forward.', i: 0 }, { id: 'lb2', text: 'Sent long, early.', i: 0 }, { id: 'lb3', text: 'Goes long.', i: 0, name: 'player' },
  ],
  keepball: [
    { id: 'kb1', text: "They're stringing the passes together now.", i: 0 }, { id: 'kb2', text: 'Lovely possession, this.', i: 0 },
    { id: 'kb3', text: 'Keeping the ball beautifully.', i: 0 }, { id: 'kb4', text: 'Pass after pass from them.', i: 0 },
  ],
  tackle: [
    { id: 'tk1', text: 'Great tackle!', i: 1 }, { id: 'tk2', text: 'Superb challenge!', i: 1 }, { id: 'tk3', text: 'Won it cleanly.', i: 1 },
    { id: 'tk4', text: 'Wins it back!', i: 1, name: 'player' }, { id: 'tk5', text: 'What a tackle!', i: 1, name: 'player' },
  ],
  interception: [
    { id: 'ic1', text: 'Cut out!', i: 1 }, { id: 'ic2', text: 'Intercepted!', i: 1 }, { id: 'ic3', text: 'Read that one well.', i: 0 },
    { id: 'ic4', text: 'Reads it!', i: 1, name: 'player' }, { id: 'ic5', text: 'Steps in and nicks it!', i: 1, name: 'player' },
  ],
  shot: [
    { id: 'sh1', text: 'Shoots!', i: 2, name: 'player' }, { id: 'sh2', text: 'Has a go!', i: 2, name: 'player' }, { id: 'sh3', text: 'Lets fly!', i: 2, name: 'player' },
    { id: 'sh4', text: 'Tries his luck!', i: 2, name: 'player' }, { id: 'sh5', text: "Here's the shot!", i: 2 }, { id: 'sh6', text: 'And the shot!', i: 2 },
  ],
  // A goal: the call, his name, then a line for the situation.
  goal: [
    { id: 'gl1', text: 'Goal!', i: 2 }, { id: 'gl2', text: "It's in!", i: 2 }, { id: 'gl3', text: "And it's there!", i: 2 }, { id: 'gl4', text: "He's scored!", i: 2 }, { id: 'gl5', text: 'What a finish!', i: 2 },
  ],
  goalLevel: [{ id: 'gq1', text: "And they're level!", i: 2 }, { id: 'gq2', text: "That's the equaliser!", i: 2 }, { id: 'gq3', text: 'All square again!', i: 2 }],
  goalAhead: [{ id: 'ga1', text: "And they're in front!", i: 2 }, { id: 'ga2', text: 'That puts them ahead!', i: 2 }, { id: 'ga3', text: 'They lead!', i: 2 }],
  goalMore: [{ id: 'gm1', text: "They've doubled their advantage!", i: 2 }, { id: 'gm2', text: "Now they're pulling away!", i: 2 }, { id: 'gm3', text: "That's a big goal!", i: 2 }],
  goalLate: [{ id: 'gw1', text: "Surely that's the winner!", i: 2 }, { id: 'gw2', text: 'What a moment, at the death!', i: 2 }],
  goalLate2: [{ id: 'gz1', text: 'Late drama! They have the equaliser!', i: 2 }],
  goalConsolation: [{ id: 'gc1', text: 'A consolation, perhaps.', i: 1 }, { id: 'gc2', text: 'Is it too little, too late?', i: 1 }],
  goalPraise: [{ id: 'gp1', text: 'What a goal!', i: 2 }, { id: 'gp2', text: 'Brilliantly taken!', i: 2 }, { id: 'gp3', text: 'Superb finish!', i: 2 }, { id: 'gp4', text: 'He made no mistake there!', i: 2 }],
  save: [
    { id: 'sv1', text: 'Great save!', i: 2 }, { id: 'sv2', text: 'What a stop!', i: 2 }, { id: 'sv3', text: 'Kept out!', i: 2 }, { id: 'sv4', text: 'Denied!', i: 2 },
    { id: 'sv5', text: 'Superb from the goalkeeper!', i: 2 }, { id: 'sv6', text: 'Gets down well!', i: 2, name: 'keeper' }, { id: 'sv7', text: 'Saves!', i: 2, name: 'keeper' }, { id: 'sv8', text: 'Turns it away!', i: 2, name: 'keeper' },
  ],
  punch: [{ id: 'pu1', text: 'Punched clear!', i: 1 }, { id: 'pu2', text: 'Fisted away!', i: 1 }, { id: 'pu3', text: 'Punches it away!', i: 1, name: 'keeper' }],
  miss: [
    { id: 'ms1', text: 'Just wide!', i: 2 }, { id: 'ms2', text: 'Over the bar!', i: 2 }, { id: 'ms3', text: 'So close!', i: 2 }, { id: 'ms4', text: 'Off target.', i: 1 },
    { id: 'ms5', text: "He'll be disappointed with that.", i: 1 }, { id: 'ms6', text: 'Wide of the post.', i: 1 }, { id: 'ms7', text: 'Not far away.', i: 1 },
  ],
  woodwork: [{ id: 'ww1', text: 'Off the post!', i: 2 }, { id: 'ww2', text: "It's hit the woodwork!", i: 2 }, { id: 'ww3', text: 'Off the bar!', i: 2 }, { id: 'ww4', text: 'Inches away!', i: 2 }, { id: 'ww5', text: 'Agonisingly close!', i: 2 }],
  yellow: [
    { id: 'yc1', text: "That's a booking.", i: 1 }, { id: 'yc2', text: 'Yellow card.', i: 1 }, { id: 'yc3', text: 'The referee shows yellow.', i: 1 },
    { id: 'yc4', text: 'Goes into the book.', i: 1, name: 'player' },
  ],
  red: [{ id: 'rc1', text: 'Red card!', i: 2 }, { id: 'rc2', text: "He's been sent off!", i: 2 }, { id: 'rc3', text: "That's a straight red!", i: 2 }, { id: 'rc4', text: 'Off he goes!', i: 2 }, { id: 'rc5', text: 'Is sent off!', i: 2, name: 'player' }],
  injury: [{ id: 'in1', text: "He's down.", i: 0 }, { id: 'in2', text: 'A worry here.', i: 0 }, { id: 'in3', text: 'He needs treatment.', i: 0 }, { id: 'in4', text: 'Is down, and needs treatment.', i: 0, name: 'player' }],
  sub: [{ id: 'sb1', text: 'Comes on.', i: 0, name: 'in' }, { id: 'sb2', text: 'Coming on to make a difference.', i: 0, name: 'in' }, { id: 'sb3', text: 'Fresh legs for them.', i: 0 }, { id: 'sb4', text: 'A change being made.', i: 0 }],
  half: [{ id: 'hf1', text: "That's half-time.", i: 1 }, { id: 'hf2', text: 'The referee blows for half-time.', i: 1 }, { id: 'hf3', text: "And that's the end of the first half.", i: 1 }],
  halfNil: [{ id: 'hn1', text: 'Goalless at the break.', i: 0 }],
  halfHome: [{ id: 'hh1', text: 'The home side lead at the break.', i: 0 }],
  halfAway: [{ id: 'ha1', text: 'The visitors lead at the break.', i: 0 }],
  halfLevel: [{ id: 'hl1', text: 'All square at half-time.', i: 0 }],
  full: [{ id: 'fu1', text: "And that's full-time!", i: 2 }, { id: 'fu2', text: 'The final whistle goes!', i: 2 }, { id: 'fu3', text: "It's all over!", i: 2 }],
  fullHome: [{ id: 'fh1', text: 'The home side take the points.', i: 1 }, { id: 'fh2', text: 'A win for the home side.', i: 1 }],
  fullAway: [{ id: 'fa1', text: 'The visitors take the points.', i: 1 }, { id: 'fa2', text: 'An away win, then.', i: 1 }],
  fullDraw: [{ id: 'fd1', text: 'It ends level.', i: 1 }, { id: 'fd2', text: 'The points are shared.', i: 1 }],
  fullNil: [{ id: 'fn1', text: 'A goalless draw.', i: 0 }],
  late: [{ id: 'lt1', text: "We're into the final minutes.", i: 1 }, { id: 'lt2', text: 'Not long to go now.', i: 1 }, { id: 'lt3', text: 'Time is running out.', i: 1 }],
  replay: [{ id: 'rp1', text: "Let's see that again.", i: 0 }, { id: 'rp2', text: "Here's another look.", i: 0 }, { id: 'rp3', text: 'Have a look at this again.', i: 0 }],
};

// The score, read with the leader first ("two-one"), then who leads; level scores are "one all".
const WORD = ['nil', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const SCORES = [];
for (let a = 1; a <= 9; a++) for (let b = 0; b < a; b++) SCORES.push({ id: `s${a}${b}`, text: `It's ${WORD[a]}-${WORD[b]}.`, i: 1 });
for (let a = 1; a <= 6; a++) SCORES.push({ id: `s${a}${a}`, text: `It's ${WORD[a]} all.`, i: 1 });
SCORES.push({ id: 'sideHome', text: 'To the home side.', i: 1 }, { id: 'sideAway', text: 'To the visitors.', i: 1 });

export const VOICE = { blend: [['bm_george', 0.6], ['bm_lewis', 0.4]], lang: 'en-gb', speed: [0.98, 1.04, 1.12], lift: [1, 1, 1.045] };
