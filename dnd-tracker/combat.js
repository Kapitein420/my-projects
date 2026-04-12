/* ============================================================
   TOME OF HEROES — Combat / Initiative Tracker
   Handles: initiative rolling, turn order, round tracking,
   active turn highlighting
   ============================================================ */

// ── HELPERS ──────────────────────────────────────────────────
function d20() { return Math.floor(Math.random() * 20) + 1; }

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
      '<div style="flex:1;font-size:.8rem;color:#e0d4c0;">' + e.name + '</div>' +
      '<div style="font-size:.6rem;color:#4a3e30;">d20(' + e.roll + ') + ' + (e.mod >= 0 ? '+' : '') + e.mod + ' =</div>' +
      '<input type="number" value="' + e.initiative + '" style="width:45px;text-align:center;font-size:.85rem;font-weight:600;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--r);color:#e0d4c0;padding:3px;" onchange="combatSetupUpdateInit(' + i + ',this.value)">' +
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
    entries: entries.map(e => ({
      id: e.id,
      type: e.type,
      initiative: e.initiative,
      name: e.name
    }))
  };

  m.updatedAt = Date.now();
  closeCombatSetup();
  saveCurrentMap();
  renderInitiativeBar();
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
  m.updatedAt = Date.now();
  saveCurrentMap();
  renderInitiativeBar();
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
  m.combat = { active: false, round: 0, turnIndex: 0, entries: [] };
  m.updatedAt = Date.now();
  saveCurrentMap();
  renderInitiativeBar();
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

    const borderColor = isActive ? '#c8a45a' : isDead ? '#333' : isMon ? '#8a2020' : '#3a2e22';
    const bgColor = isActive ? '#1a1408' : isDead ? 'rgba(0,0,0,.3)' : '#15120f';
    const textColor = isDead ? '#4a3e30' : '#e0d4c0';
    const decoration = isDead ? 'line-through' : 'none';

    entriesHtml += '<div style="display:flex;flex-direction:column;align-items:center;padding:4px 10px;border:1.5px solid ' + borderColor + ';border-radius:var(--r);background:' + bgColor + ';min-width:55px;flex-shrink:0;">' +
      '<div style="font-size:.65rem;font-weight:600;color:' + (isActive ? '#c8a45a' : '#685848') + ';">' + e.initiative + '</div>' +
      '<div style="font-size:.7rem;color:' + textColor + ';text-decoration:' + decoration + ';white-space:nowrap;max-width:70px;overflow:hidden;text-overflow:ellipsis;" title="' + e.name + '">' + e.name + '</div>' +
      '<div style="font-size:.5rem;color:' + (isMon ? '#8a2020' : '#8a6a30') + ';">' + (isMon ? 'MON' : 'PC') + '</div>' +
    '</div>';
  }

  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
      '<div style="font-family:var(--font-display);font-size:.65rem;color:#8a6a30;text-transform:uppercase;letter-spacing:.08em;">Round ' + combat.round + '</div>' +
      '<div style="font-size:.75rem;color:#e0d4c0;font-weight:500;">' + (current ? current.name : '') + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:5px;overflow-x:auto;flex:1;padding:4px 0;">' + entriesHtml + '</div>' +
    '<div style="display:flex;gap:4px;flex-shrink:0;">' +
      '<button class="btn btn-sm btn-ghost" onclick="prevTurn()" title="Previous turn" style="font-size:.75rem;">\u25C0</button>' +
      '<button class="btn btn-sm btn-primary" onclick="nextTurn()" style="font-size:.75rem;">Next \u25B6</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="endCombat()" style="font-size:.7rem;color:var(--red);">End</button>' +
    '</div>';
}
