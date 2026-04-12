/* ============================================================
   TOME OF HEROES — Fog of War System
   Handles: hex grid, zone management, brush tool,
   DM/player view toggle, fog canvas rendering
   ============================================================ */

// ── STATE ────────────────────────────────────────────────────
let _fogMap = null;          // reference to current map object
let _fogCanvas = null;       // the fog <canvas> element
let _fogCtx = null;          // canvas 2D context
let _fogCache = null;        // offscreen canvas for brush perf
let _fogCacheCtx = null;
let _fogTool = 'none';       // 'none' | 'zone' | 'brush'
let _brushMode = 'reveal';   // 'reveal' | 'fog'
let _brushSize = 20;         // brush radius in display px
let _brushCursorPos = null;  // {x, y} in canvas pixels for brush cursor
let _brushStrokeInProgress = null;
let _zoneSelection = new Set(); // hex keys being selected for zone creation
let _resizeObs = null;

const SQRT3 = Math.sqrt(3);

// ── HEX MATH ─────────────────────────────────────────────────
// Flat-top hexagons with offset coordinates (odd-column shift)

function hexToPixel(col, row, r) {
  const x = col * 1.5 * r + r;
  const y = (row + (col % 2 ? 0.5 : 0)) * SQRT3 * r + (SQRT3 * r / 2);
  return { x, y };
}

function pixelToHex(px, py, r) {
  // Approximate, then check neighbors for nearest center
  const col = Math.round((px - r) / (1.5 * r));
  const row = Math.round((py - SQRT3 * r / 2) / (SQRT3 * r) - (col % 2 ? 0.5 : 0));

  // Check this hex and its neighbors, return the closest
  let best = null, bestDist = Infinity;
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const c = col + dc, rr = row + dr;
      if (c < 0 || rr < 0) continue;
      const center = hexToPixel(c, rr, r);
      const d = (center.x - px) ** 2 + (center.y - py) ** 2;
      if (d < bestDist) { bestDist = d; best = [c, rr]; }
    }
  }
  return best;
}

function hexKey(col, row) { return col + ',' + row; }
function parseHexKey(k) { const p = k.split(','); return [+p[0], +p[1]]; }

function hexPolygonPath(cx, cy, r) {
  const path = new Path2D();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i);
    const hx = cx + r * Math.cos(angle);
    const hy = cy + r * Math.sin(angle);
    if (i === 0) path.moveTo(hx, hy); else path.lineTo(hx, hy);
  }
  path.closePath();
  return path;
}

function getGridBounds(canvasW, canvasH, r) {
  const cols = Math.ceil(canvasW / (1.5 * r)) + 1;
  const rows = Math.ceil(canvasH / (SQRT3 * r)) + 1;
  return { cols, rows };
}

// ── INITIALIZATION ───────────────────────────────────────────

function initFogSystem(mapObj) {
  _fogMap = mapObj;

  // Ensure fog data exists on map object
  if (!_fogMap.fog) {
    _fogMap.fog = {
      enabled: false,
      hexSize: 30,
      viewMode: 'dm',
      zones: {},
      revealedHexes: [],
      brushStrokes: []
    };
  }

  _fogCanvas = document.getElementById('fog-canvas');
  if (!_fogCanvas) return;
  _fogCtx = _fogCanvas.getContext('2d');

  // Offscreen cache for brush performance
  _fogCache = document.createElement('canvas');
  _fogCacheCtx = _fogCache.getContext('2d');

  _fogTool = 'none';
  _brushStrokeInProgress = null;
  _zoneSelection.clear();

  // Observe map stage for resize
  const img = document.getElementById('map-img');
  if (_resizeObs) _resizeObs.disconnect();
  _resizeObs = new ResizeObserver(() => {
    resizeFogCanvas();
    renderFog();
  });
  _resizeObs.observe(img);

  // Initial size + render
  resizeFogCanvas();
  updateFogUI();
  renderFog();

  // Canvas event listeners
  _fogCanvas.addEventListener('pointerdown', fogPointerDown);
  _fogCanvas.addEventListener('pointermove', fogPointerMove);
  _fogCanvas.addEventListener('pointerup', fogPointerUp);

  // Brush cursor tracking (works even when pointer-events: none via the stage)
  const stage = document.getElementById('map-stage');
  if (stage) {
    stage.addEventListener('pointermove', fogBrushCursorTrack);
    stage.addEventListener('pointerleave', () => { _brushCursorPos = null; renderFog(); });
  }
}

function fogBrushCursorTrack(e) {
  if (_fogTool !== 'brush' || !_fogCanvas) return;
  const rect = _fogCanvas.getBoundingClientRect();
  _brushCursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  renderFog();
}

