/* ============================================================
   DILS Marketing Analyzer — dashboard logic

   Reads from Supabase via shared/db.js (jsonb pattern).

   Tables consumed:
     buildings  — { id, data: { name, url, address, postcode } }
     scores     — { id, data: { buildingId, ruleTotal, aiTotal, composite,
                                 rule: {...}, dimensions: { name: { score, justification } },
                                 recommendations: [...], scoredAt: ISO } }
   ============================================================ */

const DIMENSION_META = {
  copy_clarity_nl:       { label: 'Dutch copy',          desc: 'Dutch copy is concise, tenant-focused, free of jargon — specific, not generic.' },
  copy_clarity_en:       { label: 'English copy',        desc: 'English copy meets the same bar. Graceful absence is fine if the NL page is strong.' },
  brand_distinctiveness: { label: 'Brand distinctiveness',desc: 'Would a tenant recognise this building from a competitor? Visual identity, naming, voice.' },
  target_tenant_fit:     { label: 'Target-tenant fit',   desc: 'Does the site speak to the right tenant profile — corporate HQ vs creative studio vs flex?' },
  amenity_messaging:     { label: 'Amenity messaging',   desc: 'Gym, F&B, bike, EV, transit, parking — clearly surfaced (not buried in a datasheet).' },
  trust_signals:         { label: 'Trust signals',       desc: 'Tenant logos, awards, certifications (BREEAM, WELL), occupancy stats, named agent contact.' },
  cta_quality:           { label: 'Call-to-action',      desc: 'Primary CTA is visible, specific, low-friction — "Plan een bezichtiging", not just "Contact".' },
  structural_clarity:    { label: 'Structure & IA',      desc: 'Information architecture suggests a confident, planned site — sections, hierarchy, navigation.' },
  // Legacy (older prompt version with vision pass)
  visual_hierarchy:      { label: 'Visual hierarchy',    desc: 'Where the eye lands first. Scale, contrast, layout priority.' },
  typography_quality:    { label: 'Typography',          desc: 'Type pairing, hierarchy, line length, NL+EN readability.' },
  photography_quality:   { label: 'Photography',         desc: 'Hero imagery, interiors, drone. Stock-iness penalised.' },
};

const STATE = {
  buildings: [],
  scores: [],
  latestByBuilding: {},
  cohort: null,
  sortBy: 'composite',
  selectedId: null,          // for the single-building drawer
  compareSet: new Set(),     // up to 2 building IDs for side-by-side
  view: 'list',              // 'list' | 'compare'
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const MAX_COMPARE = 2;

/* ── Boot ────────────────────────────────────────────────── */
async function boot() {
  populateExplainer();
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
  $('#btn-compare').addEventListener('click', enterCompare);
  $('#btn-clear-compare').addEventListener('click', clearCompare);
  $('#btn-back-to-list').addEventListener('click', exitCompare);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); if (STATE.view === 'compare') exitCompare(); } });
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
    STATE.cohort = computeCohort(STATE.latestByBuilding);

    // Drop any compareSet IDs that no longer exist.
    STATE.compareSet = new Set([...STATE.compareSet].filter((id) => STATE.buildings.some((b) => b.id === id)));

    renderKpis();
    renderCompareBar();
    if (STATE.view === 'compare') renderCompareView();
    else renderRankings();
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

/* ── Cohort averages ─────────────────────────────────────── */
function computeCohort(latestBy) {
  const scored = Object.values(latestBy);
  const out = { n: scored.length, composite: null, rule: null, ai: null, dimensions: {} };
  if (scored.length === 0) return out;

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  out.composite = avg(scored.map((s) => s.composite).filter((n) => typeof n === 'number'));
  out.rule      = avg(scored.map((s) => s.ruleTotal).filter((n) => typeof n === 'number'));
  out.ai        = avg(scored.map((s) => s.aiTotal).filter((n) => typeof n === 'number'));

  const perDim = {};
  for (const s of scored) {
    for (const [name, val] of Object.entries(s.dimensions || {})) {
      const score = typeof val === 'number' ? val : val?.score;
      if (typeof score !== 'number') continue;
      (perDim[name] ||= []).push(score);
    }
  }
  for (const [name, arr] of Object.entries(perDim)) out.dimensions[name] = avg(arr);
  return out;
}

