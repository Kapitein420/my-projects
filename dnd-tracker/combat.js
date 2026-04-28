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
  if (!m?.combat?.active) return;
  // Confirmation is handled by confirmEndCombat (two-click pattern). The
  // raw endCombat() can also be invoked directly via Ctrl+Shift+E for power
  // users, so no browser confirm() here. Clear any pending confirm timer.
  _endConfirmArmed = false;
  if (_endConfirmTimer) { clearTimeout(_endConfirmTimer); _endConfirmTimer = null; }

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

// ── INITIATIVE / COMBAT-OPS PANEL STATE ──────────────────────
// Undo stack: max 15 entries of {targetType, id, before:{currentHp, tempHp, deathSaves}, ts}
var _hpUndoStack = [];
// Currently selected combatant (for damage/heal hotkeys)
var _selectedCombatantId = null;
// Map of combatantId -> [{amount, sign}, ...] last <=3 damage/heal chips (most recent first)
var _lastDamages = {};
// Whether global combat hotkeys are installed
var _combatHotkeysInstalled = false;
// Whether an inline damage/heal prompt is currently open
var _combatPromptOpen = false;

// Look up a combatant by id within the current map (character or monster).
function _findCombatTarget(id) {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return null;
  const char = characters.find(x => x.id === id);
  if (char) return { type: 'character', obj: char, map: m };
  const mon = (m.monsters || []).find(x => x.id === id);
  if (mon) return { type: 'monster', obj: mon, map: m };
  return null;
}

function _getDeathSaves(c) {
  if (!c) return { successes: 0, failures: 0 };
  if (!c.deathSaves) c.deathSaves = { successes: 0, failures: 0 };
  if (typeof c.deathSaves.successes !== 'number') c.deathSaves.successes = 0;
  if (typeof c.deathSaves.failures !== 'number') c.deathSaves.failures = 0;
  return c.deathSaves;
}

// ── TOAST HELPER ─────────────────────────────────────────────
// Stacked fixed-position toasts (top-right), 2s fade-out.
var _toastStack = [];

function toast(msg) {
  if (!msg) return;
  const el = document.createElement('div');
  const offset = 12 + _toastStack.length * 38;
  el.style.cssText =
    'position:fixed;top:' + offset + 'px;right:16px;z-index:99999;' +
    'background:#1e1b16;border:1px solid #c8b070;color:#e2dbd0;' +
    'padding:8px 14px;border-radius:6px;font-size:.72rem;' +
    'font-family:var(--font-display,sans-serif);letter-spacing:.06em;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.5);opacity:0;' +
    'transition:opacity .2s ease-out;';
  el.textContent = msg;
  document.body.appendChild(el);
  _toastStack.push(el);
  // fade in
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  // fade out + remove after 2s
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      const i = _toastStack.indexOf(el);
      if (i >= 0) _toastStack.splice(i, 1);
      // reflow remaining
      _toastStack.forEach((t, idx) => { t.style.top = (12 + idx * 38) + 'px'; });
    }, 220);
  }, 2000);
}

// ── UNDO STACK / HP CHANGE RECORDING ─────────────────────────
window.recordHpChange = function (targetType, id, beforeObj) {
  if (!id) return;
  // Snapshot a safe clone so later mutations don't bleed into the record.
  const before = {
    currentHp: beforeObj?.currentHp ?? 0,
    tempHp: beforeObj?.tempHp ?? 0,
    deathSaves: {
      successes: beforeObj?.deathSaves?.successes ?? 0,
      failures: beforeObj?.deathSaves?.failures ?? 0
    }
  };
  _hpUndoStack.push({ targetType: targetType, id: id, before: before, ts: Date.now() });
  if (_hpUndoStack.length > 15) _hpUndoStack.shift();
};

window.undoHp = function () {
  const rec = _hpUndoStack.pop();
  if (!rec) { toast('Nothing to undo'); return; }
  const t = _findCombatTarget(rec.id);
  if (!t) { toast('Undo target missing'); return; }
  t.obj.currentHp = rec.before.currentHp;
  t.obj.tempHp = rec.before.tempHp;
  if (t.type === 'character') {
    t.obj.deathSaves = {
      successes: rec.before.deathSaves.successes,
      failures: rec.before.deathSaves.failures
    };
    if (typeof DB !== 'undefined' && DB.save) {
      DB.save('characters', t.obj, characters);
    }
  } else {
    saveCurrentMap();
  }
  renderInitiativeBar();
  if (typeof renderCharList === 'function') renderCharList();
  if (currentMapId && typeof renderTokensOnMap === 'function') renderTokensOnMap();
  if (typeof renderTokenSidebar === 'function') renderTokenSidebar();
  toast('Undone');
};

// Called by other modules AFTER an HP mutation so we can update chips + redraw.
window.onHpChanged = function (targetType, id, delta) {
  if (!id || !delta) return;
  const amt = Math.abs(delta);
  const sign = delta < 0 ? -1 : 1; // -1 = damage, +1 = heal
  const arr = _lastDamages[id] || (_lastDamages[id] = []);
  // Dedupe adjacent duplicates (same amount AND sign as most recent).
  if (!arr.length || arr[0].amount !== amt || arr[0].sign !== sign) {
    arr.unshift({ amount: amt, sign: sign });
    if (arr.length > 3) arr.length = 3;
  }
  renderInitiativeBar();
};

