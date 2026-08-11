/* ============================================================
   DILS Marketing Analyzer — dashboard logic
   SM-style: Nunito Sans + brass + compact tables.
   Reads via shared/db.js (jsonb pattern).

     buildings  — { id, data: { name, url, address, postcode } }
     scores     — { id, data: { buildingId, ruleTotal, aiTotal, composite,
                                 rule, dimensions: { name: { score, justification } },
                                 recommendations, scoredAt } }
   ============================================================ */

const DIMENSION_META = {
  copy_clarity_nl:       { label: 'Dutch copy',           desc: 'Dutch copy is concise, tenant-focused, free of jargon — specific, not generic.' },
  copy_clarity_en:       { label: 'English copy',         desc: 'English copy meets the same bar. Graceful absence is fine if the NL page is strong.' },
  brand_distinctiveness: { label: 'Brand distinctiveness',desc: 'Would a tenant recognise this building from a competitor? Visual identity, naming, voice.' },
  target_tenant_fit:     { label: 'Target-tenant fit',    desc: 'Speaks to the right tenant profile — corporate HQ vs creative studio vs flex.' },
  amenity_messaging:     { label: 'Amenity messaging',    desc: 'Gym, F&B, bike, EV, transit, parking — surfaced not buried in a datasheet.' },
  trust_signals:         { label: 'Trust signals',        desc: 'Tenant logos, awards, certifications (BREEAM, WELL), occupancy, named agent contact.' },
  cta_quality:           { label: 'Call-to-action',       desc: 'Primary CTA visible, specific, low-friction — "Plan een bezichtiging", not just "Contact".' },
  structural_clarity:    { label: 'Structure & IA',       desc: 'Information architecture suggests a confident, planned site — sections, hierarchy, nav.' },
  visual_hierarchy:      { label: 'Visual hierarchy',     desc: 'Where the eye lands first. Scale, contrast, layout priority.' },
  typography_quality:    { label: 'Typography',           desc: 'Type pairing, hierarchy, line length, NL+EN readability.' },
  photography_quality:   { label: 'Photography',          desc: 'Hero imagery, interiors, drone. Stock-iness penalised.' },
};

const STATE = {
  buildings: [],
  scores: [],
  latestByBuilding: {},
  cohort: null,
  sortBy: 'composite',
  selectedId: null,
  compareSet: new Set(),
  view: 'list',
};

const $ = (sel) => document.querySelector(sel);
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); if (STATE.view === 'compare') exitCompare(); }
  });
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

    STATE.compareSet = new Set([...STATE.compareSet].filter((id) => STATE.buildings.some((b) => b.id === id)));

    renderKpis();
    renderCompareBar();
    if (STATE.view === 'compare') renderCompareView();
    else renderRankings();
    updateFreshness();
  } catch (e) {
    toast('Could not load — did you run schema.sql in Supabase?', true);
    console.error(e);
  }
}

