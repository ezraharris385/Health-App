# Health-App

A personal health tracking app with four segments — **Workout**, **Nutrition**, **Sleep**,
**Vitamins** — each with its own AI assistant, all coordinated by a **master agent** on the
Dashboard. Everything runs locally: Express + SQLite backend, React frontend, Anthropic API
for the agents.

## Quick start

```bash
npm install
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm run dev                 # server on :3001, app on http://localhost:5173
```

Without an API key everything still works (logging, charts, scores) — only the AI chat
panels are disabled.

For a production-style run: `npm run build && npm start` then open http://localhost:3001.

Data lives in `data/health.db` (SQLite). Back that one file up and you've backed up
everything, including the agents' memories and conversations.

## The segments

- **Workout** — exercise library, workout plans with a weekly schedule, session/set logging
  with per-exercise performance charts, and a walks/runs log (run/jog/walk/interval,
  distance, intensity, auto-estimated run-vs-walk step splits with a manual override, and a
  free-text "how it went" report the coach uses for analysis).
- **Nutrition** — your food library (macros + micronutrients), per-meal daily log, calorie &
  macro tracking vs goals with 30-day history, in-depth water tracking, and daily weight with
  trend charts.
- **Sleep** — one-tap "going to bed" / "I'm awake" buttons plus manual entry for forgotten
  nights; duration vs target history.
- **Vitamins** — 0–100% coverage meters for ~18 tracked micronutrients (computed from logged
  foods + supplements vs daily targets), and reusable supplements you create once (with their
  nutrient contents) and tick off each day.
- **Dashboard** — your daily health score (weighted: nutrition 30%, workout 25%, sleep 25%,
  vitamins 20%) with weekly/monthly trends and the master agent chat.

## The agents

Every segment has an agent with **persistent memory** (notes it saves about your goals,
preferences, constraints, and patterns — stored in SQLite and injected into every future
conversation) and **live tools** over its segment's data: they don't just advise, they can
log your food, build a complete workout plan, mark supplements taken, and so on.

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