// ── SELECTION ────────────────────────────────────────────────
function selectCombatant(id) {
  _selectedCombatantId = id || null;
  renderInitiativeBar();
}
// Explicit global so cross-script callers (monsters.js, map.js) can detect
// availability via `typeof window.selectCombatant === 'function'`.
window.selectCombatant = selectCombatant;

// Selects the combat entry that corresponds to a given character id.
// PC tokens on the map carry a characterId, but the combat entry's `id`
// IS the character id (see beginCombat: `id: c.id`), so this is a direct
// lookup. Returns true if a matching entry was selected.
window.selectCombatantByCharacterId = function (charId) {
  if (!charId) return false;
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat?.active) return false;
  const entry = (m.combat.entries || []).find(en => en.type === 'character' && en.id === charId);
  if (!entry) return false;
  selectCombatant(entry.id);
  return true;
};

// ── DAMAGE / HEAL HELPERS ────────────────────────────────────
function _applyDelta(id, signedDelta) {
  if (!id || !signedDelta) return;
  const t = _findCombatTarget(id);
  if (!t) return;
  const o = t.obj;
  const oldHp = o.currentHp || 0;
  const oldTemp = o.tempHp || 0;
  const maxHp = o.maxHp || 0;
  const ds = t.type === 'character' ? _getDeathSaves(o) : null;

  // Record BEFORE state.
  window.recordHpChange(t.type, id, {
    currentHp: oldHp,
    tempHp: oldTemp,
    deathSaves: ds ? { successes: ds.successes, failures: ds.failures } : { successes: 0, failures: 0 }
  });

  if (signedDelta < 0) {
    // Damage: temp HP absorbs first.
    let dmg = -signedDelta;
    let newTemp = oldTemp;
    if (newTemp > 0) {
      const absorbed = Math.min(newTemp, dmg);
      newTemp -= absorbed;
      dmg -= absorbed;
    }
    o.tempHp = newTemp;
    o.currentHp = Math.max(0, oldHp - dmg);
  } else {
    // Heal: clamp to max. If char was at 0 and now > 0, clear death saves.
    const raw = oldHp + signedDelta;
    const capped = maxHp > 0 ? Math.min(maxHp, raw) : raw;
    o.currentHp = Math.max(0, capped);
    if (t.type === 'character' && oldHp === 0 && o.currentHp > 0 && ds) {
      ds.successes = 0;
      ds.failures = 0;
    }
  }

  const targetName = t.type === 'monster' ? (o.displayName || o.templateName || 'Monster') : (o.name || 'Character');
  const realDelta = o.currentHp - oldHp; // for logging, ignore temp-HP absorption nuance
  if (typeof logHpChange === 'function') {
    logHpChange(id, targetName, t.type, oldHp, o.currentHp);
  }
  window.onHpChanged(t.type, id, signedDelta);

  // ── Concentration: react to damage on a concentrating PC.
  // RAW: any damage taken (incl. temp-HP-absorbed) triggers a CON save.
  // 0 HP auto-ends concentration and suppresses the save prompt.
  if (t.type === 'character' && signedDelta < 0 && o.concentrating) {
    const incoming = -signedDelta; // raw incoming damage, before temp HP
    const droppedToZero = oldHp > 0 && o.currentHp <= 0;
    if (droppedToZero) {
      window.endConcentration(id, '0 HP');
    } else if (incoming > 0) {
      _showConcentrationSavePrompt(id, targetName, incoming, o.concentrating.spellName);
    }
  }

  if (t.type === 'character') {
    if (typeof DB !== 'undefined' && DB.save) DB.save('characters', o, characters);
  } else {
    saveCurrentMap();
  }
  if (typeof renderCharList === 'function') renderCharList();
  if (currentMapId && typeof renderTokensOnMap === 'function') renderTokensOnMap();
  if (typeof renderTokenSidebar === 'function') renderTokenSidebar();
  renderInitiativeBar();
}

function applyDamageToSelected(amount) {
  const n = Math.abs(parseInt(amount) || 0);
  if (!n || !_selectedCombatantId) return;
  _applyDelta(_selectedCombatantId, -n);
}

function applyHealToSelected(amount) {
  const n = Math.abs(parseInt(amount) || 0);
  if (!n || !_selectedCombatantId) return;
  _applyDelta(_selectedCombatantId, n);
}

// Re-apply a chip amount (keeps its original sign).
function applyChip(id, amount, sign) {
  const n = Math.abs(parseInt(amount) || 0);
  if (!n || !id) return;
  const signed = sign < 0 ? -n : n;
  _applyDelta(id, signed);
}

// ── INLINE DAMAGE / HEAL PROMPT ──────────────────────────────
function _removePrompt() {
  const existing = document.getElementById('combat-inline-prompt');
  if (existing) existing.remove();
  _combatPromptOpen = false;
}

// ── END-COMBAT CONFIRMATION (two-click within 3s) ────────────
var _endConfirmTimer = null;
var _endConfirmArmed = false;

function confirmEndCombat() {
  if (_endConfirmArmed) {
    // Second click within window — actually end combat.
    endCombat();
    return;
  }
  // First click — arm and re-render so the End button shows "Confirm?" red.
  _endConfirmArmed = true;
  renderInitiativeBar();
  _endConfirmTimer = setTimeout(() => {
    _endConfirmArmed = false;
    _endConfirmTimer = null;
    const m = maps.find(x => x.id === currentMapId);
    if (m?.combat?.active) renderInitiativeBar();
  }, 3000);
}

