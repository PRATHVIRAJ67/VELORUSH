// Stunt mode progression, stored inside the existing local profile (localStorage key
// velorush.profile.v1, field `stunt`). LOCAL ONLY: there is no account or server-side save, so
// coins and unlocks live in this browser and can be edited by the player — nothing here is
// trusted by the server. Versioned + migrated so existing saves keep working.
import { STUNT_LEVELS, STUNT_LEVEL_BY_ID, levelIndex } from '@shared/stunts/levels.js';
import { STUNT_BIKES, STUNT_BIKE_BY_ID } from '@shared/stunts/bikes.js';
import { UPGRADES, UPGRADE_MAX, UPGRADE_COST, ECONOMY } from '@shared/stunts/config.js';
import { BIKES } from '@shared/constants.js';
import { saveProfile } from './Storage.js';

export const STUNT_SAVE_VERSION = 1;

const STAT_KEYS = ['runs', 'completions', 'cleanRuns', 'jumps', 'flips', 'backflips', 'frontflips', 'spins', 'corkscrews', 'perfects', 'rings', 'targets', 'airTotal', 'styleTotal', 'crashes', 'score', 'bestCombo', 'maxFlipsJump', 'maxSpinsJump', 'challenges', 'challengeWins', 'coinsEarned'];

function defaults() {
  return {
    v: STUNT_SAVE_VERSION,
    coins: 0,
    bikeId: 'allround',
    owned: BIKES.map((b) => b.id),
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    levels: {}, // id -> {done, stars, best, bestTime, paid: {complete, s2, s3}}
    stats: Object.fromEntries(STAT_KEYS.map((k) => [k, 0])),
    missions: { next: 0, slots: [] }, // slots: [{i, base}]
    achievements: {}, // id -> true
  };
}

/** Load/migrate the stunt section of the profile (mutates profile.stunt). */
export function stuntData(profile) {
  const d = defaults();
  const s = profile.stunt && typeof profile.stunt === 'object' ? profile.stunt : {};
  const out = {
    ...d,
    ...s,
    upgrades: { ...d.upgrades, ...(s.upgrades || {}) },
    stats: { ...d.stats, ...(s.stats || {}) },
    missions: { ...d.missions, ...(s.missions || {}) },
    levels: { ...(s.levels || {}) },
    achievements: { ...(s.achievements || {}) },
  };
  out.v = STUNT_SAVE_VERSION;
  out.coins = Math.max(0, Math.floor(Number(out.coins) || 0));
  out.owned = [...new Set([...(Array.isArray(s.owned) ? s.owned : []), ...d.owned])].filter((id) => STUNT_BIKE_BY_ID[id]);
  if (!STUNT_BIKE_BY_ID[out.bikeId] || !out.owned.includes(out.bikeId)) out.bikeId = 'allround';
  for (const u of UPGRADES) out.upgrades[u.id] = Math.max(0, Math.min(UPGRADE_MAX, out.upgrades[u.id] | 0));
  for (const id of Object.keys(out.levels)) if (!STUNT_LEVEL_BY_ID[id]) delete out.levels[id];
  if (!Array.isArray(out.missions.slots)) out.missions.slots = [];
  profile.stunt = out;
  fillMissions(out);
  return out;
}

const save = (profile) => saveProfile(profile);

// ---------------------------------------------------------------- levels
export function levelProgress(sd, id) {
  return sd.levels[id] || { done: false, stars: 0, best: 0, bestTime: null, paid: {} };
}

export function isUnlocked(sd, id) {
  const i = levelIndex(id);
  if (i <= 0) return i === 0;
  return !!sd.levels[STUNT_LEVELS[i - 1].id]?.done;
}

export function unlockText(id) {
  const i = levelIndex(id);
  return i > 0 ? `Complete level ${i} (${STUNT_LEVELS[i - 1].name}) to unlock` : '';
}

export function totalStars(sd) {
  return Object.values(sd.levels).reduce((a, l) => a + (l.stars || 0), 0);
}

/**
 * Record a finished solo run. Rewards are paid once per milestone (first completion, 2 stars,
 * 3 stars) plus a small capped replay amount. Returns {coins, lines, newBest, stars, prevStars, unlockedNext}.
 */
