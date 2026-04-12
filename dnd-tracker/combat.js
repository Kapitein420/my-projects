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
    const typeTag = e.type === 'monster' ? '<span style="color:#8a2020;font-size:.6rem;">MON</span>' : '<span style="color:#c8b070;font-size:.6rem;">PC</span>';
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

    const borderColor = isActive ? '#c8b070' : isDead ? '#333' : isMon ? '#8a2020' : 'var(--border)';
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
      '<div style="font-size:.62rem;color:#e2dbd0;text-decoration:' + decoration + ';white-space:nowrap;max-width:65px;overflow:hidden;text-overflow:ellipsis;' + (isDead ? 'opacity:.4;' : '') + '" title="' + e.name + '">' + e.name + '</div>' +
      '<div style="font-size:.55rem;font-weight:600;color:' + (isActive ? '#c8b070' : '#7a7268') + ';">' + e.initiative + '</div>' +
    '</div>';
  }

  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
      '<div style="font-family:var(--font-display);font-size:.65rem;color:#9a8450;text-transform:uppercase;letter-spacing:.08em;">Round ' + combat.round + '</div>' +
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
      '<span style="font-size:.8rem;color:#e2dbd0;font-weight:500;">' + entry.target.name + '</span>' +
      '<span style="font-size:.85rem;color:' + color + ';font-weight:600;">' + (isDamage ? '-' : '+') + entry.value + '</span>' +
    '</div>' +
    '<div style="display:flex;gap:6px;align-items:center;">' +
      '<span style="font-size:.65rem;color:#7a7268;">from</span>' +
      '<span style="font-size:.72rem;color:#c8b070;">' + sourceName + '</span>' +
      '<input type="text" id="dmg-note-input" placeholder="Fireball, Sneak Attack..." style="flex:1;font-size:.7rem;padding:3px 6px;background:#1e1810;border:1px solid rgba(200,164,90,.15);border-radius:4px;color:#e2dbd0;" onkeydown="if(event.key===\'Enter\')saveDamageNote(' + logIdx + ')">' +
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
    el.innerHTML = '<div style="font-size:.65rem;color:#504840;padding:.5rem 0;">No events yet. Start combat to begin logging.</div>';
    return;
  }

  // Show newest first
  el.innerHTML = log.slice().reverse().map(e => {
    let icon = '', color = '#7a7268', text = '';
    switch (e.type) {
      case 'damage':
        icon = '\u2694'; color = '#c04040';
        text = (e.source?.name || '?') + ' dealt <strong style="color:#c04040">' + e.value + ' dmg</strong> to ' + (e.target?.name || '?');
        if (e.note) text += ' <span style="color:#7a7268;">(' + e.note + ')</span>';
        break;
      case 'heal':
        icon = '\u2764'; color = '#4a9a40';
        text = (e.target?.name || '?') + ' healed <strong style="color:#4a9a40">' + e.value + ' HP</strong>';
        if (e.source) text += ' from ' + e.source.name;
        break;
      case 'kill':
        icon = '\u2620'; color = '#c8b070';
        text = '<strong style="color:#c8b070">' + (e.target?.name || '?') + ' was slain</strong>';
        if (e.source) text += ' by ' + e.source.name;
        break;
      case 'turn_start':
        icon = '\u25B6'; color = '#9a8450';
        text = '<span style="color:#9a8450;">' + e.note + '</span>';
        break;
      case 'combat_start':
        icon = '\u2694'; color = '#c8b070';
        text = '<span style="color:#c8b070;">' + e.note + '</span>';
        break;
      case 'combat_end':
        icon = '\u2691'; color = '#c8b070';
        text = '<span style="color:#c8b070;">' + e.note + '</span>';
        break;
      case 'note':
        icon = '\u270E'; color = '#7a7268';
        text = e.note;
        break;
    }
    return '<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid rgba(200,164,90,.06);font-size:.68rem;color:#b0a898;line-height:1.4;">' +
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

function computeCombatStats(log) {
  const stats = { damageDealt: {}, damageTaken: {}, heals: {}, kills: [], totalDmg: 0, totalHeals: 0 };
  for (const e of log) {
    if (e.type === 'damage' && e.source) {
      const k = e.source.id;
      if (!stats.damageDealt[k]) stats.damageDealt[k] = { name: e.source.name, type: e.source.type, total: 0, kills: 0, hits: 0, biggestHit: 0, methods: {} };
      stats.damageDealt[k].total += e.value;
      stats.damageDealt[k].hits++;
      if (e.value > stats.damageDealt[k].biggestHit) stats.damageDealt[k].biggestHit = e.value;
      if (e.note) stats.damageDealt[k].methods[e.note] = (stats.damageDealt[k].methods[e.note] || 0) + e.value;
      stats.totalDmg += e.value;
    }
    if (e.type === 'damage' && e.target) {
      const k = e.target.id;
      if (!stats.damageTaken[k]) stats.damageTaken[k] = { name: e.target.name, type: e.target.type, total: 0 };
      stats.damageTaken[k].total += e.value;
    }
    if (e.type === 'heal' && e.target) {
      const k = e.target.id;
      if (!stats.heals[k]) stats.heals[k] = { name: e.target.name, total: 0 };
      stats.heals[k].total += e.value;
      stats.totalHeals += e.value;
    }
    if (e.type === 'kill') {
      stats.kills.push({ killer: e.source?.name || '?', killerId: e.source?.id, victim: e.target?.name || '?', victimType: e.target?.type });
      if (e.source && stats.damageDealt[e.source.id]) stats.damageDealt[e.source.id].kills++;
    }
  }
  return stats;
}

function showCombatReport(log, rounds, startedAt) {
  if (!log || !log.length) return;
  const s = computeCombatStats(log);
  const dmgLeader = Object.values(s.damageDealt).sort((a, b) => b.total - a.total);
  const takenLeader = Object.values(s.damageTaken).sort((a, b) => b.total - a.total);
  const healLeader = Object.values(s.heals).sort((a, b) => b.total - a.total);
  const mvp = dmgLeader.find(d => d.type === 'character');
  const tank = takenLeader.find(d => d.type === 'character');
  const mostDangerous = dmgLeader.find(d => d.type === 'monster');
  const duration = startedAt ? Math.round((Date.now() - startedAt) / 60000) : 0;

  const sectionTitle = (text) => '<div style="font-family:var(--font-display);font-size:.52rem;color:#c8b070;text-transform:uppercase;letter-spacing:.18em;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #2a2620;">' + text + '</div>';

  let h = '<div style="max-height:75vh;overflow-y:auto;color:#e2dbd0;">';

  // Header with decorative border
  h += '<div style="text-align:center;padding:16px 0 12px;margin-bottom:8px;border-bottom:1px solid #3a3428;">' +
    '<div style="font-size:.5rem;color:#7a7268;text-transform:uppercase;letter-spacing:.3em;margin-bottom:4px;">Battle Concluded</div>' +
    '<div style="font-family:var(--font-display);font-size:1.4rem;color:#c8b070;letter-spacing:.12em;">Combat Report</div>' +
    '<div style="display:flex;justify-content:center;gap:20px;margin-top:10px;">' +
      '<div style="text-align:center;"><div style="font-size:1.2rem;font-family:var(--font-mono);color:#e2dbd0;">' + rounds + '</div><div style="font-size:.5rem;color:#7a7268;text-transform:uppercase;">Rounds</div></div>' +
      '<div style="text-align:center;"><div style="font-size:1.2rem;font-family:var(--font-mono);color:#e2dbd0;">~' + duration + 'm</div><div style="font-size:.5rem;color:#7a7268;text-transform:uppercase;">Duration</div></div>' +
      '<div style="text-align:center;"><div style="font-size:1.2rem;font-family:var(--font-mono);color:#c04040;">' + s.kills.length + '</div><div style="font-size:.5rem;color:#7a7268;text-transform:uppercase;">Kills</div></div>' +
      '<div style="text-align:center;"><div style="font-size:1.2rem;font-family:var(--font-mono);color:#c8b070;">' + s.totalDmg + '</div><div style="font-size:.5rem;color:#7a7268;text-transform:uppercase;">Total Dmg</div></div>' +
    '</div>' +
  '</div>';

  // Awards row
  h += '<div style="display:flex;gap:8px;margin:12px 0;">';
  if (mvp) {
    h += '<div style="flex:1;background:#1e1b16;border:1px solid #3a3428;border-radius:10px;padding:10px;text-align:center;">' +
      '<div style="font-size:1.2rem;margin-bottom:2px;">\u2694</div>' +
      '<div style="font-size:.48rem;color:#c8b070;text-transform:uppercase;letter-spacing:.12em;font-family:var(--font-display);">MVP</div>' +
      '<div style="font-size:.85rem;color:#e2dbd0;font-family:var(--font-display);margin:3px 0;">' + mvp.name + '</div>' +
      '<div style="font-size:.62rem;color:#b0a898;">' + mvp.total + ' dmg \u00b7 ' + mvp.kills + ' kills</div>' +
      '<div style="font-size:.55rem;color:#7a7268;margin-top:2px;">Biggest hit: ' + mvp.biggestHit + '</div>' +
    '</div>';
  }
  if (mostDangerous) {
    h += '<div style="flex:1;background:#1e1b16;border:1px solid #3a2020;border-radius:10px;padding:10px;text-align:center;">' +
      '<div style="font-size:1.2rem;margin-bottom:2px;">\u2620</div>' +
      '<div style="font-size:.48rem;color:#c04040;text-transform:uppercase;letter-spacing:.12em;font-family:var(--font-display);">Deadliest</div>' +
      '<div style="font-size:.85rem;color:#e2dbd0;font-family:var(--font-display);margin:3px 0;">' + mostDangerous.name + '</div>' +
      '<div style="font-size:.62rem;color:#b0a898;">' + mostDangerous.total + ' dmg dealt</div>' +
    '</div>';
  }
  if (tank) {
    h += '<div style="flex:1;background:#1e1b16;border:1px solid #3a3428;border-radius:10px;padding:10px;text-align:center;">' +
      '<div style="font-size:1.2rem;margin-bottom:2px;">\u26e8</div>' +
      '<div style="font-size:.48rem;color:#b0a898;text-transform:uppercase;letter-spacing:.12em;font-family:var(--font-display);">Tank</div>' +
      '<div style="font-size:.85rem;color:#e2dbd0;font-family:var(--font-display);margin:3px 0;">' + tank.name + '</div>' +
      '<div style="font-size:.62rem;color:#b0a898;">' + tank.total + ' dmg taken</div>' +
    '</div>';
  }
  h += '</div>';

  // Damage dealt leaderboard
  if (dmgLeader.length) {
    h += sectionTitle('Damage Dealt');
    const maxDmg = dmgLeader[0]?.total || 1;
    h += dmgLeader.map((d, i) => {
      const pct = Math.round((d.total / maxDmg) * 100);
      const col = d.type === 'monster' ? '#8a3030' : '#c8b070';
      const topMethod = Object.entries(d.methods || {}).sort((a, b) => b[1] - a[1])[0];
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<span style="font-size:.65rem;color:#504840;width:14px;text-align:right;">' + (i + 1) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">' +
            '<span style="font-size:.72rem;color:#e2dbd0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + d.name + '</span>' +
            '<span style="font-size:.72rem;color:' + col + ';font-family:var(--font-mono);flex-shrink:0;margin-left:8px;">' + d.total + '</span>' +
          '</div>' +
          '<div style="height:4px;background:#16140f;border-radius:2px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:2px;"></div></div>' +
          '<div style="font-size:.52rem;color:#504840;margin-top:2px;">' + d.hits + ' hits \u00b7 max ' + d.biggestHit + (topMethod ? ' \u00b7 ' + topMethod[0] : '') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Damage taken
  if (takenLeader.length) {
    h += sectionTitle('Damage Taken');
    const maxTaken = takenLeader[0]?.total || 1;
    h += takenLeader.map(d => {
      const pct = Math.round((d.total / maxTaken) * 100);
      const col = d.type === 'monster' ? '#8a3030' : '#b0a898';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
        '<span style="font-size:.7rem;color:#e2dbd0;width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + d.name + '</span>' +
        '<div style="flex:1;height:4px;background:#16140f;border-radius:2px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:2px;"></div></div>' +
        '<span style="font-size:.65rem;color:#b0a898;font-family:var(--font-mono);min-width:30px;text-align:right;">' + d.total + '</span>' +
      '</div>';
    }).join('');
  }

  // Kill feed
  if (s.kills.length) {
    h += sectionTitle('Kill Feed');
    h += s.kills.map(k => {
      const icon = k.victimType === 'monster' ? '\u2620' : '\u2764\ufe0f\u200d\ud83e\ude79';
      return '<div style="display:flex;align-items:center;gap:6px;font-size:.7rem;padding:3px 0;border-bottom:1px solid #1e1b16;">' +
        '<span style="width:16px;text-align:center;">\u2620</span>' +
        '<span style="color:#e2dbd0;font-weight:500;">' + k.killer + '</span>' +
        '<span style="color:#504840;">\u2192</span>' +
        '<span style="color:#c04040;font-weight:500;">' + k.victim + '</span>' +
      '</div>';
    }).join('');
  }

  h += '</div>';

  const overlay = document.getElementById('combat-report-overlay');
  if (overlay) {
    document.getElementById('combat-report-content').innerHTML = h;
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
  const s = computeCombatStats(log);
  const leaders = Object.values(s.damageDealt).sort((a, b) => b.total - a.total);
  const kills = s.kills;
  const date = new Date().toLocaleDateString();
  let text = '\n=== Combat Report (' + date + ') ===\n';
  text += 'Total damage: ' + s.totalDmg + ' | Kills: ' + kills.length + '\n\n';
  text += 'DAMAGE DEALT:\n';
  text += leaders.map((d, i) => '  #' + (i + 1) + ' ' + d.name + ': ' + d.total + ' dmg, ' + d.hits + ' hits, ' + d.kills + ' kills, max hit ' + d.biggestHit).join('\n');
  if (kills.length) {
    text += '\n\nKILL FEED:\n';
    text += kills.map(k => '  ' + k.killer + ' slew ' + k.victim).join('\n');
  }
  text += '\n===\n';

  m.notes = (m.notes || '') + text;
  const notesEl = document.getElementById('map-notes');
  if (notesEl) notesEl.value = m.notes;
  m.updatedAt = Date.now();
  saveCurrentMap();
  closeCombatReport();
}

// ══════════════════════════════════════════════════════════════
// END OF SESSION REPORT
// Aggregates all combat logs + session notes into a comprehensive report
// ══════════════════════════════════════════════════════════════

function showSessionReport() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;

  // Collect all combat logs (current + from past combats stored in log)
  const allLogs = m.combat?.log || [];
  if (!allLogs.length) {
    alert('No combat data recorded on this map yet. Run a combat encounter first.');
    return;
  }

  const s = computeCombatStats(allLogs);
  const dmgLeader = Object.values(s.damageDealt).sort((a, b) => b.total - a.total);
  const takenLeader = Object.values(s.damageTaken).sort((a, b) => b.total - a.total);

  // Separate PC vs monster stats
  const pcDmg = dmgLeader.filter(d => d.type === 'character');
  const monDmg = dmgLeader.filter(d => d.type === 'monster');
  const pcKills = s.kills.filter(k => k.victimType === 'monster').length;
  const monKills = s.kills.filter(k => k.victimType === 'character').length;

  const sectionTitle = (text) => '<div style="font-family:var(--font-display);font-size:.52rem;color:#c8b070;text-transform:uppercase;letter-spacing:.2em;margin:20px 0 10px;padding-bottom:4px;border-bottom:1px solid #2a2620;">' + text + '</div>';

  let h = '<div style="max-height:80vh;overflow-y:auto;color:#e2dbd0;">';

  // Grand header
  h += '<div style="text-align:center;padding:20px 0 16px;margin-bottom:12px;border-bottom:2px solid #3a3428;">' +
    '<div style="font-size:.45rem;color:#504840;text-transform:uppercase;letter-spacing:.4em;margin-bottom:6px;">Session Complete</div>' +
    '<div style="font-family:var(--font-display);font-size:1.6rem;color:#c8b070;letter-spacing:.14em;margin-bottom:4px;">Session Report</div>' +
    '<div style="font-size:.7rem;color:#7a7268;">' + (m.name || 'Unnamed Map') + ' \u00b7 ' + new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'}) + '</div>' +
  '</div>';

  // Summary stats cards
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">';
  const statCard = (val, label, color) => '<div style="background:#1e1b16;border:1px solid #2a2620;border-radius:8px;padding:8px;text-align:center;">' +
    '<div style="font-size:1.3rem;font-family:var(--font-mono);color:' + color + ';font-weight:600;">' + val + '</div>' +
    '<div style="font-size:.45rem;color:#7a7268;text-transform:uppercase;letter-spacing:.1em;margin-top:2px;">' + label + '</div></div>';
  h += statCard(s.totalDmg, 'Total Damage', '#c8b070');
  h += statCard(s.kills.length, 'Total Kills', '#c04040');
  h += statCard(s.totalHeals || 0, 'Total Heals', '#4a9a40');
  h += statCard(dmgLeader.length, 'Combatants', '#b0a898');
  h += '</div>';

  // Party performance section
  if (pcDmg.length) {
    h += sectionTitle('Party Performance');
    h += '<div style="display:flex;flex-direction:column;gap:10px;">';
    const maxPcDmg = pcDmg[0]?.total || 1;
    h += pcDmg.map((d, i) => {
      const pct = Math.round((d.total / maxPcDmg) * 100);
      const topMethods = Object.entries(d.methods || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      // Get character data for portrait
      const c = characters.find(x => x.name === d.name);
      const portrait = c?.imageUrl
        ? '<img src="' + c.imageUrl + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1.5px solid #3a3428;">'
        : '<div style="width:36px;height:36px;border-radius:50%;background:#2a2620;border:1.5px solid #3a3428;display:flex;align-items:center;justify-content:center;font-size:.6rem;color:#c8b070;font-family:var(--font-display);">' + (d.name?.charAt(0) || '?') + '</div>';
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px;background:#1a1814;border:1px solid #2a2620;border-radius:8px;">' +
        portrait +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="font-size:.82rem;color:#e2dbd0;font-weight:500;">' + d.name + '</span>' +
            '<span style="font-size:.8rem;color:#c8b070;font-family:var(--font-mono);font-weight:600;">' + d.total + ' dmg</span>' +
          '</div>' +
          '<div style="height:4px;background:#16140f;border-radius:2px;overflow:hidden;margin-bottom:4px;"><div style="width:' + pct + '%;height:100%;background:#c8b070;border-radius:2px;"></div></div>' +
          '<div style="display:flex;gap:12px;font-size:.58rem;color:#7a7268;">' +
            '<span>' + d.hits + ' hits</span>' +
            '<span>max ' + d.biggestHit + '</span>' +
            '<span>' + d.kills + ' kills</span>' +
          '</div>' +
          (topMethods.length ? '<div style="font-size:.55rem;color:#504840;margin-top:3px;">Top: ' + topMethods.map(m => m[0] + ' (' + m[1] + ')').join(', ') + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    h += '</div>';
  }

  // Enemy stats
  if (monDmg.length) {
    h += sectionTitle('Enemy Threats');
    const maxMonDmg = monDmg[0]?.total || 1;
    h += monDmg.map(d => {
      const pct = Math.round((d.total / maxMonDmg) * 100);
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
        '<span style="font-size:.7rem;color:#e2dbd0;width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + d.name + '</span>' +
        '<div style="flex:1;height:4px;background:#16140f;border-radius:2px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:#8a3030;border-radius:2px;"></div></div>' +
        '<span style="font-size:.65rem;color:#c04040;font-family:var(--font-mono);min-width:30px;text-align:right;">' + d.total + '</span>' +
      '</div>';
    }).join('');
  }

  // Kill timeline
  if (s.kills.length) {
    h += sectionTitle('Kill Timeline');
    h += '<div style="display:flex;flex-direction:column;gap:4px;">';
    h += s.kills.map(k =>
      '<div style="display:flex;align-items:center;gap:6px;font-size:.68rem;padding:4px 8px;background:#1a1814;border-radius:6px;">' +
        '<span style="color:#c04040;">\u2620</span>' +
        '<span style="color:#e2dbd0;font-weight:500;">' + k.killer + '</span>' +
        '<span style="color:#504840;">\u2192</span>' +
        '<span style="color:#c04040;">' + k.victim + '</span>' +
      '</div>'
    ).join('');
    h += '</div>';
  }

  // Session notes excerpt
  if (m.notes?.trim()) {
    h += sectionTitle('Session Notes');
    h += '<div style="font-size:.7rem;color:#b0a898;line-height:1.5;padding:8px;background:#1a1814;border-radius:6px;max-height:100px;overflow-y:auto;white-space:pre-wrap;">' + (m.notes.length > 500 ? m.notes.substring(0, 500) + '...' : m.notes) + '</div>';
  }

  h += '</div>';

  const overlay = document.getElementById('combat-report-overlay');
  if (overlay) {
    document.getElementById('combat-report-content').innerHTML = h;
    overlay.classList.add('open');
  }
}

function saveSessionReportToNotes() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  const allLogs = m.combat?.log || [];
  const s = computeCombatStats(allLogs);
  const leaders = Object.values(s.damageDealt).sort((a, b) => b.total - a.total);
  const date = new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'});

  let text = '\n========================================\n';
  text += '  SESSION REPORT - ' + date + '\n';
  text += '  ' + (m.name || 'Unnamed Map') + '\n';
  text += '========================================\n\n';
  text += 'STATS: ' + s.totalDmg + ' total dmg | ' + s.kills.length + ' kills | ' + s.totalHeals + ' heals\n\n';
  text += 'PERFORMANCE:\n';
  text += leaders.map((d, i) => '  ' + (i + 1) + '. ' + d.name + ': ' + d.total + ' dmg, ' + d.hits + ' hits, ' + d.kills + ' kills').join('\n');
  if (s.kills.length) {
    text += '\n\nKILLS:\n';
    text += s.kills.map(k => '  \u2620 ' + k.killer + ' slew ' + k.victim).join('\n');
  }
  text += '\n========================================\n';

  m.notes = (m.notes || '') + text;
  const notesEl = document.getElementById('map-notes');
  if (notesEl) notesEl.value = m.notes;
  m.updatedAt = Date.now();
  saveCurrentMap();
  closeCombatReport();
}
