// The 50 stunt levels. Pure data: map + stretch of road (from), features in riding order,
// objectives, star score thresholds, coin reward. Positions are resolved by course.js.
// Every level is checked by tools/stunt-validate.mjs (headless solver with the real physics).
//
// Feature specs: {t:'kick'|'table'|'gap'|'step'|'deck'|'rollers'|'barrels'|'pad'|'ring'|'target', ...}
// ring/target attach to the jump before them. Objectives: see objectives.js.

const L = [];
let n = 0;
/** tier: 1 beginner (1-15), 2 intermediate (16-30), 3 advanced (31-40), 4 expert (41-50) */
function level(def) {
  n++;
  L.push({ id: 'L' + String(n).padStart(2, '0'), n, tier: n <= 15 ? 1 : n <= 30 ? 2 : n <= 40 ? 3 : 4, countdown: 3, ...def });
}

// ================================================================ BEGINNER (1-15)
level({
  name: 'First Air',
  desc: 'Pedal up the kickers and get both wheels off the ground.',
  map: 'mountain',
  from: 440,
  features: [{ t: 'kick', h: 0.8, w: 6 }, { t: 'kick', h: 1.0, w: 6 }, { t: 'table', h: 1.2, top: 6, w: 7 }],
  objectives: { air: 0.5 },
  stars: [4000, 5100],
  reward: 100,
  tip: 'Hold PEDAL into the ramp. Landing straight is all it takes.',
});
level({
  name: 'Table Manners',
  desc: 'Three tabletops in a row: clear the tops for big air.',
  map: 'city',
  from: 80,
  features: [{ t: 'table', h: 1.2, top: 5 }, { t: 'table', h: 1.5, top: 7 }, { t: 'table', h: 1.8, top: 9 }],
  objectives: { airTotal: 2.0 },
  stars: [4200, 5200],
  reward: 120,
});
level({
  name: 'Mind the Gap',
  desc: 'Your first gap jump: carry speed and clear the pit.',
  map: 'coast',
  from: 640,
  features: [{ t: 'kick', h: 1.0, w: 6 }, { t: 'gap', h: 1.2, gap: 4 }, { t: 'gap', h: 1.4, gap: 6 }],
  objectives: { dist: 14 },
  stars: [3800, 5000],
  reward: 140,
});
level({
  name: 'Flip Academy',
  desc: 'A tall deck with a lip: press BRAKE in the air for a backflip.',
  map: 'canyon',
  from: 120,
  features: [{ t: 'deck', h: 2.0, deck: 14 }, { t: 'deck', h: 2.4, deck: 14 }],
  objectives: { backflips: 1 },
  stars: [2800, 3900],
  reward: 160,
  tip: 'In the air: release, then hold BRAKE (S) to flip. Let go before you land.',
});
level({
  name: 'Spin Cycle',
  desc: 'Steer in the air to spin a full 360.',
  map: 'canyon',
  from: 1560,
  features: [{ t: 'deck', h: 2.2, deck: 12 }, { t: 'table', h: 1.6, top: 8 }, { t: 'deck', h: 2.4, deck: 12 }],
  objectives: { spins: 1 },
  stars: [4700, 6200],
  reward: 170,
});

