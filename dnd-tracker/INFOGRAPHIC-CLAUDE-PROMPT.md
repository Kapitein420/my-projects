# Visual System Report — Claude Chat Prompts

Copy-paste these into Claude.ai chat to generate infographic images.

---

## 1. System Architecture Diagram

```
Create an infographic image showing a web application architecture for a D&D Dungeon Master toolkit called "Tome of Heroes".

Layout: Vertical flow diagram, dark parchment background (#1e1b16), gold (#c8b070) connecting lines, cream (#e2dbd0) text labels.

TOP: "GitHub Pages" cloud — contains 7 files: index.html, map.js, fog.js, monsters.js, combat.js, spells.js, db.js

MIDDLE: 6 hexagonal feature nodes in a ring, connected:
- Map System (map icon): tokens, fog of war, video backgrounds
- Combat Engine (sword icon): initiative, turns, damage tracking
- Monster DB (dragon icon): 327 SRD creatures, encounters
- Spell Reference (wand icon): 319 spells, conditions
- Session Reports (scroll icon): MVP, leaderboard, kill feed
- Player View (eye icon): fullscreen sync, fog applied

BOTTOM: Two service boxes:
- Supabase (3 tables: characters, sessions, maps — all JSONB)
- Pollinations.ai (free AI scene images)

Style: Clean technical diagram with dark fantasy aesthetics, Baldur's Gate 3 inspired UI, professional infographic quality. No clutter — readable and elegant.
```

---

## 2. Today's Build Timeline

```
Create a horizontal timeline infographic showing 31 pull requests merged in one day building a D&D app.

Background: Dark warm brown (#1e1b16)
Timeline: Gold (#c8b070) horizontal line with dots at each phase

5 phases along the timeline:

PHASE 1 "Foundation" (PRs 1-4): Map system, fog of war, 327 monsters
Icon: hammer and anvil

PHASE 2 "Combat" (PRs 5-7): Initiative tracker, token images, player view
Icon: crossed swords

PHASE 3 "Data" (PRs 8-10): 319 spells, conditions, combat log, reports
Icon: open book

PHASE 4 "Design" (PRs 11-21): BG3 theme, light dashboard, dark cards, color palette
Icon: paintbrush

PHASE 5 "Polish" (PRs 22-31): Video maps, campaign import, AI images, session analysis
Icon: gem/diamond

Stats bar at bottom:
30 PRs | 8 new files | 3,500+ lines | 17 features | 12 bugs fixed | $0 cost

Style: Clean infographic, warm dark fantasy palette, gold accents, professional timeline visualization. Readable text, no clutter.
```

---

## 3. Data Flow Diagram

```
Create a data flow diagram showing how a D&D app syncs between DM and players.

Two sides connected through a central database:

LEFT SIDE - "DM's Screen":
- Map Editor (edit tokens, place fog, manage combat)
- Combat Log (damage events, kills, heals)
- Session Analysis (parse notes, generate images)
Arrow pointing right labeled "Save"

CENTER - "Supabase Cloud":
- Three tables stacked: characters, sessions, maps
- Each stores JSONB data blobs
- Labeled "Real-time sync"

RIGHT SIDE - "Player's Screen":
- Fullscreen map view
- Fog applied (only revealed areas visible)
- Tokens visible (no monster HP)
- Turn indicator (whose turn it is)
Arrow pointing left labeled "Poll every 3s"

BOTTOM - "External Services":
- Pollinations.ai → generates scene images for session analysis
- YouTube Embed → video map backgrounds

Style: Dark background, gold flow arrows, cream labels, clean technical diagram with fantasy UI elements. Baldur's Gate 3 aesthetic.
```

---

## 4. Skills Roadmap (RPG Skill Tree)

```
Create an RPG skill tree infographic showing a developer's learning progression toward building AI-powered tools.

Background: Dark with subtle star field, like a constellation map

THREE TIERS connected by gold lines:

TIER 1 "Foundation" (5 nodes, GREEN/lit up — completed):
- Vanilla JavaScript (code brackets icon)
- Canvas 2D Rendering (paintbrush icon)
- Supabase Database (cylinder icon)
- GitHub Pages CI/CD (rocket icon)
- CSS Design Systems (palette icon)
Label: "Built today — 30 PRs shipped"

TIER 2 "Advanced" (4 nodes, AMBER/partially lit):
- Supabase Realtime (lightning icon)
- Edge Functions (server icon)
- Claude API Integration (brain icon)
- WebGL / 3D Maps (cube icon)
Label: "Next sprint"

TIER 3 "AI Agents" (5 nodes, RED/locked/mysterious glow):
- AI DM Assistant (wizard hat)
- Automated Session Recaps (scroll)
- Security Audit Agent (shield)
- Learning Progress Tracker (chart)
- Collaboration Agent (people icon)
Label: "Vision — AI agent rollout"

Each node has a small circular progress indicator.
Gold connecting lines show prerequisites between tiers.

Style: Fantasy RPG talent tree, dark background, glowing nodes, particle effects on completed nodes, warm gold and amber connections. Professional and clean.
```

---

## 5. Feature Dashboard Mockup

```
Create a UI mockup screenshot of a D&D Dungeon Master app called "Tome of Heroes" showing the map editor view.

Layout: Three-column design on warm neutral background (#efeeeb)

LEFT COLUMN (dark panel #1e1b16, 200px):
- "CHARACTERS" header in gold
- 3 character cards with circular portrait images, names, HP bars (green)
- "MONSTERS" header in gold
- Search input field
- Encounter list with monster names, HP bars, +/- buttons

CENTER (main area):
- Dungeon map image with hex grid overlay (subtle gold lines)
- 5 circular tokens placed on the map (character portraits with colored borders)
- Semi-transparent fog covering unrevealed areas
- Active turn token has a glowing gold pulse effect

RIGHT COLUMN (dark panel, 220px):
- Tab bar: "NOTES | COMBAT LOG | REFERENCE"
- Session notes textarea
- Spell search input

TOP: Dark toolbar with buttons: Maps, Save, DM View, Fog On, Combat, Report, Player Screen, Link, Snapshots

Below toolbar: Initiative bar showing 6 portrait circles with names and initiative numbers, one highlighted in gold

Style: Baldur's Gate 3 inspired dark fantasy UI, warm brown dark panels, gold accents, cream text, professional app design mockup. Realistic and polished.
```