function promptDamageOrHeal(kind) {
  if (!_selectedCombatantId) { toast('Select a combatant first (J/K)'); return; }
  _removePrompt();
  const isDmg = kind === 'damage';
  const label = isDmg ? 'Damage' : 'Heal';
  const color = isDmg ? '#c04040' : '#4a9a40';

  // Anchor to the selected tile when possible. Falls back to centered
  // overlay if the tile isn't found (e.g. selection just cleared).
  let tileRect = null;
  const selectedTile = document.querySelector(
    '#initiative-bar [data-combatant-id="' + _selectedCombatantId + '"]'
  );
  if (selectedTile) tileRect = selectedTile.getBoundingClientRect();

  const wrap = document.createElement('div');
  wrap.id = 'combat-inline-prompt';
  let posCss;
  if (tileRect) {
    // Position immediately below the tile, centered horizontally.
    // Clamp to viewport so it never overflows on small screens.
    const promptWidth = 220;
    let left = tileRect.left + (tileRect.width / 2) - (promptWidth / 2);
    left = Math.max(8, Math.min(window.innerWidth - promptWidth - 8, left));
    let top = tileRect.bottom + 10;
    // If there's no room below, flip above the tile.
    if (top + 100 > window.innerHeight) top = Math.max(8, tileRect.top - 110);
    posCss = 'position:fixed;left:' + left + 'px;top:' + top + 'px;';
  } else {
    posCss = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);';
  }
  wrap.style.cssText =
    posCss + 'z-index:99998;' +
    'background:#1e1b16;border:1px solid ' + color + ';border-radius:8px;' +
    'padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.6);' +
    'display:flex;flex-direction:column;gap:6px;min-width:220px;';

  // Cheap gold connector: a small notch pointing at the tile.
  if (tileRect) {
    const connector = document.createElement('div');
    connector.style.cssText =
      'position:absolute;top:-6px;left:50%;transform:translateX(-50%) rotate(45deg);' +
      'width:10px;height:10px;background:#1e1b16;border-left:1px solid #c8b070;border-top:1px solid #c8b070;';
    wrap.appendChild(connector);
  }

  const title = document.createElement('div');
  title.style.cssText = 'font-family:var(--font-display,sans-serif);font-size:.7rem;color:' + color + ';letter-spacing:.1em;text-transform:uppercase;';
  title.textContent = label + ' — enter amount';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.placeholder = '0';
  input.style.cssText =
    'width:80px;font-size:.9rem;padding:6px 8px;background:#14110c;' +
    'border:1px solid ' + color + ';border-radius:4px;color:#e2dbd0;';
  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-sm btn-primary';
  okBtn.textContent = isDmg ? 'Apply' : 'Heal';
  okBtn.style.cssText = 'font-size:.7rem;';
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:.55rem;color:#7a7268;';
  hint.textContent = 'Enter to apply  •  Esc to cancel';
  row.appendChild(input);
  row.appendChild(okBtn);
  wrap.appendChild(title);
  wrap.appendChild(row);
  wrap.appendChild(hint);
  document.body.appendChild(wrap);
  _combatPromptOpen = true;

  const commit = () => {
    const v = parseInt(input.value) || 0;
    if (v > 0) {
      if (isDmg) applyDamageToSelected(v);
      else applyHealToSelected(v);
    }
    _removePrompt();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); _removePrompt(); }
    ev.stopPropagation();
  });
  okBtn.addEventListener('click', commit);

  setTimeout(() => input.focus(), 0);
}

// ── DEATH SAVES ──────────────────────────────────────────────
// "Click to fill, click again to unfill" UX: each click toggles the Nth pip.
// If successes reach 3: log stable event. If failures reach 3: log death event.
window.toggleDeathSave = function (charId, type) {
  const c = characters.find(x => x.id === charId);
  if (!c) return;
  if ((c.currentHp || 0) > 0) return; // Only at 0 HP
  const ds = _getDeathSaves(c);

  // Record before state for undo.
  window.recordHpChange('character', charId, {
    currentHp: c.currentHp || 0,
    tempHp: c.tempHp || 0,
    deathSaves: { successes: ds.successes, failures: ds.failures }
  });

  if (type === 'success') {
    // Toggle: if we're already at 3, click reduces back by one; otherwise increment.
    if (ds.successes >= 3) ds.successes = 2;
    else ds.successes += 1;
    if (ds.successes >= 3) {
      combatLog({ type: 'note', note: c.name + ' stabilized (3 death-save successes)' });
    }
  } else if (type === 'failure') {
    if (ds.failures >= 3) ds.failures = 2;
    else ds.failures += 1;
    if (ds.failures >= 3) {
      combatLog({
        type: 'kill',
        source: null,
        target: { id: c.id, name: c.name, type: 'character' },
        value: 0,
        note: c.name + ' died (3 death-save failures)'
      });
    }
  }

  if (typeof DB !== 'undefined' && DB.save) DB.save('characters', c, characters);
  renderInitiativeBar();
  if (typeof renderCharList === 'function') renderCharList();
  renderCombatLog();
};

// ── CONCENTRATION TRACKING ───────────────────────────────────
// Per character: c.concentrating = null | { spellName, startedRound, startedTurnIdx }.
// Marc's #1 forgotten 5e rule: when a concentrator takes damage they need
// CON save DC max(10, floor(damage/2)). Auto-prompt the DM, never auto-roll.
// v1 scope: PCs only.

// "C" badge tap-to-end: first click arms (red border), second within 2s ends.
var _concEndArmTs = {};