function teardownFogSystem() {
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
  const stage = document.getElementById('map-stage');
  if (stage) stage.removeEventListener('pointermove', fogBrushCursorTrack);
  if (_fogCanvas) {
    _fogCanvas.removeEventListener('pointerdown', fogPointerDown);
    _fogCanvas.removeEventListener('pointermove', fogPointerMove);
    _fogCanvas.removeEventListener('pointerup', fogPointerUp);
  }
  _fogMap = null;
  _fogTool = 'none';
  _brushCursorPos = null;
  _zoneSelection.clear();
}

function resizeFogCanvas() {
  if (!_fogCanvas) return;
  const img = document.getElementById('map-img');
  if (!img || !img.clientWidth) return;
  _fogCanvas.width = img.clientWidth;
  _fogCanvas.height = img.clientHeight;
  _fogCache.width = img.clientWidth;
  _fogCache.height = img.clientHeight;
}

// ── FOG RENDERING ────────────────────────────────────────────

function renderFog() {
  if (!_fogCtx || !_fogMap) return;
  const fog = _fogMap.fog;
  if (!fog) return;

  const w = _fogCanvas.width, h = _fogCanvas.height;
  if (!w || !h) return;

  const ctx = _fogCtx;
  const isDm = fog.viewMode === 'dm';
  const isEnabled = fog.enabled;

  // Clear
  ctx.clearRect(0, 0, w, h);

  if (!isEnabled) {
    _fogCanvas.style.display = 'none';
    return;
  }
  _fogCanvas.style.display = 'block';

  const r = fog.hexSize || 30;

  // 1. Fill with fog
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = isDm ? 'rgba(15, 18, 25, 0.45)' : 'rgba(15, 18, 25, 1.0)';
  ctx.fillRect(0, 0, w, h);

  // 2. Build revealed set
  const revealedSet = new Set();
  for (const hex of (fog.revealedHexes || [])) {
    revealedSet.add(hexKey(hex[0], hex[1]));
  }
  for (const zone of Object.values(fog.zones || {})) {
    if (zone.revealed) {
      for (const hex of zone.hexes) {
        revealedSet.add(hexKey(hex[0], hex[1]));
      }
    }
  }

  // 3. Punch out revealed hexes
  if (revealedSet.size > 0) {
    ctx.globalCompositeOperation = 'destination-out';
    const revealPath = new Path2D();
    for (const key of revealedSet) {
      const [col, row] = parseHexKey(key);
      const center = hexToPixel(col, row, r);
      // Add hex polygon to batch path
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i);
        const hx = center.x + r * Math.cos(angle);
        const hy = center.y + r * Math.sin(angle);
        if (i === 0) revealPath.moveTo(hx, hy); else revealPath.lineTo(hx, hy);
      }
      revealPath.closePath();
    }
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill(revealPath);
  }

  // 4. Brush strokes — reveal
  for (const stroke of (fog.brushStrokes || [])) {
    if (stroke.mode === 'reveal' && stroke.points.length > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      drawBrushStroke(ctx, stroke, w, h);
    }
  }

  // 5. Brush strokes — re-fog
  for (const stroke of (fog.brushStrokes || [])) {
    if (stroke.mode === 'fog' && stroke.points.length > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = isDm ? 'rgba(15, 18, 25, 0.45)' : 'rgba(15, 18, 25, 1.0)';
      drawBrushStroke(ctx, stroke, w, h);
    }
  }

  // 6. In-progress brush stroke
  if (_brushStrokeInProgress && _brushStrokeInProgress.points.length > 0) {
    if (_brushStrokeInProgress.mode === 'reveal') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = isDm ? 'rgba(15, 18, 25, 0.45)' : 'rgba(15, 18, 25, 1.0)';
    }
    drawBrushStroke(ctx, _brushStrokeInProgress, w, h);
  }

  // 7. DM overlays: hex grid lines
  ctx.globalCompositeOperation = 'source-over';
  if (isDm) {
    drawHexGrid(ctx, w, h, r);
    drawZoneOutlines(ctx, w, h, r);
    drawZoneSelection(ctx, w, h, r);
  }

  // 8. Brush cursor indicator
  if (_fogTool === 'brush' && _brushCursorPos && isDm) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(_brushCursorPos.x, _brushCursorPos.y, _brushSize, 0, Math.PI * 2);
    ctx.strokeStyle = _brushMode === 'reveal' ? 'rgba(200, 164, 90, 0.8)' : 'rgba(200, 80, 80, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Inner fill preview
    ctx.fillStyle = _brushMode === 'reveal' ? 'rgba(200, 164, 90, 0.1)' : 'rgba(200, 80, 80, 0.1)';
    ctx.fill();
  }
}

