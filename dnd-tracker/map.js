/* ============================================================
   TOME OF HEROES — Map System
   Handles: map list, image loading, token placement,
   token dragging, scenario save/load, quick save
   ============================================================ */

let maps = [];
let currentMapId = null;
let placingCharId = null;
let _dragTokenId = null;
let _dragOffX = 0, _dragOffY = 0;

// ── LOAD ──────────────────────────────────────────────────────────────────────
async function loadMaps() {
  maps = await DB.load('maps');
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function showMapList() {
  if (typeof teardownFogSystem === 'function') teardownFogSystem();
  showView('view-map-list');
  renderMapList();
}

// ── MAP LIST ──────────────────────────────────────────────────────────────────
function renderMapList() {
  const grid = document.getElementById('map-grid');
  const empty = document.getElementById('map-list-empty');
  const count = document.getElementById('map-count');
  count.textContent = maps.length ? `(${maps.length})` : '';

  if (!maps.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = maps.map(m => {
    const bg = m.imageData || m.imageUrl;
    const scenCount = Object.keys(m.scenarios || {}).length;
    const tokCount = (m.tokens || []).length;
    return `<div class="map-card" onclick="openMapEditor('${m.id}')">
      <div class="map-card-thumb" ${bg ? `style="background-image:url('${bg}')"` : ''}>${!bg ? '<span style="font-size:1.5rem;opacity:.3;">🗺</span>' : ''}</div>
      <div class="map-card-body">
        <div class="map-card-name">${esc(m.name || 'Unnamed Map')}</div>
        <div class="map-card-meta">${scenCount} scenario${scenCount !== 1 ? 's' : ''} · ${tokCount} token${tokCount !== 1 ? 's' : ''}</div>
      </div>
      <button class="btn btn-sm btn-danger map-card-del" onclick="event.stopPropagation();deleteMap('${m.id}')">✕</button>
    </div>`;
  }).join('');
}

// ── NEW MAP MODAL ─────────────────────────────────────────────────────────────
function showNewMapModal() {
  document.getElementById('new-map-overlay').classList.add('open');
  document.getElementById('nm-name').value = '';
  document.getElementById('nm-url').value = '';
  document.getElementById('nm-file').value = '';
  document.getElementById('nm-preview').style.display = 'none';
  document.getElementById('nm-err').textContent = '';
}
function closeNewMapModal() {
  document.getElementById('new-map-overlay').classList.remove('open');
}
function handleNmUrl() {
  const url = document.getElementById('nm-url').value.trim();
  const prev = document.getElementById('nm-preview');
  if (url) {
    prev.src = url;
    prev.style.display = 'block';
    prev.onerror = () => { document.getElementById('nm-err').textContent = 'Cannot load image from that URL.'; prev.style.display = 'none'; };
    prev.onload = () => { document.getElementById('nm-err').textContent = ''; };
  } else {
    prev.style.display = 'none';
  }
}
function handleNmFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    document.getElementById('nm-err').textContent = 'File too large (max 5 MB). Use a URL instead for big maps.';
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const prev = document.getElementById('nm-preview');
    prev.src = ev.target.result;
    prev.style.display = 'block';
    document.getElementById('nm-url').value = '';
    document.getElementById('nm-err').textContent = '';
  };
  reader.readAsDataURL(file);
}
async function createMap() {
  const name = document.getElementById('nm-name').value.trim();
  if (!name) { document.getElementById('nm-err').textContent = 'Map name is required.'; return; }

  const urlVal = document.getElementById('nm-url').value.trim();
  const prev = document.getElementById('nm-preview');
  let imageUrl = null, imageData = null;

  let videoUrl = null;
  if (urlVal) {
    // Detect YouTube URLs
    const ytMatch = urlVal.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/);
    if (ytMatch) {
      videoUrl = 'https://www.youtube.com/embed/' + ytMatch[1] + '?autoplay=1&mute=1&loop=1&controls=0&playlist=' + ytMatch[1];
      imageUrl = 'https://img.youtube.com/vi/' + ytMatch[1] + '/maxresdefault.jpg';
    } else if (urlVal.match(/\.(mp4|webm|ogg)(\?|$)/i)) {
      videoUrl = urlVal;
    } else {
      imageUrl = urlVal;
    }
  } else if (prev.src.startsWith('data:')) {
    imageData = prev.src;
  } else {
    document.getElementById('nm-err').textContent = 'Provide an image/video URL or upload a file.';
    return;
  }

  const btn = document.getElementById('nm-create-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  const m = { id: uid(), name, imageUrl, imageData, videoUrl, tokens: [], scenarios: {}, createdAt: Date.now(), updatedAt: Date.now() };
  maps.push(m);
  await DB.save('maps', m, maps);
  closeNewMapModal();
  openMapEditor(m.id);
  btn.disabled = false; btn.textContent = 'Create Map';
}
async function deleteMap(id) {
  const m = maps.find(x => x.id === id);
  if (!m || !confirm(`Delete map "${m.name}"?\n\nAll tokens and scenarios will be permanently removed.`)) return;
  maps = maps.filter(x => x.id !== id);
  await DB.remove('maps', id, maps);
  renderMapList();
}