function _isConcentrationSpell(name) {
  if (!name) return false;
  if (typeof SPELL_DB === 'undefined' || !Array.isArray(SPELL_DB)) return false;
  const n = String(name).trim().toLowerCase();
  const hit = SPELL_DB.find(s => s.name.toLowerCase() === n);
  return !!(hit && hit.conc);
}

window.startConcentration = function (characterId, spellName) {
  const c = characters.find(x => x.id === characterId);
  if (!c) return;
  const name = (spellName || '').trim();
  if (!name) return;
  const m = maps.find(x => x.id === currentMapId);
  c.concentrating = {
    spellName: name,
    startedRound: m?.combat?.round || 0,
    startedTurnIdx: m?.combat?.turnIndex || 0
  };
  if (typeof DB !== 'undefined' && DB.save) DB.save('characters', c, characters);
  renderInitiativeBar();
  if (typeof renderCharList === 'function') renderCharList();
  combatLog({ type: 'note', note: c.name + ' is concentrating on ' + name });
  renderCombatLog();
  toast('Concentrating: ' + name);
};

window.endConcentration = function (characterId, reason) {
  const c = characters.find(x => x.id === characterId);
  if (!c || !c.concentrating) return;
  const lastSpell = c.concentrating.spellName || 'spell';
  c.concentrating = null;
  delete _concEndArmTs[characterId];
  if (typeof DB !== 'undefined' && DB.save) DB.save('characters', c, characters);
  renderInitiativeBar();
  if (typeof renderCharList === 'function') renderCharList();
  combatLog({ type: 'note', note: c.name + ' lost concentration on ' + lastSpell + ' (' + (reason || 'ended') + ')' });
  renderCombatLog();
  toast('Concentration ended: ' + lastSpell + ' (' + (reason || 'ended') + ')');
};

// Click handler for the "C" badge on initiative tiles.
window.armEndConcentration = function (charId, ev) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  const c = characters.find(x => x.id === charId);
  if (!c || !c.concentrating) return;
  const now = Date.now();
  const armed = _concEndArmTs[charId];
  if (armed && (now - armed) <= 2000) {
    window.endConcentration(charId, 'voluntary');
    return;
  }
  _concEndArmTs[charId] = now;
  renderInitiativeBar();
  toast('Click again within 2s to end concentration');
  setTimeout(() => {
    if (_concEndArmTs[charId] === now) {
      delete _concEndArmTs[charId];
      renderInitiativeBar();
    }
  }, 2100);
};

// "+ Concentrate" inline input in the detail strip.
window.openConcentrateInput = function (charId) {
  // Replace the +Concentrate button cell with an input. We'll target a specific
  // span we render in the detail strip.
  const host = document.getElementById('conc-input-host-' + charId);
  if (!host) return;
  host.innerHTML =
    '<input id="conc-input-' + charId + '" type="text" placeholder="Bless, Hunter\'s Mark…" ' +
    'style="font-size:.62rem;padding:2px 6px;background:#14110c;border:1px solid #c8b070;' +
    'border-radius:6px;color:#e2dbd0;width:160px;" autocomplete="off" />';
  const input = document.getElementById('conc-input-' + charId);
  if (!input) return;
  // Build a tiny suggestion list (top 6 conc spells matching typed text).
  const sugBox = document.createElement('div');
  sugBox.id = 'conc-sug-' + charId;
  sugBox.style.cssText =
    'position:absolute;background:#1e1b16;border:1px solid #c8b070;border-radius:6px;' +
    'margin-top:2px;padding:2px 0;z-index:99997;min-width:180px;display:none;' +
    'box-shadow:0 6px 16px rgba(0,0,0,.55);';
  host.appendChild(sugBox);

  const renderSug = () => {
    if (typeof SPELL_DB === 'undefined' || !Array.isArray(SPELL_DB)) {
      sugBox.style.display = 'none'; return;
    }
    const q = (input.value || '').toLowerCase().trim();
    if (!q) { sugBox.style.display = 'none'; return; }
    const matches = SPELL_DB
      .filter(s => s.conc && s.name.toLowerCase().includes(q))
      .slice(0, 6);
    if (!matches.length) { sugBox.style.display = 'none'; return; }
    sugBox.innerHTML = matches.map(s =>
      '<div data-name="' + s.name + '" ' +
      'style="padding:3px 8px;font-size:.62rem;color:#e2dbd0;cursor:pointer;" ' +
      'onmouseover="this.style.background=\'rgba(200,176,112,.12)\'" ' +
      'onmouseout="this.style.background=\'transparent\'">' +
      s.name + ' <span style="color:#7a7268;font-size:.52rem;">Lv ' + s.level + '</span></div>'
    ).join('');
    sugBox.style.display = 'block';
    Array.from(sugBox.children).forEach(el => {
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        input.value = el.getAttribute('data-name') || '';
        sugBox.style.display = 'none';
        commit();
      });
    });
  };

  const commit = () => {
    const v = (input.value || '').trim();
    if (v) window.startConcentration(charId, v);
    else renderInitiativeBar(); // bail out
  };
  const cancel = () => { renderInitiativeBar(); };

  input.addEventListener('input', renderSug);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => {
    // Defer so suggestion mousedown can fire first.
    setTimeout(() => {
      if (document.getElementById('conc-input-' + charId)) cancel();
    }, 150);
  });
  setTimeout(() => input.focus(), 0);
};

