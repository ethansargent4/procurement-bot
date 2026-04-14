# Procurement Bot

End-to-end federal procurement workflow automation. Polls SAM.gov for supply opportunities (brake calipers, generators, widgets, whatever your NAICS), discovers suppliers from three sources, auto-emails them RFQs from your Gmail, parses their quote replies with Claude, drafts a bid with your configurable margin, and drops it in an **approval queue** — you click Approve, submit on SAM.gov, then mark it won. Won projects show up in a "Projects" tab you can update as you ship.

Comes with a React dashboard that has an opportunities list, a flowchart view of the whole pipeline, an approval queue, and a projects tracker.

## Architecture

```
SAM.gov API ─┐
             ├─ Postgres ── Express API ── React dashboard
Gmail API  ──┤                (routes)      (public/index.html)
Serper API ──┤
Anthropic ───┘
                ▲
                │ cron + on-demand pipeline (src/bot.js)
```

Pipeline stages (all live in `src/bot.js`):

1. **Poll** — fetches SAM.gov opportunities for the NAICS / PSC / set-aside filters in your env, scores each, upserts to DB.
2. **Research** — for each `new` opportunity: Claude extracts structured requirements, then `src/suppliers/index.js` pulls candidate suppliers from your manual CSV, SAM.gov Entity Management, and Serper web search.
3. **Outreach** — Claude drafts a short RFQ email, Gmail sends it, DB tracks thread IDs.
4. **Replies** — pulls replies on each open thread, Claude parses into structured quote rows.
5. **Bid drafts** — for each opportunity with a quote, Claude drafts a bid (supplier cost + margin), status goes to `pending_approval`, you see it in the dashboard.
6. **Human approval** — you click Approve, submit on SAM.gov yourself, come back and click "Mark submitted" → "Mark won" / "Mark lost". Won bids auto-create a project row.

> **Why human approval?** Federal bids are legally binding. An LLM misreading a spec could commit you to a losing contract. This bot does 95% of the work and asks you to pull the trigger.

## Project layout

```
procurement-bot/
├── package.json
├── railway.json
├── .env.example
├── .gitignore
├── README.md
├── data/
│   └── suppliers.csv           # your curated supplier list
├── public/
│   └── index.html              # React dashboard (single-file, no build step)
└── src/
    ├── index.js                # Express + cron
    ├── config.js               # all env vars
    ├── db.js                   # pg pool + query helpers
    ├── schema.sql              # tables
    ├── migrate.js              # applies schema.sql
    ├── sam.js                  # SAM.gov Opportunities poller + scoring
    ├── llm.js                  # Claude: requirements, RFQ emails, quote parsing, bid drafts
    ├── gmail.js                # OAuth + send + read replies
    ├── bot.js                  # pipeline orchestrator
    ├── runOnce.js              # CLI one-shot pipeline runner
    ├── suppliers/
    │   ├── index.js            # combines all three sources
    │   ├── serper.js           # web search
    │   ├── samEntities.js      # registered federal vendors by NAICS
    │   └── manual.js           # loads data/suppliers.csv
    └── routes/
        ├── api.js              # REST API
        └── oauth.js            # Gmail OAuth callback
```

## Setup

### 1. Prereqs — collect API keys

You'll need:

- **SAM.gov API key** — sign in at [sam.gov](https://sam.gov) → Account → Request Public API Key. Docs: <https://open.gsa.gov/api/get-opportunities-public-api/>
- **Anthropic API key** — <https://console.anthropic.com>
- **Serper key** (optional but recommended) — <https://serper.dev>, free tier is fine
- **Google OAuth client** — <https://console.cloud.google.com>:
  1. Create a project, enable Gmail API
  2. OAuth consent screen → External, add yourself as a test user
  3. Credentials → Create Credentials → OAuth 2.0 Client ID → Web application
  4. Authorized redirect URIs: `http://localhost:3000/oauth/google/callback` *and* `https://<your-railway-domain>/oauth/google/callback`
  5. Copy Client ID and Client Secret

### 2. Local setup

```bash
cd procurement-bot
cp .env.example .env           # fill in everything except GOOGLE_REFRESH_TOKEN
npm install
# Start Postgres locally (or use Railway's DB remotely):
#   docker run -p 5432:5432 -e POSTGRES_PASSWORD=pg -d postgres
# set DATABASE_URL=postgresql://postgres:pg@localhost:5432/postgres
npm run migrate
npm run dev
```

Open http://localhost:3000 — dashboard should load. Go to http://localhost:3000/oauth/google to authorize Gmail. Copy the refresh token into `.env` and restart.

Add a few rows to `data/suppliers.csv` with real suppliers you trust, tagged with what they sell.

Click "Run pipeline now" in the dashboard. Watch opportunities flow through.

### 3. Push to GitHub

I can't push for you (no GitHub connector), but here's the exact sequence:

```bash
cd procurement-bot
git init
git add .
git commit -m "Initial commit: procurement bot"

# Install GitHub CLI once: https://cli.github.com
gh auth login
gh repo create procurement-bot --private --source=. --push
```

Or, if you prefer manual: create an empty repo on github.com, then
`git remote add origin https://github.com/<you>/procurement-bot.git && git branch -M main && git push -u origin main`.

### 4. Deploy to Railway

1. <https://railway.app> → **New Project** → **Deploy from GitHub repo** → pick `procurement-bot`.
2. After initial deploy fails (no DB), click **+ New** → **Database** → **PostgreSQL**. Railway auto-wires `DATABASE_URL`.
3. Go to your service → **Variables** → add everything from `.env` except `DATABASE_URL` (already set).
4. **Settings** → **Networking** → **Generate Domain**. Copy the URL.
5. Update `GOOGLE_REDIRECT_URI` in variables to `https://<that-domain>/oauth/google/callback` and add the same URI to your Google OAuth client's authorized redirect URIs.
6. Redeploy. Visit `https://<domain>/oauth/google` to authorize Gmail, copy the refresh token into Railway vars as `GOOGLE_REFRESH_TOKEN`, redeploy once more.
7. Done. Open `https://<domain>/` for the dashboard.

The `railway.json` runs `node src/migrate.js && node src/index.js` on start, so the schema auto-applies on each deploy.

## Using the dashboard

- **Opportunities tab** — lists everything the bot has pulled, click a row to see description, outreach, quotes.
- **Flowchart tab** — visual pipeline: opportunity → suppliers contacted. Animated edges = in-flight outreach. (Uses ReactFlow.)
- **Approvals tab** — bids waiting for your sign-off. Approve / Reject / Mark submitted / Mark won / Mark lost.
- **Projects tab** — won contracts. Update status (active / shipped / delivered / completed / issue) via the API (UI edit is next on the list).

The "Run pipeline now" button top-right runs all five stages end-to-end. There's also a cron running every 4 hours by default (`CRON_SCHEDULE`).

## What's real vs stub

**Real:** SAM.gov polling, Postgres storage, supplier discovery from three sources, Gmail OAuth send + read, Claude-based requirements/quote/bid text, full approval workflow, dashboard.

**Stubs / to extend:**
- **SAM.gov bid submission** is not automated. You submit manually after approval. (SAM.gov doesn't have a public bid submission API for most solicitation types.)
- **Quote parsing confidence** is whatever the LLM returns; you'll want to tune the prompt or add rules.
- **Supplier scoring / dedupe** is naive (name+email). Swap in fuzzy matching if you get real volume.
- **Project fulfillment UI** — API supports updates, UI is read-only. Easy to extend.

## Endpoints (JSON)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/opportunities` | list |
| GET | `/api/opportunities/:id` | detail + outreach + quotes |
| POST | `/api/opportunities/:id/status` | `{ status }` |
| GET | `/api/outreach` | for flowchart |
| GET | `/api/bids?status=pending_approval` | approval queue |
| POST | `/api/bids/:id/approve` | |
| POST | `/api/bids/:id/reject` | |
| POST | `/api/bids/:id/mark-submitted` | |
| POST | `/api/bids/:id/mark-won` | also creates a project row |
| POST | `/api/bids/:id/mark-lost` | |
| GET | `/api/projects` | won contracts |
| POST | `/api/projects/:id` | update fields |
| GET | `/api/suppliers` | |
| POST | `/api/run/all` | full pipeline |
| POST | `/api/run/{poll,research,outreach,replies,bids}` | single stage |
| GET | `/api/config` | env status |

If `DASHBOARD_PASSWORD` is set, everything under `/api/*` requires `?key=<password>` or `Authorization: Bearer <password>`.

## Next steps I'd recommend

1. **Curate `data/suppliers.csv`** aggressively — the manual list is the highest-quality source and gets priority.
2. **Tune `KEYWORDS` and `MIN_SCORE`** — the default NAICS is broad; narrow it to what you actually supply.
3. **Review every bid draft** for the first 10–20 before trusting the pipeline's output.
4. **Add Slack alerts** when a bid hits `pending_approval` so you don't have to poll the dashboard.
