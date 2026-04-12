# My Projects

Personal web app launcher and project portfolio. All apps run directly in the browser — no server, no build step, no dependencies.

## Structure

```
my-projects/
├── index.html              ← Project launcher (start here)
├── README.md               ← This file
└── dnd-tracker/
    └── index.html          ← D&D Campaign Tracker
```

Each project lives in its own folder. Add new projects by dropping a folder in here and registering it in the launcher.

---

## D&D Campaign Tracker

Track your tabletop campaign — characters, sessions, transcripts, and AI-generated scene analysis.

### Features
- Full D&D 5e character sheets (ability scores, skills, saving throws, equipment, backstory)
- Session logging with transcript paste-in
- AI analysis that extracts key events, NPCs, loot, and plot threads from transcripts
- Cinematic image prompts generated per scene (copy into any image generator)
- Live HP tracker per character
- Export/import JSON backup

### Data storage
The app uses **Supabase** (cloud Postgres) by default. Data syncs across all devices and browsers automatically.

Falls back to **localStorage** (browser only) if Supabase is unreachable.

---

## Supabase Setup

One-time setup. Run this SQL in your Supabase project → SQL Editor:

```sql
create table characters (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table maps (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table characters disable row level security;
alter table sessions disable row level security;
alter table maps disable row level security;
```

Credentials are baked into the app files. To update them, open the `☁ Cloud` button in the app nav and paste new values — or ask Claude to update the files directly.

### Adding a new app to Supabase
Each new app just needs its own tables following the same pattern:

```sql
create table your_app_table (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table your_app_table disable row level security;
```

---

## Development Workflow

Claude writes and updates all the code. The workflow is:

```
1. Describe what you want in Claude
2. Download the updated file(s)
3. Drop them into the right folder (replacing old versions)
4. Commit and push via GitHub Desktop or the GitHub web UI
5. Live at yourusername.github.io/my-projects/ within 60 seconds
```

Your Supabase data is **never affected by file updates** — it lives in the database, not the HTML file.

### Adding a new project
1. Create a new folder under `my-projects/`
2. Put the app's `index.html` inside it
3. Open the launcher → click **+ New project**
4. Enter the folder path (e.g. `recipe-tracker/index.html`) and details
5. Commit and push

---

## GitHub Pages

This site is hosted on GitHub Pages at:
`https://[username].github.io/my-projects/`

Pages auto-deploys on every push to `main`. Changes are live within ~60 seconds.

**Settings:** Repository → Settings → Pages → Source: Deploy from branch → main → / (root)

---

## Updating via GitHub web UI (no desktop app needed)

You can update files directly in the browser at github.com:

1. Navigate to the file you want to replace
2. Click the pencil icon (Edit) — or drag-drop a new file into the folder
3. Paste the new content
4. Click **Commit changes** → Commit directly to main
5. Pages redeploys automatically

---

## Claude Code Laptop — Automated Workflow

For Claude to write, commit, and push files to GitHub **without any manual steps**, set up a dedicated Claude Code machine. This is the fastest development workflow — you describe what you want and Claude Code does the rest.

### What "Claude Code laptop" means

A spare computer (or a dedicated user account on any machine) that runs Claude Code — Anthropic's terminal app. Claude Code can read and write files, run git, push to GitHub, and call any tool you connect to it. It reads `CLAUDE.md` at the start of every session so it always knows your project structure, conventions, and what's been built.

The browser version of Claude (claude.ai) can design and generate files, but cannot push to GitHub. Claude Code on your machine closes that loop.

### One-time setup

Run `setup.sh` from this repo on the machine:

```bash
# Download and run — handles everything below automatically
chmod +x setup.sh && ./setup.sh
```

**What the script installs and configures:**

| Step | What | Why |
|------|------|-----|
| Node.js via nvm | JavaScript runtime | Required for Claude Code |
| Claude Code | The AI terminal app | Writes and pushes code |
| GitHub CLI (`gh`) | Secure GitHub auth | No passwords, tokens managed safely |
| SSH key (Ed25519) | GitHub authentication | Safer than HTTPS + password |
| GitHub MCP server | Claude ↔ GitHub bridge | Claude can push directly |
| `.env` file | Local secrets store | API keys never committed |

### After setup

```bash
cd ~/projects/my-projects
claude
```

That's it. Inside Claude Code you talk normally:

> *"Add a spell slot tracker to the D&D app and push it"*
> *"Create a new app for tracking recipes, connect it to Supabase"*
> *"Fix the HP bar bug and deploy"*

Claude Code reads `CLAUDE.md`, understands your full project context, makes the changes, commits with a sensible message, and pushes. Your live site updates within 60 seconds.

### Security model

The setup is designed so nothing sensitive ever touches GitHub:

```
~/.ssh/github_claude_laptop     ← SSH private key (stays on machine)
~/projects/my-projects/.env     ← API keys and secrets (gitignored)
gh auth token                   ← GitHub token (managed by gh CLI)
```

If the laptop is lost or compromised:
1. Go to github.com → Settings → SSH keys → delete `Claude Laptop`
2. Go to github.com → Settings → Personal access tokens → revoke the token
3. Go to console.anthropic.com → API keys → delete the key

That's a full revoke in under 2 minutes. The machine had access to nothing else.

### CLAUDE.md — Claude's persistent memory

`CLAUDE.md` in this repo is the most important file. Claude Code reads it at the start of every session and uses it to understand:

- Who you are and what this project is
- Every app in the repo and what it does
- The DB object pattern and design rules
- How to handle commits, new apps, and debugging

Keep it updated as you build more apps. Claude Code will update it automatically when you add projects.

---

## Projects

| App | Path | Database tables |
|-----|------|----------------|
| D&D Campaign Tracker | `dnd-tracker/` | `characters`, `sessions` |

*Add new rows here as you build more apps.*