// CON-save prompt shown when a concentrator takes damage.
function _showConcentrationSavePrompt(charId, charName, damage, spellName) {
  const dc = Math.max(10, Math.floor(damage / 2));
  const existing = document.getElementById('conc-save-prompt-' + charId);
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'conc-save-prompt-' + charId;
  // Stack multiple prompts vertically (bottom-right).
  const existingPrompts = document.querySelectorAll('[id^="conc-save-prompt-"]');
  const offset = 16 + existingPrompts.length * 92;
  wrap.style.cssText =
    'position:fixed;bottom:' + offset + 'px;right:16px;z-index:99996;' +
    'background:#1e1b16;border:1.5px solid #c8b070;border-radius:8px;' +
    'padding:10px 14px;box-shadow:0 6px 18px rgba(0,0,0,.55);' +
    'min-width:260px;font-family:var(--font-display,sans-serif);' +
    'animation:none;opacity:0;transition:opacity .2s ease-out;';
  wrap.innerHTML =
    '<div style="font-size:.72rem;color:#c8b070;letter-spacing:.06em;margin-bottom:6px;">' +
      '\u26A0 ' + charName + ': CON save DC ' + dc + ' (' + spellName + ')' +
    '</div>' +
    '<div style="display:flex;gap:6px;">' +
      '<button class="btn btn-sm" data-act="pass" style="font-size:.65rem;padding:3px 10px;background:#1f3020;border:1px solid #285028;color:#80c080;border-radius:6px;cursor:pointer;">Pass</button>' +
      '<button class="btn btn-sm" data-act="fail" style="font-size:.65rem;padding:3px 10px;background:#362020;border:1px solid #5a2828;color:#e08080;border-radius:6px;cursor:pointer;">Fail</button>' +
      '<button class="btn btn-sm" data-act="skip" style="font-size:.65rem;padding:3px 10px;background:#14110c;border:1px solid #3a3428;color:#9a8450;border-radius:6px;cursor:pointer;">Skip</button>' +
    '</div>';
  document.body.appendChild(wrap);
  requestAnimationFrame(() => { wrap.style.opacity = '1'; });

  const dismiss = () => {
    if (!wrap.parentNode) return;
    wrap.style.opacity = '0';
    setTimeout(() => { if (wrap.parentNode) wrap.remove(); }, 220);
    clearTimeout(timer);
  };
  wrap.querySelector('[data-act="pass"]').addEventListener('click', () => {
    toast(charName + ' held concentration on ' + spellName);
    combatLog({ type: 'note', note: charName + ' held concentration on ' + spellName + ' (DC ' + dc + ' passed)' });
    renderCombatLog();
    dismiss();
  });
  wrap.querySelector('[data-act="fail"]').addEventListener('click', () => {
    window.endConcentration(charId, 'failed save');
    dismiss();
  });
  wrap.querySelector('[data-act="skip"]').addEventListener('click', dismiss);

  // Auto-dismiss after 12s — Marc may be roleplaying mid-prompt.
  const timer = setTimeout(dismiss, 12000);
}

// ── INITIATIVE / COMBAT-OPS PANEL RENDERING ──────────────────