level({
  name: 'Ring Leader',
  desc: 'Fly through the rings on the long alpine descent.',
  map: 'alpine',
  from: 2160,
  features: [{ t: 'kick', h: 1.2 }, { t: 'ring', f: 0.45 }, { t: 'kick', h: 1.4 }, { t: 'ring', f: 0.5 }, { t: 'table', h: 1.2, top: 6 }],
  objectives: { rings: 2 },
  stars: [5000, 5600],
  reward: 180,
  tip: 'Rings sit on the line of a jump taken at the speed shown on the HUD.',
});
level({
  name: 'Bullseye',
  desc: 'Land inside the glowing target zones.',
  map: 'city',
  from: 1950,
  runup: 60,
  features: [{ t: 'kick', h: 1.0 }, { t: 'target', len: 8 }, { t: 'kick', h: 1.2 }, { t: 'target', len: 8 }],
  objectives: { targets: 1 },
  stars: [3100, 3400],
  reward: 180,
});
level({
  name: 'Barrel Roll',
  desc: 'Weave through the barrel rows without a scratch, then jump the last one.',
  map: 'forest',
  from: 560,
  features: [{ t: 'barrels', n: 3, space: 18, offset: 1.6 }, { t: 'kick', h: 1.1 }, { t: 'barrels', n: 2, space: 18, offset: 1.6 }, { t: 'table', h: 1.3, top: 6 }],
  objectives: { clean: 0 },
  stars: [2000, 2400],
  reward: 190,
});
level({
  name: 'Rollercoaster',
  desc: 'Pump the rollers and keep your speed through the tables.',
  map: 'coast',
  from: 700,
  time: 75,
  features: [{ t: 'rollers', n: 4 }, { t: 'table', h: 1.4, top: 6 }, { t: 'rollers', n: 4, h: 0.65 }, { t: 'table', h: 1.6, top: 8 }],
  objectives: { airTotal: 2.5 },
  stars: [8400, 8700],
  reward: 200,
});
level({
  name: 'Hands Free',
  desc: 'On the mountain descent: hold SPRINT in the air for a no-hander. Grab the bars before you land!',
  map: 'mountain',
  from: 1240,
  features: [{ t: 'deck', h: 2.0, deck: 10 }, { t: 'kick', h: 1.5 }],
  objectives: { style: 0.5 },
  stars: [2700, 3200],
  reward: 210,
  tip: 'Release SPRINT before touchdown or you crash.',
});
level({
  name: 'Front Runner',
  desc: 'Re-press PEDAL in the air to throw your first frontflip.',
  map: 'canyon',
  from: 1560,
  features: [{ t: 'deck', h: 2.4, deck: 12 }, { t: 'table', h: 1.6, top: 7 }, { t: 'deck', h: 2.6, deck: 12 }],
  objectives: { frontflips: 1 },
  stars: [4700, 7200],
  reward: 220,
});
level({
  name: 'Combo Starter',
  desc: 'Chain jumps without crashing: each clean landing grows the multiplier.',
  map: 'canyon',
  from: 2820,
  runup: 40,
  features: [{ t: 'kick', h: 1.0, gap: 8 }, { t: 'kick', h: 1.0, gap: 10 }, { t: 'kick', h: 1.1, gap: 10 }],
  objectives: { combo: 3 },
  stars: [3700, 5000],
  reward: 230,
});
level({
  name: 'Long Haul',
  desc: 'Steep alpine descent and wide gaps: send it as far as you can.',
  map: 'alpine',
  from: 2300,
  features: [{ t: 'gap', h: 1.3, gap: 6 }, { t: 'gap', h: 1.5, gap: 9 }, { t: 'kick', h: 1.6 }],
  objectives: { dist: 26 },
  stars: [4200, 5200],
  reward: 240,
});
level({
  name: 'Perfect Ten',
  desc: 'Smooth, level landings: three of them perfect.',
  map: 'coast',
  from: 900,
  features: [{ t: 'table', h: 1.2, top: 6 }, { t: 'kick', h: 1.0 }, { t: 'table', h: 1.4, top: 7 }, { t: 'kick', h: 1.2 }],
  objectives: { perfect: 3 },
  stars: [6000, 7800],
  reward: 250,
});
level({
  name: 'Graduation',
  desc: 'Beginner final: a backflip, a 360 and a clean finish line.',
  map: 'mountain',
  from: 450,
  features: [{ t: 'deck', h: 2.2, deck: 10 }, { t: 'kick', h: 1.2 }, { t: 'table', h: 1.5, top: 7 }, { t: 'deck', h: 2.4, deck: 10 }],
  objectives: { backflips: 1, spins: 1, score: 3000 },
  stars: [5300, 6900],
  reward: 300,
});

