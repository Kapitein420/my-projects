/* ============================================================
   TOME OF HEROES — Combat / Initiative Tracker
   Handles: initiative rolling, turn order, round tracking,
   active turn highlighting
   ============================================================ */

// ── HELPERS ──────────────────────────────────────────────────
function d20() { return Math.floor(Math.random() * 20) + 1; }
const _logUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function getDexMod(entity, type) {
  if (type === 'character') {
    const dex = parseInt(entity.dex) || 10;
    return Math.floor((dex - 10) / 2);
  }
  if (type === 'monster') {
    // Monster instances don't store DEX, look up template
    const template = MONSTER_DB.find(t => t.name === entity.templateName);
    const dex = template ? parseInt(template.dex) || 10 : 10;
    return Math.floor((dex - 10) / 2);
  }
  return 0;
}

// ── COMBAT SETUP ─────────────────────────────────────────────

function showCombatSetup() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;

  // Gather all placed entities (characters + monsters with tokens on map)
  const placedCharIds = new Set();
  const placedMonIds = new Set();
  for (const tok of (m.tokens || [])) {
    if (tok.characterId) placedCharIds.add(tok.characterId);
    if (tok.monsterId) placedMonIds.add(tok.monsterId);
  }

  const entries = [];

  // Characters on map
  for (const cid of placedCharIds) {
    const c = characters.find(x => x.id === cid);
    if (!c) continue;
    const dexMod = getDexMod(c, 'character');
    const roll = d20();
    entries.push({
      id: c.id,
      type: 'character',
      name: c.name,
      initiative: roll + dexMod,
      roll: roll,
      mod: dexMod,
      hp: c.currentHp,
      maxHp: c.maxHp
    });
  }

  // Monsters on map
  for (const mid of placedMonIds) {
    const mon = (m.monsters || []).find(x => x.id === mid);
    if (!mon) continue;
    const dexMod = getDexMod(mon, 'monster');
    const roll = d20();
    entries.push({
      id: mon.id,
      type: 'monster',
      name: mon.displayName || mon.templateName,
      initiative: roll + dexMod,
      roll: roll,
      mod: dexMod,
      hp: mon.currentHp,
      maxHp: mon.maxHp
    });
  }

  // Sort by initiative desc
  entries.sort((a, b) => b.initiative - a.initiative);

  // Render the setup modal
  const overlay = document.getElementById('combat-setup-overlay');
  if (!overlay) return;

  const listHtml = entries.map((e, i) => {
    const typeTag = e.type === 'monster' ? '<span style="color:#8a2020;font-size:.6rem;">MON</span>' : '<span style="color:#c8a45a;font-size:.6rem;">PC</span>';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);" data-entry-idx="' + i + '">' +
      '<div style="width:28px;text-align:center;">' + typeTag + '</div>' +
      '<div style="flex:1;font-size:.8rem;color:var(--text);">' + e.name + '</div>' +
      '<div style="font-size:.6rem;color:var(--text4);">d20(' + e.roll + ') + ' + (e.mod >= 0 ? '+' : '') + e.mod + ' =</div>' +
      '<input type="number" value="' + e.initiative + '" style="width:45px;text-align:center;font-size:.85rem;font-weight:600;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--r);color:var(--text);padding:3px;" onchange="combatSetupUpdateInit(' + i + ',this.value)">' +
    '</div>';
  }).join('');

  document.getElementById('combat-setup-list').innerHTML = listHtml;
  overlay.classList.add('open');

  // Store entries temporarily
  window._combatSetupEntries = entries;
}

function combatSetupUpdateInit(idx, val) {
  if (window._combatSetupEntries && window._combatSetupEntries[idx]) {
    window._combatSetupEntries[idx].initiative = parseInt(val) || 0;
  }
}

function closeCombatSetup() {
  const overlay = document.getElementById('combat-setup-overlay');
  if (overlay) overlay.classList.remove('open');
  window._combatSetupEntries = null;
}

function rerollAllInitiative() {
  const entries = window._combatSetupEntries;
  if (!entries) return;
  for (const e of entries) {
    e.roll = d20();
    e.initiative = e.roll + e.mod;
  }
  entries.sort((a, b) => b.initiative - a.initiative);
  // Re-render
  showCombatSetup();
}