function renderInitiativeBar() {
  const m = maps.find(x => x.id === currentMapId);
  const bar = document.getElementById('initiative-bar');
  const startBtn = document.getElementById('combat-start-btn');
  if (!bar) return;

  if (!m?.combat?.active) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    if (startBtn) startBtn.style.display = '';
    _uninstallCombatHotkeys();
    return;
  }

  if (startBtn) startBtn.style.display = 'none';
  bar.style.display = 'flex';
  bar.style.flexDirection = 'column';
  bar.style.alignItems = 'stretch';
  bar.style.flexShrink = '0';
  _installCombatHotkeys();

  const combat = m.combat;
  const current = combat.entries[combat.turnIndex];

  // ── Compact horizontal strip: round + current turn on left, tiles scroll, controls on right
  // Each tile is ~90px wide, ~68px tall. Map keeps ~80% of screen.
  let tilesHtml = '';
  for (let i = 0; i < combat.entries.length; i++) {
    const e = combat.entries[i];
    const isActive = i === combat.turnIndex;
    const isSelected = _selectedCombatantId === e.id;
    const isMon = e.type === 'monster';

    let refObj = null;
    if (isMon) refObj = (m.monsters || []).find(x => x.id === e.id);
    else refObj = characters.find(x => x.id === e.id);

    const curHp = refObj?.currentHp ?? 0;
    const maxHp = refObj?.maxHp ?? 0;
    const isDead = curHp <= 0;
    const hpPctVal = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((curHp / maxHp) * 100))) : 0;
    const hpBarColor = isMon ? '#8a2020' : (refObj && !isMon ? classColor(refObj.class) : '#506050');

    const borderColor = isActive ? '#c8b070' : isSelected ? '#d4b878' : isDead ? '#333' : isMon ? '#8a2020' : 'rgba(90,70,40,.35)';
    const glowCss = isActive
      ? 'box-shadow:0 0 0 2px rgba(200,176,112,.6),0 0 12px rgba(200,176,112,.4);'
      : isSelected
        ? 'box-shadow:0 0 0 2px rgba(212,184,120,.45);'
        : '';
    const bgColor = isActive ? 'rgba(200,176,112,.08)' : isDead ? 'rgba(0,0,0,.3)' : 'var(--bg-card)';

    let portrait = '';
    const avatarStyle = 'width:32px;height:32px;border-radius:50%;border:1.5px solid ' + borderColor + ';';
    let portraitInner = '';
    if (isMon) {
      if (refObj && refObj.imgUrl) portraitInner = '<img src="' + refObj.imgUrl + '" style="' + avatarStyle + 'object-fit:cover;">';
      else portraitInner = '<div style="' + avatarStyle + 'background:#3a1818;display:flex;align-items:center;justify-content:center;font-size:.58rem;color:#c04040;font-family:var(--font-display);">' + (e.name || '?').charAt(0) + '</div>';
    } else {
      if (refObj && refObj.imageUrl) portraitInner = '<img src="' + refObj.imageUrl + '" style="' + avatarStyle + 'object-fit:cover;">';
      else {
        const col = refObj ? classColor(refObj.class) : '#5a4830';
        portraitInner = '<div style="' + avatarStyle + 'background:' + col + '20;color:' + col + ';display:flex;align-items:center;justify-content:center;font-size:.58rem;font-family:var(--font-display);">' + (refObj?.icon || (e.name || '?').charAt(0)) + '</div>';
      }
    }

    // Concentration badge ("C") for characters with active concentration.
    let concBadge = '';
    if (!isMon && refObj && refObj.concentrating) {
      const armed = !!_concEndArmTs[e.id];
      const badgeBorder = armed ? '#c04040' : '#c8b070';
      const badgeBg = armed ? '#3a1818' : '#1e1b16';
      const badgeColor = armed ? '#e08080' : '#c8b070';
      const tip = (armed ? 'Click again to end · ' : 'Concentrating: ') + (refObj.concentrating.spellName || '');
      concBadge =
        '<div onclick="window.armEndConcentration(\'' + e.id + '\',event)" ' +
        'title="' + tip.replace(/"/g, '&quot;') + '" ' +
        'style="position:absolute;right:-3px;bottom:-3px;width:16px;height:16px;border-radius:50%;' +
        'background:' + badgeBg + ';border:1.5px solid ' + badgeBorder + ';color:' + badgeColor + ';' +
        'display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;' +
        'font-family:var(--font-display,sans-serif);cursor:pointer;letter-spacing:0;line-height:1;">C</div>';
    }
    portrait = '<div style="position:relative;display:inline-block;">' + portraitInner + concBadge + '</div>';

    // Foot row: either compact death-save pips (6 small dots) or a mini HP bar with numeric
    let footRow = '';
    if (!isMon && isDead && refObj) {
      const ds = _getDeathSaves(refObj);
      // Bumped from 7px → 11px and added 2px padding so each dot has a
      // ~15px effective tap target — Jess can hit them on her phone.
      const dot = (filled, color) =>
        '<div style="width:11px;height:11px;border-radius:50%;border:1px solid ' + color + ';background:' + (filled ? color : 'transparent') + ';"></div>';
      let succ = ''; for (let j = 0; j < 3; j++) succ += dot(j < ds.successes, '#4a9a40');
      let fail = ''; for (let j = 0; j < 3; j++) fail += dot(j < ds.failures, '#c04040');
      footRow =
        '<div style="display:flex;gap:4px;justify-content:center;align-items:center;padding:2px;">' +
          '<div title="Death save successes — click to toggle" style="display:flex;gap:3px;cursor:pointer;padding:2px;" onclick="event.stopPropagation();window.toggleDeathSave(\'' + e.id + '\',\'success\')">' + succ + '</div>' +
          '<span style="color:#555;font-size:.55rem;">·</span>' +
          '<div title="Death save failures — click to toggle" style="display:flex;gap:3px;cursor:pointer;padding:2px;" onclick="event.stopPropagation();window.toggleDeathSave(\'' + e.id + '\',\'failure\')">' + fail + '</div>' +
        '</div>';
    } else if (maxHp > 0) {
      footRow =
        '<div style="position:relative;height:7px;background:#12100c;border-radius:2px;overflow:hidden;">' +
          '<div style="position:absolute;inset:0 auto 0 0;width:' + hpPctVal + '%;background:' + hpBarColor + ';"></div>' +
        '</div>' +
        '<div style="font-size:.52rem;color:#9a8450;font-family:var(--font-mono);text-align:center;letter-spacing:.04em;margin-top:1px;">' + curHp + '/' + maxHp + '</div>';
    }

    const nameStyle = isDead ? 'text-decoration:line-through;color:#7a7268;' : 'color:#e2dbd0;';
    const initColor = isActive ? '#c8b070' : '#7a7268';

    tilesHtml +=
      '<div data-combatant-id="' + e.id + '" onclick="selectCombatant(\'' + e.id + '\')" title="' + e.name + ' · init ' + e.initiative + '" ' +
      'style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 6px;min-width:88px;max-width:92px;' +
      'border:1.5px solid ' + borderColor + ';border-radius:8px;background:' + bgColor + ';cursor:pointer;transition:transform .1s;' +
      glowCss + (isDead ? 'opacity:.65;' : '') + '">' +
        portrait +
        '<div style="font-size:.65rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:84px;' + nameStyle + '">' + e.name + '</div>' +
        '<div style="font-size:.54rem;font-weight:600;color:' + initColor + ';font-family:var(--font-mono);">' + e.initiative + '</div>' +
        '<div style="width:100%;">' + footRow + '</div>' +
      '</div>';
  }

  const headerHtml =
    '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">' +
      '<div style="font-family:var(--font-display);font-size:.62rem;color:#9a8450;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;">Round ' + combat.round + '</div>' +
      '<div style="font-size:.72rem;color:var(--text);font-weight:500;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;" title="' + (current?.name || '') + "'s turn" + '">' + (current ? current.name : '') + '</div>' +
    '</div>';

  // End-combat button reflects the two-click confirmation state.
  const endLabel = _endConfirmArmed ? 'Confirm?' : 'End';
  const endStyle = _endConfirmArmed
    ? 'font-size:.7rem;padding:3px 7px;background:#c04040;border-color:#c04040;color:#fff;'
    : 'font-size:.7rem;padding:3px 7px;color:var(--red);';
  const endTitle = _endConfirmArmed
    ? 'Click again to end combat (Ctrl+Shift+E to skip confirm)'
    : 'End combat (click twice; Ctrl+Shift+E to skip confirm)';

  const controlsHtml =
    '<div style="display:flex;gap:4px;flex-shrink:0;align-items:center;">' +
      '<span style="font-size:.48rem;color:#5a5248;letter-spacing:.06em;margin-right:6px;display:none;" class="kb-hint">N next · J/K sel · D dmg · H heal · \u2318Z undo</span>' +
      '<button class="btn btn-sm btn-ghost" onclick="prevTurn()" title="Previous turn (Shift+N)" style="font-size:.75rem;padding:3px 7px;">\u25C0</button>' +
      '<button class="btn btn-sm btn-primary" onclick="nextTurn()" title="Next turn (N or Space)" style="font-size:.72rem;padding:3px 9px;">Next \u25B6</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="window.undoHp()" title="Undo last HP change (Ctrl+Z)" style="font-size:.7rem;padding:3px 7px;">\u21B6</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="confirmEndCombat()" title="' + endTitle + '" style="' + endStyle + '">' + endLabel + '</button>' +
    '</div>';

  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;padding:4px 6px;">' +
      headerHtml +
      '<div style="display:flex;gap:6px;overflow-x:auto;flex:1;padding:3px 0;scrollbar-width:thin;">' + tilesHtml + '</div>' +
      controlsHtml +
    '</div>' +
    _renderSelectedDetailStrip(m);
}

