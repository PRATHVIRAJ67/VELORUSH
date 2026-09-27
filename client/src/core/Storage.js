// Profile + settings persisted in localStorage (guarded: storage may be unavailable).
import { XP } from '@shared/constants.js';

const KEY_PROFILE = 'velorush.profile.v1';
const KEY_SETTINGS = 'velorush.settings.v1';

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

import { isMobile } from './device.js';

function defaultServer() {
  const env = import.meta.env?.VITE_SERVER_URL;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // dev: Vite on 5173, game server on 8080. prod: served by the game server itself.
  if (location.port === '5173' || location.port === '4173') return `${proto}://${location.hostname}:8080`;
  return `${proto}://${location.host}`;
}

export function loadSettings() {
  const d = {
    // phones default to Medium (full content; mobile render path caps resolution); PC stays High
    quality: isMobile() ? 'medium' : 'high',
    speedFx: true,
    showFps: false,
    cam: 1,
    shake: true,
    master: 0.8,
    sfx: 0.9,
    music: 0.45,
    assist: true,
    touch: 'auto',
    server: defaultServer(),
  };
  const s = { ...d, ...(load(KEY_SETTINGS) || {}) };
  // only a server address the player typed in themselves is remembered
  if (!s.serverCustom || !s.server) s.server = d.server;
  return s;
}
export const saveSettings = (s) => save(KEY_SETTINGS, s);

const SKINS = ['#f1c7a6', '#e0ac8a', '#c68863', '#8d5a3b', '#5b3a26'];
export function loadProfile() {
  const d = {
    name: 'Rider' + Math.floor(100 + Math.random() * 900),
    bikeId: 'allround',
    frame: '#e63946',
    jersey: '#3a86ff',
    accent: '#f1faee',
    outfit: 'stripe',
    skin: SKINS[Math.floor(Math.random() * SKINS.length)],
    xp: 0,
    level: 1,
    races: 0,
    wins: 0,
    best: {},
  };
  const p = { ...d, ...(load(KEY_PROFILE) || {}) };
  save(KEY_PROFILE, p);
  return p;
}
export const saveProfile = (p) => save(KEY_PROFILE, p);

/** Adds XP, handles level ups. Returns {gained, levelsUp, before, after}. */
export function addXp(profile, amount) {
  const before = { level: profile.level, xp: profile.xp };
  profile.xp += amount;
  let levels = 0;
  while (profile.xp >= XP.perLevel(profile.level)) {
    profile.xp -= XP.perLevel(profile.level);
    profile.level++;
    levels++;
  }
  saveProfile(profile);
  return { gained: amount, levelsUp: levels, before, after: { level: profile.level, xp: profile.xp } };
}

export function loadGhost(key) {
  return load('velorush.ghost.' + key);
}
export function saveGhost(key, g) {
  save('velorush.ghost.' + key, g);
}