// ── MAP EDITOR ────────────────────────────────────────────────────────────────
function openMapEditor(id) {
  currentMapId = id;
  placingCharId = null;
  const m = maps.find(x => x.id === id);
  if (!m) { showMapList(); return; }

  showView('view-map-editor');

  // Header
  document.getElementById('me-name').value = m.name;

  // Load image (or video background)
  const img = document.getElementById('map-img');
  const mapStage = document.getElementById('map-stage');
  const _initAll = () => { renderTokensOnMap(); initFogSystem(m); if (typeof renderInitiativeBar === 'function') renderInitiativeBar(); };

  // Clean up any previous video elements
  mapStage.querySelectorAll('.map-video-bg,.map-iframe-bg').forEach(el => el.remove());
  img.style.cssText = '';

  if (m.videoUrl) {
    // Video map: use the image as the sizing layer (invisible or semi-transparent)
    // and overlay the video behind it
    if (m.videoUrl.includes('youtube.com/embed')) {
      // YouTube: use thumbnail as the map image for sizing, iframe behind
      img.src = m.imageUrl || '';
      const iframe = document.createElement('iframe');
      iframe.className = 'map-iframe-bg';
      iframe.src = m.videoUrl;
      iframe.allow = 'autoplay; encrypted-media';
      iframe.frameBorder = '0';
      iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border:none;z-index:0;';
      mapStage.insertBefore(iframe, img);
      img.style.cssText = 'position:relative;z-index:1;width:100%;display:block;opacity:0;';
      img.onload = _initAll;
    } else {
      // Direct video: create video element, use a poster frame or first frame for sizing
      const vid = document.createElement('video');
      vid.className = 'map-video-bg';
      vid.src = m.videoUrl;
      vid.autoplay = true; vid.muted = true; vid.loop = true; vid.playsInline = true;
      vid.style.cssText = 'display:block;width:100%;height:auto;pointer-events:none;position:relative;z-index:1;';
      mapStage.insertBefore(vid, img);
      img.style.display = 'none';
      // Fog and tokens overlay on the video
      vid.onloadeddata = () => {
        // Size fog canvas to video
        const fogCanvas = document.getElementById('fog-canvas');
        if (fogCanvas) { fogCanvas.style.cssText = 'position:absolute;top:0;left:0;width:' + vid.offsetWidth + 'px;height:' + vid.offsetHeight + 'px;z-index:2;pointer-events:none;'; }
        const overlay = document.getElementById('token-overlay');
        if (overlay) { overlay.style.cssText = 'position:absolute;top:0;left:0;width:' + vid.offsetWidth + 'px;height:' + vid.offsetHeight + 'px;z-index:3;pointer-events:none;'; }
        _initAll();
      };
    }
  } else {
    // Normal image map
    img.src = m.imageData || m.imageUrl || '';
    img.onload = _initAll;
    if (img.complete && img.naturalWidth) _initAll();
  }

  // Sidebar + scenarios
  renderTokenSidebar();
  if (typeof renderMonsterSidebar === 'function') renderMonsterSidebar();
  if (typeof renderMonsterSearchResults === 'function') renderMonsterSearchResults('');
  renderScenarioSelect();
  // Load notes
  const notesEl = document.getElementById('map-notes');
  if (notesEl) notesEl.value = m.notes || '';
  // Render condition reference + combat log
  if (typeof renderConditionRef === 'function') renderConditionRef();
  if (typeof renderCombatLog === 'function') renderCombatLog();
  setPlacingMode(null);
  if (typeof clearMonsterPlacing === 'function') clearMonsterPlacing();
}