export function recordSoloRun(profile, level, res, stars) {
  const sd = stuntData(profile);
  const lp = { ...levelProgress(sd, level.id), paid: { ...(levelProgress(sd, level.id).paid || {}) } };
  const lines = [];
  let coins = 0;
  const prevStars = lp.stars || 0;
  const newBest = res.complete && res.score > (lp.best || 0);
  const wasDone = lp.done;
  if (res.complete) {
    lp.done = true;
    lp.stars = Math.max(prevStars, stars);
    if (newBest) lp.best = res.score;
    if (lp.bestTime == null || res.time < lp.bestTime) lp.bestTime = res.time;
    if (!lp.paid.complete) {
      lp.paid.complete = true;
      coins += level.reward;
      lines.push(['First completion', level.reward]);
    }
    const s2 = Math.round(level.reward * 0.5);
    if (stars >= 2 && !lp.paid.s2) {
      lp.paid.s2 = true;
      coins += s2;
      lines.push(['★★ reward', s2]);
    }
    if (stars >= 3 && !lp.paid.s3) {
      lp.paid.s3 = true;
      coins += level.reward;
      lines.push(['★★★ reward', level.reward]);
    }
    const replay = Math.min(ECONOMY.replayCap, Math.floor(res.score / ECONOMY.replayDivisor));
    if (replay > 0) {
      coins += replay;
      lines.push(['Run bonus', replay]);
    }
  }
  sd.levels[level.id] = lp;
  sd.coins += coins;
  sd.stats.coinsEarned += coins;
  const i = levelIndex(level.id);
  const unlockedNext = res.complete && !wasDone && i < STUNT_LEVELS.length - 1 ? STUNT_LEVELS[i + 1] : null;
  save(profile);
  return { coins, lines, newBest, stars: lp.stars, prevStars, unlockedNext };
}

/** Add a finished run's real events to the lifetime stats (solo and challenges). */
export function addRunStats(profile, st, { completed = false, challenge = false, won = false } = {}) {
  const sd = stuntData(profile);
  const S = sd.stats;
  S.runs++;
  if (completed) S.completions++;
  if (completed && st.crashes === 0) S.cleanRuns++;
  for (const k of ['jumps', 'flips', 'backflips', 'frontflips', 'spins', 'corkscrews', 'perfects', 'rings', 'targets', 'crashes']) S[k] += st[k] | 0;
  S.airTotal += st.airTotal || 0;
  S.styleTotal += st.styleTotal || 0;
  S.score += st.score | 0;
  S.bestCombo = Math.max(S.bestCombo, st.maxCombo | 0);
  S.maxFlipsJump = Math.max(S.maxFlipsJump, st.maxFlipsJump | 0);
  S.maxSpinsJump = Math.max(S.maxSpinsJump, st.maxSpinsJump | 0);
  if (challenge) S.challenges++;
  if (won) S.challengeWins++;
  save(profile);
}

/** Coins for a friend challenge (participation + win). Never unlocks levels. */
export function recordChallengeCoins(profile, won) {
  const sd = stuntData(profile);
  const coins = ECONOMY.challengeBase + (won ? ECONOMY.challengeWin : 0);
  if (won) sd.stats.challengeWins++;
  sd.coins += coins;
  sd.stats.coinsEarned += coins;
  save(profile);
  return coins;
}

// ---------------------------------------------------------------- bikes + upgrades
export function bikeLock(sd, bike) {
  if (sd.owned.includes(bike.id)) return { owned: true, canBuy: false, reasons: [] };
  const u = bike.unlock || {};
  const reasons = [];
  const i = u.level ? u.level - 1 : -1;
  if (u.level && !sd.levels[STUNT_LEVELS[i].id]?.done) reasons.push(`Complete level ${u.level}`);
  if (u.stars && totalStars(sd) < u.stars) reasons.push(`Earn ${u.stars} stars (${totalStars(sd)}/${u.stars})`);
  const price = u.coins || 0;
  if (sd.coins < price) reasons.push(`${price.toLocaleString('en-US')} coins (you have ${sd.coins.toLocaleString('en-US')})`);
  return { owned: false, price, canBuy: reasons.length === 0, reasons };
}