// ── START COMBAT ─────────────────────────────────────────────

function beginCombat() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  const entries = window._combatSetupEntries;
  if (!entries || !entries.length) return;

  // Sort final
  entries.sort((a, b) => b.initiative - a.initiative);

  // Store combat state
  m.combat = {
    active: true,
    round: 1,
    turnIndex: 0,
    startedAt: Date.now(),
    log: [],
    entries: entries.map(e => ({
      id: e.id,
      type: e.type,
      initiative: e.initiative,
      name: e.name
    }))
  };

  // Log combat start
  combatLog({ type: 'combat_start', note: 'Combat began with ' + entries.length + ' participants' });
  combatLog({ type: 'turn_start', note: m.combat.entries[0]?.name + "'s turn" });

  m.updatedAt = Date.now();
  closeCombatSetup();
  saveCurrentMap();
  renderInitiativeBar();
  renderCombatLog();
  renderTokensOnMap();
}

// ── TURN MANAGEMENT ──────────────────────────────────────────

function nextTurn() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat?.active) return;

  let idx = m.combat.turnIndex;
  const len = m.combat.entries.length;
  let attempts = 0;

  do {
    idx = (idx + 1) % len;
    if (idx === 0) m.combat.round++;
    attempts++;
    // Skip dead monsters
    const entry = m.combat.entries[idx];
    if (entry.type === 'monster') {
      const mon = (m.monsters || []).find(x => x.id === entry.id);
      if (mon && mon.currentHp <= 0) continue;
    }
    break;
  } while (attempts < len * 2);

  m.combat.turnIndex = idx;
  const newEntry = m.combat.entries[idx];
  combatLog({ type: 'turn_start', note: 'Round ' + m.combat.round + ' \u2014 ' + newEntry.name + "'s turn" });
  m.updatedAt = Date.now();
  saveCurrentMap();
  renderInitiativeBar();
  renderCombatLog();
  renderTokensOnMap();
}

function prevTurn() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat?.active) return;

  let idx = m.combat.turnIndex;
  const len = m.combat.entries.length;

  idx = (idx - 1 + len) % len;
  if (idx === len - 1 && m.combat.round > 1) m.combat.round--;

  m.combat.turnIndex = idx;
  m.updatedAt = Date.now();
  saveCurrentMap();
  renderInitiativeBar();
  renderTokensOnMap();
}

function endCombat() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  if (!confirm('End combat? Initiative order will be cleared.')) return;

  combatLog({ type: 'combat_end', note: 'Combat ended after ' + m.combat.round + ' rounds' });

  // Save log before clearing combat
  const log = m.combat.log ? [...m.combat.log] : [];
  const rounds = m.combat.round;
  const startedAt = m.combat.startedAt;

  // Show report
  showCombatReport(log, rounds, startedAt);

  m.combat = { active: false, round: 0, turnIndex: 0, entries: [], log: log };
  m.updatedAt = Date.now();
  saveCurrentMap();
  renderInitiativeBar();
  renderCombatLog();
  renderTokensOnMap();
}

// ── INITIATIVE BAR RENDERING ─────────────────────────────────