async function saveMapName() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  m.name = document.getElementById('me-name').value.trim() || 'Unnamed Map';
  m.updatedAt = Date.now();
  await saveCurrentMap();
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function renderTokenSidebar() {
  const el = document.getElementById('token-sidebar-chars');
  if (!characters.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--text4);padding:.5rem;">No characters yet.</div>';
    return;
  }
  el.innerHTML = characters.map(c => {
    const col = classColor(c.class);
    const sideIcon = c.icon || initials(c.name);
    const sideFontSize = c.icon ? "1rem" : ".62rem";
    const pct = hpPct(c.currentHp || 0, c.maxHp || 1);
    const hpCol = hpColor(pct);
    const imgHtml = c.imageUrl
      ? `<img src="${c.imageUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
        + `<span style="display:none;font-size:${sideFontSize};">${sideIcon}</span>`
      : `<span style="font-size:${sideFontSize};">${sideIcon}</span>`;
    return `<div class="sidebar-char-item" id="sci-${c.id}" onclick="selectCharForPlace('${c.id}')" title="Click to place on map" style="padding:8px;gap:8px;">
      <div class="avatar avatar-sm" style="background:${col}20;border-color:${col};color:${col};overflow:hidden;">${imgHtml}</div>
      <div style="min-width:0;flex:1;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
          <span style="font-size:.78rem;color:#e2dbd0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</span>
          <span style="font-size:.55rem;color:#7a7268;flex-shrink:0;margin-left:4px;">${c.class || '—'} Lv${c.level || 1}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
          <button onclick="event.stopPropagation();quickHp('${c.id}',-1)" style="width:18px;height:18px;border-radius:4px;border:1px solid #2a2620;background:#16140f;color:#b0a898;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);">-</button>
          <div style="flex:1;height:4px;background:#16140f;border-radius:2px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${hpCol};border-radius:2px;"></div>
          </div>
          <span style="font-size:.58rem;color:${hpCol};font-family:var(--font-mono);white-space:nowrap;min-width:36px;text-align:center;">${c.currentHp||0}/${c.maxHp||0}</span>
          <button onclick="event.stopPropagation();quickHp('${c.id}',1)" style="width:18px;height:18px;border-radius:4px;border:1px solid #2a2620;background:#16140f;color:#b0a898;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);">+</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function selectCharForPlace(charId) {
  if (placingCharId === charId) { setPlacingMode(null); return; }
  setPlacingMode(charId);
}

function setPlacingMode(charId) {
  placingCharId = charId;
  // Clear monster placing when selecting a character
  if (charId && typeof clearMonsterPlacing === 'function') { placingMonsterId = null; }
  document.querySelectorAll('.sidebar-char-item').forEach(el => el.classList.remove('placing'));
  const stage = document.getElementById('map-stage');
  const hint = document.getElementById('place-hint');
  if (charId) {
    document.getElementById('sci-' + charId)?.classList.add('placing');
    stage.style.cursor = 'crosshair';
    hint.style.display = 'flex';
  } else {
    stage.style.cursor = '';
    hint.style.display = 'none';
  }
}

// ── TOKEN PLACEMENT ───────────────────────────────────────────────────────────
function mapStageClick(e) {
  if (_fogTool !== 'none') return; // fog tool active, don't place tokens
  if (e.target.closest('.map-token')) return;
  if (e.target.closest('#monster-popup')) return;
  // Hide monster popup on map click
  if (typeof hideMonsterPopup === 'function') hideMonsterPopup();

  if (_mapPingMode) {
    const stageRect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - stageRect.left) / stageRect.width) * 100;
    const yPct = ((e.clientY - stageRect.top) / stageRect.height) * 100;
    fireMapPing(xPct, yPct);
    toggleMapPingMode(); // exit ping mode after one ping
    return;
  }

  const mapEl = getMapElement();
  if (!mapEl || !mapEl.offsetWidth) return;

  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  const pos = getPosOnImg(e);

  // Monster placement
  if (typeof placingMonsterId !== 'undefined' && placingMonsterId) {
    const token = { id: uid(), monsterId: placingMonsterId, x: pos.x, y: pos.y, size: 1 };
    m.tokens = m.tokens || [];
    m.tokens.push(token);
    m.updatedAt = Date.now();
    saveCurrentMap();
    renderTokensOnMap();
    clearMonsterPlacing();
    return;
  }

  // Character placement
  if (!placingCharId) return;
  const token = { id: uid(), characterId: placingCharId, x: pos.x, y: pos.y, size: 1 };
  m.tokens = m.tokens || [];
  m.tokens.push(token);
  m.updatedAt = Date.now();

  saveCurrentMap();
  renderTokensOnMap();
  setPlacingMode(null);
}