/* ── Explainer legend ────────────────────────────────────── */
function populateExplainer() {
  const target = $('#dim-legend');
  if (!target) return;
  const order = [
    'copy_clarity_nl', 'copy_clarity_en', 'brand_distinctiveness', 'target_tenant_fit',
    'amenity_messaging', 'trust_signals', 'cta_quality', 'structural_clarity',
  ];
  target.innerHTML = order.map((k) => {
    const m = DIMENSION_META[k];
    if (!m) return '';
    return `<div class="dle"><strong>${escHtml(m.label)}</strong>${escHtml(m.desc)}</div>`;
  }).join('');
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
  $('#rankings-section').hidden = false;
  $('#compare-view').hidden = true;

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

  const compareFull = STATE.compareSet.size >= MAX_COMPARE;
  const cohortAvg = STATE.cohort?.composite;

  const html = `
    <table class="rank-table">
      <thead>
        <tr>
          <th class="col-select" title="Select up to 2 buildings to compare"></th>
          <th class="col-rank">#</th>
          <th>Building</th>
          <th class="col-score">Rule</th>
          <th class="col-score">AI</th>
          <th class="col-score">Composite</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => {
          const checked = STATE.compareSet.has(r.id);
          const disabled = !checked && compareFull;
          return `
          <tr data-id="${escAttr(r.id)}">
            <td class="col-select">
              <input type="checkbox" class="row-checkbox" data-id="${escAttr(r.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            </td>
            <td class="col-rank">${r.composite !== null ? (i + 1) : '—'}</td>
            <td class="col-name">
              ${escHtml(r.name)}
              <span class="url">${escHtml(r.url || '(no url)')}</span>
            </td>
            <td class="col-score">${pill(r.ruleTotal)}</td>
            <td class="col-score">${pill(r.aiTotal)}</td>
            <td class="col-score">${pill(r.composite, true)}${deltaBadge(r.composite, cohortAvg)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  body.innerHTML = html;

  // row click → drawer (but clicks on the checkbox cell are handled separately)
  body.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.col-select')) return;
      openDrawer(tr.dataset.id);
    });
  });
  body.querySelectorAll('.row-checkbox').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => onCheckboxChange(e.target));
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

/* ── Cohort delta badge ──────────────────────────────────── */
function deltaBadge(score, cohortAvg) {
  if (score == null || cohortAvg == null || STATE.cohort?.n < 2) return '';
  const delta = score - cohortAvg;
  const rounded = Math.round(delta * 10) / 10;
  if (Math.abs(rounded) < 0.05) return ` <span class="delta neutral" title="On par with the Zuidoost average">avg</span>`;
  const sign = delta > 0 ? '+' : '−';
  const cls = delta > 0 ? 'up' : 'down';
  return ` <span class="delta ${cls}" title="Delta vs Zuidoost cohort average (${STATE.cohort.n} scored buildings)">${sign}${Math.abs(rounded).toFixed(1)}</span>`;
}

/* ── Compare bar + mode ──────────────────────────────────── */
function onCheckboxChange(cb) {
  const id = cb.dataset.id;
  if (cb.checked) {
    if (STATE.compareSet.size >= MAX_COMPARE) { cb.checked = false; return; }
    STATE.compareSet.add(id);
  } else {
    STATE.compareSet.delete(id);
  }
  renderCompareBar();
  renderRankings(); // re-render to update disabled state
}

function renderCompareBar() {
  const bar = $('#compare-bar');
  const count = STATE.compareSet.size;
  bar.classList.toggle('visible', count > 0);
  $('#compare-count').textContent = `${count} selected`;
  $('#btn-compare').disabled = count !== 2;

  const pills = [...STATE.compareSet].map((id) => {
    const b = STATE.buildings.find((x) => x.id === id);
    return `<span class="pill-chip">${escHtml(b?.name ?? id)}</span>`;
  }).join('');
  $('#compare-pills').innerHTML = pills;
}

