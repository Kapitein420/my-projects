# Marketing Analyzer — Amsterdam Zuidoost

Scores office-building landing pages on marketing/branding quality. Hybrid rule-based + Claude AI scoring. Dashboard renders the results; a Node CLI does the scoring.

## Files
- `index.html` / `app.js` — dashboard (reads from Supabase via `../shared/db.js`)
- `schema.sql` — 2 tables to paste into Supabase SQL editor (one-time)
- `seeds.js` — ~8 Zuidoost anchor buildings
- `analyze.mjs` — Node CLI: fetch pages → rule checks → Claude scoring → write to Supabase
- `package.json` — only dep is `@anthropic-ai/sdk` for the CLI

## One-time setup

1. Supabase → SQL Editor → paste `schema.sql`, run.
2. `cd marketing-analyzer && npm install`
3. Get an Anthropic API key at https://console.anthropic.com/settings/keys

## Run a scan

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node analyze.mjs --seed              # push sample buildings first time
node analyze.mjs --limit=3           # score 3 buildings (~$0.02 each)
node analyze.mjs --building=<slug>   # re-score one
node analyze.mjs --force             # re-score all
```

Dashboard auto-reads new scores on refresh.

## What gets scored

**Rule-based (0–100)** — HTML inspection: TLS, OG tags, schema.org, viewport, hreflang, language lang attrs, CTAs ("Plan een bezichtiging" etc), alt-text density, word count, contact links.

**AI (0–100)** — Claude Sonnet 4.6 scores 8 dimensions 0–10 each: copy clarity NL, copy clarity EN, brand distinctiveness, target tenant fit, amenity messaging, trust signals, CTA quality, structural clarity. Plus top 3 actionable recommendations per building.

**Composite** = 0.4 × rule + 0.6 × AI.

## Cost

~$0.02 per building per scan. 60 buildings ≈ $1.20.

## Limitations today (text-only)

No screenshots yet, so visual hierarchy / typography / photography dimensions are not scored — upgraded to text-based ones. A Playwright pass can be added later for the full 10-dimension vision scoring.