function renderInitiativeBar() {
  const m = maps.find(x => x.id === currentMapId);
  const bar = document.getElementById('initiative-bar');
  const startBtn = document.getElementById('combat-start-btn');
  if (!bar) return;

  if (!m?.combat?.active) {
    bar.style.display = 'none';
    if (startBtn) startBtn.style.display = '';
    return;
  }

  if (startBtn) startBtn.style.display = 'none';
  bar.style.display = 'flex';

  const combat = m.combat;
  const current = combat.entries[combat.turnIndex];

  let entriesHtml = '';
  for (let i = 0; i < combat.entries.length; i++) {
    const e = combat.entries[i];
    const isActive = i === combat.turnIndex;
    const isMon = e.type === 'monster';

    // Check if dead
    let isDead = false;
    if (isMon) {
      const mon = (m.monsters || []).find(x => x.id === e.id);
      if (mon && mon.currentHp <= 0) isDead = true;
    } else {
      const c = characters.find(x => x.id === e.id);
      if (c && c.currentHp <= 0) isDead = true;
    }

    const borderColor = isActive ? '#c8a45a' : isDead ? '#333' : isMon ? '#8a2020' : 'var(--border)';
    const bgColor = isActive ? 'var(--glow-bg)' : isDead ? 'rgba(0,0,0,.3)' : 'var(--bg-card)';
    const textColor = isDead ? 'var(--text4)' : 'var(--text)';
    const decoration = isDead ? 'line-through' : 'none';

    // Get portrait
    let portrait = '';
    if (isMon) {
      const mon = (m.monsters || []).find(x => x.id === e.id);
      if (mon && mon.imgUrl) portrait = '<img src="' + mon.imgUrl + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1.5px solid ' + borderColor + ';">';
      else portrait = '<div style="width:28px;height:28px;border-radius:50%;background:#3a1818;border:1.5px solid ' + borderColor + ';display:flex;align-items:center;justify-content:center;font-size:.5rem;color:#c04040;font-family:var(--font-display);">' + (e.name || '?').charAt(0) + '</div>';
    } else {
      const c = characters.find(x => x.id === e.id);
      if (c && c.imageUrl) portrait = '<img src="' + c.imageUrl + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1.5px solid ' + borderColor + ';">';
      else {
        const col = c ? classColor(c.class) : '#5a4830';
        portrait = '<div style="width:28px;height:28px;border-radius:50%;background:' + col + '20;border:1.5px solid ' + borderColor + ';display:flex;align-items:center;justify-content:center;font-size:.5rem;color:' + col + ';font-family:var(--font-display);">' + (c?.icon || (e.name || '?').charAt(0)) + '</div>';
      }
    }

    entriesHtml += '<div style="display:flex;flex-direction:column;align-items:center;padding:4px 8px;border:1.5px solid ' + borderColor + ';border-radius:8px;background:' + bgColor + ';min-width:55px;flex-shrink:0;gap:2px;">' +
      portrait +
      '<div style="font-size:.62rem;color:#efe4d0;text-decoration:' + decoration + ';white-space:nowrap;max-width:65px;overflow:hidden;text-overflow:ellipsis;' + (isDead ? 'opacity:.4;' : '') + '" title="' + e.name + '">' + e.name + '</div>' +
      '<div style="font-size:.55rem;font-weight:600;color:' + (isActive ? '#c8a45a' : '#8a7868') + ';">' + e.initiative + '</div>' +
    '</div>';
  }

  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
      '<div style="font-family:var(--font-display);font-size:.65rem;color:#8a6a30;text-transform:uppercase;letter-spacing:.08em;">Round ' + combat.round + '</div>' +
      '<div style="font-size:.75rem;color:var(--text);font-weight:500;">' + (current ? current.name : '') + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:5px;overflow-x:auto;flex:1;padding:4px 0;">' + entriesHtml + '</div>' +
    '<div style="display:flex;gap:4px;flex-shrink:0;">' +
      '<button class="btn btn-sm btn-ghost" onclick="prevTurn()" title="Previous turn" style="font-size:.75rem;">\u25C0</button>' +
      '<button class="btn btn-sm btn-primary" onclick="nextTurn()" style="font-size:.75rem;">Next \u25B6</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="endCombat()" style="font-size:.7rem;color:var(--red);">End</button>' +
    '</div>';
}

// ══════════════════════════════════════════════════════════════
// COMBAT LOG SYSTEM
// ══════════════════════════════════════════════════════════════

function combatLog(entry) {
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat) return;
  m.combat.log = m.combat.log || [];
  const current = m.combat.entries?.[m.combat.turnIndex];
  m.combat.log.push({
    id: _logUid(),
    timestamp: Date.now(),
    round: m.combat.round || 0,
    turn: current?.name || '',
    turnId: current?.id || '',
    ...entry
  });
}

function getCurrentTurnEntity() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat?.active) return null;
  return m.combat.entries?.[m.combat.turnIndex] || null;
}