// ================================================================ INTERMEDIATE (16-30)
level({
  name: 'Double Trouble',
  desc: 'The canyon mega-deck gives enough air for a double flip.',
  map: 'canyon',
  from: 150,
  features: [{ t: 'deck', h: 3.0, deck: 14, lip: 0.9, v: 22 }, { t: 'deck', h: 3.2, deck: 14, lip: 0.9, v: 22 }],
  objectives: { flipJump: 2 },
  stars: [3200, 4800],
  reward: 320,
});
level({
  name: 'Step It Up',
  desc: 'Gap up onto higher decks and stick the targets.',
  map: 'city',
  from: 80,
  features: [{ t: 'step', h: 1.2, gap: 4, h2: 1.6, deck: 10 }, { t: 'kick', h: 1.0 }, { t: 'target', len: 7 }, { t: 'step', h: 1.4, gap: 5, h2: 2.0, deck: 10 }, { t: 'kick', h: 1.2 }, { t: 'target', len: 7 }],
  objectives: { targets: 2 },
  stars: [7300, 9500],
  reward: 330,
});
level({
  name: 'Ring of Fire',
  desc: 'Four rings over four jumps through the night city. Match the speed for each one.',
  map: 'city',
  from: 20,
  runup: 60,
  features: [{ t: 'kick', h: 1.0 }, { t: 'ring', f: 0.5 }, { t: 'kick', h: 1.3 }, { t: 'ring', f: 0.4 }, { t: 'kick', h: 1.5 }, { t: 'ring', f: 0.55 }, { t: 'table', h: 1.6, top: 6 }, { t: 'ring', f: 0.5 }],
  objectives: { rings: 4 },
  stars: [8100, 10000],
  reward: 340,
});
level({
  name: 'Corkscrew Canyon',
  desc: 'Flip and spin in the same jump: the corkscrew.',
  map: 'canyon',
  from: 1560,
  features: [{ t: 'deck', h: 2.8, deck: 12, lip: 0.9, v: 21 }, { t: 'deck', h: 3.0, deck: 12, lip: 0.9, v: 21 }, { t: 'kick', h: 1.6 }],
  objectives: { corkscrew: 1 },
  stars: [4800, 6800],
  reward: 350,
});
level({
  name: 'Narrow Escape',
  desc: 'The tight forest road: a barrel slalom, then gaps with nowhere to bail.',
  map: 'forest',
  from: 560,
  features: [{ t: 'barrels', n: 3, space: 20, offset: 1.5, lane: 2.4 }, { t: 'gap', h: 1.2, gap: 5 }, { t: 'gap', h: 1.3, gap: 6 }, { t: 'barrels', n: 2, space: 20, offset: 1.5, lane: 2.4 }],
  objectives: { clean: 1, dist: 12 },
  stars: [2200, 3200],
  reward: 360,
});
level({
  name: 'Coastal Combo',
  desc: 'Five jumps close together: keep the chain alive to x2.5.',
  map: 'coast',
  from: 720,
  features: [{ t: 'kick', h: 1.0, gap: 10 }, { t: 'kick', h: 1.1, gap: 12 }, { t: 'table', h: 1.3, top: 5, gap: 12 }, { t: 'kick', h: 1.2, gap: 12 }, { t: 'kick', h: 1.3, gap: 12 }],
  objectives: { combo: 4 },
  stars: [8000, 12300],
  reward: 370,
});
level({
  name: 'Seven-Twenty',
  desc: 'Two full turns in the air: the 720.',
  map: 'canyon',
  from: 470,
  features: [{ t: 'deck', h: 3.6, deck: 12, lip: 1.0, v: 23 }, { t: 'kick', h: 1.6 }],
  objectives: { spinJump: 2 },
  stars: [2900, 3900],
  reward: 380,
});
level({
  name: 'Time Attack',
  desc: 'Night city sprint: clear every gap and beat the clock.',
  map: 'city',
  from: 400,
  runup: 50,
  time: 45,
  features: [{ t: 'pad', d: 0 }, { t: 'gap', h: 1.2, gap: 6 }, { t: 'pad', d: 0 }, { t: 'gap', h: 1.4, gap: 8 }],
  objectives: { time: 30, dist: 16 },
  stars: [2500, 3400],
  reward: 390,
});
level({
  name: 'Night Gaps',
  desc: 'Nitro pads feed three big gaps under the city lights.',
  map: 'city',
  from: 40,
  features: [{ t: 'pad', d: 0 }, { t: 'gap', h: 1.4, gap: 9 }, { t: 'pad', d: 0 }, { t: 'gap', h: 1.6, gap: 11 }, { t: 'pad', d: 0 }, { t: 'gap', h: 1.8, gap: 13 }],
  objectives: { dist: 24, clean: 2 },
  stars: [3600, 4700],
  reward: 400,
});
level({
  name: 'Frontside Mountain',
  desc: 'Three frontflips on the original course, from the climb to the descent.',
  map: 'mountain',
  from: 900,
  features: [{ t: 'deck', h: 2.4, deck: 10, v: 18 }, { t: 'deck', h: 2.6, deck: 10, v: 20 }, { t: 'kick', h: 1.5 }],
  objectives: { frontflips: 3 },
  stars: [4500, 7200],
  reward: 410,
});
level({
  name: 'Target Practice',
  desc: 'Three landing zones, each a little tighter.',
  map: 'coast',
  from: 720,
  features: [{ t: 'kick', h: 1.1 }, { t: 'target', len: 7 }, { t: 'table', h: 1.4, top: 4 }, { t: 'target', len: 6 }, { t: 'kick', h: 1.4 }, { t: 'target', len: 5 }],
  objectives: { targets: 3 },
  stars: [5600, 6700],
  reward: 420,
});
level({
  name: 'Air Miles',
  desc: 'Rack up eight seconds of hang time on the alpine descent.',
  map: 'alpine',
  from: 1700,
  features: [{ t: 'deck', h: 2.6, deck: 10 }, { t: 'kick', h: 1.6 }, { t: 'deck', h: 2.8, deck: 10 }, { t: 'kick', h: 1.8 }, { t: 'kick', h: 1.6 }, { t: 'deck', h: 3.0, deck: 10 }],
  objectives: { airTotal: 8 },
  stars: [10500, 16200],
  reward: 430,
});
level({
  name: 'Style Points',
  desc: 'Hold a one-second no-hander and still put up a score.',
  map: 'canyon',
  from: 300,
  features: [{ t: 'deck', h: 2.8, deck: 12, lip: 0.9, v: 21 }, { t: 'table', h: 1.6, top: 8 }, { t: 'deck', h: 3.0, deck: 12, lip: 0.9, v: 21 }],
  objectives: { style: 1.0, score: 5000 },
  stars: [5500, 6000],
  reward: 440,
});
level({
  name: 'Forest Flow',
  desc: 'Rollers into tables in the pines: three perfect landings.',
  map: 'forest',
  from: 560,
  features: [{ t: 'rollers', n: 3 }, { t: 'table', h: 1.3, top: 6 }, { t: 'rollers', n: 3, h: 0.6 }, { t: 'table', h: 1.5, top: 6 }],
  objectives: { perfect: 3, airTotal: 2.5 },
  stars: [8500, 10000],
  reward: 450,
});
level({
  name: 'Intermediate Final',
  desc: 'A double flip, a 360 and two perfect landings on the original course.',
  map: 'mountain',
  from: 900,
  features: [{ t: 'deck', h: 3.0, deck: 10, lip: 0.9, v: 21 }, { t: 'deck', h: 3.2, deck: 10, lip: 0.9, v: 23 }, { t: 'kick', h: 1.4 }],
  objectives: { flipJump: 2, spins: 1, perfect: 2 },
  stars: [4800, 6600],
  reward: 500,
});

