#!/usr/bin/env node
/* ============================================================
   DILS Marketing Analyzer — local scoring CLI

   Pulls buildings from Supabase, fetches each landing page,
   runs lightweight rule-based checks, sends the visible text
   to Claude Sonnet 4.6 for AI scoring + recommendations,
   writes a `scores` row back to Supabase.

   No Playwright today — pure Node fetch + regex + Claude.
   Visual dimensions get a partial pass since we have no screenshot.
   We'll add a screenshot pass when there's appetite.

   Usage:
     node analyze.mjs                       # score every unscored building
     node analyze.mjs --building=<slug>     # rescore one building
     node analyze.mjs --force               # ignore the unscored filter
     node analyze.mjs --limit=3             # cap how many to score this run
     node analyze.mjs --seed                # also push seeds.js samples first

   Env required:
     ANTHROPIC_API_KEY   (https://console.anthropic.com/settings/keys)
   Optional:
     SUPABASE_URL / SUPABASE_KEY  — overrides the baked-in shared/db.js creds
   ============================================================ */

import Anthropic from '@anthropic-ai/sdk';
import { ZUIDOOST_SEEDS } from './seeds.js';

// --- Supabase config (matches shared/db.js) ---
const SUPABASE_URL = process.env.SUPABASE_URL ||
  'https://qavuogmqssjrsaylthdw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhdnVvZ21xc3NqcnNheWx0aGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTQyMzQsImV4cCI6MjA5MTQ5MDIzNH0.jpP1vHqs2nvy0HEOnoglXOboSDNC-Nm1DZjaTWnSBdw';

const argv = parseArgs(process.argv.slice(2));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('✗ ANTHROPIC_API_KEY missing. Get one at https://console.anthropic.com/settings/keys');
  process.exit(1);
}

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';
const PROMPT_VERSION = 'v1.0.0-text';

const RUBRIC = `You are a senior real-estate marketing reviewer for DILS Office Amsterdam.
You evaluate office-building landing pages on 8 dimensions, scored 0-10.
Be honest: 5 is average for the Amsterdam office market, 8+ should be rare,
2- is reserved for visibly broken or empty pages.

Dimensions:
- copy_clarity_nl: Dutch copy is concise, tenant-focused, free of jargon
- copy_clarity_en: English copy meets the same bar; or graceful absence
- brand_distinctiveness: would a tenant recognise this building from competitors?
- target_tenant_fit: does it speak to the right tenant profile (corporate HQ vs creative vs flex)?
- amenity_messaging: are gym/F&B/bike/EV/transit clearly surfaced?
- trust_signals: tenant logos, awards, certifications (BREEAM, WELL), occupancy stats
- cta_quality: primary CTA visible, specific, low-friction
- structural_clarity: information architecture suggests a confident, planned site

Strong NL marketing example: "Het meest connected kantoor van de Zuidas",
"Vier vloeren beschikbaar — kom langs deze week".
Avoid scoring high for generic "Premium offices in a prime location"-style copy.

Then propose the top 3 actionable recommendations the marketing team
could implement in <2 weeks to lift the lowest-scoring dimensions.`;

const DIMENSIONS = [
  'copy_clarity_nl', 'copy_clarity_en', 'brand_distinctiveness',
  'target_tenant_fit', 'amenity_messaging', 'trust_signals',
  'cta_quality', 'structural_clarity',
];

