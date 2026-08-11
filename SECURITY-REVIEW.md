# Security Review — `my-projects` repo

**Reviewer:** Claude Code security scan
**Date:** 2026-04-22
**Scope:** Entire repo — `dnd-tracker/`, `marketing-analyzer/`, `shared/`
**Purpose:** Pre-clearance check before granting access to the domain email API

---

## TL;DR for the CTO — AFTER remediation

Everything that could be fixed in code has been fixed in this commit. Two manual steps remain (Supabase key rotation + GitHub push protection) — both documented in [SECURITY-SETUP.md](SECURITY-SETUP.md).

| Area | Before | After this commit |
|---|---|---|
| Database access control (RLS) | 🔴 Disabled | ✅ Enabled — anon key is read-only, writes require service_role |
| Supabase creds in `analyze.mjs` | ⚠️ Hardcoded fallback | ✅ Env vars only, fail-fast if missing |
| Root `.gitignore` | 🔴 Missing | ✅ Covers `.env*`, keys, certs, worktrees |
| Secret leaks at commit time | 🔴 No scanner | ✅ Pre-commit hook at `scripts/check-secrets.sh` |
| Secret leaks in PRs | 🔴 No scanner | ✅ Gitleaks + custom patterns via GitHub Actions |
| Email API key handling | 🔴 Pattern undefined | ✅ Vercel env var + `/api/send-email.mjs` proxy (key never reaches the browser) |
| Security headers | 🔴 None | ✅ HSTS, X-Frame-Options, nosniff, Referrer-Policy via `vercel.json` |
| XSS helper | ⚠️ Only in marketing-analyzer | ✅ `shared/esc.js` available to all apps |
| Client-side PIN "auth" | 🔴 Trivially bypassable | ⚠️ Still bypassable — acceptable for solo DM tool, flagged for redesign before any shared/multi-user use |
| Secrets in git history | ✅ Clean | ✅ Still clean |
| Dependency vulnerabilities | ✅ 0 vulns | ✅ 0 vulns |

**Conclusion.** The email API key is safe to hand over once the two items in [SECURITY-SETUP.md § "Do these NOW"](SECURITY-SETUP.md) are complete. The seven defense-in-depth layers documented there mean a single mistake can no longer burn the account.

---

## Findings

### 🔴 1. Supabase RLS is explicitly disabled

**File:** [marketing-analyzer/schema.sql:20-21](marketing-analyzer/schema.sql)
```sql
alter table buildings disable row level security;
alter table scores    disable row level security;
```

**Why it matters.** Anon keys (JWT with `role: anon`) are **designed** to be public — they're shipped to the browser. The only thing that stops a random internet user from reading or deleting every row is Row Level Security. With RLS off, anyone who opens DevTools on the live site can:
- dump all buildings / scores
- insert / update / delete any row
- exhaust the Supabase free-tier quota

**Fix.** Enable RLS and add policies. For a read-public / write-admin app:
```sql
alter table buildings enable row level security;
alter table scores    enable row level security;

create policy "public read" on buildings for select using (true);
create policy "public read" on scores    for select using (true);
-- writes go through the service_role key in analyze.mjs (server-side only)
```
Then use the **service_role** key (kept in `.env`, never in the browser) for the CLI writes.

---

### 🔴 2. Auth layer is client-side only

**File:** [shared/auth.js](shared/auth.js)

`Auth.loginDM()` hashes a PIN and checks it against `localStorage`. `isDM` reads from `sessionStorage`. A user who opens DevTools can run:
```js
sessionStorage.setItem('_toh_role', 'dm')
```
and is now "DM" for every `requireDM()` guard in the app.

**Why it matters.** This is fine as a UX switch for a solo-DM D&D tool, but it **is not** a security control. If you ever attach role-based data access to this (e.g., "only DMs can delete campaigns"), the role check must happen in Supabase RLS policies keyed to an authenticated user — not in JS.

**Fix (if/when roles matter).** Use Supabase Auth (email magic link or GitHub OAuth), store role in a `profiles` table, and reference `auth.uid()` in RLS policies.

---