// Called when HP changes during combat — logs and optionally shows popup
function logHpChange(targetId, targetName, targetType, oldHp, newHp) {
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat?.active) return;

  const delta = newHp - oldHp;
  if (delta === 0) return;

  const source = getCurrentTurnEntity();
  const isDamage = delta < 0;
  const value = Math.abs(delta);

  // Auto-log the event
  const entry = {
    type: isDamage ? 'damage' : 'heal',
    source: source ? { id: source.id, name: source.name, type: source.type } : null,
    target: { id: targetId, name: targetName, type: targetType },
    value: value,
    note: ''
  };

  combatLog(entry);

  // Check for kill
  if (newHp <= 0 && oldHp > 0) {
    combatLog({
      type: 'kill',
      source: source ? { id: source.id, name: source.name, type: source.type } : null,
      target: { id: targetId, name: targetName, type: targetType },
      value: 0,
      note: targetName + ' was slain'
    });
  }

  // Show quick damage popup for DM to add note
  showDamagePopup(entry, m.combat.log.length - (newHp <= 0 && oldHp > 0 ? 2 : 1));

  saveCurrentMap();
  renderCombatLog();
}

// ── DAMAGE POPUP ─────────────────────────────────────────────
let _damagePopupTimeout = null;

function showDamagePopup(entry, logIdx) {
  clearTimeout(_damagePopupTimeout);
  const popup = document.getElementById('damage-popup');
  if (!popup) return;

  const isDamage = entry.type === 'damage';
  const icon = isDamage ? '\u2694' : '\u2764';
  const color = isDamage ? '#c04040' : '#4a9a40';
  const sourceName = entry.source?.name || 'Unknown';

  popup.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
      '<span style="font-size:1rem;">' + icon + '</span>' +
      '<span style="font-size:.8rem;color:#efe4d0;font-weight:500;">' + entry.target.name + '</span>' +
      '<span style="font-size:.85rem;color:' + color + ';font-weight:600;">' + (isDamage ? '-' : '+') + entry.value + '</span>' +
    '</div>' +
    '<div style="display:flex;gap:6px;align-items:center;">' +
      '<span style="font-size:.65rem;color:#8a7868;">from</span>' +
      '<span style="font-size:.72rem;color:#c8a45a;">' + sourceName + '</span>' +
      '<input type="text" id="dmg-note-input" placeholder="Fireball, Sneak Attack..." style="flex:1;font-size:.7rem;padding:3px 6px;background:#1e1810;border:1px solid rgba(200,164,90,.15);border-radius:4px;color:#efe4d0;" onkeydown="if(event.key===\'Enter\')saveDamageNote(' + logIdx + ')">' +
      '<button class="btn btn-sm btn-primary" onclick="saveDamageNote(' + logIdx + ')" style="font-size:.6rem;padding:2px 8px;">Log</button>' +
    '</div>';

  popup.style.display = 'block';

  // Auto-dismiss after 8 seconds
  _damagePopupTimeout = setTimeout(() => { popup.style.display = 'none'; }, 8000);
}

function saveDamageNote(logIdx) {
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat?.log?.[logIdx]) return;
  const note = document.getElementById('dmg-note-input')?.value || '';
  m.combat.log[logIdx].note = note;
  saveCurrentMap();
  renderCombatLog();
  const popup = document.getElementById('damage-popup');
  if (popup) popup.style.display = 'none';
  clearTimeout(_damagePopupTimeout);
}

// ── COMBAT LOG PANEL ─────────────────────────────────────────

