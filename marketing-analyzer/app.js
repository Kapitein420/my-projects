/* ============================================================
   DILS Marketing Analyzer — dashboard logic
   Reads from Supabase via shared/db.js (jsonb pattern, like dnd-tracker).

   Tables consumed:
     buildings  — { id, data: { name, url, address, postcode } }
     scores     — { id, data: { buildingId, ruleTotal, aiTotal, composite,
                                 dimensions: { ... }, recommendations: [...],
                                 scoredAt: ISO } }
   ============================================================ */

const STATE = {
  buildings: [],
  scores: [],          // every score row
  latestByBuilding: {}, // buildingId -> latest score row
  sortBy: 'composite',
  selectedId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ── Boot ────────────────────────────────────────────────── */
async function boot() {
  bindUi();
  await reload();
}

function bindUi() {
  $('#btn-refresh').addEventListener('click', reload);
  $('#btn-load-samples').addEventListener('click', loadSamples);
  $('#sort-by').addEventListener('change', (e) => { STATE.sortBy = e.target.value; renderRankings(); });
  $('#d-close').addEventListener('click', closeDrawer);
  $('#drawer-bg').addEventListener('click', closeDrawer);
  $('#add-form').addEventListener('submit', onAddBuilding);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

async function reload() {
  try {
    const [buildings, scores] = await Promise.all([
      DB.load('buildings'),
      DB.load('scores'),
    ]);
    STATE.buildings = buildings || [];
    STATE.scores    = scores || [];
    STATE.latestByBuilding = computeLatestByBuilding(STATE.scores);
    renderKpis();
    renderRankings();
  } catch (e) {
    toast('Could not load — did you run schema.sql in Supabase?', true);
    console.error(e);
  }
}

function computeLatestByBuilding(scores) {
  const map = {};
  for (const s of scores) {
    if (!s || !s.buildingId) continue;
    const prev = map[s.buildingId];
    if (!prev || new Date(s.scoredAt) > new Date(prev.scoredAt)) map[s.buildingId] = s;
  }
  return map;
}

/* ── KPI row ─────────────────────────────────────────────── */
function renderKpis() {
  const tracked = STATE.buildings.length;
  const analyzed = Object.keys(STATE.latestByBuilding).length;
  const composites = Object.values(STATE.latestByBuilding).map((s) => s.composite).filter((n) => typeof n === 'number');
  const avg = composites.length ? composites.reduce((a, b) => a + b, 0) / composites.length : null;
  const top = composites.length ? Math.max(...composites) : null;
  const topRow = top !== null ? Object.values(STATE.latestByBuilding).find((s) => s.composite === top) : null;
  const topBuilding = topRow ? STATE.buildings.find((b) => b.id === topRow.buildingId) : null;

  $('#kpi-tracked').textContent = tracked.toString();
  $('#kpi-analyzed').textContent = analyzed.toString();
  $('#kpi-analyzed-sub').textContent = tracked ? `${Math.round((analyzed / tracked) * 100)}% of tracked` : '';
  $('#kpi-avg').textContent = avg !== null ? Math.round(avg) : '—';
  $('#kpi-top').textContent = top !== null ? Math.round(top) : '—';
  $('#kpi-top-sub').textContent = topBuilding ? topBuilding.name : '';
}

/* ── Rankings table ──────────────────────────────────────── */
function renderRankings() {
  const body = $('#rank-body');

  if (STATE.buildings.length === 0) {
    body.innerHTML = `
      <div class="empty">
        <p>No buildings yet. Click <strong>Load sample buildings</strong> to seed Zuidoost anchors,
        or add one via the form below.</p>
      </div>`;
    return;
  }

  const rows = STATE.buildings.map((b) => {
    const latest = STATE.latestByBuilding[b.id];
    return {
      id: b.id,
      name: b.name,
      url: b.url,
      address: b.address,
      ruleTotal: latest?.ruleTotal ?? null,
      aiTotal: latest?.aiTotal ?? null,
      composite: latest?.composite ?? null,
      scoredAt: latest?.scoredAt ?? null,
    };
  });

  rows.sort(sorter(STATE.sortBy));

  const html = `
    <table class="rank-table">
      <thead>
        <tr>
          <th class="col-rank">#</th>
          <th>Building</th>
          <th class="col-score">Rule</th>
          <th class="col-score">AI</th>
          <th class="col-score">Composite</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr data-id="${escAttr(r.id)}">
            <td class="col-rank">${r.composite !== null ? (i + 1) : '—'}</td>
            <td class="col-name">
              ${escHtml(r.name)}
              <span class="url">${escHtml(r.url || '(no url)')}</span>
            </td>
            <td class="col-score">${pill(r.ruleTotal)}</td>
            <td class="col-score">${pill(r.aiTotal)}</td>
            <td class="col-score">${pill(r.composite, true)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  body.innerHTML = html;
  body.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => openDrawer(tr.dataset.id));
  });
}

function sorter(by) {
  return (a, b) => {
    if (by === 'name') return a.name.localeCompare(b.name);
    if (by === 'recent') {
      const ta = a.scoredAt ? new Date(a.scoredAt).getTime() : 0;
      const tb = b.scoredAt ? new Date(b.scoredAt).getTime() : 0;
      return tb - ta;
    }
    const key = by === 'rule' ? 'ruleTotal' : by === 'ai' ? 'aiTotal' : 'composite';
    const av = a[key]; const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  };
}

function pill(n, big = false) {
  if (n === null || n === undefined) return `<span class="score-pill s-na">—</span>`;
  const v = Math.round(n);
  let cls = 's-0';
  if (v >= 90) cls = 's-90'; else if (v >= 75) cls = 's-75';
  else if (v >= 60) cls = 's-60'; else if (v >= 40) cls = 's-40';
  return `<span class="score-pill ${cls}" style="${big ? 'font-size:1.05rem;padding:.3rem .85rem;' : ''}">${v}</span>`;
}

/* ── Drawer ──────────────────────────────────────────────── */
function openDrawer(buildingId) {
  STATE.selectedId = buildingId;
  const b = STATE.buildings.find((x) => x.id === buildingId);
  const s = STATE.latestByBuilding[buildingId];
  if (!b) return;

  $('#d-name').textContent = b.name;
  $('#d-meta').innerHTML = [
    b.address ? escHtml(b.address) : null,
    b.url ? `<a href="${escAttr(b.url)}" target="_blank" rel="noopener">${escHtml(b.url)} ↗</a>` : null,
    s?.scoredAt ? `<span class="scored-at">analyzed ${formatDate(s.scoredAt)}</span>` : null,
  ].filter(Boolean).join(' · ');

  const body = $('#d-body');
  if (!s) {
    body.innerHTML = `
      <div class="empty">
        <p>This building has not been analyzed yet.</p>
        <p>Run <code>node analyze.mjs --building=${escHtml(buildingId)}</code> from this folder
        (needs <code>ANTHROPIC_API_KEY</code> in your env), or
        <code>node analyze.mjs</code> to score everything pending.</p>
      </div>`;
  } else {
    body.innerHTML = `
      <div class="score-hero">
        <div class="b"><div class="b-label">Rule</div><div class="b-value">${Math.round(s.ruleTotal ?? 0)}</div></div>
        <div class="b"><div class="b-label">AI</div><div class="b-value">${Math.round(s.aiTotal ?? 0)}</div></div>
        <div class="b composite"><div class="b-label">Composite</div><div class="b-value">${Math.round(s.composite ?? 0)}</div></div>
      </div>

      <div class="section-title">AI breakdown</div>
      <div class="dim-list">
        ${renderDimensions(s.dimensions || {})}
      </div>

      ${s.recommendations && s.recommendations.length ? `
        <div class="section-title">Top recommendations</div>
        <div class="recs">
          <ol>${s.recommendations.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ol>
        </div>` : ''}

      <div class="section-title">Notes</div>
      <p style="font-size:.85rem;color:var(--text3);font-family:var(--font-body)">
        Composite = 0.4 × rule + 0.6 × AI. Rule covers technical/SEO; AI covers visual hierarchy, copy, brand fit.
        Re-run <code>node analyze.mjs --building=${escHtml(buildingId)}</code> to refresh.
      </p>`;
  }

  $('#drawer-bg').classList.add('open');
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
}

function renderDimensions(dims) {
  const entries = Object.entries(dims);
  if (entries.length === 0) return `<div class="empty">No AI dimensions stored.</div>`;
  return entries.map(([name, info]) => {
    const score = typeof info === 'number' ? info : (info?.score ?? 0);
    const just  = typeof info === 'object' ? (info.justification ?? '') : '';
    const pct   = Math.max(0, Math.min(100, (score / 10) * 100));
    const color = score >= 8 ? '#5a8a3a' : score >= 6 ? '#a08a30' : score >= 4 ? '#c87838' : '#a83a30';
    return `
      <div class="dim">
        <div class="dim-name">${escHtml(name.replace(/_/g, ' '))}</div>
        <div class="dim-score">${score}/10</div>
        <div class="dim-bar"><div class="dim-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        ${just ? `<div class="dim-justification">${escHtml(just)}</div>` : ''}
      </div>`;
  }).join('');
}

function closeDrawer() {
  $('#drawer-bg').classList.remove('open');
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  STATE.selectedId = null;
}

/* ── Add building ────────────────────────────────────────── */
async function onAddBuilding(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = (fd.get('name') || '').toString().trim();
  const url = (fd.get('url') || '').toString().trim();
  const address = (fd.get('address') || '').toString().trim();
  if (!name || !url) { toast('Name and URL required', true); return; }

  const record = {
    id: slugify(name),
    name, url, address,
    postcode: '',
    addedAt: new Date().toISOString(),
  };

  try {
    await DB.save('buildings', record);
    toast(`Added ${name}`);
    e.target.reset();
    await reload();
  } catch (err) {
    console.error(err);
    toast('Save failed: ' + err.message, true);
  }
}

/* ── Sample seeder ───────────────────────────────────────── */
async function loadSamples() {
  if (!window.ZUIDOOST_SEEDS) { toast('seeds.js not loaded', true); return; }
  const existing = new Set(STATE.buildings.map((b) => b.id));
  let added = 0;
  for (const s of window.ZUIDOOST_SEEDS) {
    const id = slugify(s.name);
    if (existing.has(id)) continue;
    const record = { id, name: s.name, url: s.url, address: s.address, postcode: s.postcode, addedAt: new Date().toISOString() };
    try { await DB.save('buildings', record); added++; } catch (err) { console.error(err); }
  }
  toast(added > 0 ? `Added ${added} sample building${added === 1 ? '' : 's'}` : 'All samples already loaded');
  await reload();
}

/* ── Tiny utils ──────────────────────────────────────────── */
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) { return escHtml(s); }
function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'b-' + Date.now();
}
function formatDate(iso) {
  try { return new Date(iso).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

let _toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

/* go */
boot();
