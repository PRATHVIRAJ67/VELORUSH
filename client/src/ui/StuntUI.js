// Stunt Park UI: level select (tiers), level detail (Play Solo / Challenge Friends), stunt garage
// (34 bikes + upgrades), missions + achievements, the stunt HUD and the stunt results block.
import { STUNT_LEVELS, STUNT_LEVEL_BY_ID } from '@shared/stunts/levels.js';
import { STUNT_BIKES, STUNT_BIKE_BY_ID, BIKE_CATEGORIES, stuntStats } from '@shared/stunts/bikes.js';
import { objectiveList, objectiveLabel } from '@shared/stunts/objectives.js';
import { buildCourse } from '@shared/stunts/course.js';
import { TIER_NAMES, UPGRADES, UPGRADE_MAX } from '@shared/stunts/config.js';
import { getTrack } from '@shared/tracks.js';
import { escapeHtml, formatTime } from './format.js';
import { GaragePreview } from './GaragePreview.js';
import { stuntData, levelProgress, isUnlocked, unlockText, totalStars, bikeLock, buyBike, equipBike, upgradeCost, buyUpgrade, missionList, claimMission, ACHIEVEMENTS, checkAchievements } from '../core/stuntProfile.js';
import { analytics } from '../core/analytics.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const stars = (n) => `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;