// Thin strip shown directly under the initiative bar when a combatant is selected.
// Holds HP edit buttons, inline damage input, chips, and expanded death saves.
function _renderSelectedDetailStrip(m) {
  if (!_selectedCombatantId) return '';
  const entry = (m.combat.entries || []).find(x => x.id === _selectedCombatantId);
  if (!entry) return '';
  const isMon = entry.type === 'monster';
  const refObj = isMon
    ? (m.monsters || []).find(x => x.id === entry.id)
    : characters.find(x => x.id === entry.id);
  if (!refObj) return '';

  const curHp = refObj.currentHp ?? 0;
  const maxHp = refObj.maxHp ?? 0;
  const tempHp = refObj.tempHp ?? 0;
  const tempStr = tempHp > 0 ? ' <span style="color:#6ab0e0;">(+' + tempHp + ' temp)</span>' : '';

  // Chips
  const chips = _lastDamages[entry.id] || [];
  const chipsHtml = chips.map(chip => {
    const c = chip.sign < 0 ? '#c04040' : '#4a9a40';
    const prefix = chip.sign < 0 ? '-' : '+';
    return '<button onclick="applyChip(\'' + entry.id + '\',' + chip.amount + ',' + chip.sign + ')" title="Re-apply ' + prefix + chip.amount + '" ' +
      'style="font-size:.6rem;padding:2px 8px;background:rgba(0,0,0,.35);border:1px solid ' + c + ';color:' + c + ';border-radius:10px;cursor:pointer;font-family:var(--font-mono);">' +
      prefix + chip.amount + '</button>';
  }).join('');

  // Conditions (chars only)
  let condsHtml = '';
  if (!isMon && Array.isArray(refObj.conditions)) {
    condsHtml = refObj.conditions.map(cn =>
      '<span style="display:inline-block;padding:1px 5px;font-size:.55rem;border-radius:4px;background:rgba(200,176,112,.12);color:#c8b070;border:1px solid rgba(200,176,112,.25);letter-spacing:.04em;">' + cn + '</span>'
    ).join('');
  }

  // Concentration UI (chars only).
  let concHtml = '';
  if (!isMon) {
    if (refObj.concentrating && refObj.concentrating.spellName) {
      const sp = refObj.concentrating.spellName;
      concHtml =
        '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 6px;font-size:.6rem;border-radius:6px;background:rgba(200,176,112,.12);color:#c8b070;border:1px solid #c8b070;font-family:var(--font-display,sans-serif);letter-spacing:.04em;" title="Concentrating">' +
          '<span style="font-weight:600;">C</span>' +
          '<span>' + sp + '</span>' +
          '<button onclick="window.endConcentration(\'' + entry.id + '\',\'voluntary\')" title="End concentration" ' +
          'style="background:transparent;border:none;color:#e08080;cursor:pointer;font-size:.7rem;padding:0 2px;line-height:1;">\u00D7</button>' +
        '</span>';
    } else {
      concHtml =
        '<span id="conc-input-host-' + entry.id + '" style="position:relative;display:inline-flex;align-items:center;">' +
          '<button onclick="window.openConcentrateInput(\'' + entry.id + '\')" title="Start concentrating on a spell" ' +
          'style="font-size:.6rem;padding:2px 6px;background:transparent;border:1px dashed rgba(200,176,112,.4);color:#9a8450;border-radius:6px;cursor:pointer;letter-spacing:.04em;">+ Concentrate</button>' +
        '</span>';
    }
  }

  return '<div style="display:flex;align-items:center;gap:10px;padding:4px 10px;border-top:1px solid rgba(200,176,112,.12);background:rgba(26,22,19,.4);flex-shrink:0;">' +
    '<span style="font-size:.68rem;color:#c8b070;font-weight:500;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + entry.name + '</span>' +
    '<span style="font-size:.66rem;color:#e2dbd0;font-family:var(--font-mono);">' + curHp + '/' + maxHp + tempStr + '</span>' +
    '<button onclick="applyDamageToSelected(1)" title="Damage 1 (D for custom)" style="font-size:.62rem;padding:2px 8px;background:#362020;border:1px solid #5a2828;color:#e08080;border-radius:6px;cursor:pointer;">−1</button>' +
    '<button onclick="applyDamageToSelected(5)" style="font-size:.62rem;padding:2px 8px;background:#362020;border:1px solid #5a2828;color:#e08080;border-radius:6px;cursor:pointer;">−5</button>' +
    '<button onclick="promptDamageOrHeal(\'damage\')" title="Damage prompt (D)" style="font-size:.62rem;padding:2px 8px;background:#362020;border:1px solid #5a2828;color:#e08080;border-radius:6px;cursor:pointer;">Dmg…</button>' +
    '<button onclick="applyHealToSelected(1)" style="font-size:.62rem;padding:2px 8px;background:#1f3020;border:1px solid #285028;color:#80c080;border-radius:6px;cursor:pointer;">+1</button>' +
    '<button onclick="applyHealToSelected(5)" style="font-size:.62rem;padding:2px 8px;background:#1f3020;border:1px solid #285028;color:#80c080;border-radius:6px;cursor:pointer;">+5</button>' +
    '<button onclick="promptDamageOrHeal(\'heal\')" title="Heal prompt (H)" style="font-size:.62rem;padding:2px 8px;background:#1f3020;border:1px solid #285028;color:#80c080;border-radius:6px;cursor:pointer;">Heal…</button>' +
    (chipsHtml ? '<span style="font-size:.52rem;color:#7a7268;letter-spacing:.06em;margin-left:4px;">LAST:</span>' + '<div style="display:flex;gap:3px;">' + chipsHtml + '</div>' : '') +
    (condsHtml ? '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-left:4px;">' + condsHtml + '</div>' : '') +
    (concHtml ? '<div style="margin-left:4px;">' + concHtml + '</div>' : '') +
    '<div style="flex:1;"></div>' +
    '<span style="font-size:.5rem;color:#5a5248;letter-spacing:.06em;">Esc to deselect</span>' +
  '</div>';
}