function drawBrushStroke(ctx, stroke, canvasW, canvasH) {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.lineWidth = stroke.radius * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,1)';

  // Convert percentage to pixel
  const x0 = (pts[0].x / 100) * canvasW;
  const y0 = (pts[0].y / 100) * canvasH;
  ctx.moveTo(x0, y0);

  if (pts.length === 1) {
    // Single dot
    ctx.arc(x0, y0, stroke.radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  for (let i = 1; i < pts.length; i++) {
    const x = (pts[i].x / 100) * canvasW;
    const y = (pts[i].y / 100) * canvasH;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawHexGrid(ctx, w, h, r) {
  const { cols, rows } = getGridBounds(w, h, r);
  ctx.strokeStyle = 'rgba(200, 164, 90, 0.10)';
  ctx.lineWidth = 0.5;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const center = hexToPixel(col, row, r);
      if (center.x - r > w || center.y - r > h) continue;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i);
        const hx = center.x + r * Math.cos(angle);
        const hy = center.y + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawZoneOutlines(ctx, w, h, r) {
  if (!_fogMap?.fog?.zones) return;
  for (const zone of Object.values(_fogMap.fog.zones)) {
    const color = zone.revealed ? 'rgba(200, 164, 90, 0.35)' : 'rgba(200, 80, 80, 0.35)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (const hex of zone.hexes) {
      const center = hexToPixel(hex[0], hex[1], r);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i);
        ctx.lineTo(center.x + r * Math.cos(angle), center.y + r * Math.sin(angle));
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawZoneSelection(ctx, w, h, r) {
  if (_zoneSelection.size === 0) return;
  ctx.fillStyle = 'rgba(200, 164, 90, 0.2)';
  ctx.strokeStyle = 'rgba(200, 164, 90, 0.5)';
  ctx.lineWidth = 1.5;
  for (const key of _zoneSelection) {
    const [col, row] = parseHexKey(key);
    const center = hexToPixel(col, row, r);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i);
      ctx.lineTo(center.x + r * Math.cos(angle), center.y + r * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// ── POINTER EVENTS ───────────────────────────────────────────

function fogPointerDown(e) {
  if (!_fogMap?.fog?.enabled) return;
  const fog = _fogMap.fog;
  if (fog.viewMode !== 'dm') return;

  const r = fog.hexSize || 30;
  const rect = _fogCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  if (_fogTool === 'zone') {
    // Toggle hex in selection
    const hex = pixelToHex(px, py, r);
    if (!hex) return;
    const key = hexKey(hex[0], hex[1]);
    if (e.shiftKey || _zoneSelection.size > 0) {
      // Multi-select mode
      if (_zoneSelection.has(key)) _zoneSelection.delete(key);
      else _zoneSelection.add(key);
    } else {
      // Single click — toggle individual hex reveal
      const idx = (fog.revealedHexes || []).findIndex(h => h[0] === hex[0] && h[1] === hex[1]);
      if (idx >= 0) {
        fog.revealedHexes.splice(idx, 1);
      } else {
        fog.revealedHexes = fog.revealedHexes || [];
        fog.revealedHexes.push(hex);
      }
      _fogMap.updatedAt = Date.now();
      saveCurrentMap();
    }
    renderFog();
  } else if (_fogTool === 'brush') {
    _fogCanvas.setPointerCapture(e.pointerId);
    const xPct = (px / _fogCanvas.width) * 100;
    const yPct = (py / _fogCanvas.height) * 100;
    _brushStrokeInProgress = {
      points: [{ x: xPct, y: yPct }],
      radius: _brushSize,
      mode: _brushMode
    };
    renderFog();
  }
}

function fogPointerMove(e) {
  if (!_brushStrokeInProgress) return;
  const rect = _fogCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const xPct = (px / _fogCanvas.width) * 100;
  const yPct = (py / _fogCanvas.height) * 100;
  _brushStrokeInProgress.points.push({ x: xPct, y: yPct });
  renderFog();
}

function fogPointerUp(e) {
  if (!_brushStrokeInProgress) return;
  const fog = _fogMap.fog;
  fog.brushStrokes = fog.brushStrokes || [];
  fog.brushStrokes.push(_brushStrokeInProgress);
  _brushStrokeInProgress = null;
  _fogMap.updatedAt = Date.now();
  saveCurrentMap();
  renderFog();
}

// ── TOOL CONTROL ─────────────────────────────────────────────

function setFogTool(tool) {
  _fogTool = tool;
  if (tool !== 'zone') _zoneSelection.clear();
  if (tool !== 'brush') _brushStrokeInProgress = null;

  // Pointer events: only capture when a tool is active
  if (_fogCanvas) {
    _fogCanvas.style.pointerEvents = (tool !== 'none') ? 'auto' : 'none';
  }

  // Cursor
  const stage = document.getElementById('map-stage');
  if (stage) {
    if (tool === 'zone') stage.style.cursor = 'crosshair';
    else if (tool === 'brush') stage.style.cursor = 'none';
    else stage.style.cursor = '';
  }

  updateFogToolbarState();
  renderFog();
}

function setFogViewMode(mode) {
  if (!_fogMap?.fog) return;
  _fogMap.fog.viewMode = mode;
  _fogMap.updatedAt = Date.now();
  updateFogUI();
  renderFog();
  // Re-render tokens for visibility
  if (typeof renderTokensOnMap === 'function') renderTokensOnMap();
  saveCurrentMap();
}

function toggleFogEnabled() {
  if (!_fogMap?.fog) return;
  _fogMap.fog.enabled = !_fogMap.fog.enabled;
  _fogMap.updatedAt = Date.now();
  if (!_fogMap.fog.enabled) setFogTool('none');
  updateFogUI();
  renderFog();
  if (typeof renderTokensOnMap === 'function') renderTokensOnMap();
  saveCurrentMap();
}

function setBrushMode(mode) {
  _brushMode = mode;
  updateFogToolbarState();
}

function setBrushSize(size) {
  _brushSize = Math.max(5, Math.min(80, size));
  const slider = document.getElementById('fog-brush-size');
  if (slider) slider.value = _brushSize;
}

function setHexSize(size) {
  if (!_fogMap?.fog) return;
  const newSize = Math.max(10, Math.min(80, size));
  _fogMap.fog.hexSize = newSize;
  _fogMap.updatedAt = Date.now();
  renderFog();
  saveCurrentMap();
}

// ── ZONE MANAGEMENT ──────────────────────────────────────────

function createZoneFromSelection() {
  if (_zoneSelection.size === 0) return;
  const name = prompt('Zone name:', 'Room ' + (Object.keys(_fogMap.fog.zones || {}).length + 1));
  if (!name?.trim()) return;

  const fog = _fogMap.fog;
  fog.zones = fog.zones || {};
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const hexes = [];
  for (const key of _zoneSelection) {
    hexes.push(parseHexKey(key));
  }
  fog.zones[id] = { id, name: name.trim(), revealed: false, hexes };
  _zoneSelection.clear();
  _fogMap.updatedAt = Date.now();
  saveCurrentMap();
  renderFogZonePanel();
  renderFog();
}

function toggleZoneRevealed(zoneId) {
  const zone = _fogMap?.fog?.zones?.[zoneId];
  if (!zone) return;
  zone.revealed = !zone.revealed;
  _fogMap.updatedAt = Date.now();
  saveCurrentMap();
  renderFogZonePanel();
  renderFog();
  if (typeof renderTokensOnMap === 'function') renderTokensOnMap();
}

function deleteZone(zoneId) {
  if (!_fogMap?.fog?.zones?.[zoneId]) return;
  const zone = _fogMap.fog.zones[zoneId];
  if (!confirm(`Delete zone "${zone.name}"?`)) return;
  delete _fogMap.fog.zones[zoneId];
  _fogMap.updatedAt = Date.now();
  saveCurrentMap();
  renderFogZonePanel();
  renderFog();
}

function clearAllBrushStrokes() {
  if (!_fogMap?.fog) return;
  if (!confirm('Clear all brush strokes?')) return;
  _fogMap.fog.brushStrokes = [];
  _fogMap.updatedAt = Date.now();
  saveCurrentMap();
  renderFog();
}

// ── TOKEN VISIBILITY ─────────────────────────────────────────

function isPositionRevealed(xPct, yPct) {
  if (!_fogMap?.fog?.enabled) return true;
  const fog = _fogMap.fog;
  const r = fog.hexSize || 30;
  const w = _fogCanvas?.width || 1;
  const h = _fogCanvas?.height || 1;

  // Convert percentage to pixel
  const px = (xPct / 100) * w;
  const py = (yPct / 100) * h;

  // Check hex-based reveals
  const hex = pixelToHex(px, py, r);
  if (hex) {
    const key = hexKey(hex[0], hex[1]);
    // Check individual revealed hexes
    if ((fog.revealedHexes || []).some(h => h[0] === hex[0] && h[1] === hex[1])) return true;
    // Check zone reveals
    for (const zone of Object.values(fog.zones || {})) {
      if (zone.revealed && zone.hexes.some(h => h[0] === hex[0] && h[1] === hex[1])) return true;
    }
  }

  // Check brush strokes — sample the fog canvas pixel
  // If we've rendered the fog, we can read the pixel alpha
  if (_fogCtx && w > 0 && h > 0) {
    try {
      const pixel = _fogCtx.getImageData(Math.round(px), Math.round(py), 1, 1).data;
      // If alpha is very low, position is revealed
      if (pixel[3] < 30) return true;
    } catch (e) { /* canvas tainted or not ready */ }
  }

  return false;
}

// ── UI UPDATES ───────────────────────────────────────────────

function updateFogUI() {
  const fog = _fogMap?.fog;
  if (!fog) return;

  const isDm = fog.viewMode === 'dm';
  const isEnabled = fog.enabled;

  // View mode button
  const viewBtn = document.getElementById('fog-view-btn');
  if (viewBtn) {
    viewBtn.textContent = isDm ? '⚔ DM View' : '👁 Player View';
    viewBtn.className = isDm ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
  }

  // Fog toggle
  const fogBtn = document.getElementById('fog-toggle-btn');
  if (fogBtn) {
    fogBtn.textContent = isEnabled ? '🌫 Fog: ON' : '🌫 Fog: OFF';
    fogBtn.className = isEnabled ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
  }

  // DM-only tools visibility
  const dmTools = document.getElementById('fog-dm-tools');
  if (dmTools) dmTools.style.display = (isDm && isEnabled) ? 'flex' : 'none';

  // Hex size display
  const hexSizeVal = document.getElementById('fog-hex-size-val');
  if (hexSizeVal) hexSizeVal.textContent = fog.hexSize || 30;

  updateFogToolbarState();
  renderFogZonePanel();
}

function updateFogToolbarState() {
  // Tool buttons active state
  const zoneBtn = document.getElementById('fog-zone-btn');
  const brushBtn = document.getElementById('fog-brush-btn');
  if (zoneBtn) zoneBtn.className = _fogTool === 'zone' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
  if (brushBtn) brushBtn.className = _fogTool === 'brush' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';

  // Brush controls visibility
  const brushControls = document.getElementById('fog-brush-controls');
  if (brushControls) brushControls.style.display = _fogTool === 'brush' ? 'flex' : 'none';

  // Zone controls visibility
  const zoneControls = document.getElementById('fog-zone-controls');
  if (zoneControls) zoneControls.style.display = _fogTool === 'zone' ? 'flex' : 'none';

  // Brush mode buttons
  const revealBtn = document.getElementById('fog-brush-reveal');
  const fogBrushBtn = document.getElementById('fog-brush-fog');
  if (revealBtn) revealBtn.className = _brushMode === 'reveal' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
  if (fogBrushBtn) fogBrushBtn.className = _brushMode === 'fog' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';

  // Zone selection count
  const selCount = document.getElementById('fog-zone-sel-count');
  if (selCount) selCount.textContent = _zoneSelection.size ? `${_zoneSelection.size} hexes selected` : 'Click hexes to select, shift+click for multi';

  // Create zone button enabled state
  const createBtn = document.getElementById('fog-zone-create-btn');
  if (createBtn) createBtn.disabled = _zoneSelection.size === 0;
}

function renderFogZonePanel() {
  const el = document.getElementById('fog-zone-list');
  if (!el) return;
  const zones = Object.values(_fogMap?.fog?.zones || {});
  if (!zones.length) {
    el.innerHTML = '<div style="font-size:.7rem;color:var(--text4);padding:.25rem 0;">No zones yet</div>';
    return;
  }
  el.innerHTML = zones.map(z => `
    <div class="fog-zone-item" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.75rem;">
      <button class="btn btn-sm" style="padding:0 4px;font-size:.7rem;min-width:0;background:none;border:none;cursor:pointer;color:var(--text2);"
        onclick="toggleZoneRevealed('${z.id}')" title="${z.revealed ? 'Hide' : 'Reveal'}">${z.revealed ? '👁' : '🚫'}</button>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${z.revealed ? 'var(--glow)' : 'var(--text3)'};">${z.name}</span>
      <span style="font-size:.6rem;color:var(--text4);">${z.hexes.length}h</span>
      <button class="btn btn-sm" style="padding:0 4px;font-size:.65rem;min-width:0;background:none;border:none;cursor:pointer;color:var(--red);"
        onclick="deleteZone('${z.id}')">✕</button>
    </div>
  `).join('');
}

function toggleFogZonePanel() {
  const panel = document.getElementById('fog-zone-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}