// ================================================================ ADVANCED (31-40)
level({
  name: 'Triple Threat',
  desc: 'The mega decks on the canyon floor: three flips in one jump.',
  map: 'canyon',
  from: 20,
  runup: 60,
  features: [{ t: 'deck', slope: -0.12, h: 5.5, deck: 10, lip: 1.5, v: 28 }, { t: 'deck', slope: -0.12, h: 5.5, deck: 10, lip: 1.5, v: 28 }],
  objectives: { flipJump: 3 },
  stars: [3900, 7500],
  reward: 550,
});
level({
  name: 'Precision Pilot',
  desc: 'Four narrow landing zones between the city towers.',
  map: 'city',
  from: 60,
  features: [{ t: 'kick', h: 1.0 }, { t: 'target', len: 5 }, { t: 'kick', h: 1.2 }, { t: 'target', len: 5 }, { t: 'table', h: 1.4, top: 5 }, { t: 'target', len: 4.5 }, { t: 'kick', h: 1.3 }, { t: 'target', len: 4.5 }],
  objectives: { targets: 4 },
  stars: [8400, 11100],
  reward: 560,
});
level({
  name: 'Ringmaster',
  desc: 'Six rings on the Riviera: every speed matters.',
  map: 'coast',
  from: 700,
  features: [
    { t: 'kick', h: 1.0 }, { t: 'ring', f: 0.5 },
    { t: 'kick', h: 1.2 }, { t: 'ring', f: 0.35 }, { t: 'ring', f: 0.7 },
    { t: 'table', h: 1.5, top: 6 }, { t: 'ring', f: 0.5 },
    { t: 'kick', h: 1.4 }, { t: 'ring', f: 0.4 }, { t: 'ring', f: 0.75 },
  ],
  objectives: { rings: 6 },
  stars: [9200, 11600],
  reward: 570,
});
level({
  name: 'Gap Marathon',
  desc: 'Four ever-wider gaps out of the alpine village, no crashes allowed.',
  map: 'alpine',
  from: 20,
  runup: 60,
  features: [{ t: 'gap', h: 1.3, gap: 8 }, { t: 'gap', h: 1.5, gap: 10 }, { t: 'gap', h: 1.6, gap: 11 }, { t: 'gap', h: 1.7, gap: 12 }],
  objectives: { clean: 0, dist: 28 },
  stars: [5300, 8000],
  reward: 580,
});
level({
  name: 'Corkscrew Combo',
  desc: 'Three corkscrews and a x2 combo.',
  map: 'canyon',
  from: 1560,
  features: [{ t: 'deck', h: 3.0, deck: 10, lip: 0.9, v: 21 }, { t: 'kick', h: 1.8, gap: 14 }, { t: 'deck', h: 3.0, deck: 10, lip: 0.9, v: 21, gap: 14 }, { t: 'kick', h: 1.8, gap: 14 }, { t: 'deck', h: 3.2, deck: 10, lip: 0.9, v: 21, gap: 14 }],
  objectives: { corkscrew: 3, combo: 3 },
  stars: [10000, 16100],
  reward: 600,
});
level({
  name: 'Barrel Gauntlet',
  desc: 'Long barrel slalom against the clock.',
  map: 'forest',
  from: 560,
  time: 80,
  features: [{ t: 'barrels', n: 5, space: 19, offset: 1.5, lane: 2.4 }, { t: 'kick', h: 1.2 }, { t: 'barrels', n: 4, space: 19, offset: 1.6, lane: 2.4 }, { t: 'table', h: 1.4, top: 6 }],
  objectives: { time: 68, clean: 0 },
  stars: [2000, 2900],
  reward: 610,
});
level({
  name: 'The Big Drop',
  desc: 'A mega deck off the steepest alpine slope: 1.6 seconds of air in one jump.',
  map: 'alpine',
  from: 1780,
  features: [{ t: 'deck', slope: -0.15, h: 5.0, deck: 12, lip: 1.4, v: 26 }, { t: 'kick', h: 1.6 }],
  objectives: { air: 1.6 },
  stars: [2900, 5100],
  reward: 620,
});
level({
  name: 'Spin Doctor',
  desc: 'Five 360s from the mountain climb to the descent.',
  map: 'mountain',
  from: 900,
  features: [{ t: 'deck', h: 2.8, deck: 10, lip: 0.9, v: 21 }, { t: 'deck', h: 3.0, deck: 10, lip: 0.9, v: 22 }, { t: 'kick', h: 1.6 }],
  objectives: { spins: 5 },
  stars: [5000, 6100],
  reward: 640,
});
level({
  name: 'Step Ladder',
  desc: 'Four climbing step-ups, landed perfectly.',
  map: 'city',
  from: 80,
  features: [{ t: 'step', h: 1.2, gap: 4, h2: 1.6, deck: 8 }, { t: 'step', h: 1.4, gap: 5, h2: 1.9, deck: 8 }, { t: 'step', h: 1.6, gap: 6, h2: 2.2, deck: 8 }, { t: 'step', h: 1.8, gap: 6, h2: 2.5, deck: 8 }],
  objectives: { perfect: 4, clean: 1 },
  stars: [6000, 9700],
  reward: 650,
});
level({
  name: 'Advanced Final',
  desc: 'Rings, a target and a double flip down the Riviera.',
  map: 'coast',
  from: 1000,
  features: [{ t: 'kick', h: 1.2 }, { t: 'ring', f: 0.5 }, { t: 'kick', h: 1.3, v: 18 }, { t: 'target', len: 6 }, { t: 'deck', h: 3.6, deck: 10, lip: 1.0, v: 24 }, { t: 'kick', h: 1.4 }, { t: 'ring', f: 0.5 }],
  objectives: { rings: 2, targets: 1, flipJump: 2, score: 9000 },
  stars: [9900, 11900],
  reward: 700,
});