/* ============================================================ */
async function main() {
  if (argv.seed) await seedBuildings();

  const buildings = await listBuildings();
  const scoresAll = await listScores();
  const latestBy = latestByBuilding(scoresAll);

  let candidates = buildings;
  if (argv.building) candidates = candidates.filter((b) => b.id === argv.building);
  if (!argv.force && !argv.building) {
    candidates = candidates.filter((b) => !latestBy[b.id]);
  }
  if (argv.limit) candidates = candidates.slice(0, parseInt(argv.limit, 10));
  candidates = candidates.filter((b) => b.url);

  if (candidates.length === 0) {
    console.log('Nothing to score. Use --force to re-score, or --building=<slug>.');
    return;
  }

  console.log(`Scoring ${candidates.length} building(s)…\n`);

  for (const b of candidates) {
    try {
      console.log(`→ ${b.name}  (${b.url})`);
      const scoreRow = await scoreBuilding(b);
      await postScore(scoreRow);
      console.log(`  ✓ rule ${scoreRow.ruleTotal}  ai ${scoreRow.aiTotal}  composite ${scoreRow.composite}\n`);
    } catch (err) {
      console.error(`  ✗ ${b.name}: ${err.message}\n`);
    }
  }
}

/* ── Score one building ──────────────────────────────────── */
async function scoreBuilding(b) {
  const fetched = await fetchPage(b.url);
  const ruleResult = scoreRules(fetched);
  const aiResult = await scoreWithAi(b, fetched.text);

  const ruleTotal = ruleResult.total;
  const aiTotal = aiResult.total;
  const composite = Math.round(0.4 * ruleTotal + 0.6 * aiTotal);

  return {
    id: `${b.id}-${Date.now()}`,
    buildingId: b.id,
    ruleTotal,
    aiTotal,
    composite,
    rule: ruleResult.breakdown,
    dimensions: aiResult.dimensions,
    recommendations: aiResult.recommendations,
    scoredAt: new Date().toISOString(),
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    cost_usd: aiResult.cost_usd,
  };
}

/* ── Fetch + extract ─────────────────────────────────────── */
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'DILS-Marketing-Analyzer/1.0 (+contact: nmaatoke@gmail.com)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'nl,en;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const text = stripHtml(html).slice(0, 18000);
  return { html, text, finalUrl: res.url, status: res.status };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Rule-based scoring ──────────────────────────────────── */