function updateFreshness() {
  const el = $('#fresh-ts');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
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

function computeCohort(latestBy) {
  const scored = Object.values(latestBy).filter((s) => typeof s.composite === 'number');
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

/* ── Explainer dimension legend ──────────────────────────── */
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

/* ── KPI tiles ───────────────────────────────────────────── */
function renderKpis() {
  const tracked = STATE.buildings.length;
  const scored = Object.keys(STATE.latestByBuilding).length;
  const withUrl = STATE.buildings.filter((b) => (b.url || '').trim()).length;
  const pending = withUrl - scored;

  const composites = Object.values(STATE.latestByBuilding).map((s) => s.composite).filter((n) => typeof n === 'number');
  const avg = composites.length ? composites.reduce((a, b) => a + b, 0) / composites.length : null;
  const top = composites.length ? Math.max(...composites) : null;
  const topRow = top !== null ? Object.values(STATE.latestByBuilding).find((s) => s.composite === top) : null;
  const topBuilding = topRow ? STATE.buildings.find((b) => b.id === topRow.buildingId) : null;

  const noUrlCount = tracked - withUrl;

  $('#kpi-tracked').textContent = tracked.toString();
  $('#kpi-scored').textContent = scored.toString();
  $('#kpi-scored-sub').textContent = tracked ? `${Math.round((scored / tracked) * 100)}% of tracked` : '';
  $('#kpi-pending').textContent = Math.max(0, pending).toString();
  $('#kpi-pending-sub').textContent = noUrlCount > 0 ? `${noUrlCount} more need URL` : (pending > 0 ? 'Will run in next scan' : 'All caught up');
  $('#kpi-avg').textContent = avg !== null ? Math.round(avg) : '—';
  $('#kpi-avg-sub').textContent = scored > 1 ? `Across ${scored} buildings` : '';
  $('#kpi-top').textContent = top !== null ? Math.round(top) : '—';
  $('#kpi-top-sub').textContent = topBuilding ? topBuilding.name : '';
}

/* ── Leaderboard ─────────────────────────────────────────── */
function renderRankings() {
  $('#leaderboard').hidden = false;
  $('#compare-section').hidden = true;
  $('#explainer').hidden = false;

  const body = $('#rank-body');

  if (STATE.buildings.length === 0) {
    body.innerHTML = `
      <div class="empty">
        <p class="h">No buildings yet</p>
        <p>Click <strong>+ Samples</strong> in the topbar to seed Zuidoost anchors,
        or add one via the form below.</p>
      </div>`;
    return;
  }

  const rows = STATE.buildings.map((b) => {
    const latest = STATE.latestByBuilding[b.id];
    return {
      id: b.id,
      name: b.name,
      url: b.url || '',
      address: b.address || '',
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
    <table>
      <thead>
        <tr class="header-row">
          <th class="shrink"></th>
          <th class="shrink">#</th>
          <th>Building</th>
          <th>Status</th>
          <th class="right shrink">Rule</th>
          <th class="right shrink">AI</th>
          <th class="right shrink">Composite</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => {
          const checked = STATE.compareSet.has(r.id);
          const disabled = !checked && compareFull;
          const status = statusFor(r);
          const rank = r.composite !== null ? (i + 1) : '—';
          return `
          <tr data-id="${escAttr(r.id)}">
            <td class="shrink"><input type="checkbox" class="row-checkbox" data-id="${escAttr(r.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="Select ${escAttr(r.name)}"></td>
            <td class="col-rank">${rank}</td>
            <td>
              <span class="bldg-name">${escHtml(r.name)}</span>
              <div class="bldg-meta">${r.address ? escHtml(r.address) + ' · ' : ''}${r.url ? `<a href="${escAttr(r.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(stripProto(r.url))} ↗</a>` : '<em>no URL</em>'}</div>
            </td>
            <td>${status}</td>
            <td class="right">${pill(r.ruleTotal)}</td>
            <td class="right">${pill(r.aiTotal)}</td>
            <td class="right"><span class="comp-cell">${pill(r.composite, true)}${deltaBadge(r.composite, cohortAvg)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  body.innerHTML = html;

  body.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, a')) return;
      openDrawer(tr.dataset.id);
    });
  });
  body.querySelectorAll('.row-checkbox').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => onCheckboxChange(e.target));
  });
}

function statusFor(r) {
  if (!r.url) return `<span class="status-pill pill-bad"><span class="dot"></span>Needs URL</span>`;
  if (r.composite === null) return `<span class="status-pill pill-warn"><span class="dot"></span>Pending scan</span>`;
  return `<span class="status-pill pill-ok"><span class="dot"></span>Scored</span>`;
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
  if (n === null || n === undefined) return `<span class="spill s-na">—</span>`;
  const v = Math.round(n);
  let cls = 's-0';
  if (v >= 90) cls = 's-90'; else if (v >= 75) cls = 's-75';
  else if (v >= 60) cls = 's-60'; else if (v >= 40) cls = 's-40';
  return `<span class="spill ${cls}${big ? ' lg' : ''}">${v}</span>`;
}

