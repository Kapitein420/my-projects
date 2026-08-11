#!/usr/bin/env node
/* ============================================================
   verify-supabase.mjs — security smoke test

   Proves three things in one run:
     1. Publishable key from shared/db.js CAN read buildings/scores
     2. Publishable key CANNOT write (RLS blocks it — this is the
        main defense against the leaked-key scenario)
     3. Secret key from $SUPABASE_SERVICE_ROLE_KEY CAN write
        (bypasses RLS — the pattern analyze.mjs and /api routes
        will use)

   Run with:  node --env-file=.env scripts/verify-supabase.mjs
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

// Pull the publishable key straight out of shared/db.js so we're
// testing what the browser will actually use.
const dbSrc = fs.readFileSync(path.join(process.cwd(), 'shared', 'db.js'), 'utf8');
const m = dbSrc.match(/key:\s*['"]([^'"]+)['"]/);
if (!m) { console.error('✗ Could not find publishable key in shared/db.js'); process.exit(1); }
const PUBLISHABLE_KEY = m[1];

if (!PUBLISHABLE_KEY.startsWith('sb_publishable_') && !PUBLISHABLE_KEY.startsWith('eyJ')) {
  console.error('✗ shared/db.js key looks wrong — expected sb_publishable_ prefix');
  process.exit(1);
}

console.log('SUPABASE_URL        ', SUPABASE_URL);
console.log('publishable (browser)', PUBLISHABLE_KEY.slice(0, 20) + '…');
console.log('secret (server)      ', SECRET_KEY.slice(0, 14) + '…');
console.log();

let failures = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { console.error('  ✗ ' + msg); failures++; }

async function req(key, method, pathname, body) {
  const r = await fetch(SUPABASE_URL + pathname, {
    method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=minimal' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, text: await r.text() };
}

// ─── Test 1: publishable key reads (should succeed) ────────────
console.log('Test 1: publishable key READ  (expected: 200)');
{
  const r = await req(PUBLISHABLE_KEY, 'GET', '/rest/v1/buildings?select=id&limit=1');
  if (r.status === 200) pass(`read ok (${r.status})`);
  else fail(`read FAILED (${r.status}) — ${r.text.slice(0, 120)}`);
}

// ─── Test 2: publishable key writes (should be denied by RLS) ──
console.log('\nTest 2: publishable key WRITE (expected: 401/403 — RLS blocks)');
{
  const probeId = 'rls-probe-' + Date.now();
  const r = await req(PUBLISHABLE_KEY, 'POST', '/rest/v1/buildings', {
    id: probeId,
    data: { name: 'RLS probe — should not persist' },
  });
  if (r.status === 401 || r.status === 403) {
    pass(`write blocked (${r.status}) — RLS is protecting data`);
  } else if (r.status >= 200 && r.status < 300) {
    fail(`write SUCCEEDED (${r.status}) — RLS is NOT protecting writes! Run schema.sql in Supabase SQL editor.`);
    // Try to clean up with the secret key.
    await req(SECRET_KEY, 'DELETE', `/rest/v1/buildings?id=eq.${probeId}`);
  } else {
    fail(`unexpected status ${r.status}: ${r.text.slice(0, 120)}`);
  }
}

// ─── Test 3: secret key writes (should succeed) ────────────────
console.log('\nTest 3: secret key WRITE      (expected: 201 — bypasses RLS)');
{
  const probeId = 'secret-probe-' + Date.now();
  const r = await req(SECRET_KEY, 'POST', '/rest/v1/buildings', {
    id: probeId,
    data: { name: 'secret-key probe' },
  });
  if (r.status >= 200 && r.status < 300) {
    pass(`write ok (${r.status}) — secret key bypasses RLS as expected`);
    // Clean up the probe row so the dashboard isn't polluted.
    await req(SECRET_KEY, 'DELETE', `/rest/v1/buildings?id=eq.${probeId}`);
  } else {
    fail(`write FAILED (${r.status}) — ${r.text.slice(0, 120)}`);
  }
}

console.log();
if (failures === 0) {
  console.log('✅ All checks passed. RLS + key separation is correctly configured.');
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) failed. Do not hand out the email API key until fixed.`);
  process.exit(1);
}