export function buyBike(profile, bikeId) {
  const sd = stuntData(profile);
  const bike = STUNT_BIKE_BY_ID[bikeId];
  if (!bike) return { ok: false, msg: 'Unknown bike' };
  const lock = bikeLock(sd, bike);
  if (lock.owned) return { ok: false, msg: 'Already owned' };
  if (!lock.canBuy) return { ok: false, msg: 'Locked: ' + lock.reasons.join(' · ') };
  sd.coins -= lock.price;
  sd.owned.push(bike.id);
  save(profile);
  return { ok: true };
}

/** Equip only owned bikes (selecting a locked bike never equips it). */
export function equipBike(profile, bikeId) {
  const sd = stuntData(profile);
  if (!sd.owned.includes(bikeId)) return false;
  sd.bikeId = bikeId;
  save(profile);
  return true;
}

export function upgradeCost(sd, id) {
  const lv = sd.upgrades[id] | 0;
  return lv >= UPGRADE_MAX ? null : UPGRADE_COST[lv];
}

export function buyUpgrade(profile, id) {
  const sd = stuntData(profile);
  const cost = upgradeCost(sd, id);
  if (cost == null) return { ok: false, msg: 'Already at max level' };
  if (sd.coins < cost) return { ok: false, msg: `Need ${cost} coins` };
  sd.coins -= cost;
  sd.upgrades[id]++;
  save(profile);
  return { ok: true };
}

// ---------------------------------------------------------------- missions
// A fixed sequence (same for everyone); three are active at a time. Progress is measured from
// the lifetime stat value when the mission became active, so only new riding counts.
const MISSION_KINDS = [
  { stat: 'flips', label: (n) => `Land ${n} flips`, base: 3, grow: 3, coins: 60 },
  { stat: 'spins', label: (n) => `Land ${n} 360 spins`, base: 3, grow: 3, coins: 60 },
  { stat: 'perfects', label: (n) => `${n} perfect landings`, base: 5, grow: 5, coins: 70 },
  { stat: 'completions', label: (n) => `Complete ${n} stunt levels (replays count)`, base: 2, grow: 2, coins: 80 },
  { stat: 'airTotal', label: (n) => `${n} s of air time`, base: 15, grow: 15, coins: 70 },
  { stat: 'rings', label: (n) => `Fly through ${n} rings`, base: 3, grow: 4, coins: 80 },
  { stat: 'score', label: (n) => `Score ${n.toLocaleString('en-US')} stunt points`, base: 15000, grow: 20000, coins: 90 },
  { stat: 'targets', label: (n) => `Land in ${n} target zones`, base: 2, grow: 3, coins: 80 },
  { stat: 'corkscrews', label: (n) => `Land ${n} corkscrews`, base: 1, grow: 2, coins: 100 },
  { stat: 'cleanRuns', label: (n) => `${n} levels without a crash`, base: 1, grow: 2, coins: 100 },
  { stat: 'challenges', label: (n) => `Ride ${n} friend challenge${n > 1 ? 's' : ''}`, base: 1, grow: 1, coins: 120 },
];

export function missionDef(i) {
  const k = MISSION_KINDS[i % MISSION_KINDS.length];
  const round = Math.floor(i / MISSION_KINDS.length);
  const n = k.base + k.grow * round;
  return { i, stat: k.stat, n, label: k.label(n), coins: k.coins + round * 30 };
}

function fillMissions(sd) {
  const m = sd.missions;
  while (m.slots.length < 3) {
    m.slots.push({ i: m.next, base: sd.stats[missionDef(m.next).stat] || 0 });
    m.next++;
  }
}

export function missionList(sd) {
  return sd.missions.slots.map((slot, k) => {
    const def = missionDef(slot.i);
    const got = Math.max(0, (sd.stats[def.stat] || 0) - slot.base);
    return { ...def, slot: k, got: Math.min(def.n, def.stat === 'airTotal' ? Math.floor(got) : got), done: got >= def.n };
  });
}

/** Claim a finished mission once; its slot gets the next mission in the sequence. */
export function claimMission(profile, slot) {
  const sd = stuntData(profile);
  const m = missionList(sd)[slot];
  if (!m || !m.done) return null;
  sd.coins += m.coins;
  sd.stats.coinsEarned += m.coins;
  sd.missions.slots.splice(slot, 1);
  fillMissions(sd);
  save(profile);
  return m.coins;
}