function renderCombatLog() {
  const el = document.getElementById('combat-log-content');
  if (!el) return;
  const m = maps.find(x => x.id === currentMapId);
  const log = m?.combat?.log || [];

  if (!log.length) {
    el.innerHTML = '<div style="font-size:.65rem;color:#5a4e40;padding:.5rem 0;">No events yet. Start combat to begin logging.</div>';
    return;
  }

  // Show newest first
  el.innerHTML = log.slice().reverse().map(e => {
    let icon = '', color = '#8a7868', text = '';
    switch (e.type) {
      case 'damage':
        icon = '\u2694'; color = '#c04040';
        text = (e.source?.name || '?') + ' dealt <strong style="color:#c04040">' + e.value + ' dmg</strong> to ' + (e.target?.name || '?');
        if (e.note) text += ' <span style="color:#8a7868;">(' + e.note + ')</span>';
        break;
      case 'heal':
        icon = '\u2764'; color = '#4a9a40';
        text = (e.target?.name || '?') + ' healed <strong style="color:#4a9a40">' + e.value + ' HP</strong>';
        if (e.source) text += ' from ' + e.source.name;
        break;
      case 'kill':
        icon = '\u2620'; color = '#c8a45a';
        text = '<strong style="color:#c8a45a">' + (e.target?.name || '?') + ' was slain</strong>';
        if (e.source) text += ' by ' + e.source.name;
        break;
      case 'turn_start':
        icon = '\u25B6'; color = '#8a6a30';
        text = '<span style="color:#8a6a30;">' + e.note + '</span>';
        break;
      case 'combat_start':
        icon = '\u2694'; color = '#c8a45a';
        text = '<span style="color:#c8a45a;">' + e.note + '</span>';
        break;
      case 'combat_end':
        icon = '\u2691'; color = '#c8a45a';
        text = '<span style="color:#c8a45a;">' + e.note + '</span>';
        break;
      case 'note':
        icon = '\u270E'; color = '#8a7868';
        text = e.note;
        break;
    }
    return '<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid rgba(200,164,90,.06);font-size:.68rem;color:#c4b498;line-height:1.4;">' +
      '<span style="color:' + color + ';flex-shrink:0;width:14px;text-align:center;">' + icon + '</span>' +
      '<div>' + text + '</div>' +
    '</div>';
  }).join('');
}

function addCombatNote() {
  const note = prompt('Add a note to the combat log:');
  if (!note?.trim()) return;
  combatLog({ type: 'note', note: note.trim() });
  const m = maps.find(x => x.id === currentMapId);
  if (m) { m.updatedAt = Date.now(); saveCurrentMap(); }
  renderCombatLog();
}

// ── SESSION REPORT ───────────────────────────────────────────

