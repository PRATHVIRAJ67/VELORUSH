// Player progress on top of the saved profile: time-trial medals, race wins per map, the
// post-race "next goal" and the Daily Ride. Medals come from the existing personal bests
// (profile.best), so returning players keep everything they already achieved.
import { TRACK_IDS, getTrack } from '@shared/tracks.js';
import { AI_SKILLS } from '@shared/constants.js';
import { formatTime } from '../ui/format.js';

// Target times in seconds per map and lap count: [gold, silver, bronze].
// From tools/medal-times.mjs (gold ≈ Elite AI solo, silver ≈ Pro AI solo, bronze ≈ a first clean
// ride holding pedal + sprint). Rerun it if physics or tracks change.
const MEDAL_TIMES = {
  mountain: { 1: [120, 125, 135], 2: [238, 246, 272], 3: [354, 368, 409] },
  alpine: { 1: [132, 137, 148], 2: [256, 265, 290], 3: [381, 396, 433] },
  coast: { 1: [99, 104, 112], 2: [195, 205, 222], 3: [290, 304, 332] },
  forest: { 1: [89, 91, 97], 2: [174, 179, 195], 3: [259, 266, 293] },
  canyon: { 1: [144, 151, 161], 2: [288, 302, 321], 3: [431, 449, 482] },
  city: { 1: [106, 110, 115], 2: [209, 218, 230], 3: [313, 325, 345] },
};
export const MEDALS = [
  { id: 'gold', name: 'Gold', icon: '🥇', rank: 3 },
  { id: 'silver', name: 'Silver', icon: '🥈', rank: 2 },
  { id: 'bronze', name: 'Bronze', icon: '🥉', rank: 1 },
];
/** XP for earning a medal for the first time on a map + lap count (an upgrade pays the new tier). */
export const MEDAL_XP = { gold: 120, silver: 80, bronze: 50 };
const SKILLS = ['easy', 'medium', 'hard', 'elite'];
export const skillName = (s) => AI_SKILLS[s]?.name || s;
const secs = (t) => formatTime(Math.abs(t)).replace(/^0:0?/, '') + 's';
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Medal targets for a map + lap count: [{...medal, time}] gold first, or null. */
export function medalTargets(trackId, laps) {
  const t = MEDAL_TIMES[trackId]?.[laps];
  return t ? MEDALS.map((m, i) => ({ ...m, time: t[i] })) : null;
}

/** Best medal a time earns (or null). */
export function medalFor(trackId, laps, time) {
  if (time == null) return null;
  return medalTargets(trackId, laps)?.find((m) => time <= m.time) || null;
}

/** Best time-trial medal on a map over all lap counts: {medal, laps, time} or null. */
export function bestMapMedal(profile, trackId) {
  let best = null;
  for (const laps of [1, 2, 3]) {
    const time = profile.best?.[`${trackId}.timetrial.${laps}`];
    const medal = medalFor(trackId, laps, time);
    if (medal && (!best || medal.rank > best.medal.rank)) best = { medal, laps, time };
  }
  return best;
}

/** Total time-trial medals over all maps: {gold, silver, bronze} (best medal per map). */
export function medalCount(profile) {
  const n = { gold: 0, silver: 0, bronze: 0 };
  for (const id of TRACK_IDS) {
    const b = bestMapMedal(profile, id);
    if (b) n[b.medal.id]++;
  }
  return n;
}

/** Highest AI difficulty the player has won a race on, per map ('easy'..'elite' or undefined). */
export const bestWin = (profile, trackId) => profile.wonOn?.[trackId];

export function recordWin(profile, trackId, skill) {
  profile.wonOn ||= {};
  const prev = profile.wonOn[trackId];
  if (!prev || SKILLS.indexOf(skill) > SKILLS.indexOf(prev)) profile.wonOn[trackId] = skill;
}

export const nextTrack = (id) => TRACK_IDS[(TRACK_IDS.indexOf(id) + 1) % TRACK_IDS.length];

/**
 * What to aim for after a local race: {title, sub, action?: {label, opts, kind}}.
 * `opts` are startLocal() options for the suggested race (based on the race just ridden).
 */