// ---------------------------------------------------------------- achievements
const tierDone = (sd, t) => STUNT_LEVELS.filter((l) => l.tier === t).every((l) => sd.levels[l.id]?.done);
export const ACHIEVEMENTS = [
  { id: 'first_air', name: 'Lift-off', desc: 'Land your first jump', coins: 50, test: (sd) => sd.stats.jumps >= 1 },
  { id: 'first_flip', name: 'Head over heels', desc: 'Land a flip', coins: 100, test: (sd) => sd.stats.flips >= 1 },
  { id: 'double', name: 'Double vision', desc: 'Land a double flip', coins: 200, test: (sd) => sd.stats.maxFlipsJump >= 2 },
  { id: 'triple', name: 'Triple crown', desc: 'Land a triple flip', coins: 400, test: (sd) => sd.stats.maxFlipsJump >= 3 },
  { id: 'spin720', name: 'Seven-twenty', desc: 'Land a 720 spin', coins: 200, test: (sd) => sd.stats.maxSpinsJump >= 2 },
  { id: 'spin1080', name: 'Ten-eighty', desc: 'Land a 1080 spin', coins: 400, test: (sd) => sd.stats.maxSpinsJump >= 3 },
  { id: 'cork', name: 'Corkscrew', desc: 'Flip and spin in one jump', coins: 150, test: (sd) => sd.stats.corkscrews >= 1 },
  { id: 'combo', name: 'Chain reaction', desc: 'Reach a x3 combo', coins: 250, test: (sd) => sd.stats.bestCombo >= 5 },
  { id: 'rings25', name: 'Ring master', desc: 'Fly through 25 rings', coins: 200, test: (sd) => sd.stats.rings >= 25 },
  { id: 'targets20', name: 'Sniper', desc: 'Land in 20 target zones', coins: 200, test: (sd) => sd.stats.targets >= 20 },
  { id: 'air300', name: 'Frequent flyer', desc: '5 minutes of total air time', coins: 300, test: (sd) => sd.stats.airTotal >= 300 },
  { id: 'clean10', name: 'Smooth operator', desc: 'Finish 10 levels without crashing', coins: 200, test: (sd) => sd.stats.cleanRuns >= 10 },
  { id: 'tier1', name: 'Beginner graduate', desc: 'Complete every Beginner level', coins: 300, test: (sd) => tierDone(sd, 1) },
  { id: 'tier2', name: 'Intermediate graduate', desc: 'Complete every Intermediate level', coins: 500, test: (sd) => tierDone(sd, 2) },
  { id: 'tier3', name: 'Advanced graduate', desc: 'Complete every Advanced level', coins: 800, test: (sd) => tierDone(sd, 3) },
  { id: 'tier4', name: 'Stunt legend', desc: 'Complete every Expert level', coins: 1200, test: (sd) => tierDone(sd, 4) },
  { id: 'stars150', name: 'Perfectionist', desc: 'All 150 stars', coins: 2000, test: (sd) => totalStars(sd) >= 150 },
  { id: 'garage10', name: 'Collector', desc: 'Own 10 bikes', coins: 300, test: (sd) => sd.owned.length >= 10 },
  { id: 'maxed', name: 'Fully tuned', desc: 'Max out an upgrade', coins: 200, test: (sd) => Object.values(sd.upgrades).some((v) => v >= UPGRADE_MAX) },
  { id: 'friend', name: 'Show-off', desc: 'Ride a friend challenge', coins: 100, test: (sd) => sd.stats.challenges >= 1 },
  { id: 'champ', name: 'Challenge champion', desc: 'Win a friend challenge', coins: 200, test: (sd) => sd.stats.challengeWins >= 1 },
];

/** Unlock (and pay) every achievement whose condition is now true. Returns the new ones. */
export function checkAchievements(profile) {
  const sd = stuntData(profile);
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (sd.achievements[a.id] || !a.test(sd)) continue;
    sd.achievements[a.id] = true;
    sd.coins += a.coins;
    sd.stats.coinsEarned += a.coins;
    fresh.push(a);
  }
  if (fresh.length) save(profile);
  return fresh;
}

export { STUNT_BIKES };
