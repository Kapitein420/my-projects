# Security Setup — Operations Runbook

**Purpose:** Steps to run (one-time) before handing out the domain email API key, and the flow to follow every time a new secret is added.

---

## 🔴 Do these NOW (manual, can't be done from code)

### 1. Migrate away from the exposed legacy Supabase keys

The legacy anon key `eyJ...jpP1vHqs2nvy...` has lived in the public `my-projects` repo since the first commit that added `shared/db.js`. Anon keys are technically public-safe, **but only when RLS is on** — which wasn't the case until this commit. Treat it as burned.

Supabase no longer has a "Roll" button — the legacy JWT system couples anon + service_role together, so rotating breaks both at once. Instead, migrate to the new per-key system (zero downtime):

1. Supabase dashboard → **Project Settings** (gear icon) → **API Keys**
2. Under **New API keys**, click **Create new publishable key** — name it `my-projects-browser`, copy the `sb_publishable_...` value (replaces the anon JWT)
3. Click **Create new secret key** — name it `my-projects-server`, copy the `sb_secret_...` value (replaces the service_role JWT)
4. Paste the **publishable** key into `shared/db.js` (line 12, `_defaultCreds.key`) — this is browser-safe
5. Paste the **secret** key into Vercel → Settings → Environment Variables as `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview)
6. Paste the same secret key into your local `.env` (gitignored) so `npm run analyze` keeps working
7. Run the updated `marketing-analyzer/schema.sql` in Supabase SQL Editor to flip RLS on
8. Verify the app still works, then **deactivate** the legacy `anon` + `service_role` keys in the dashboard. Once deactivated, the leaked value is dead.

### 2. Install the pre-commit hook (local, one-time per clone)

```bash
cp scripts/check-secrets.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

This blocks commits containing API-key-shaped strings before they leave your machine.

### 3. Enable GitHub secret scanning

Repo settings → **Code security and analysis** → turn on:
- Secret scanning
- Push protection (blocks secret-containing pushes at GitHub's edge)
- Dependabot alerts

Free for public repos. 30-second setup.

---

## Adding a new API key (the domain email key, or any future key)

**Rule:** the key exists in exactly two places — the provider dashboard, and Vercel env vars. Nowhere else.

1. Generate the key in the provider dashboard (Resend / SendGrid / Postmark / etc.)
2. Vercel → your project → **Settings → Environment Variables**
3. Add the variable (e.g. `EMAIL_API_KEY`) — check **Production**, **Preview**, and **Development** as needed
4. Redeploy (Vercel does this automatically on the next push, or hit "Redeploy" manually)
5. Update `.env.example` with the variable name and a blank value so teammates know it exists
6. Do **not** put the real value in `.env.example`, `README.md`, Slack, email, or any code file

### For local development

If you need the key locally (e.g. to test `/api/send-email` with `vercel dev`):
```bash
# One-time: pull env vars from Vercel into a gitignored .env file
npx vercel env pull .env.local
```
`.env.local` is covered by the root `.gitignore`. Never copy values from it into code.

### In code

```js
const apiKey = process.env.EMAIL_API_KEY;
if (!apiKey) return res.status(500).json({ error: 'email service not configured' });
```

Never import keys into browser bundles. Browser code calls `/api/send-email`; the serverless function reads the env var.

---

## If a key leaks anyway

Assume compromise within 60 seconds — automated scanners (GitHub, Anthropic, AWS, etc.) watch public commits in real time. Response:

1. **Rotate immediately** in the provider dashboard
2. Update the new value in Vercel env vars
3. `git log -p -S "<first 6 chars of leaked key>"` to find which commit introduced it
4. If it's only in the most recent commit: `git reset --hard HEAD~1 && git push --force` (but still rotate — it was already scraped)
5. If it's deeper in history: use [`git filter-repo`](https://github.com/newren/git-filter-repo) — but again, **rotation is what actually protects you**, not history rewriting
6. Check provider audit logs for unauthorized usage
7. File an abuse report with the provider if you see unauthorized charges

---

## Defense in depth — what's in place now

| Layer | Protection | Location |
|---|---|---|
| 1. Editor | `.env` never committed | `.gitignore` |
| 2. Commit | Pattern scanner blocks `sk-ant-*`, `re_*`, `SG.*`, JWTs, etc. | `.git/hooks/pre-commit` |
| 3. Push | GitHub push protection (requires manual enable) | GitHub repo settings |
| 4. CI | `gitleaks` + custom pattern scan on every PR/push | `.github/workflows/secret-scan.yml` |
| 5. Runtime | Serverless function proxies — key never reaches the browser | `api/send-email.mjs` |
| 6. Data | Supabase RLS — anon key can read, never write | `marketing-analyzer/schema.sql` |
| 7. Transport | HSTS, X-Frame-Options, Content-Type nosniff | `vercel.json` |

Any single layer failing is survivable. All seven failing is deliberate sabotage.