export function nextGoal({ mode, trackId, laps, time, place, field, skill, prevBest, rival, opts }) {
  const mapName = (id) => getTrack(id).name;
  const upNext = `Next up: ${mapName(nextTrack(trackId))}`;
  const nextMap = { label: 'Next map', opts: { ...opts, track: nextTrack(trackId), daily: undefined }, kind: 'next_map' };
  if (mode === 'timetrial') {
    const targets = medalTargets(trackId, laps);
    const earned = medalFor(trackId, laps, time);
    const next = targets && [...targets].reverse().find((m) => !earned || m.rank > earned.rank);
    let title = earned ? `${earned.icon} ${earned.name} medal` : 'No medal yet';
    if (prevBest != null && time != null) title += time < prevBest ? ` · ${secs(prevBest - time)} faster than your best` : ` · ${secs(time - prevBest)} off your best`;
    if (!next) return { title, sub: `Gold on this map. ${upNext}`, action: nextMap };
    return {
      title,
      sub: `${next.icon} ${next.name}: ${formatTime(next.time)} · ${secs(time - next.time)} to find`,
      action: { label: 'Race your ghost', opts: { ...opts, daily: undefined }, kind: 'ghost' },
    };
  }
  if (field < 2) return null;
  if (place > 1) {
    return {
      title: rival ? `${secs(rival.gap)} behind ${rival.name} in ${ordinal(place - 1)}` : `Finished ${ordinal(place)}`,
      sub: `Win against ${skillName(skill)} riders to claim ${mapName(trackId)}`,
      action: null, // Rematch is the natural next move
    };
  }
  const harder = SKILLS[SKILLS.indexOf(skill) + 1];
  if (harder) return { title: `🏆 Won against ${skillName(skill)} riders`, sub: `${skillName(harder)} riders are faster`, action: { label: `Try ${skillName(harder)}`, opts: { ...opts, skill: harder, daily: undefined }, kind: 'harder' } };
  return { title: `🏆 Beat the ${skillName(skill)} field`, sub: `The hardest field there is. ${upNext}`, action: nextMap };
}

// ---------------------------------------------------------------- Daily Ride
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNumber = (key) => Math.round(Date.parse(key + 'T12:00:00Z') / 86400000);

/** Today's challenge: the same for every player on a given calendar day, rotating maps and modes. */
export function dailyChallenge(date = new Date()) {
  const key = dayKey(date);
  const n = dayNumber(key);
  const track = TRACK_IDS[(n * 5 + 2) % TRACK_IDS.length];
  const weather = ['', 'rain', '', 'fog', '', 'cloudy', ''][((n % 7) + 7) % 7];
  const base = { track, laps: 1, weather, daily: key };
  const name = getTrack(track).name;
  const kind = ((n % 3) + 3) % 3;
  if (kind === 0) {
    const silver = medalTargets(track, 1)[1];
    return { key, track, kind: 'medal', target: silver.time, title: `${silver.icon} Silver on ${name}`, desc: `Time trial · beat ${formatTime(silver.time)}`, opts: { ...base, mode: 'timetrial', ai: 0, skill: 'medium' } };
  }
  if (kind === 1) return { key, track, kind: 'podium', title: `Podium on ${name}`, desc: 'Race 7 Pro riders · finish top 3', opts: { ...base, mode: 'ai', ai: 7, skill: 'medium' } };
  return { key, track, kind: 'win', title: `Win on ${name}`, desc: 'Race 5 Elite riders · take the win', opts: { ...base, mode: 'quick', ai: 5, skill: 'hard' } };
}

/** Did this finish complete the daily challenge? */
export function dailyMet(ch, { time, place }) {
  if (ch.kind === 'medal') return time != null && time <= ch.target;
  if (ch.kind === 'podium') return place <= 3;
  return place === 1;
}

/** Streak as the player sees it today (a missed day resets it to 0). */
export function dailyStatus(profile, ch = dailyChallenge()) {
  const d = profile.daily || {};
  const doneToday = d.last === ch.key;
  const alive = doneToday || (!!d.last && dayNumber(ch.key) - dayNumber(d.last) === 1);
  return { doneToday, streak: alive ? d.streak || 0 : 0, best: d.best || 0 };
}

export const DAILY_XP = 150;
export const dailyStreakXp = (streak) => Math.min(100, 25 * Math.max(0, streak - 1));

/** Marks today's challenge complete. Returns {streak, xp} or null if it was already done today. */
export function completeDaily(profile, ch) {
  const st = dailyStatus(profile, ch);
  if (st.doneToday) return null;
  const streak = st.streak + 1;
  profile.daily = { last: ch.key, streak, best: Math.max(streak, st.best) };
  return { streak, xp: DAILY_XP + dailyStreakXp(streak) };
}