function showCombatReport(log, rounds, startedAt) {
  if (!log || !log.length) return;

  // Compute stats
  const damageDealt = {};  // id -> { name, type, total, kills }
  const damageTaken = {};  // id -> { name, type, total }
  const kills = [];

  for (const e of log) {
    if (e.type === 'damage' && e.source) {
      const key = e.source.id;
      if (!damageDealt[key]) damageDealt[key] = { name: e.source.name, type: e.source.type, total: 0, kills: 0 };
      damageDealt[key].total += e.value;
    }
    if (e.type === 'damage' && e.target) {
      const key = e.target.id;
      if (!damageTaken[key]) damageTaken[key] = { name: e.target.name, type: e.target.type, total: 0 };
      damageTaken[key].total += e.value;
    }
    if (e.type === 'kill') {
      kills.push({ killer: e.source?.name || 'Unknown', victim: e.target?.name || 'Unknown' });
      if (e.source && damageDealt[e.source.id]) damageDealt[e.source.id].kills++;
    }
  }

  // Leaderboards
  const dmgLeader = Object.values(damageDealt).sort((a, b) => b.total - a.total);
  const takenLeader = Object.values(damageTaken).sort((a, b) => b.total - a.total);

  // MVP (most damage from characters)
  const mvp = dmgLeader.find(d => d.type === 'character');
  // Most dangerous enemy
  const mostDangerous = dmgLeader.find(d => d.type === 'monster');

  const duration = startedAt ? Math.round((Date.now() - startedAt) / 60000) : 0;

  // Build report HTML
  let html = '<div style="max-height:70vh;overflow-y:auto;color:#efe4d0;">';

  // Header
  html += '<div style="text-align:center;margin-bottom:1.25rem;">' +
    '<div style="font-family:var(--font-display);font-size:1.2rem;color:#c8a45a;letter-spacing:.1em;">Combat Report</div>' +
    '<div style="font-size:.72rem;color:#8a7868;margin-top:4px;">' + rounds + ' rounds \u00b7 ~' + duration + ' min \u00b7 ' + kills.length + ' kills</div>' +
  '</div>';

  // MVP
  if (mvp) {
    html += '<div style="background:rgba(200,164,90,.08);border:1px solid rgba(200,164,90,.2);border-radius:8px;padding:10px;margin-bottom:12px;text-align:center;">' +
      '<div style="font-size:.55rem;color:#8a6a30;text-transform:uppercase;letter-spacing:.15em;font-family:var(--font-display);">MVP</div>' +
      '<div style="font-size:1.1rem;color:#c8a45a;font-family:var(--font-display);margin:4px 0;">' + mvp.name + '</div>' +
      '<div style="font-size:.7rem;color:#c4b498;">' + mvp.total + ' damage dealt \u00b7 ' + mvp.kills + ' kills</div>' +
    '</div>';
  }

  // Most dangerous
  if (mostDangerous) {
    html += '<div style="background:rgba(192,64,64,.08);border:1px solid rgba(192,64,64,.2);border-radius:8px;padding:10px;margin-bottom:12px;text-align:center;">' +
      '<div style="font-size:.55rem;color:#8a3030;text-transform:uppercase;letter-spacing:.15em;font-family:var(--font-display);">Most Dangerous</div>' +
      '<div style="font-size:1.1rem;color:#c04040;font-family:var(--font-display);margin:4px 0;">' + mostDangerous.name + '</div>' +
      '<div style="font-size:.7rem;color:#c4b498;">' + mostDangerous.total + ' damage dealt</div>' +
    '</div>';
  }

  // Damage leaderboard
  if (dmgLeader.length) {
    html += '<div style="font-family:var(--font-display);font-size:.55rem;color:#c8a45a;text-transform:uppercase;letter-spacing:.15em;margin-bottom:6px;">Damage Dealt</div>';
    const maxDmg = dmgLeader[0]?.total || 1;
    html += dmgLeader.map((d, i) => {
      const pct = Math.round((d.total / maxDmg) * 100);
      const col = d.type === 'monster' ? '#8a2020' : '#c8a45a';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
        '<span style="font-size:.7rem;color:#8a7868;width:16px;">#' + (i + 1) + '</span>' +
        '<span style="font-size:.72rem;color:#efe4d0;width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + d.name + '</span>' +
        '<div style="flex:1;height:6px;background:#1e1810;border-radius:3px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:3px;"></div></div>' +
        '<span style="font-size:.7rem;color:#c4b498;font-family:var(--font-mono);min-width:35px;text-align:right;">' + d.total + '</span>' +
      '</div>';
    }).join('');
    html += '<div style="height:12px;"></div>';
  }

  // Kill feed
  if (kills.length) {
    html += '<div style="font-family:var(--font-display);font-size:.55rem;color:#c8a45a;text-transform:uppercase;letter-spacing:.15em;margin-bottom:6px;">Kill Feed</div>';
    html += kills.map(k =>
      '<div style="font-size:.7rem;color:#c4b498;padding:2px 0;">\u2620 <strong style="color:#efe4d0;">' + k.killer + '</strong> slew <strong style="color:#c04040;">' + k.victim + '</strong></div>'
    ).join('');
  }

  html += '</div>';

  // Show in modal
  const overlay = document.getElementById('combat-report-overlay');
  if (overlay) {
    document.getElementById('combat-report-content').innerHTML = html;
    overlay.classList.add('open');
  }
}

function closeCombatReport() {
  const overlay = document.getElementById('combat-report-overlay');
  if (overlay) overlay.classList.remove('open');
}

function saveReportToNotes() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  const log = m.combat?.log || [];
  const damageDealt = {};
  for (const e of log) {
    if (e.type === 'damage' && e.source) {
      if (!damageDealt[e.source.id]) damageDealt[e.source.id] = { name: e.source.name, total: 0, kills: 0 };
      damageDealt[e.source.id].total += e.value;
    }
    if (e.type === 'kill' && e.source && damageDealt[e.source.id]) damageDealt[e.source.id].kills++;
  }
  const leaders = Object.values(damageDealt).sort((a, b) => b.total - a.total);
  let text = '\n--- Combat Report ---\n';
  text += leaders.map((d, i) => '#' + (i + 1) + ' ' + d.name + ': ' + d.total + ' dmg, ' + d.kills + ' kills').join('\n');
  text += '\n---\n';

  m.notes = (m.notes || '') + text;
  const notesEl = document.getElementById('map-notes');
  if (notesEl) notesEl.value = m.notes;
  m.updatedAt = Date.now();
  saveCurrentMap();
  closeCombatReport();
}
