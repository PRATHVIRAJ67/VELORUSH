// DOM UI: menus, HUD, results, lobby, garage, settings.
import { BIKES, COLORS, OUTFITS, PHYSICS, XP, RACE_MODES } from '@shared/constants.js';
import { formatTime, formatGap, escapeHtml } from './format.js';
import { Minimap } from './Minimap.js';
import { GaragePreview } from './GaragePreview.js';
import { drawMapPreview, MAP_LIST } from './MapPreview.js';
import { saveProfile, saveSettings, loadSettings } from '../core/Storage.js';

const $ = (id) => document.getElementById(id);
const MENUS = ['menu-main', 'menu-play', 'menu-mp', 'menu-lobby', 'menu-garage', 'menu-settings'];

export class UI {
  constructor(app) {
    this.app = app;
    this.selMode = 'quick';
    this.hudT = 0;
    this.msgTimer = null;
    this.selTrack = app.settings.track || 'mountain';
    this._buildMapCards();
    this.settingsReturn = 'main';
    this._bind();
    this._fillSettings();
    this.refreshProfile();
    this.updateTouchVisibility();
  }

  // ---------------- screens ----------------
  setLoading(p, text) {
    $('loading-fill').style.width = `${Math.round(p * 100)}%`;
    if (text) $('loading-text').textContent = text;
  }

  hideLoading() {
    $('loading').classList.remove('show');
  }

  showLoading(text) {
    $('loading').classList.add('show');
    this.setLoading(0, text);
  }

  /** Called when the world switches to another map. */
  setTrack(track) {
    this.minimap = new Minimap($('minimap'), track);
    document.querySelector('#menu-main .tagline').textContent = `Arcade cycling · ${track.name}`;
  }

  _buildMapCards() {
    const stars = (n) => '●'.repeat(n) + '○'.repeat(5 - n);
    $('map-cards').innerHTML = MAP_LIST.map(
      (m) => `<button class="map-card" data-track="${m.id}"><canvas width="260" height="130"></canvas>
        <div class="mc-body"><h3>${m.name}</h3><div class="mc-loc">${m.meta.location}</div>
        <div class="mc-stats" data-stats="${m.id}"></div>
        <div class="mc-style">${m.meta.style}</div><div class="mc-diff">Difficulty <b>${stars(m.meta.difficulty)}</b></div></div></button>`,
    ).join('');
    for (const card of document.querySelectorAll('.map-card')) {
      const st = drawMapPreview(card.querySelector('canvas'), card.dataset.track);
      card.querySelector('.mc-stats').textContent = `${st.km.toFixed(2)} km · ↑ ${st.gain} m climbing`;
    }
    $('lobby-track').innerHTML = MAP_LIST.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  }

  _renderLobbyMap(id) {
    const m = MAP_LIST.find((x) => x.id === id) || MAP_LIST[0];
    const el = $('lobby-map');
    if (el.dataset.track === m.id) return;
    el.dataset.track = m.id;
    el.innerHTML = `<canvas width="360" height="150"></canvas><div class="lm-name">${m.name}</div><div class="lm-meta">${m.meta.location} · ${m.meta.style}</div>`;
    drawMapPreview(el.querySelector('canvas'), m.id);
  }

  showMenu(name) {
    const id = 'menu-' + name;
    for (const m of MENUS) $(m).classList.toggle('show', m === id);
    $('hud').classList.remove('show');
    $('results').classList.remove('show');
    $('pause').classList.remove('show');
    document.body.classList.remove('racing');
    this.updateTouchVisibility();
    if (name === 'garage') this._openGarage();
    else this.garage?.stop();
    if (name === 'play') this._refreshPlay();
    if (name === 'main') this.refreshProfile();
    if (name === 'mp') this._refreshMp();
    this.currentMenu = name;
  }

  hideMenus() {
    for (const m of MENUS) $(m).classList.remove('show');
    this.garage?.stop();
    this.currentMenu = null;
  }

  showHud() {
    this.hideMenus();
    $('results').classList.remove('show');
    $('pause').classList.remove('show');
    $('hud').classList.add('show');
    document.body.classList.add('racing');
    this.updateTouchVisibility();
  }