function deltaBadge(score, cohortAvg) {
  if (score == null || cohortAvg == null || (STATE.cohort?.n ?? 0) < 2) return '';
  const delta = score - cohortAvg;
  const rounded = Math.round(delta * 10) / 10;
  if (Math.abs(rounded) < 0.05) return `<span class="delta neutral" title="On par with the Zuidoost average">avg</span>`;
  const cls = delta > 0 ? 'up' : 'down';
  return `<span class="delta ${cls}" title="vs Zuidoost cohort average (${STATE.cohort.n} scored)">${Math.abs(rounded).toFixed(1)}</span>`;
}

function stripProto(url) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
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
  renderRankings();
}

function renderCompareBar() {
  const bar = $('#compare-bar');
  const count = STATE.compareSet.size;
  bar.classList.toggle('visible', count > 0);
  $('#compare-count').textContent = `${count} selected`;
  $('#btn-compare').disabled = count !== 2;

  $('#compare-pills').innerHTML = [...STATE.compareSet].map((id) => {
    const b = STATE.buildings.find((x) => x.id === id);
    return `<span class="chip">${escHtml(b?.name ?? id)}</span>`;
  }).join('');
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
  $('#leaderboard').hidden = true;
  $('#compare-section').hidden = false;
  $('#explainer').hidden = true;

  const ids = [...STATE.compareSet];
  const [a, b] = ids.map((id) => STATE.buildings.find((x) => x.id === id)).filter(Boolean);
  if (!a || !b) { exitCompare(); return; }
  const sa = STATE.latestByBuilding[a.id];
  const sb = STATE.latestByBuilding[b.id];

  $('#compare-title').textContent = `${a.name} vs ${b.name}`;

  const dimKeys = new Set([
    ...Object.keys(sa?.dimensions ?? {}),
    ...Object.keys(sb?.dimensions ?? {}),
  ]);

  const tierRows = [
    ['Composite', sa?.composite, sb?.composite, 100, true],
    ['Rule score', sa?.ruleTotal, sb?.ruleTotal, 100, true],
    ['AI score', sa?.aiTotal, sb?.aiTotal, 100, true],
  ];
  const dimRows = [...dimKeys].map((k) => [k, getDimScore(sa, k), getDimScore(sb, k), 10, false]);

  const html = `
    <div class="cv-heads">
      <div>Dimension</div>
      <div class="b-name">${escHtml(a.name)}<span class="u">${a.url ? escHtml(stripProto(a.url)) : ''}</span></div>
      <div class="b-name">${escHtml(b.name)}<span class="u">${b.url ? escHtml(stripProto(b.url)) : ''}</span></div>
    </div>

    ${tierRows.map(([label, va, vb, max, isTier]) => compareRow(label, va, vb, max, isTier)).join('')}

    ${dimRows.length ? `
      <div class="cv-row" style="background:var(--bg4)">
        <div class="cv-dim" style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--brass);font-weight:700">— AI dimensions —</div>
        <div></div><div></div>
      </div>
    ` : ''}
    ${dimRows.map(([k, va, vb, max]) => {
      const meta = DIMENSION_META[k];
      const label = meta?.label ?? k.replace(/_/g, ' ');
      const title = meta?.desc ?? '';
      return compareRow(label, va, vb, max, false, title);
    }).join('')}

    ${(sa?.recommendations || sb?.recommendations) ? `
      <div class="cv-recs-row">
        <div>Recommendations</div>
        <div>${renderRecs(sa?.recommendations)}</div>
        <div>${renderRecs(sb?.recommendations)}</div>
      </div>
    ` : ''}
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
  if (ratio >= 0.8) return 'var(--ok)';
  if (ratio >= 0.6) return 'var(--brass)';
  if (ratio >= 0.4) return 'var(--warn)';
  return 'var(--bad)';
}

function renderRecs(recs) {
  if (!recs || !recs.length) return `<div style="color:var(--ink-mute);font-size:12px;font-style:italic">None yet — building hasn't been scored.</div>`;
  return `<ol style="padding-left:18px;margin:0">${recs.map((r) => `<li style="margin-bottom:6px;font-size:12px;color:var(--ink-dim);line-height:1.5">${escHtml(r)}</li>`).join('')}</ol>`;
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
    b.url ? `<a href="${escAttr(b.url)}" target="_blank" rel="noopener">${escHtml(stripProto(b.url))} ↗</a>` : '<em>no URL set</em>',
    s?.scoredAt ? `analyzed ${formatDate(s.scoredAt)}` : 'not yet analyzed',
  ].filter(Boolean).join(' · ');

  const body = $('#d-body');
  if (!s) {
    body.innerHTML = `
      <div class="empty">
        <p class="h">Not yet scored</p>
        <p>The daily scheduled scan runs at 06:00 Amsterdam.</p>
        <p>Trigger immediately from the
          <a href="https://claude.ai/code/scheduled" target="_blank" rel="noopener">scheduled-agents page</a>
          (look for <code>zuidoost-marketing-scan</code>).</p>
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
          ${deltaBadge(s.ruleTotal, cohortRule)}
        </div>
        <div class="b">
          <div class="b-label">AI</div>
          <div class="b-value">${Math.round(s.aiTotal ?? 0)}</div>
          ${deltaBadge(s.aiTotal, cohortAi)}
        </div>
        <div class="b composite">
          <div class="b-label">Composite</div>
          <div class="b-value">${Math.round(s.composite ?? 0)}</div>
          ${deltaBadge(s.composite, cohortComposite)}
        </div>
      </div>

      <div class="section-title">AI breakdown</div>
      <div class="dim-list">${renderDimensions(s.dimensions || {})}</div>

      ${s.recommendations && s.recommendations.length ? `
        <div class="section-title">Top recommendations</div>
        <div class="recs"><ol>${s.recommendations.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ol></div>
      ` : ''}

      <div class="section-title">How to read this</div>
      <p style="font-size:12px;color:var(--ink-mute);line-height:1.6">
        Composite = 0.4 × rule + 0.6 × AI. Each dimension scored 0–10 (5 = market average, 8+ rare).
        Deltas compare against the Zuidoost cohort of ${STATE.cohort?.n ?? 0} scored building${STATE.cohort?.n === 1 ? '' : 's'}.
        Re-runs daily 06:00 Amsterdam; tune the rubric in
        <code>marketing-analyzer/agent-rubric.md</code>.
      </p>`;
  }

  $('#drawer-bg').classList.add('open');
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
}

function renderDimensions(dims) {
  const entries = Object.entries(dims);
  if (entries.length === 0) return `<div style="color:var(--ink-mute);font-size:12px">No AI dimensions stored.</div>`;
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
    return `
      <div class="dim">
        <div class="dim-name" title="${escAttr(tooltip)}">${escHtml(label)}</div>
        <div class="dim-score">${score}<span style="color:var(--ink-mute);font-weight:400">/10</span></div>
        <div class="dim-bar"><div class="dim-bar-fill" style="width:${pct}%;background:${colour}"></div></div>
        ${just || cohortAvg !== undefined ? `<div class="dim-meta">${just ? `<span style="font-size:11px;color:var(--ink-mute);font-style:italic">${escHtml(just)}</span>` : ''}${cohortAvg !== undefined ? deltaBadge(score, cohortAvg) : ''}</div>` : ''}
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
  if (!name) { toast('Name required', true); return; }

  const record = {
    id: slugify(name),
    name, url, address, postcode: '',
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
    try {
      await DB.save('buildings', { id, name: s.name, url: s.url, address: s.address, postcode: s.postcode, addedAt: new Date().toISOString() });
      added++;
    } catch (err) { console.error(err); }
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

boot();