function scoreRules({ html, finalUrl }) {
  const lower = html.toLowerCase();

  const checks = {
    has_tls: finalUrl.startsWith('https://'),
    has_viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    has_og: /<meta[^>]+property=["']og:/.test(html),
    has_twitter: /<meta[^>]+name=["']twitter:/.test(html),
    has_schema: /application\/ld\+json/i.test(html) && /schema\.org/i.test(html),
    has_canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    has_favicon: /<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(html),
    has_hreflang: /<link[^>]+hreflang=/i.test(html),
    has_lang_nl: /lang=["']nl/i.test(html),
    has_lang_en: /lang=["']en/i.test(html),
    has_contact: /mailto:|tel:/i.test(html),
    has_cta: /(plan een bezichtiging|schedule a viewing|book a tour|huur opvragen|neem contact op|contact us|bezichtiging|aanvragen)/i.test(lower),
    word_count: stripHtml(html).split(/\s+/).filter(Boolean).length,
  };

  const imgs = (html.match(/<img\b[^>]*>/gi) || []);
  const imgsAlt = imgs.filter((t) => /\salt=["'][^"']+["']/i.test(t));
  checks.alt_density = imgs.length === 0 ? 1 : imgsAlt.length / imgs.length;
  checks.img_count = imgs.length;

  // Weight to a 100 cap.
  let total = 0;
  if (checks.has_tls) total += 8;
  if (checks.has_viewport) total += 6;
  if (checks.has_og) total += 12;
  if (checks.has_twitter) total += 4;
  if (checks.has_schema) total += 10;
  if (checks.has_canonical) total += 4;
  if (checks.has_favicon) total += 3;
  if (checks.has_hreflang) total += 5;
  if (checks.has_lang_nl) total += 4;
  if (checks.has_lang_en) total += 4;
  if (checks.has_contact) total += 8;
  if (checks.has_cta) total += 10;
  total += Math.round(checks.alt_density * 12);
  if (checks.word_count > 200) total += 5;
  if (checks.word_count > 600) total += 5;

  return { total: Math.min(100, total), breakdown: checks };
}

/* ── AI scoring (text-only, single Claude call) ──────────── */
async function scoreWithAi(b, visibleText) {
  const dimensionsSchema = Object.fromEntries(
    DIMENSIONS.map((d) => [
      d,
      {
        type: 'object',
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 10 },
          justification: { type: 'string', maxLength: 220 },
        },
        required: ['score', 'justification'],
      },
    ]),
  );

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [
      {
        name: 'submit_score',
        description: 'Submit the marketing-quality score for the building.',
        input_schema: {
          type: 'object',
          properties: {
            dimensions: { type: 'object', properties: dimensionsSchema, required: [...DIMENSIONS] },
            recommendations: { type: 'array', items: { type: 'string', maxLength: 240 }, minItems: 3, maxItems: 3 },
          },
          required: ['dimensions', 'recommendations'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_score' },
    system: [{ type: 'text', text: RUBRIC, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Building: ${b.name}\nURL: ${b.url}\n\nVisible page text (truncated):\n${visibleText}`,
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not call submit_score');

  const dims = toolUse.input.dimensions;
  const sum = Object.values(dims).reduce((s, d) => s + d.score, 0);
  const total = Math.round((sum / (DIMENSIONS.length * 10)) * 100);

  // Sonnet 4.6 pricing (Jan 2026): $3 per Mtok in, $15 per Mtok out, cached $0.30/Mtok
  const u = response.usage;
  const cost_usd = +(
    (u.input_tokens || 0) * 3 / 1_000_000 +
    (u.cache_read_input_tokens || 0) * 0.3 / 1_000_000 +
    (u.cache_creation_input_tokens || 0) * 3.75 / 1_000_000 +
    (u.output_tokens || 0) * 15 / 1_000_000
  ).toFixed(4);

  return {
    total,
    dimensions: dims,
    recommendations: toolUse.input.recommendations,
    cost_usd,
  };
}

/* ── Supabase REST helpers ───────────────────────────────── */
async function listBuildings() {
  const rows = await sbGet('/rest/v1/buildings?select=data&order=created_at.asc');
  return rows.map((r) => r.data);
}
async function listScores() {
  const rows = await sbGet('/rest/v1/scores?select=data&order=created_at.asc');
  return rows.map((r) => r.data);
}
function latestByBuilding(scores) {
  const out = {};
  for (const s of scores) {
    if (!s?.buildingId) continue;
    if (!out[s.buildingId] || new Date(s.scoredAt) > new Date(out[s.buildingId].scoredAt)) {
      out[s.buildingId] = s;
    }
  }
  return out;
}
async function postScore(record) {
  await sbPost('/rest/v1/scores', { id: record.id, data: record, updated_at: new Date().toISOString() });
}
async function postBuilding(record) {
  await sbPost('/rest/v1/buildings', { id: record.id, data: record, updated_at: new Date().toISOString() });
}
async function seedBuildings() {
  console.log('Seeding sample buildings…');
  for (const s of ZUIDOOST_SEEDS) {
    const id = slugify(s.name);
    try {
      await postBuilding({ id, name: s.name, url: s.url, address: s.address, postcode: s.postcode, addedAt: new Date().toISOString() });
      console.log(`  + ${s.name}`);
    } catch (e) { console.error(`  ✗ ${s.name}: ${e.message}`); }
  }
  console.log();
}

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + path, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPost(path, body) {
  const r = await fetch(SUPABASE_URL + path, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase POST ${path}: ${r.status} ${await r.text()}`);
}
function sbHeaders() {
  return { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };
}

/* ── tiny utils ──────────────────────────────────────────── */
function parseArgs(args) {
  const out = {};
  for (const a of args) {
    if (a === '--force') out.force = true;
    else if (a === '--seed') out.seed = true;
    else if (a.startsWith('--building=')) out.building = a.slice(11);
    else if (a.startsWith('--limit=')) out.limit = a.slice(8);
  }
  return out;
}
function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

main().catch((e) => { console.error(e); process.exit(1); });