function clearCompare() {
  STATE.compareSet.clear();
  renderCompareBar();
  renderRankings();
}

function enterCompare() {
  if (STATE.compareSet.size !== 2) return;
  STATE.view = 'compare';
  renderCompareView();
}

function exitCompare() {
  STATE.view = 'list';
  renderRankings();
}

function renderCompareView() {
  $('#rankings-section').hidden = true;
  $('#compare-view').hidden = false;

  const ids = [...STATE.compareSet];
  const [a, b] = ids.map((id) => STATE.buildings.find((x) => x.id === id)).filter(Boolean);
  if (!a || !b) { exitCompare(); return; }
  const sa = STATE.latestByBuilding[a.id];
  const sb = STATE.latestByBuilding[b.id];

  $('#compare-title').textContent = `${a.name} vs ${b.name}`;

  // Merge all dimension keys both buildings have
  const dimKeys = new Set([
    ...Object.keys(sa?.dimensions ?? {}),
    ...Object.keys(sb?.dimensions ?? {}),
  ]);

  const tierRows = [
    ['Composite', sa?.composite, sb?.composite, 100],
    ['Rule score', sa?.ruleTotal, sb?.ruleTotal, 100],
    ['AI score', sa?.aiTotal, sb?.aiTotal, 100],
  ];

  const dimRows = [...dimKeys].map((k) => {
    const va = getDimScore(sa, k);
    const vb = getDimScore(sb, k);
    return [k, va, vb, 10];
  });

  const html = `
    <div class="cv-heads">
      <div>Dimension</div>
      <div class="b-name">${escHtml(a.name)}<span class="u">${escHtml(a.url || '')}</span></div>
      <div class="b-name">${escHtml(b.name)}<span class="u">${escHtml(b.url || '')}</span></div>
    </div>

    ${tierRows.map(([label, va, vb, max]) => compareRow(label, va, vb, max, true)).join('')}
    ${dimRows.length ? '<div class="cv-row tier-top" style="background:transparent"><div class="cv-dim" style="font-family:var(--font-display);letter-spacing:.12em;text-transform:uppercase;color:var(--text3);font-size:.75rem">— AI dimensions —</div><div></div><div></div></div>' : ''}
    ${dimRows.map(([k, va, vb, max]) => {
      const meta = DIMENSION_META[k];
      const label = meta?.label ?? k.replace(/_/g, ' ');
      const title = meta?.desc ?? '';
      return compareRow(label, va, vb, max, false, title);
    }).join('')}

    ${(sa || sb) ? `
      <div style="padding:1.25rem 1.5rem;background:var(--bg-light2);border-top:1px solid var(--border-light)">
        <div class="section-title" style="margin-top:0">Recommendations</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <div>${renderRecs(sa?.recommendations)}</div>
          <div>${renderRecs(sb?.recommendations)}</div>
        </div>
      </div>` : ''}
  `;

  $('#compare-body').innerHTML = html;
}

function compareRow(label, va, vb, max, tierTop = false, title = '') {
  const winA = typeof va === 'number' && typeof vb === 'number' && va > vb;
  const winB = typeof va === 'number' && typeof vb === 'number' && vb > va;
  const cell = (v, isWin) => {
    if (v == null) return `<div class="cv-score-cell"><span class="cv-score-num">—</span></div>`;
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    const colour = barColour(v / max);
    return `
      <div class="cv-score-cell ${isWin ? 'win' : ''}">
        <span class="cv-score-num">${max === 10 ? v : Math.round(v)}</span>
        <div class="cv-bar"><div class="cv-bar-fill" style="width:${pct}%;background:${colour}"></div></div>
      </div>`;
  };
  return `
    <div class="cv-row ${tierTop ? 'tier-top' : ''}">
      <div class="cv-dim" ${title ? `title="${escAttr(title)}"` : ''}>${escHtml(label)}</div>
      ${cell(va, winA)}
      ${cell(vb, winB)}
    </div>`;
}