  showPause(on) {
    $('pause').classList.toggle('show', on);
    $('btn-restart').style.display = this.app.session?.canPause ? '' : 'none';
    $('btn-resume').textContent = this.app.session?.canPause ? 'Resume' : 'Back to race';
  }

  updateTouchVisibility() {
    const s = this.app.settings.touch;
    const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const on = s === 'on' || (s === 'auto' && touchDevice);
    $('touch').classList.toggle('show', on && document.body.classList.contains('racing'));
    document.body.classList.toggle('touch-on', on);
  }

  // ---------------- messages ----------------
  message(text, sub = '', cls = '') {
    const m = $('hud-msg');
    m.className = 'hud-center-msg show ' + cls;
    m.textContent = text;
    $('hud-sub').textContent = sub;
    $('hud-sub').className = 'hud-sub-msg' + (sub ? ' show' : '') + (cls.includes('small') ? ' small' : '');
    void m.offsetWidth;
    m.classList.add('pop');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => {
      m.classList.remove('show', 'pop');
      $('hud-sub').classList.remove('show');
    }, cls === 'count' ? 900 : 1700);
  }

  flash(text) {
    this.message(text, '', 'small flashy');
  }

  toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  fade(on) {
    $('fade').classList.toggle('show', on);
  }

  // ---------------- HUD ----------------
  updateHud(h, dt) {
    this.hudT += dt;
    if (this.hudT < 1 / 20) return;
    this.hudT = 0;
    const b = h.bike;
    const ord = this.app.session.ordinal(h.place);
    $('hud-pos').textContent = h.place || '–';
    $('hud-pos-suf').textContent = ord.replace(/\d+/, '');
    $('hud-pos-of').textContent = '/' + h.total;
    let timer = formatTime(h.time);
    $('hud-timer').textContent = timer;
    $('hud-lap').textContent = `LAP ${h.lap}/${h.laps}`;
    $('hud-cp').textContent = `CP ${h.cp}/${h.cpTotal}`;
    if (h.ghostDelta != null) {
      $('hud-cp').textContent = `GHOST ${formatGap(h.ghostDelta)}`;
      $('hud-cp').className = h.ghostDelta <= 0 ? 'good' : 'bad';
    } else $('hud-cp').className = '';
    const kmh = Math.round(b.v * 3.6);
    $('hud-speed').textContent = kmh;
    const frac = Math.min(1, b.v / 38.9); // dial reads to 140 km/h
    $('speedo-fill').style.strokeDashoffset = String(252 * (1 - frac));
    $('speedo-fill').classList.toggle('hot', b.boostTimer > 0 || b.sprinting);
    // speed tiers: 60 / 80 / 100 km/h
    const tier = kmh >= 100 ? 3 : kmh >= 80 ? 2 : kmh >= 60 ? 1 : 0;
    $('hud-speed').parentElement.parentElement.dataset.tier = tier;
    $('hud-stamina').style.width = `${b.stamina}%`;
    $('hud-stamina').className = b.exhausted ? 'exhausted' : b.stamina < 30 ? 'low' : '';
    let sprintFrac;
    let state;
    if (b.boostTimer > 0) {
      sprintFrac = b.boostTimer / PHYSICS.boostDuration;
      state = 'BOOSTING';
    } else if (b.exhausted) {
      sprintFrac = b.stamina / PHYSICS.exhaustedThreshold;
      state = 'EXHAUSTED';
    } else if (b.sprinting) {
      sprintFrac = b.stamina / 100;
      state = 'SPRINTING';
    } else if (b.boostCooldown > 0) {
      sprintFrac = 1 - b.boostCooldown / PHYSICS.boostCooldown;
      state = 'RECHARGING';
    } else {
      sprintFrac = Math.min(1, b.stamina / PHYSICS.boostCost);
      state = sprintFrac >= 1 ? 'READY' : 'CHARGING';
    }
    $('hud-sprint').style.width = `${Math.round(sprintFrac * 100)}%`;
    $('hud-sprint').className = state === 'READY' ? 'ready' : state === 'BOOSTING' || state === 'SPRINTING' ? 'active' : '';
    $('hud-boost-state').textContent = state;
    $('hud-dist').textContent = (h.distLeft / 1000).toFixed(2) + ' km';
    const g = Math.round(h.grade * 100);
    const grade = $('hud-grade');
    grade.textContent = `${g > 0 ? '▲' : g < 0 ? '▼' : '■'} ${Math.abs(g)}%`;
    grade.className = g > 3 ? 'up' : g < -3 ? 'down' : '';
    $('hud-draft').classList.toggle('show', b.draft > 0.3);
    const warn = $('hud-warning');
    if (b.wrongWay > 1) {
      warn.textContent = 'WRONG WAY — press R';
      warn.classList.add('show');
    } else if (b.offroad && b.v > 2) {
      warn.textContent = 'OFF ROAD';
      warn.classList.add('show');
    } else warn.classList.remove('show');
    // standings
    const list = h.standings.slice(0, 8);
    $('hud-standings').innerHTML = list
      .map(
        (s, i) =>
          `<li class="${s.isLocal ? 'me' : ''}"><i style="background:${s.color}"></i><span>${escapeHtml(s.name)}</span><em>${
            i === 0 ? (s.finished ? 'FIN' : 'LEAD') : s.gap != null ? formatGap(s.gap) : ''
          }</em></li>`,
      )
      .join('');
    this.minimap.draw(h.riders);
  }

  setFps(fps) {
    const el = $('fps');
    el.style.display = this.app.settings.showFps ? 'block' : 'none';
    el.textContent = `${fps} FPS`;
  }

  // ---------------- results ----------------
  showResults(res) {
    $('hud').classList.remove('show');
    $('results').classList.add('show');
    document.body.classList.remove('racing');
    this.updateTouchVisibility();
    this.refreshResults(res, true);
  }

  refreshResults(res, animateXp = false) {
    if (!$('results').classList.contains('show')) return;
    $('res-title').textContent = res.title;
    $('res-sub').textContent = res.sub + (res.ghost !== undefined ? ` · Ghost best ${formatTime(res.ghost)}` : '');
    $('res-body').innerHTML = res.rows
      .map(
        (r) => `<tr class="${r.isLocal ? 'me' : ''}"><td>${r.place}</td><td><i style="background:${r.color}"></i>${escapeHtml(r.name)}</td>
        <td>${r.time != null ? (r.gap != null ? formatGap(r.gap) : formatTime(r.time)) : r.status}</td><td>${r.best != null ? formatTime(r.best) : '—'}</td></tr>`,
      )
      .join('');
    const pod = res.rows.slice(0, 3);
    $('podium').innerHTML = [1, 0, 2]
      .map((i) => pod[i] && pod[i].time != null ? `<div class="pod p${i + 1}"><b>${escapeHtml(pod[i].name)}</b><div class="step" style="--c:${pod[i].color}">${i + 1}</div></div>` : '<div class="pod empty"></div>')
      .join('');
    $('btn-res-skip').style.display = res.canSkip ? '' : 'none';
    $('btn-rematch').textContent = res.rematchLabel || 'Rematch';
    $('btn-res-menu').textContent = res.menuLabel || 'Main menu';
    const f = res.finish;
    if (f && animateXp) {
      $('xp-lines').innerHTML = f.lines.map(([t, v]) => `<div><span>${t}</span><b>+${v} XP</b></div>`).join('') + (f.newRecord ? '<div class="rec">NEW PERSONAL BEST</div>' : '');
      const fill = $('res-xp');
      const { before, after, levelsUp } = f.xp;
      fill.style.transition = 'none';
      fill.style.width = `${(before.xp / XP.perLevel(before.level)) * 100}%`;
      void fill.offsetWidth;
      fill.style.transition = 'width 1.4s cubic-bezier(.2,.8,.2,1)';
      setTimeout(() => (fill.style.width = `${levelsUp ? 100 : (after.xp / XP.perLevel(after.level)) * 100}%`), 150);
      if (levelsUp) setTimeout(() => {
        fill.style.transition = 'none';
        fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = 'width 1s';
        fill.style.width = `${(after.xp / XP.perLevel(after.level)) * 100}%`;
      }, 1700);
      $('res-level').innerHTML = levelsUp ? `<b class="lvlup">LEVEL UP! Level ${after.level}</b>` : `Level ${after.level} · ${after.xp}/${XP.perLevel(after.level)} XP`;
    } else if (!f) {
      $('xp-lines').innerHTML = '';
      $('res-level').textContent = '';
    }
  }

  // ---------------- profile ----------------
  refreshProfile() {
    const p = this.app.profile;
    $('pc-name').textContent = p.name;
    $('pc-level').textContent = p.level;
    $('pc-xp').style.width = `${(p.xp / XP.perLevel(p.level)) * 100}%`;
    $('pc-stats').innerHTML = `<span>${p.races} races</span><span>${p.wins} wins</span>`;
  }

  // ---------------- play menu ----------------
  _refreshPlay() {
    const m = RACE_MODES[this.selMode];
    document.querySelectorAll('.mode-card').forEach((c) => c.classList.toggle('sel', c.dataset.mode === this.selMode));
    $('opt-laps').value = String(this._laps?.[this.selMode] ?? m.laps);
    $('opt-ai').value = String(this._ai ?? (m.ai || 5));
    $('opt-skill').value = this._skill ?? m.skill;
    document.querySelectorAll('.ai-only').forEach((e) => (e.style.display = this.selMode === 'timetrial' ? 'none' : ''));
    document.querySelectorAll('.map-card').forEach((c) => c.classList.toggle('sel', c.dataset.track === this.selTrack));
    const best = this.app.profile.best[`${this.selTrack}.${this.selMode}.${$('opt-laps').value}`];
    $('tc-best').textContent = best ? `Personal best: ${formatTime(best)}` : 'No personal best yet';
  }

  // ---------------- multiplayer ----------------
  _refreshMp() {
    $('mp-name').value = this.app.profile.name;
    $('mp-server').value = this.app.settings.server;
    if (!this.app.net.online) this.app.net.connect().catch(() => this.setNetStatus('err', 'Server offline — start it with: npm run dev:server'));
  }

  setNetStatus(state, text) {
    const el = $('net-status');
    el.className = 'net-status ' + state;
    el.querySelector('span').textContent = text;
  }

  renderLobby(room, myId) {
    $('lobby-code').textContent = room.code;
    const isHost = room.hostId === myId;
    const humans = room.players.filter((p) => !p.bot);
    $('lobby-count').textContent = `${room.players.length}/8`;
    $('lobby-players').innerHTML = room.players
      .map(
        (p) => `<li class="${p.id === myId ? 'me' : ''} ${p.connected === false ? 'dc' : ''}">
          <i style="background:${p.look?.jersey || '#888'}"></i>
          <span class="nm">${escapeHtml(p.name)}${p.id === room.hostId ? ' <b class="host">HOST</b>' : ''}${p.bot ? ' <b class="bot">BOT</b>' : ''}${p.spectator ? ' <b class="spec">NEXT RACE</b>' : ''}</span>
          <span class="st ${p.ready || p.bot ? 'ok' : ''}">${p.bot ? (p.skill || '').toUpperCase() : p.connected === false ? 'RECONNECTING' : p.ready ? 'READY' : 'NOT READY'}</span>
        </li>`,
      )
      .join('');
    this._renderLobbyMap(room.settings.track || 'mountain');
    for (const [id, key] of [['lobby-laps', 'laps'], ['lobby-bots', 'bots'], ['lobby-skill', 'skill'], ['lobby-weather', 'weather'], ['lobby-track', 'track']]) {
      $(id).value = String(room.settings[key] ?? (key === 'track' ? 'mountain' : 'clear'));
      $(id).disabled = !isHost || room.phase !== 'lobby';
    }
    const me = room.players.find((p) => p.id === myId);
    $('btn-ready').textContent = me?.ready ? 'Not ready' : 'Ready';
    $('btn-ready').classList.toggle('on', !!me?.ready);
    $('btn-host-start').style.display = isHost ? '' : 'none';
    const allReady = humans.every((p) => p.ready || p.connected === false);
    const enough = room.players.length >= 2 || humans.length >= 1;
    $('btn-host-start').disabled = !(allReady && enough) || room.phase !== 'lobby';
    $('lobby-hint').textContent =
      room.phase !== 'lobby'
        ? 'A race is in progress — you will join the next one.'
        : isHost
          ? allReady ? 'Everyone is ready. Start when you like!' : 'Waiting for all riders to be ready…'
          : 'Waiting for the host to start the race…';
  }

  // ---------------- garage ----------------
  _openGarage() {
    const p = this.app.profile;
    if (!this.garage) this.garage = new GaragePreview($('garage-preview'));
    this.garage.start(this._look());
    $('bike-list').innerHTML = BIKES.map(
      (b) => `<button class="bike-item ${b.id === p.bikeId ? 'sel' : ''}" data-bike="${b.id}"><b>${b.name}</b><small>${b.desc}</small></button>`,
    ).join('');
    this._renderBikeStats();
    const sw = (id, key) => {
      $(id).innerHTML = COLORS.map((c) => `<button class="sw ${p[key] === c ? 'sel' : ''}" data-key="${key}" data-color="${c}" style="background:${c}"></button>`).join('');
    };
    sw('sw-frame', 'frame');
    sw('sw-jersey', 'jersey');
    sw('sw-accent', 'accent');
    $('outfit-list').innerHTML = OUTFITS.map((o) => `<button class="chip ${p.outfit === o.id ? 'sel' : ''}" data-outfit="${o.id}">${o.name}</button>`).join('');
  }

  _renderBikeStats() {
    const b = BIKES.find((x) => x.id === this.app.profile.bikeId);
    const bar = (label, v) => `<div class="stat"><span>${label}</span><div><i style="width:${Math.round((v - 0.8) / 0.35 * 100)}%"></i></div></div>`;
    $('bike-stats').innerHTML = bar('Power', b.power) + bar('Top speed', b.top) + bar('Climbing', b.climb) + bar('Handling', b.handling) + bar('Stamina', b.stamina);
  }

  _look() {
    const p = this.app.profile;
    return { frame: p.frame, jersey: p.jersey, accent: p.accent, outfit: p.outfit, bikeId: p.bikeId, skin: p.skin };
  }

  // ---------------- settings ----------------
  _fillSettings() {
    const s = this.app.settings;
    $('set-quality').value = s.quality;
    $('set-speedfx').checked = s.speedFx;
    $('set-fps').checked = s.showFps;
    $('set-cam').value = String(s.cam);
    $('set-shake').checked = s.shake;
    $('set-master').value = s.master;
    $('set-sfx').value = s.sfx;
    $('set-music').value = s.music;
    $('set-assist').checked = s.assist;
    $('set-touch').value = s.touch;
  }

  _readSettings() {
    const s = this.app.settings;
    s.quality = $('set-quality').value;
    s.speedFx = $('set-speedfx').checked;
    s.showFps = $('set-fps').checked;
    s.cam = Number($('set-cam').value);
    s.shake = $('set-shake').checked;
    s.master = Number($('set-master').value);
    s.sfx = Number($('set-sfx').value);
    s.music = Number($('set-music').value);
    s.assist = $('set-assist').checked;
    s.touch = $('set-touch').value;
    saveSettings(s);
    this.app.applySettings();
  }

  // ---------------- bindings ----------------
  _bind() {
    const app = this.app;
    const click = (id, fn) => $(id).addEventListener('click', (e) => {
      app.audio.init();
      app.audio.play('ui');
      fn(e);
    });
    document.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        app.audio.init();
        app.audio.play('ui');
        app.audio.setMusic('menu');
        if (b.dataset.go === 'settings') this.settingsReturn = 'main';
        this.showMenu(b.dataset.go);
      }),
    );
    document.querySelectorAll('.mode-card').forEach((c) =>
      c.addEventListener('click', () => {
        app.audio.play('ui');
        this.selMode = c.dataset.mode;
        this._refreshPlay();
      }),
    );
    $('map-cards').addEventListener('click', (e) => {
      const card = e.target.closest('.map-card');
      if (!card) return;
      app.audio.play('ui');
      this.selTrack = card.dataset.track;
      this._refreshPlay();
    });
    $('opt-laps').addEventListener('change', () => {
      (this._laps ||= {})[this.selMode] = Number($('opt-laps').value);
      this._refreshPlay();
    });
    $('opt-ai').addEventListener('change', () => (this._ai = Number($('opt-ai').value)));
    $('opt-skill').addEventListener('change', () => (this._skill = $('opt-skill').value));
    click('btn-start-race', () => {
      const mode = this.selMode;
      app.startLocal({
        mode,
        laps: Number($('opt-laps').value),
        ai: mode === 'timetrial' ? 0 : Number($('opt-ai').value),
        skill: $('opt-skill').value,
        weather: $('opt-weather').value,
        track: this.selTrack,
      });
    });
    // settings
    for (const id of ['set-quality', 'set-speedfx', 'set-fps', 'set-cam', 'set-shake', 'set-assist', 'set-touch']) $(id).addEventListener('change', () => this._readSettings());
    for (const id of ['set-master', 'set-sfx', 'set-music']) $(id).addEventListener('input', () => this._readSettings());
    click('btn-settings-back', () => {
      if (this.settingsReturn === 'pause') {
        this.hideMenus();
        this.showHud();
        this.showPause(true);
      } else this.showMenu('main');
    });
    // pause
    click('btn-pause', () => app.togglePause());
    click('btn-resume', () => app.togglePause(false));
    click('btn-restart', () => app.session?.restart());
    click('btn-quit', () => app.quitToMenu());
    click('btn-mute', () => {
      const muted = app.audio.toggleMute();
      $('btn-mute').textContent = muted ? 'Sound: off' : 'Sound: on';
    });
    click('btn-pause-settings', () => {
      this.settingsReturn = 'pause';
      $('pause').classList.remove('show');
      this._fillSettings();
      for (const m of MENUS) $(m).classList.toggle('show', m === 'menu-settings');
    });
    // results
    click('btn-rematch', () => app.session?.rematch ? app.session.rematch() : app.session?.restart());
    click('btn-res-menu', () => (app.session?.leaveResults ? app.session.leaveResults() : app.quitToMenu()));
    click('btn-res-skip', () => app.session?.skipToEnd?.());
    // garage
    $('menu-garage').addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      const p = app.profile;
      if (t.dataset.bike) p.bikeId = t.dataset.bike;
      else if (t.dataset.color) p[t.dataset.key] = t.dataset.color;
      else if (t.dataset.outfit) p.outfit = t.dataset.outfit;
      else return;
      app.audio.play('ui');
      saveProfile(p);
      app.net.sendProfile();
      this._openGarage();
    });
    // multiplayer
    $('mp-name').addEventListener('change', () => {
      const n = $('mp-name').value.trim().slice(0, 16);
      if (n) {
        app.profile.name = n;
        saveProfile(app.profile);
        app.net.sendProfile();
      }
    });
    $('mp-server').addEventListener('change', () => {
      const v = $('mp-server').value.trim();
      app.settings.serverCustom = !!v;
      app.settings.server = v || loadSettings().server;
      $('mp-server').value = app.settings.server;
      saveSettings(app.settings);
      if (app.net.ws) app.net.ws.close();
      app.net.connect().catch(() => this.setNetStatus('err', 'Server offline'));
    });
    $('mp-code').addEventListener('input', () => ($('mp-code').value = $('mp-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    click('btn-create', () => app.net.createRoom({ laps: Number($('mp-laps').value), bots: Number($('mp-bots').value), skill: $('mp-skill').value, track: app.track.id }));
    click('btn-join', () => {
      const code = $('mp-code').value.trim();
      if (code.length < 4) return this.toast('Enter the room code first');
      app.net.joinRoom(code);
    });
    click('btn-leave', () => app.net.leaveRoom());
    click('btn-ready', () => app.net.toggleReady());
    click('btn-host-start', () => app.net.startRace());
    click('btn-copy-code', () => {
      const code = $('lobby-code').textContent;
      navigator.clipboard?.writeText(code).then(() => this.toast('Room code copied'), () => this.toast(code));
    });
    for (const [id, key] of [['lobby-laps', 'laps'], ['lobby-bots', 'bots'], ['lobby-skill', 'skill'], ['lobby-weather', 'weather'], ['lobby-track', 'track']]) {
      $(id).addEventListener('change', () => app.net.updateSettings({ [key]: ['skill', 'weather', 'track'].includes(key) ? $(id).value : Number($(id).value) }));
    }
    app.input.bindTouch($('touch'));
  }
}
