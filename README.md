# Health-App ("Darfum")

A personal health tracking app with five segments — **Workout**, **Nutrition**, **Sleep**,
**Vitamins**, **Mobility** — each with its own AI assistant, all coordinated by a **master agent** on the
Dashboard. Everything runs locally: Express + SQLite backend, React frontend, Anthropic API
for the agents.

## Option A — the phone-only version (GitHub Pages, no computer needed)

The app is published as **Darfum** at
**https://ezraharris385.github.io/Health-App/** — it runs entirely in your
phone's browser: the database (SQLite compiled to WebAssembly) lives in the
browser's storage on your device, and the AI agents call Anthropic directly
with a key you enter once in Settings (stored only on the device).

1. Open the URL on your phone and **Add to Home Screen**.
2. In **Settings**, paste your Anthropic API key (AI assistants) — optional.
3. Use **Settings → Data → Export backup** now and then; your data lives on
   that one device, and the backup file restores everything (including agent
   memories) via Import.

Notes: only one tab/window can have the app open at a time (a second one is
politely refused so they can't overwrite each other); the public URL serves
only the empty app shell — visitors get their own blank copy, never your data.
Deploys are automatic: every push rebuilds and publishes via GitHub Actions.

## Option B — run it on a computer (no terminal experience needed)

1. Install **Node.js** from [nodejs.org](https://nodejs.org) (green button → Next → Finish).
2. Download this project as a ZIP from GitHub (green **Code** button → Download ZIP) and unzip it.
3. Double-click **`Start Health App.bat`** (Windows) or **`Start Health App.command`** (Mac —
   right-click → Open the first time). On first run it asks for your Anthropic API key
   (from [platform.claude.com](https://platform.claude.com)), installs, builds, and starts.
4. On your phone (same Wi-Fi), open the `on your phone:` address the window shows, then
   **Add to Home Screen**. Leave the computer window open while you use the app.

## Quick start (developers)

```bash
npm install
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm run dev                 # server on :3001, app on http://localhost:5173
```

Without an API key everything still works (logging, charts, scores) — only the AI chat
panels are disabled.

For a production-style run: `npm run build && npm start` then open http://localhost:3001.

## Using it on your phone

The app is built phone-first: a bottom tab bar, touch-sized controls, and charts that fit
small screens.

1. Run `npm run build && npm start` on a computer (or home server) on your Wi-Fi.
2. The server prints an `on your phone:` URL (your computer's LAN IP) — open it in your
   phone's browser.
3. Use **Add to Home Screen** — the app installs standalone (no browser chrome) with its
   own icon.

The server listens on all interfaces by default (`HOST=0.0.0.0`); it's intended for your
own private network — don't port-forward it to the internet as there's no authentication.

Data lives in `data/health.db` (SQLite). Back that one file up and you've backed up
everything, including the agents' memories and conversations.

## The segments

- **Workout** — exercise library, workout plans with a weekly schedule, and session logging
  two ways: live set-by-set, or a guided grid that records a whole finished workout (only
  what you actually did vs the plan-day template, including timed work like planks) in one
  save — plus per-exercise performance charts.
- **Cardio** — its own tab (still coached by the workout agent and counted in the workout
  score): a walks/runs log (run/jog/walk/interval, distance, intensity, auto-estimated
  run-vs-walk step splits with a manual override, and a free-text "how it went" report the
  coach uses for analysis) with weekly distance/steps tiles and history charts.
- **Nutrition** — your food library (macros + micronutrients), per-meal daily log, calorie &
  macro tracking vs goals with 30-day history, in-depth water tracking, and daily weight with
  trend charts.
- **Sleep** — one-tap "going to bed" / "I'm awake" buttons plus manual entry for forgotten
  nights; duration vs target history.
- **Vitamins** — 0–100% coverage meters for ~18 tracked micronutrients (computed from logged
  foods + supplements vs daily targets), and reusable supplements you create once (with their
  nutrient contents) and tick off each day.
- **Mobility** — a stretch/yoga-pose/posture-drill bank, routines built from it, session
  logging with a qualitative "how it went" report, and your own named metrics (e.g.
  "Hamstring flexibility") rated 1-10 over time with trend charts.
- **Dashboard** — your daily health score (weighted: nutrition 28%, workout 22%, sleep 22%,
  vitamins 15%, mobility 13%) with weekly/monthly trends and the master agent chat.

## The agents

Every segment has an agent with **persistent memory** (notes it saves about your goals,
preferences, constraints, and patterns — stored in SQLite and injected into every future
conversation) and **live tools** over its segment's data: they don't just advise, they can
log your food, build a complete workout plan, mark supplements taken, and so on — always
at your request; they never record data you didn't tell them about.

The **master agent** on the Dashboard monitors all segments, explains your score, and makes
combined recommendations. For cross-segment asks it *consults the specialists directly* —
e.g.:

> "I want a dinner that stays under my remaining calories but fixes today's low iron and
> magnesium" → it tasks the nutrition and vitamins agents together and synthesizes one plan.

> "I'm having a heavy meal tonight" → it pulls nutrition (what to eat the rest of the day)
> and workout (how to adjust training) into one answer.

Agents run on `claude-opus-4-8` with adaptive thinking (configurable via `AGENT_MODEL`
in `.env`).

## Scores

Formulas are simple and documented in `server/score.ts`; every daily score comes with a
human-readable breakdown per component, and the master agent can explain any number.

## Development

- `npm run dev` — server (tsx watch) + client (vite) with proxy
- `npm run typecheck` — both tsconfigs
- `npm run build` — typecheck server + build client
- Architecture and contribution conventions: `docs/ARCHITECTURE.md`