function getDimScore(scoreRow, key) {
  const v = scoreRow?.dimensions?.[key];
  if (v == null) return null;
  return typeof v === 'number' ? v : (typeof v.score === 'number' ? v.score : null);
}

function barColour(ratio) {
  if (ratio >= 0.8) return '#5a8a3a';
  if (ratio >= 0.6) return '#a08a30';
  if (ratio >= 0.4) return '#c87838';
  return '#a83a30';
}

function renderRecs(recs) {
  if (!recs || !recs.length) return `<div style="color:var(--text3);font-size:.85rem">No recommendations yet.</div>`;
  return `<ol style="padding-left:1.1rem;margin:0">${recs.map((r) => `<li style="margin-bottom:.35rem;font-size:.85rem;color:var(--text2);line-height:1.45">${escHtml(r)}</li>`).join('')}</ol>`;
}

/* ── Drawer (single-building detail) ─────────────────────── */
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
        <p>The daily scheduled scan runs at 06:00 Amsterdam. To trigger manually, run the
        <code>zuidoost-marketing-scan</code> agent from the
        <a href="https://claude.ai/code/scheduled" target="_blank" rel="noopener">Claude Code scheduled page</a>.</p>
      </div>`;
  } else {
    const cohortComposite = STATE.cohort?.composite;
    const cohortRule = STATE.cohort?.rule;
    const cohortAi = STATE.cohort?.ai;
    body.innerHTML = `
      <div class="score-hero">
        <div class="b">
          <div class="b-label">Rule</div>
          <div class="b-value">${Math.round(s.ruleTotal ?? 0)}</div>
          <div style="margin-top:.2rem">${deltaBadge(s.ruleTotal, cohortRule)}</div>
        </div>
        <div class="b">
          <div class="b-label">AI</div>
          <div class="b-value">${Math.round(s.aiTotal ?? 0)}</div>
          <div style="margin-top:.2rem">${deltaBadge(s.aiTotal, cohortAi)}</div>
        </div>
        <div class="b composite">
          <div class="b-label">Composite</div>
          <div class="b-value">${Math.round(s.composite ?? 0)}</div>
          <div style="margin-top:.2rem">${deltaBadge(s.composite, cohortComposite)}</div>
        </div>
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

      <div class="section-title">How to read this</div>
      <p style="font-size:.85rem;color:var(--text3);font-family:var(--font-body);line-height:1.5">
        Composite = 0.4 × rule + 0.6 × AI. Each dimension is scored 0–10 (5 = market average, 8+ rare).
        Deltas compare against the Zuidoost cohort of ${STATE.cohort?.n ?? 0} scored building${STATE.cohort?.n === 1 ? '' : 's'}.
        Re-runs daily at 06:00 Amsterdam; tune the rubric by editing
        <code>marketing-analyzer/agent-rubric.md</code>.
      </p>`;
  }

  $('#drawer-bg').classList.add('open');
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
}

function renderDimensions(dims) {
  const entries = Object.entries(dims);
  if (entries.length === 0) return `<div class="empty">No AI dimensions stored.</div>`;
  const cohortDims = STATE.cohort?.dimensions ?? {};
  return entries.map(([name, info]) => {
    const score = typeof info === 'number' ? info : (info?.score ?? 0);
    const just  = typeof info === 'object' ? (info.justification ?? '') : '';
    const pct   = Math.max(0, Math.min(100, (score / 10) * 100));
    const colour = barColour(score / 10);
    const meta = DIMENSION_META[name];
    const label = meta?.label ?? name.replace(/_/g, ' ');
    const tooltip = meta?.desc ?? '';
    const cohortAvg = cohortDims[name];
    const delta = deltaBadge(score, cohortAvg);
    return `
      <div class="dim">
        <div class="dim-name" title="${escAttr(tooltip)}">${escHtml(label)}</div>
        <div class="dim-score">${score}/10 ${delta}</div>
        <div class="dim-bar"><div class="dim-bar-fill" style="width:${pct}%;background:${colour}"></div></div>
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