export class StuntUI {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.tab = 'levels';
    this.tier = 1;
    this.sel = 'L01';
    this.cat = 'road';
    this.selBike = null;
    this.popT = null;
    this._bind();
  }

  get sd() {
    return stuntData(this.app.profile);
  }

  // ---------------------------------------------------------------- hub
  open(tab) {
    if (tab) this.tab = tab;
    const sd = this.sd;
    checkAchievements(this.app.profile);
    // jump to the first level not done yet
    if (!this._opened) {
      this._opened = true;
      const next = STUNT_LEVELS.find((l) => isUnlocked(sd, l.id) && !sd.levels[l.id]?.done) || STUNT_LEVELS[0];
      this.sel = next.id;
      this.tier = next.tier;
    }
    this.selBike ||= sd.bikeId;
    this.cat = STUNT_BIKE_BY_ID[this.selBike]?.category || 'road';
    this.render();
  }

  close() {
    this.preview?.stop();
  }

  render() {
    const sd = this.sd;
    $('st-coins').textContent = `🪙 ${fmt(sd.coins)}`;
    $('st-starcount').textContent = `★ ${totalStars(sd)}/150`;
    document.querySelectorAll('[data-sttab]').forEach((b) => b.classList.toggle('sel', b.dataset.sttab === this.tab));
    for (const t of ['levels', 'garage', 'missions']) $('st-' + t).classList.toggle('show', this.tab === t);
    const ready = missionList(sd).filter((m) => m.done).length;
    $('st-mission-badge').textContent = ready ? String(ready) : '';
    if (this.tab === 'levels') this.renderLevels();
    if (this.tab === 'garage') this.renderGarage();
    else this.preview?.stop();
    if (this.tab === 'missions') this.renderMissions();
  }

  renderLevels() {
    const sd = this.sd;
    $('st-tiers').innerHTML = TIER_NAMES.map((n, i) => {
      const lv = STUNT_LEVELS.filter((l) => l.tier === i + 1);
      const got = lv.reduce((a, l) => a + (sd.levels[l.id]?.stars || 0), 0);
      return `<button class="chip ${this.tier === i + 1 ? 'sel' : ''}" data-tier="${i + 1}">${n} <small>${lv[0].n}-${lv.at(-1).n} · ★${got}/${lv.length * 3}</small></button>`;
    }).join('');
    $('st-grid').innerHTML = STUNT_LEVELS.filter((l) => l.tier === this.tier)
      .map((l) => {
        const p = levelProgress(sd, l.id);
        const open = isUnlocked(sd, l.id);
        return `<button class="lv-card ${l.id === this.sel ? 'sel' : ''} ${open ? '' : 'locked'} ${p.done ? 'done' : ''}" data-level="${l.id}">
          <em>${l.n}</em><b>${escapeHtml(l.name)}</b><span>${open ? stars(p.stars || 0) : '🔒'}</span></button>`;
      })
      .join('');
    this.renderDetail();
  }

  renderDetail() {
    const sd = this.sd;
    const l = STUNT_LEVEL_BY_ID[this.sel];
    const p = levelProgress(sd, l.id);
    const open = isUnlocked(sd, l.id);
    const course = buildCourse(l);
    const map = getTrack(l.map).name;
    const objs = objectiveList(l).map((o) => `<li>${escapeHtml(objectiveLabel(o))}</li>`).join('');
    const feats = {};
    for (const f of course.features) feats[f.t] = (feats[f.t] || 0) + 1;
    const featTxt = Object.entries(feats).map(([k, n]) => `${n} ${FEATURE_NAMES[k] || k}${n > 1 ? 's' : ''}`).join(' · ');
    const extras = [course.rings.length && `${course.rings.length} ring${course.rings.length > 1 ? 's' : ''}`, course.targets.length && `${course.targets.length} target${course.targets.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
    $('st-detail').innerHTML = `
      <div class="ld-head"><b>L${l.n} · ${escapeHtml(l.name)}</b><span class="tier t${l.tier}">${TIER_NAMES[l.tier - 1]}</span></div>
      <div class="ld-map">${escapeHtml(map)} · ${Math.round(course.length)} m${l.time ? ` · ${l.time} s limit` : ''}</div>
      <p class="ld-desc">${escapeHtml(l.desc)}</p>
      <div class="ld-feats">${featTxt}${extras ? ' · ' + extras : ''}</div>
      <h3>Objectives <small>finish the course with all of them</small></h3><ul class="ld-obj">${objs}<li>Cross the finish line</li></ul>
      <div class="ld-row"><span>Stars</span>${stars(p.stars || 0)}<small>★★ ${fmt(l.stars[0])} · ★★★ ${fmt(l.stars[1])}</small></div>
      <div class="ld-row"><span>Reward</span><b>🪙 ${fmt(l.reward)}</b><small>+${fmt(l.reward * 0.5)} at ★★ · +${fmt(l.reward)} at ★★★ (once each)</small></div>
      ${p.done ? `<div class="ld-row"><span>Best</span><b>${fmt(p.best)} pts</b><small>${p.bestTime != null ? formatTime(p.bestTime) : ''}</small></div>` : ''}
      ${open ? '' : `<p class="ld-lock">🔒 ${escapeHtml(unlockText(l.id))}</p>`}
      ${l.tip ? `<p class="hint">💡 ${escapeHtml(l.tip)}</p>` : ''}
      <div class="btn-row ld-btns">
        <button class="btn primary" id="st-play" ${open ? '' : 'disabled'}>Play Solo</button>
        <button class="btn" id="st-challenge" ${open ? '' : 'disabled'}>Challenge Friends</button>
      </div>
      <p class="hint">Challenge Friends opens a private room on this level. Friends join with the room code (Multiplayer → Join room) and can ride it even if it is still locked for them.</p>`;
  }

  // ---------------------------------------------------------------- garage
  renderGarage() {
    const sd = this.sd;
    if (!this.preview) this.preview = new GaragePreview($('st-preview'));
    const bike = STUNT_BIKE_BY_ID[this.selBike] || STUNT_BIKE_BY_ID[sd.bikeId];
    this.preview.start({ ...this.ui._look(), bikeId: bike.id });
    $('st-owned').textContent = `${sd.owned.length}/${STUNT_BIKES.length} owned`;
    $('st-cats').innerHTML = BIKE_CATEGORIES.map((c) => `<button class="chip ${c.id === this.cat ? 'sel' : ''}" data-cat="${c.id}">${c.name}</button>`).join('');
    $('st-bikes').innerHTML = STUNT_BIKES.filter((b) => b.category === this.cat)
      .map((b) => {
        const lock = bikeLock(sd, b);
        const tag = b.id === sd.bikeId ? '<em class="eq">RIDING</em>' : lock.owned ? '<em class="own">OWNED</em>' : `<em class="price">🔒 🪙 ${fmt(lock.price)}</em>`;
        return `<button class="bike-item ${b.id === bike.id ? 'sel' : ''} ${lock.owned ? '' : 'locked'}" data-sbike="${b.id}"><b>${escapeHtml(b.name)}</b><small>${escapeHtml(b.desc)}</small>${tag}</button>`;
      })
      .join('');
    const lock = bikeLock(sd, bike);
    $('st-bike-name').textContent = bike.name;
    $('st-bike-desc').textContent = `${BIKE_CATEGORIES.find((c) => c.id === bike.category).name} · ${bike.desc}`;
    const s = stuntStats(bike.id);
    const bar = (label, v, lo = 0.8, span = 0.6) => `<div class="stat"><span>${label}</span><div><i style="width:${Math.max(4, Math.min(100, Math.round(((v - lo) / span) * 100)))}%"></i></div></div>`;
    $('st-bike-stats').innerHTML =
      bar('Power', bike.power, 0.85, 0.3) + bar('Top speed', bike.top, 0.85, 0.3) + bar('Handling', bike.handling, 0.85, 0.3) + bar('Air control', s.air) + bar('Rotation', s.rot) + bar('Landing', s.land) + bar('Nitro', s.nitro) +
      '<p class="hint">Air control, rotation, landing and nitro only matter in stunt mode. Racing always uses the four road bikes.</p>';
    let act;
    if (bike.id === sd.bikeId) act = '<button class="btn" disabled>Equipped</button>';
    else if (lock.owned) act = `<button class="btn primary" data-equip="${bike.id}">Ride this bike</button>`;
    else act = `<button class="btn primary" data-buy="${bike.id}" ${lock.canBuy ? '' : 'disabled'}>Buy · 🪙 ${fmt(lock.price)}</button><p class="ld-lock">${lock.canBuy ? 'Unlocked — buy it with coins' : 'Requires: ' + lock.reasons.map(escapeHtml).join(' · ')}</p>`;
    $('st-bike-act').innerHTML = act;
    $('st-upgrades').innerHTML = UPGRADES.map((u) => {
      const lv = sd.upgrades[u.id];
      const cost = upgradeCost(sd, u.id);
      const pips = Array.from({ length: UPGRADE_MAX }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="upg"><div><b>${u.name}</b><small>${u.desc} · +${Math.round(u.per * 100 * lv)}%</small></div><span class="pips">${pips}</span>
        <button class="btn small" data-upg="${u.id}" ${cost == null || sd.coins < cost ? 'disabled' : ''}>${cost == null ? 'MAX' : '🪙 ' + fmt(cost)}</button></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- missions
  renderMissions() {
    const sd = this.sd;
    $('st-mission-list').innerHTML = missionList(sd)
      .map(
        (m) => `<div class="mission ${m.done ? 'done' : ''}"><div><b>${escapeHtml(m.label)}</b><small>${fmt(m.got)}/${fmt(m.n)} · 🪙 ${m.coins}</small>
          <div class="xpbar"><div style="width:${Math.round((m.got / m.n) * 100)}%"></div></div></div>
          <button class="btn small ${m.done ? 'primary' : ''}" data-claim="${m.slot}" ${m.done ? '' : 'disabled'}>${m.done ? 'Claim' : 'In progress'}</button></div>`,
      )
      .join('');
    const got = ACHIEVEMENTS.filter((a) => sd.achievements[a.id]).length;
    $('st-ach-count').textContent = `${got}/${ACHIEVEMENTS.length}`;
    $('st-ach-list').innerHTML = ACHIEVEMENTS.map((a) => `<div class="ach ${sd.achievements[a.id] ? 'got' : ''}"><b>${sd.achievements[a.id] ? '🏆' : '○'} ${escapeHtml(a.name)}</b><small>${escapeHtml(a.desc)} · 🪙 ${a.coins}</small></div>`).join('');
  }

  // ---------------------------------------------------------------- bindings
  _bind() {
    const app = this.app;
    const root = $('menu-stunt');
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || t.disabled) return;
      const d = t.dataset;
      let handled = true;
      if (d.sttab) {
        this.tab = d.sttab;
        this.render();
      } else if (d.tier) {
        this.tier = Number(d.tier);
        const first = STUNT_LEVELS.find((l) => l.tier === this.tier);
        if (STUNT_LEVEL_BY_ID[this.sel].tier !== this.tier) this.sel = first.id;
        this.renderLevels();
      } else if (d.level) {
        this.sel = d.level;
        this.renderLevels();
      } else if (t.id === 'st-play') {
        if (!isUnlocked(this.sd, this.sel)) return this.ui.toast(unlockText(this.sel));
        app.startStunt(this.sel, { source: 'menu' });
      } else if (t.id === 'st-challenge') {
        if (!isUnlocked(this.sd, this.sel)) return this.ui.toast(unlockText(this.sel));
        const level = STUNT_LEVEL_BY_ID[this.sel];
        analytics.track('stunt_challenge', { m: level.map, md: 'stunt', x: 'create', v: level.n });
        app.net.createRoom({ mode: 'stunt', level: level.id });
      } else if (d.cat) {
        this.cat = d.cat;
        this.selBike = STUNT_BIKES.find((b) => b.category === d.cat).id;
        this.renderGarage();
      } else if (d.sbike) {
        // selecting shows the bike; only owned bikes can be equipped
        this.selBike = d.sbike;
        this.renderGarage();
      } else if (d.equip) {
        if (equipBike(app.profile, d.equip)) {
          app.net.sendProfile();
          this.ui.toast(`Riding the ${STUNT_BIKE_BY_ID[d.equip].name}`, 1400);
        }
        this.render();
      } else if (d.buy) {
        const r = buyBike(app.profile, d.buy);
        if (r.ok) {
          equipBike(app.profile, d.buy);
          app.net.sendProfile();
          checkAchievements(app.profile);
          this.ui.toast(`${STUNT_BIKE_BY_ID[d.buy].name} unlocked!`, 1800);
        } else this.ui.toast(r.msg, 2600);
        this.render();
      } else if (d.upg) {
        const r = buyUpgrade(app.profile, d.upg);
        if (!r.ok) this.ui.toast(r.msg);
        else checkAchievements(app.profile);
        this.render();
      } else if (d.claim !== undefined) {
        const c = claimMission(app.profile, Number(d.claim));
        if (c) this.ui.toast(`Mission complete: +${c} coins`, 1800);
        this.render();
      } else handled = false;
      if (handled) app.audio.play('ui');
    });
  }

  // ---------------------------------------------------------------- lobby (challenge)
  renderLobby(room, isHost) {
    const level = STUNT_LEVEL_BY_ID[room.settings.level] || STUNT_LEVELS[0];
    const sd = this.sd;
    const sel = $('lobby-level');
    // the host picks from levels they have unlocked (plus the current one)
    const opts = STUNT_LEVELS.filter((l) => isUnlocked(sd, l.id) || l.id === level.id);
    const html = opts.map((l) => `<option value="${l.id}">L${l.n} · ${escapeHtml(l.name)}</option>`).join('');
    if (sel.dataset.html !== html) {
      sel.innerHTML = html;
      sel.dataset.html = html;
    }
    sel.value = level.id;
    sel.disabled = !isHost || room.phase !== 'lobby';
    const locked = !isUnlocked(sd, level.id);
    $('lobby-stunt-info').innerHTML = `<b>${TIER_NAMES[level.tier - 1]} · ${escapeHtml(getTrack(level.map).name)}</b><ul class="ld-obj">${objectiveList(level)
      .map((o) => `<li>${escapeHtml(objectiveLabel(o))}</li>`)
      .join('')}</ul>${locked ? '<p class="hint">🔓 Locked for you in solo — open for this challenge only (no permanent unlock).</p>' : ''}<p class="hint">Everyone rides the same level with base bike stats (no upgrades). Highest score wins; completing the objectives ranks first.</p>`;
  }

  // ---------------------------------------------------------------- session + HUD
  onSessionStart(s) {
    $('hud-lap').textContent = `L${s.level.n} ${s.level.name}`;
    this.comboShown = 0;
    $('sh-pop').innerHTML = '';
  }

  onSessionEnd() {
    clearTimeout(this.popT);
    $('sh-pop').innerHTML = '';
  }

  updateHud(h) {
    $('sh-score').textContent = fmt(h.score);
    const mult = h.combo > 1 ? `x${(1 + (h.combo - 1) * 0.5).toFixed(1)} COMBO` : '';
    const c = $('sh-combo');
    c.textContent = mult;
    c.style.setProperty('--t', String(Math.max(0, Math.min(1, h.comboT / 4))));
    const objHtml = h.objectives.map((o) => `<li class="${o.done ? 'ok' : ''}"><span>${o.done ? '✓' : '○'}</span>${escapeHtml(o.label)}<em>${o.progress}</em></li>`).join('');
    if (objHtml !== this._objHtml) {
      $('sh-obj').innerHTML = objHtml;
      this._objHtml = objHtml;
    }
    const hint = $('sh-hint');
    if (h.hint) {
      hint.textContent = h.hint.min ? `${h.hint.kind} · at least ${h.hint.kmh} km/h` : `${h.hint.kind} · ride in at ~${h.hint.kmh} km/h`;
      hint.classList.add('show');
    } else hint.classList.remove('show');
    $('sh-air').textContent = h.air > 0.35 ? `AIR ${h.air.toFixed(1)} s` : '';
    if (h.timeLimit) {
      const left = Math.max(0, h.timeLimit - h.time);
      $('hud-timer').textContent = formatTime(left);
      $('hud-timer').classList.toggle('low', left < 10);
    }
    $('hud-dist').textContent = `${Math.round(h.progress * 100)}%`;
    const others = h.others.map((o) => `<li><i style="background:${o.color}"></i><span>${escapeHtml(o.name)}</span><em>${fmt(o.score)}${o.finished ? ' ✓' : ''}</em></li>`).join('');
    if (others !== this._othersHtml) {
      $('sh-others').innerHTML = others;
      this._othersHtml = others;
    }
  }

  trickPopup(e) {
    const el = $('sh-pop');
    const names = e.names.length ? e.names.join(' + ') : e.air >= 0.32 ? (e.air > 1.2 ? 'BIG AIR' : 'AIR') : '';
    if (!names && !e.target && !e.perfect) return;
    const extra = [e.perfect && 'PERFECT', e.target && 'BULLSEYE', e.rings && `RING${e.rings > 1 ? ' x' + e.rings : ''}`].filter(Boolean).join(' · ');
    el.innerHTML = `<b>${names || 'NICE'}</b>${extra ? `<small>${extra}</small>` : ''}<em>+${fmt(e.points)}${e.mult > 1 ? ` <i>x${e.mult.toFixed(1)}</i>` : ''}</em>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.popT);
    this.popT = setTimeout(() => el.classList.remove('show'), 1600);
  }

  flashLine(text) {
    this.ui.message(text, '', 'small flashy');
  }

  comboBroken() {
    $('sh-combo').textContent = '';
  }

  // ---------------------------------------------------------------- results
  renderResults(r) {
    const el = $('res-stunt');
    if (!r) {
      el.innerHTML = '';
      return;
    }
    const objs = r.objectives.map((o) => `<li class="${o.done ? 'ok' : 'no'}"><span>${o.done ? '✓' : '✗'}</span>${escapeHtml(o.label)}<em>${o.progress}</em></li>`).join('');
    if (r.challenge) {
      el.innerHTML = `<div class="rs-score"><b>${fmt(r.score)}</b><small>your points${r.complete ? ' · objectives complete ✓' : ''}</small></div><ul class="ld-obj rs-obj">${objs}</ul>`;
      return;
    }
    const rw = r.reward;
    const coinLines = rw?.lines?.length ? rw.lines.map(([t, v]) => `<div><span>${escapeHtml(t)}</span><b>+🪙 ${fmt(v)}</b></div>`).join('') : '<div><span>No coins this run (complete the objectives)</span><b></b></div>';
    const ach = (r.achievements || []).map((a) => `<div class="rs-ach">🏆 ${escapeHtml(a.name)} <b>+🪙 ${a.coins}</b></div>`).join('');
    el.innerHTML = `
      <div class="rs-score"><b>${fmt(r.score)}</b><small>points · ${formatTime(r.time)}</small>${stars(r.stars)}</div>
      <ul class="ld-obj rs-obj">${objs}<li class="${r.complete ? 'ok' : 'no'}"><span>${r.complete ? '✓' : '✗'}</span>Cross the finish line</li></ul>
      <div class="rs-stars">★★ ${fmt(r.level.stars[0])} · ★★★ ${fmt(r.level.stars[1])}${rw?.newBest ? ' · <b>NEW BEST</b>' : ''}</div>
      <div class="xp-line rs-coins">${coinLines}</div>${ach}
      ${rw?.unlockedNext ? `<div class="rs-unlock">🔓 Unlocked L${rw.unlockedNext.n} · ${escapeHtml(rw.unlockedNext.name)}</div>` : ''}
      ${r.missionsReady ? `<div class="rs-unlock">🎯 ${r.missionsReady} mission${r.missionsReady > 1 ? 's' : ''} ready to claim in Stunt Park</div>` : ''}
      <div class="rs-total">Coins: 🪙 ${fmt(this.sd.coins)}</div>`;
  }
}

const FEATURE_NAMES = { kick: 'kicker', table: 'tabletop', gap: 'gap', step: 'step-up', deck: 'drop deck', rollers: 'roller set', barrels: 'barrel slalom', pad: 'nitro pad' };