function getMapElement() {
  // Return the visible map element (image or video)
  const img = document.getElementById('map-img');
  if (img && img.style.display !== 'none' && img.offsetWidth > 0) return img;
  const vid = document.querySelector('.map-video-bg');
  if (vid) return vid;
  return img; // fallback
}

function getPosOnImg(e) {
  const el = getMapElement();
  const r = el.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
    y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))
  };
}

// ── TOKEN RENDERING ───────────────────────────────────────────────────────────
function renderTokensOnMap() {
  const m = maps.find(x => x.id === currentMapId);
  const overlay = document.getElementById('token-overlay');
  if (!m) { overlay.innerHTML = ''; return; }

  // Clean orphan character tokens
  const before = (m.tokens || []).length;
  m.tokens = (m.tokens || []).filter(tok => {
    if (tok.characterId) return characters.some(c => c.id === tok.characterId);
    if (tok.monsterId) return (m.monsters || []).some(mon => mon.id === tok.monsterId);
    return false;
  });
  if (m.tokens.length < before) saveCurrentMap();

  const fogView = getFogViewMode(m.id);
  const fogOn = m.fog?.enabled;

  overlay.innerHTML = m.tokens.map(tok => {
    const isMonster = !!tok.monsterId;
    let col, name, pct, hpC, display, displaySize;
    const sz = Math.round((tok.size || 1) * 42);

    let imgUrl = null;
    let entityId = null; // for initiative tracking

    if (isMonster) {
      const mon = (m.monsters || []).find(x => x.id === tok.monsterId);
      if (!mon) return '';
      col = '#8a2020';
      name = mon.displayName || mon.templateName;
      pct = hpPct(mon.currentHp || 0, mon.maxHp || 1);
      hpC = hpColor(pct);
      display = initials(name);
      displaySize = Math.round(sz * 0.33);
      imgUrl = mon.imgUrl || null;
      entityId = mon.id;
    } else {
      const c = characters.find(x => x.id === tok.characterId);
      col = c ? classColor(c.class) : '#506050';
      name = c ? c.name : 'Unknown';
      pct = c ? hpPct(c.currentHp || 0, c.maxHp || 1) : 100;
      hpC = hpColor(pct);
      display = c?.icon || initials(name);
      const isEmoji = c?.icon && c.icon.length > 0;
      displaySize = isEmoji ? Math.round(sz * 0.52) : Math.round(sz * 0.33);
      imgUrl = c?.imageUrl || null;
      entityId = c?.id;
    }

    // Fog visibility
    let tokVis = '';
    if (fogOn && typeof isPositionRevealed === 'function') {
      const revealed = isPositionRevealed(tok.x, tok.y);
      if (!revealed && fogView === 'player') tokVis = 'display:none;';
      else if (!revealed && fogView === 'dm') tokVis = 'opacity:0.4;';
    }

    // In player view, hide monster HP ring
    const showHpRing = !(isMonster && fogView === 'player');
    const hpSvg = showHpRing ? `<svg viewBox="0 0 36 36" style="position:absolute;inset:-3px;width:calc(100% + 6px);height:calc(100% + 6px);pointer-events:none;">
        <circle cx="18" cy="18" r="16" fill="none" stroke="${hpC}" stroke-width="2.5"
          stroke-dasharray="${(pct / 100 * 100.5).toFixed(1)} 100.5"
          stroke-dashoffset="25.1" stroke-linecap="round"
          transform="rotate(-90 18 18)" opacity="0.7"/>
      </svg>` : '';

    // Monster tokens: click to show popup in DM view
    const clickHandler = isMonster
      ? `onclick="event.stopPropagation();showMonsterPopup('${tok.monsterId}',this)"`
      : '';

    // Active turn highlight
    const isActiveTurn = m.combat?.active && m.combat.entries?.[m.combat.turnIndex]?.id === entityId;
    const turnClass = isActiveTurn ? ' active-turn' : '';

    // Image or text display
    const innerDisplay = imgUrl
      ? `<img class="token-img" src="${imgUrl}" alt="${esc(name)}" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
        + `<span style="font-size:${displaySize}px;line-height:1;pointer-events:none;user-select:none;display:none;">${display}</span>`
      : `<span style="font-size:${displaySize}px;line-height:1;pointer-events:none;user-select:none;">${display}</span>`;

    return `<div class="map-token${turnClass}" id="tok-${tok.id}"
        style="left:${tok.x.toFixed(2)}%;top:${tok.y.toFixed(2)}%;width:${sz}px;height:${sz}px;border-color:${col};background:${col}28;color:${col};${tokVis}"
        onpointerdown="startTokenDrag(event,'${tok.id}')"
        onwheel="handleTokenWheel(event,'${tok.id}')"
        ${clickHandler}
        title="${esc(name)} — scroll to resize">
      ${innerDisplay}
      ${hpSvg}
      <div class="token-label">${esc(name)}</div>
      <button class="token-del" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();removeToken('${tok.id}')">✕</button>
    </div>`;
  }).join('');
}

// ── TOKEN DRAG ────────────────────────────────────────────────────────────────
function startTokenDrag(e, tokenId) {
  if (placingCharId) return;
  e.stopPropagation();
  e.preventDefault();

  _dragTokenId = tokenId;
  const tok = document.getElementById('tok-' + tokenId);
  if (!tok) return;

  const tokR = tok.getBoundingClientRect();
  _dragOffX = e.clientX - (tokR.left + tokR.width / 2);
  _dragOffY = e.clientY - (tokR.top + tokR.height / 2);

  tok.classList.add('dragging');
  tok.setPointerCapture(e.pointerId);

  tok.onpointermove = ev => {
    const img = document.getElementById('map-img');
    const r = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((ev.clientX - _dragOffX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((ev.clientY - _dragOffY - r.top) / r.height) * 100));
    tok.style.left = x.toFixed(2) + '%';
    tok.style.top = y.toFixed(2) + '%';
  };

  tok.onpointerup = async ev => {
    tok.classList.remove('dragging');
    tok.onpointermove = null;
    tok.onpointerup = null;
    tok.releasePointerCapture(ev.pointerId);

    const img = document.getElementById('map-img');
    const r = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((ev.clientX - _dragOffX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((ev.clientY - _dragOffY - r.top) / r.height) * 100));

    const m = maps.find(mx => mx.id === currentMapId);
    if (m) {
      const token = m.tokens.find(t => t.id === _dragTokenId);
      if (token) { token.x = x; token.y = y; m.updatedAt = Date.now(); }
    }
    await saveCurrentMap();
    _dragTokenId = null;
  };
}

async function removeToken(tokenId) {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  m.tokens = m.tokens.filter(t => t.id !== tokenId);
  m.updatedAt = Date.now();
  await saveCurrentMap();
  renderTokensOnMap();
}

// ── SCENARIOS ─────────────────────────────────────────────────────────────────
function renderScenarioSelect() {
  const m = maps.find(x => x.id === currentMapId);
  const sel = document.getElementById('scenario-sel');
  const scens = Object.values(m?.scenarios || {}).sort((a, b) => b.savedAt - a.savedAt);
  const named = scens.filter(s => !s.isQuickSave);
  sel.innerHTML = '<option value="">— Select snapshot —</option>' +
    named.map(s => `<option value="${s.id}">${esc(s.name)} · ${new Date(s.savedAt).toLocaleDateString()}</option>`).join('');
}

async function quickSave() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;

  const existing = Object.values(m.scenarios || {}).find(s => s.isQuickSave);
  const charHp = characters.filter(c => (m.tokens||[]).some(t => t.characterId === c.id)).map(c => ({id:c.id, currentHp:c.currentHp, maxHp:c.maxHp}));
  const scen = { id: existing?.id || uid(), name: '⚡ Quick Save', isQuickSave: true, savedAt: Date.now(), tokens: JSON.parse(JSON.stringify(m.tokens || [])), monsters: JSON.parse(JSON.stringify(m.monsters || [])), fog: JSON.parse(JSON.stringify(m.fog || {})), combat: JSON.parse(JSON.stringify(m.combat || {})), charHp };
  m.scenarios = m.scenarios || {};
  m.scenarios[scen.id] = scen;
  m.updatedAt = Date.now();
  await saveCurrentMap();
  renderScenarioSelect();
  flashBtn('quick-save-btn', '✓ Saved!', '⚡ Save');
}

async function saveNamedScenario() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;

  const name = prompt('Name this scenario:', `Session pause — ${new Date().toLocaleDateString()}`);
  if (!name?.trim()) return;

  const charHp = characters.filter(c => (m.tokens||[]).some(t => t.characterId === c.id)).map(c => ({id:c.id, currentHp:c.currentHp, maxHp:c.maxHp}));
  const scen = { id: uid(), name: name.trim(), savedAt: Date.now(), tokens: JSON.parse(JSON.stringify(m.tokens || [])), monsters: JSON.parse(JSON.stringify(m.monsters || [])), fog: JSON.parse(JSON.stringify(m.fog || {})), combat: JSON.parse(JSON.stringify(m.combat || {})), charHp };
  m.scenarios = m.scenarios || {};
  m.scenarios[scen.id] = scen;
  m.updatedAt = Date.now();
  await saveCurrentMap();
  renderScenarioSelect();
  flashBtn('save-scen-btn', '✓ Saved!', '+ Save New');
}

async function loadScenario() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;

  const sel = document.getElementById('scenario-sel');
  const scenId = sel.value;
  if (!scenId) return;

  const scen = m.scenarios[scenId];
  if (!scen) return;

  if (!confirm(`Load "${scen.name}"?\n\nCurrent token positions will be replaced.`)) { sel.value = ''; return; }

  m.tokens = JSON.parse(JSON.stringify(scen.tokens));
  if (scen.monsters) m.monsters = JSON.parse(JSON.stringify(scen.monsters));
  if (scen.fog) m.fog = JSON.parse(JSON.stringify(scen.fog));
  if (scen.combat) m.combat = JSON.parse(JSON.stringify(scen.combat));
  // Restore character HP from snapshot
  if (scen.charHp) {
    for (const hp of scen.charHp) {
      const c = characters.find(x => x.id === hp.id);
      if (c) { c.currentHp = hp.currentHp; c.maxHp = hp.maxHp; DB.save('characters', c, characters); }
    }
  }
  m.updatedAt = Date.now();
  await saveCurrentMap();
  renderTokensOnMap();
  if (typeof renderMonsterSidebar === 'function') renderMonsterSidebar();
  if (typeof initFogSystem === 'function') initFogSystem(m);
  if (typeof renderInitiativeBar === 'function') renderInitiativeBar();
  sel.value = '';
}

async function deleteScenario() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  const sel = document.getElementById('scenario-sel');
  const scenId = sel.value;
  if (!scenId) return;
  const scen = m.scenarios[scenId];
  if (!scen || !confirm(`Delete scenario "${scen.name}"?`)) return;
  delete m.scenarios[scenId];
  m.updatedAt = Date.now();
  await saveCurrentMap();
  renderScenarioSelect();
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
let _notesTimeout = null;
function switchNotesTab(tab, btn) {
  document.querySelectorAll('.notes-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.notes-tab').forEach(el => el.classList.remove('active'));
  const panel = document.getElementById('notes-tab-' + tab);
  if (panel) panel.style.display = 'flex';
  if (btn) btn.classList.add('active');
}

function saveMapNotes() {
  clearTimeout(_notesTimeout);
  _notesTimeout = setTimeout(() => {
    const m = maps.find(x => x.id === currentMapId);
    if (!m) return;
    m.notes = document.getElementById('map-notes')?.value || '';
    m.updatedAt = Date.now();
    saveCurrentMap();
  }, 800);
}

async function saveCurrentMap() {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  await DB.save('maps', m, maps);
}

// Mouse-wheel over a token to resize it. Works for both characters and monsters.
// Size is clamped to 0.5x–3x. Save is debounced so rapid wheeling doesn't spam.
let _tokenResizeTimer = null;
function handleTokenWheel(e, tokenId) {
  e.preventDefault();
  e.stopPropagation();
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  const tok = (m.tokens || []).find(t => t.id === tokenId);
  if (!tok) return;
  // Wheel up = bigger, wheel down = smaller. Finer step when shift held.
  const step = e.shiftKey ? 0.05 : 0.1;
  const delta = e.deltaY < 0 ? step : -step;
  const next = Math.max(0.5, Math.min(3, (tok.size || 1) + delta));
  if (next === tok.size) return;
  tok.size = next;
  m.updatedAt = Date.now();
  renderTokensOnMap();
  clearTimeout(_tokenResizeTimer);
  _tokenResizeTimer = setTimeout(() => saveCurrentMap(), 400);
}

function flashBtn(id, text, resetTo) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const orig = resetTo || btn.textContent;
  btn.textContent = text;
  setTimeout(() => btn.textContent = orig, 1800);
}

function toggleSnapshotPanel() {
  const panel = document.getElementById('snapshot-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── DM PING ────────────────────────────────────────────────
let _mapPingMode = false;
function toggleMapPingMode() {
  _mapPingMode = !_mapPingMode;
  const btn = document.getElementById('map-ping-btn');
  if (btn) {
    btn.textContent = _mapPingMode ? '📍 Click map…' : '📍 Ping';
    btn.style.borderColor = _mapPingMode ? '#c8b070' : '';
  }
  const stage = document.getElementById('map-stage');
  if (stage) stage.style.cursor = _mapPingMode ? 'crosshair' : '';
}

function fireMapPing(xPct, yPct) {
  const m = maps.find(x => x.id === currentMapId);
  if (!m) return;
  m.activePing = { x: xPct, y: yPct, ts: Date.now() };
  m.updatedAt = Date.now();
  saveCurrentMap();
  // Auto-clear after 3.5s so other DMs/player views revert and a follow-up ping with same coords still triggers
  setTimeout(() => {
    if (m.activePing && m.activePing.ts && Date.now() - m.activePing.ts >= 3000) {
      m.activePing = null;
      saveCurrentMap();
    }
  }, 3500);
}
