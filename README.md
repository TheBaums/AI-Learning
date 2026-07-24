# ⛳ Golf Bets

A mobile-first web app for playing golf betting games with your friends. Enter
players and handicaps, set up your course once and reuse it, track scores
hole-by-hole, and get the payouts (and who-pays-whom) at the end of the round.

Everything runs in your browser and is stored on your device — no account, no
server, and it works **offline** on the course (it installs as a PWA).

## Features

- **Players** — save friends with their handicaps and reuse them every round.
- **Courses** — enter par, stroke index and yardage for each hole once; saved
  for reuse. (Photo-scorecard import is stubbed for a future release.)
- **Games** — each with a per-game **net / gross** toggle, and a **"birdies
  double the hole"** option on the per-hole-money games:
  - **Skins** — low score wins the hole; ties carry the pot forward.
  - **Wolf** — 4 players; rotating Wolf picks a partner or goes Lone Wolf for
    triple stakes (pick partner/Lone right on the scorecard each hole).
  - **Banker** — rotating banker plays a match vs everyone each hole.
  - **666 (Sixes)** — 4 players; partners rotate every 6 holes. Choose
    **low ball**, **low total**, or **both** (2 points/hole). The current
    6-hole pairing is shown right on the scorecard.
  - **Nassau** — front 9 / back 9 / total, match play, 1v1 or 2v2 best ball.
  - **Match Play** — a single head-to-head match, most holes won takes it.
  - **Vegas** — 2 teams; scores form a number (4 & 6 = 46), lower wins,
    difference × value. Birdies flip the opponent's number.
  - **Stableford / Quota** — points per hole vs par; most points wins the pot.
  - **Bingo Bango Bongo** — 3 points a hole (first on, closest, first in),
    tapped in on the scorecard as you play.
  - **Stroke Play** — lowest total wins the pot.
- **Live standings** while you play and a **final settlement** that reduces
  everything to the fewest "X pays Y $Z" transactions.
- **Manage everything** — delete players, courses, and rounds with the 🗑
  button on each.

## Running it

It's a static site — no build step.

```bash
# from the repo root
python3 -m http.server 8080
# then open http://localhost:8080 on your phone or laptop
```

Or host the folder on **GitHub Pages** (Settings → Pages → deploy from branch)
and open the URL on your phone. Use your browser's *Add to Home Screen* to
install it as an app; after the first load it works with no signal.

> A service worker caches the app for offline use. If you change files during
> development, bump the `CACHE` version in `sw.js` (or hard-refresh) to pick up
> the new assets.

## Handicaps

Strokes are allocated the standard way: a player receives `floor(hc / 18)`
strokes on every hole plus one extra on the `hc % 18` hardest holes (by stroke
index). Plus handicaps give strokes back on the easiest holes. Each game can be
switched between **net** (handicap-adjusted) and **gross** independently.

## Project layout

```
index.html              app shell
styles.css              mobile-first styles
manifest.webmanifest    PWA manifest
sw.js                   offline service worker
js/
  app.js                hash router + entry point
  storage.js            localStorage persistence (players, courses, rounds)
  scoring.js            handicap stroke allocation + settlement math
  games.js              the betting-game engine (one module per game)
  ui.js                 all screens
```

## Roadmap

- 📸 Photo-scorecard import (read pars / stroke index / yardage from a picture).
- Presses for Nassau; more games (Vegas, Bingo-Bango-Bongo, Quota).
- Export / share a round summary.