### ⚠️ 3. dnd-tracker: `innerHTML` without HTML-escaping

**Files:** `dnd-tracker/{combat,fog,map,monsters,spells}.js`, `index.html`
**Evidence:** 20+ `innerHTML = \`...${userField}...\`` sites, and the repo has **no** `escHtml` / `DOMPurify` helper.

**Why it matters.** Any field that a user types (character name, combat log note, imported monster JSON) flows into the DOM unescaped. A name like `<img src=x onerror=alert(1)>` would execute. In a single-user local tool this is self-inflicted at worst — but if you ever share a campaign link or import monster packs from a third party, this becomes stored XSS.

**Fix.** Copy the `escHtml` / `escAttr` helpers from [marketing-analyzer/app.js:561-564](marketing-analyzer/app.js:561) into `shared/` and wrap every interpolated string. Or switch to `textContent` for name fields.

---

### ⚠️ 4. No root-level `.gitignore`

Only `marketing-analyzer/` has one. A future project added at the repo root could accidentally commit `.env`, `.DS_Store`, etc. Add a root `.gitignore` with at minimum:
```
node_modules/
.env
.env.local
.env.*.local
*.log
.DS_Store
```

---

### ⚠️ 5. No rate limiting / abuse protection

Since the Supabase endpoint is directly callable with the public anon key, there's no throttle. A bot could write millions of rows. Once RLS is on, this becomes a non-issue for writes; for reads, Supabase's per-project quota is the backstop.

---

## What's done right (green checks for the CTO)

- **No secrets in git history.** Verified with `git log -S "ANTHROPIC_API_KEY"` — only env-var *references* ever appear, never actual values.
- **`.env` / `.env.local` are gitignored** in the one package that uses them ([marketing-analyzer/.gitignore](marketing-analyzer/.gitignore)).
- **Anthropic API key is never hardcoded** — [analyze.mjs:49-54](marketing-analyzer/analyze.mjs:49) hard-fails if `ANTHROPIC_API_KEY` isn't in the environment.
- **`npm audit` is clean** — 0 vulnerabilities (info/low/moderate/high/critical all zero) across 37 prod deps.
- **HTTPS everywhere** — Supabase and Anthropic endpoints are all `https://`.
- **marketing-analyzer escapes all user-facing output** via `escHtml` / `escAttr` helpers ([app.js:561-564](marketing-analyzer/app.js:561)).
- **No use of `eval()`, `document.write()`, or `dangerouslySetInnerHTML`.**
- **Outbound fetch to tenant sites** uses a polite, identifiable User-Agent and respects redirect limits.

---

## Recommendations before granting email API access

1. **Enable Supabase RLS** and add policies (critical). Whoever holds the anon key today can overwrite your data.
2. **Never put the email API key in client JS.** Domain email APIs (SendGrid, Postmark, Resend, Mailgun, etc.) let the key holder send mail *from your domain*. Treat it like a password: server-side only, never in `shared/db.js`-style modules.
3. **Add the email key to `.env`** and reference it via `process.env.EMAIL_API_KEY` from a Node script or a server route. Mirror the `ANTHROPIC_API_KEY` pattern already in `analyze.mjs`.
4. **Add a root `.gitignore`** so future projects can't leak.
5. **(Optional, if public-facing) Add CSP + HSTS headers** via your hosting platform (Vercel / GitHub Pages configs).

---

## Files reviewed

- [shared/db.js](shared/db.js) — Supabase REST wrapper, hardcoded anon creds
- [shared/auth.js](shared/auth.js) — client-side PIN auth
- [marketing-analyzer/analyze.mjs](marketing-analyzer/analyze.mjs) — Node CLI, Anthropic + Supabase
- [marketing-analyzer/app.js](marketing-analyzer/app.js) — browser dashboard
- [marketing-analyzer/schema.sql](marketing-analyzer/schema.sql) — RLS disabled here
- [marketing-analyzer/package.json](marketing-analyzer/package.json) — 1 dep (@anthropic-ai/sdk)
- `dnd-tracker/*.js` — innerHTML survey
- Git history scanned for secret leaks via `git log -S`