// ── HOTKEYS ──────────────────────────────────────────────────
function _hotkeyHandler(ev) {
  const m = maps.find(x => x.id === currentMapId);
  if (!m?.combat?.active) return;

  // If a prompt is open, only handle its own keys — let input consume the rest.
  // (The prompt installs its own listener that stopPropagation, but guard anyway.)
  if (_combatPromptOpen) {
    if (ev.key === 'Escape') { _removePrompt(); ev.preventDefault(); }
    return;
  }

  // Skip when user is typing in an input/textarea/select/contenteditable.
  const ae = document.activeElement;
  if (ae) {
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) return;
  }

  const key = ev.key;
  const entries = m.combat.entries || [];

  // Ctrl+Z / Cmd+Z — undo
  if ((ev.ctrlKey || ev.metaKey) && (key === 'z' || key === 'Z')) {
    ev.preventDefault();
    window.undoHp();
    return;
  }

  // Ctrl+Shift+E — quick-end combat (skips the two-click confirmation).
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (key === 'e' || key === 'E')) {
    ev.preventDefault();
    endCombat();
    return;
  }

  // N or Space — next turn; Shift+ — prev turn
  if (key === 'n' || key === 'N' || key === ' ' || key === 'Spacebar') {
    ev.preventDefault();
    if (ev.shiftKey) prevTurn();
    else nextTurn();
    return;
  }

  // J — select next combatant
  if (key === 'j' || key === 'J') {
    ev.preventDefault();
    if (!entries.length) return;
    let idx = entries.findIndex(x => x.id === _selectedCombatantId);
    idx = idx < 0 ? 0 : (idx + 1) % entries.length;
    selectCombatant(entries[idx].id);
    return;
  }

  // K — select prev combatant
  if (key === 'k' || key === 'K') {
    ev.preventDefault();
    if (!entries.length) return;
    let idx = entries.findIndex(x => x.id === _selectedCombatantId);
    idx = idx < 0 ? entries.length - 1 : (idx - 1 + entries.length) % entries.length;
    selectCombatant(entries[idx].id);
    return;
  }

  // D — damage prompt for selected
  if (key === 'd' || key === 'D') {
    ev.preventDefault();
    promptDamageOrHeal('damage');
    return;
  }

  // H — heal prompt for selected
  if (key === 'h' || key === 'H') {
    ev.preventDefault();
    promptDamageOrHeal('heal');
    return;
  }

  // Escape — clear selection (if no prompt open)
  if (key === 'Escape') {
    if (_selectedCombatantId) {
      _selectedCombatantId = null;
      renderInitiativeBar();
      ev.preventDefault();
    }
    return;
  }
}

function _installCombatHotkeys() {
  if (_combatHotkeysInstalled) return;
  document.addEventListener('keydown', _hotkeyHandler);
  _combatHotkeysInstalled = true;
}

function _uninstallCombatHotkeys() {
  if (!_combatHotkeysInstalled) return;
  document.removeEventListener('keydown', _hotkeyHandler);
  _combatHotkeysInstalled = false;
  _selectedCombatantId = null;
  _removePrompt();
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