// ================================================================ EXPERT (41-50)
level({
  name: 'Mega Ramp',
  desc: 'The tallest decks in the game, down the canyon descent.',
  map: 'canyon',
  from: 1480,
  features: [{ t: 'deck', h: 6.0, deck: 12, lip: 1.5, v: 29 }, { t: 'deck', h: 5.5, deck: 12, lip: 1.5, v: 28 }],
  objectives: { air: 1.8, flips: 4 },
  stars: [3900, 8000],
  reward: 750,
});
level({
  name: 'Triple Crown',
  desc: 'A triple flip off the alpine mega deck, then a corkscrew.',
  map: 'alpine',
  from: 2560,
  runup: 180,
  features: [{ t: 'deck', slope: -0.16, h: 6.0, deck: 12, lip: 1.5, v: 29 }, { t: 'kick', h: 1.8 }],
  objectives: { flipJump: 3, corkscrew: 1 },
  stars: [3300, 6300],
  reward: 800,
});
level({
  name: 'Ten-Eighty',
  desc: 'Three full spins in one jump: the 1080, on the mountain descent.',
  map: 'mountain',
  from: 920,
  features: [{ t: 'deck', h: 4.0, deck: 10, lip: 1.2, v: 24 }, { t: 'deck', slope: -0.12, h: 5.5, deck: 10, lip: 1.5, v: 28 }],
  objectives: { spinJump: 3 },
  stars: [3400, 4100],
  reward: 820,
});
level({
  name: 'Laser Precision',
  desc: 'Tiny landing zones in the canyon, every one landed perfectly.',
  map: 'canyon',
  from: 2820,
  runup: 36,
  runout: 12,
  features: [{ t: 'kick', h: 1.0, gap: 6 }, { t: 'target', len: 3.5 }, { t: 'kick', h: 1.1, gap: 4 }, { t: 'target', len: 3.5 }, { t: 'kick', h: 1.1, gap: 4 }, { t: 'target', len: 3.5 }],
  objectives: { targets: 3, perfect: 3 },
  stars: [5500, 7600],
  reward: 840,
});
level({
  name: 'Ring Gauntlet',
  desc: 'Eight rings, at most one crash.',
  map: 'canyon',
  from: 1560,
  features: [
    { t: 'kick', h: 1.0 }, { t: 'ring', f: 0.3 }, { t: 'ring', f: 0.7 },
    { t: 'kick', h: 1.3 }, { t: 'ring', f: 0.35 }, { t: 'ring', f: 0.7 },
    { t: 'deck', h: 2.6, deck: 10, v: 18 }, { t: 'ring', f: 0.3 }, { t: 'ring', f: 0.6 },
    { t: 'kick', h: 1.5 }, { t: 'ring', f: 0.4 }, { t: 'ring', f: 0.75 },
  ],
  objectives: { rings: 8, clean: 1 },
  stars: [8300, 11400],
  reward: 860,
});
level({
  name: 'No Hands Hero',
  desc: 'A 1.3 s no-hander and a x2 combo on the canyon descent.',
  map: 'canyon',
  from: 600,
  features: [{ t: 'deck', h: 4.5, deck: 10, lip: 1.2, v: 26 }, { t: 'kick', h: 1.6, gap: 12 }, { t: 'deck', h: 4.5, deck: 10, lip: 1.2, v: 26, gap: 12 }],
  objectives: { style: 1.3, combo: 3 },
  stars: [5100, 8700],
  reward: 880,
});
level({
  name: 'Speed Demon',
  desc: 'Canyon gaps flat out against a brutal clock.',
  map: 'canyon',
  from: 60,
  time: 70,
  features: [{ t: 'pad', d: 0 }, { t: 'gap', h: 1.4, gap: 10 }, { t: 'pad', d: 0 }, { t: 'gap', h: 1.6, gap: 13 }, { t: 'pad', d: 0 }, { t: 'gap', h: 1.8, gap: 15 }, { t: 'kick', h: 1.6 }],
  objectives: { time: 50, dist: 28 },
  stars: [4100, 6800],
  reward: 900,
});
level({
  name: 'Forest Frenzy',
  desc: 'Barrels, kickers, a gap and rollers in the pines with a x2 combo.',
  map: 'forest',
  from: 560,
  features: [{ t: 'barrels', n: 3, space: 18, offset: 1.5, lane: 2.4 }, { t: 'kick', h: 1.1, gap: 10 }, { t: 'kick', h: 1.2, gap: 10 }, { t: 'gap', h: 1.3, gap: 6 }, { t: 'rollers', n: 3 }, { t: 'table', h: 1.4, top: 6 }],
  objectives: { combo: 3, clean: 1 },
  stars: [9200, 14000],
  reward: 920,
});
level({
  name: 'The Gauntlet',
  desc: 'Everything at once on the canyon floor.',
  map: 'canyon',
  from: 150,
  features: [
    { t: 'gap', h: 1.4, gap: 9 }, { t: 'barrels', n: 3, space: 20, offset: 2, lane: 2.6 },
    { t: 'deck', h: 3.6, deck: 12, lip: 1.0, v: 24, gap: 80 }, { t: 'ring', f: 0.45 },
    { t: 'kick', h: 1.4, v: 18 }, { t: 'target', len: 6 },
    { t: 'deck', h: 3.6, deck: 12, lip: 1.0, v: 24 },
  ],
  objectives: { flipJump: 2, rings: 1, targets: 1, clean: 1, score: 8000 },
  stars: [8800, 10500],
  reward: 950,
});
level({
  name: 'Legend',
  desc: 'The final exam: flips, spins, corkscrews, no crashes.',
  map: 'canyon',
  from: 1560,
  features: [
    { t: 'deck', h: 3.6, deck: 10, lip: 1.0, v: 24 },
    { t: 'kick', h: 1.8, gap: 14 },
    { t: 'deck', h: 3.8, deck: 10, lip: 1.0, v: 24, gap: 14 },
    { t: 'kick', h: 1.8, gap: 14 },
    { t: 'deck', h: 4.0, deck: 10, lip: 1.1, v: 25, gap: 14 },
  ],
  objectives: { flipJump: 2, spinJump: 2, corkscrew: 2, clean: 0, score: 14000 },
  stars: [14900, 15200],
  reward: 1200,
});

export const STUNT_LEVELS = L;
export const STUNT_LEVEL_BY_ID = Object.fromEntries(L.map((l) => [l.id, l]));
export const levelIndex = (id) => L.findIndex((l) => l.id === id);
