# Foundation League

A browser-based, multiplayer soccer club-management sim: 3 divisions of 8 clubs,
a live minute-by-minute match engine you can change tactics and make subs in
mid-game, a real auction + transfer market, contracts, sponsorships, coaches,
youth academies, a player development/retirement engine, and admin-curated
Icon/Hero/Special marquee players. Built to run as a single web service on
Render with a Postgres database, so nothing is lost between visits or deploys.

All players, clubs, and managers are real — 24 real clubs from the top 5
European leagues, 1,003 real professional footballers, and 72 real
managers, all seeded as free agents and auctioned onto clubs (managers,
then players) tier by tier. See `server/src/constants/realWorld.js` for
the data and its honesty notes (attributes are engine-generated, not a
licensed rating; squads reflect general football knowledge and will drift
from reality over time; named medical staff are placeholders, not real
people).

## Stack

- **Server**: Node.js + Express + Socket.IO + PostgreSQL (`pg`, no ORM)
- **Client**: React + Vite + Tailwind CSS v4, served by the same Express process
- **Realtime**: Socket.IO rooms for live matches and the live auction

One web service, one Postgres database. That's the whole deployment.

## Local development

Prerequisites: Node 20+, a Postgres database (local or remote).

```bash
# 1. Server
cd server
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET
npm run dev             # http://localhost:8080

# 2. Client (separate terminal)
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api and /socket.io to :8080
```

The first account you register through the app automatically becomes the
league **admin**. From the Admin Panel, click **Full reset** to generate the
world (3 divisions × 8 real clubs + a 1,003-player real free-agent pool +
72 real managers).

For production-style testing, run `npm run build` from the repo root, then
`npm start` from `server/` — Express will serve the built client itself.

## Deploying to Render

1. Create a free, **permanent** Postgres database — [Neon](https://neon.tech)
   is recommended (Render's own free-tier Postgres expires and gets deleted
   after a period of inactivity; Neon's free tier doesn't). Copy its
   connection string.
2. Push this repo to GitHub.
3. In Render, choose **New → Blueprint** and point it at the repo — it will
   read `render.yaml` and create the web service on the free plan. When it
   asks for `DATABASE_URL` (left blank in the blueprint on purpose), paste
   the Neon connection string from step 1.
   - Or set it up by hand: a **Web Service** with build command
     `npm install --prefix server && npm install --prefix client && npm run build --prefix client`,
     start command `npm start --prefix server`, plus `DATABASE_URL` (the Neon
     string) and a `JWT_SECRET` env var set on the web service.
4. Once deployed, register the first account — that's your admin login — and
   run **Full reset** from the Admin Panel to generate the league.

Because everything lives in that external Postgres (not in memory or on
local disk), your league survives redeploys and restarts — including a
**live match or live auction in progress**: state is persisted to the
database on every tick/bid,
so if the process restarts mid-match or mid-auction (deploy, crash,
free-tier spin-down) it resumes automatically on the next boot instead of
being lost. One thing worth knowing about Render's free tier specifically:
a free web service spins down after ~15 minutes idle and takes 30-60s to
wake back up on the next visit — that's a cold-start delay (and, for a live
match/auction, a pause exactly that long), not data loss. The Starter plan
avoids the idle spin-down if that matters to you.

## How it plays

**Stages.** Elite (Stage 1) is the top division, Rise (Stage 2) the middle,
Foundation (Stage 3) the bottom — 8 clubs each. Every season the bottom 2 of
Elite swap with the top 2 of Rise, and likewise between Rise and Foundation.
Which stage a club is in feeds directly into prize money, budgets, and player
morale/ambition.

**Getting started.** Clubs begin as empty shells — real badge/colors, real
stadium, a starting budget, no manager or players. An admin runs the live
**manager auction** and **player auction** for each division in turn (Elite,
then Rise, then Foundation) to distribute the pool of 72 real managers and
1,003 real players (timed bidding with soft-close, plus an "auto-fill
remaining" button so you're not forced to manually bid on all of it). Each
club can hold up to 35 players; whatever's left stays in the free-agent pool.
After that, the **transfer market** stays open: list players, make/accept/
reject offers, sign free agents on contracts, hire a new manager.

**Matches.** Generate fixtures per stage from the Admin Panel, then kick off
any match (as admin, or as the manager of either club). It simulates live,
roughly a minute every ~1.7 real seconds at 1x speed (adjustable), with a
commentary feed. Managers can change **formation and mentality** and make
**substitutions (5 per match)** in real time while it's running — anyone else
can just spectate.

**Player growth.** Every player has 7 stat categories (Pace, Shooting,
Passing, Dribbling, Defending, Physical, Goalkeeping), each built from 3
sub-attributes you can drill into on their profile. Roughly twice a season
("Run development" in the Admin Panel, plus automatically at season-end),
every player's sub-attributes nudge up, down, or hold steady based on age,
position, morale, and a club's Youth Academy level. From age 33 retirement
risk climbs every season.

**Facilities.** Each club has a Youth Academy (1★-5★: 1-5 graduates per
season, better academies + higher divisions producing better prospects, and
faster development/slower decline league-wide) and a Medical Centre (1★-5★:
cuts injury recovery time up to 50% at level 5). Upgrades cost budget.

**Marquee players (Icon / Hero / Special).** These are hand-built by the
admin only — never auctioned, never transferred. Elite clubs may hold one of
each (Icon fixed at 95 overall, Hero 89 up to 90, Special fixed at 85); Rise
clubs may hold a Hero and a Special; Foundation clubs a Special only. That's a
hard cap of 8 Icons / 16 Heroes / 24 Specials league-wide. A manager can
request an open slot from their Team page; it shows up in the Admin Panel for
you to fulfill with a name and hand-entered stats.

**Reset, three ways**, all in the Admin Panel:
- *Run development* — stat nudges only, no other changes.
- *Reset current season* — clears this season's results/fixtures, keeps every
  squad/contract/finance untouched.
- *Advance season* — the full year-end rollover: prize money, wage/sponsor
  settlement, promotion/relegation, development, retirements, youth intake,
  fresh fixtures.
- *Full reset* — wipes everything and regenerates a brand new world. User
  accounts are kept but every manager claim is cleared.

## Project layout

```
server/          Express API + Socket.IO + Postgres access + game engine
  src/engine/    Pure simulation logic (match, world gen, economy, development, auction)
  src/constants/ Real clubs/managers/players data (realWorld.js) + flavor pools
  src/services/  DB-aware orchestration (league lifecycle, transfer market, marquee)
  src/routes/    REST endpoints
  src/sockets/   Live match + auction realtime handlers
  src/db.js      Postgres pool + kv_store helpers (persists live match/auction
                 state so a restart mid-event resumes instead of losing it)
client/          React + Vite + Tailwind frontend
render.yaml      One-click Render Blueprint (web service + Postgres)
```

## Notes on scope

This is a deliberately-scoped simulation, not a literal recreation of every
mechanic a full club-management game might have. A few things are
intentionally simplified from what a AAA sim would do: no in-game transfer
"negotiation" beyond the AI accept/reject heuristics for offers made to
unmanaged clubs and player contract offers; no calendar/date system (the
league advances by matchday and season, not real dates); the real-player
and real-manager data is a snapshot built from general football knowledge,
not a licensed, continuously-updated feed. All very extendable if you want
to go deeper on any one of these later.
