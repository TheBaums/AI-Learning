// games.js — the betting-game engine. Each game is a self-contained module that
// knows how to configure itself and how to turn entered scores into a
// zero-sum payout map {playerId: dollars}. Positive = player is owed money,
// negative = player owes money. The sum across all players is always ~0.
//
// Every compute() returns { payouts, holes } where `holes` is a per-hole
// breakdown used to render the running results table.
//
// Capability flags on each game tell the UI what extra controls to show:
//   needsTeams — pick Team A / Team B on setup
//   needsPicks — needs a per-hole choice on the scorecard (Wolf partner, BBB)
//   birdie     — supports the "birdies double the hole" option
//   noMode     — has no net/gross toggle (event-based games)

import { scoreFor, holeComplete, courseHandicap, strokesOnHole } from './scoring.js';

/* ----------------------------- shared helpers ---------------------------- */

function zeroPayouts(players) {
  const p = {};
  for (const pl of players) p[pl.id] = 0;
  return p;
}

// Score for a player on a hole using the round's stored gross scores.
function pScore(round, hole, playerId, net) {
  const gross = round.scores?.[hole.number]?.[playerId];
  const player = round.players.find((p) => p.id === playerId);
  return scoreFor(player, hole, gross, net);
}

function bestBall(round, hole, ids, net) {
  const vals = ids.map((id) => pScore(round, hole, id, net)).filter((v) => v != null);
  return vals.length ? Math.min(...vals) : null;
}

function teamTotal(round, hole, ids, net) {
  const vals = ids.map((id) => pScore(round, hole, id, net));
  if (vals.some((v) => v == null)) return null;
  return vals.reduce((a, b) => a + b, 0);
}

function completed(round, hole) {
  return holeComplete(round.players, round.scores?.[hole.number]);
}

const nameOf = (round, id) => round.players.find((p) => p.id === id)?.name || '?';
const names = (round, ids) => ids.map((id) => nameOf(round, id)).join(' & ');

// A gross birdie (or better) on this hole by any of `winnerIds`.
function hasBirdie(round, hole, ids) {
  return ids.some((id) => {
    const g = round.scores?.[hole.number]?.[id];
    return g != null && g !== '' && Number(g) <= Number(hole.par) - 1;
  });
}

// Stake multiplier for a hole: doubled when the winning side made a birdie and
// the "birdies double" option is on. Applied to both sides so payouts stay
// zero-sum.
function holeMult(round, hole, winnerIds, cfg) {
  return cfg.birdieDouble && hasBirdie(round, hole, winnerIds) ? 2 : 1;
}

/* --------------------------------- Skins --------------------------------- */

const Skins = {
  id: 'skins',
  name: 'Skins',
  min: 2,
  max: 8,
  birdie: true,
  description: 'Each hole is worth money. Lowest score wins the skin; ties carry the pot forward.',
  defaultConfig: () => ({ mode: 'net', value: 5, carryover: true, birdieDouble: false }),
  compute(round, cfg) {
    const players = round.players;
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const payouts = zeroPayouts(players);
    const holes = [];
    let carry = 1;

    for (const hole of round.course.holes) {
      if (!completed(round, hole)) {
        holes.push({ hole: hole.number, status: 'open' });
        continue;
      }
      const scores = players.map((p) => ({ id: p.id, s: pScore(round, hole, p.id, net) }));
      const min = Math.min(...scores.map((x) => x.s));
      const winners = scores.filter((x) => x.s === min);

      if (winners.length === 1) {
        const w = winners[0].id;
        const skins = carry;
        const mult = holeMult(round, hole, [w], cfg);
        for (const p of players) {
          if (p.id === w) payouts[p.id] += value * skins * mult * (players.length - 1);
          else payouts[p.id] -= value * skins * mult;
        }
        holes.push({ hole: hole.number, winner: w, skins, text: `${nameOf(round, w)} wins ${skins} skin${skins > 1 ? 's' : ''}${mult > 1 ? ' (birdie ×2)' : ''}` });
        carry = 1;
      } else {
        if (cfg.carryover) {
          carry += 1;
          holes.push({ hole: hole.number, winner: null, text: `Push — pot carries (${carry} skins)` });
        } else {
          holes.push({ hole: hole.number, winner: null, text: 'Push' });
          carry = 1;
        }
      }
    }
    return { payouts, holes };
  },
};

/* -------------------------------- Banker --------------------------------- */

const Banker = {
  id: 'banker',
  name: 'Banker',
  min: 2,
  max: 8,
  birdie: true,
  description: 'A rotating "banker" plays a match against every other player each hole. Low score wins the wager.',
  defaultConfig: () => ({ mode: 'net', value: 2, birdieDouble: false }),
  compute(round, cfg) {
    const players = round.players;
    const net = cfg.mode === 'net';
    const wager = Number(cfg.value) || 0;
    const payouts = zeroPayouts(players);
    const holes = [];

    round.course.holes.forEach((hole, i) => {
      const banker = players[i % players.length];
      if (!completed(round, hole)) {
        holes.push({ hole: hole.number, status: 'open', banker: banker.id });
        return;
      }
      const bScore = pScore(round, hole, banker.id, net);
      let delta = 0;
      let won = 0;
      let lost = 0;
      for (const opp of players) {
        if (opp.id === banker.id) continue;
        const oScore = pScore(round, hole, opp.id, net);
        if (bScore < oScore) {
          const w = wager * holeMult(round, hole, [banker.id], cfg);
          payouts[banker.id] += w; payouts[opp.id] -= w; delta += w; won++;
        } else if (bScore > oScore) {
          const w = wager * holeMult(round, hole, [opp.id], cfg);
          payouts[banker.id] -= w; payouts[opp.id] += w; delta -= w; lost++;
        }
      }
      holes.push({
        hole: hole.number,
        banker: banker.id,
        text: `${nameOf(round, banker.id)} banks: ${won}W ${lost}L (${delta >= 0 ? '+' : ''}$${delta})`,
      });
    });
    return { payouts, holes };
  },
};

/* -------------------------------- Stroke --------------------------------- */

const Stroke = {
  id: 'stroke',
  name: 'Stroke Play',
  min: 2,
  max: 8,
  description: 'Lowest total score for the round wins a set amount from each other player.',
  defaultConfig: () => ({ mode: 'net', value: 20 }),
  compute(round, cfg) {
    const players = round.players;
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const payouts = zeroPayouts(players);

    const totals = {};
    for (const p of players) totals[p.id] = 0;
    const holes = [];
    for (const hole of round.course.holes) {
      if (!completed(round, hole)) {
        holes.push({ hole: hole.number, status: 'open' });
        continue;
      }
      for (const p of players) totals[p.id] += pScore(round, hole, p.id, net);
      holes.push({ hole: hole.number, text: 'Scored' });
    }

    const anyComplete = round.course.holes.some((h) => completed(round, h));
    if (anyComplete) {
      const min = Math.min(...players.map((p) => totals[p.id]));
      const winners = players.filter((p) => totals[p.id] === min);
      const losers = players.filter((p) => totals[p.id] !== min);
      const pot = value * losers.length;
      for (const l of losers) payouts[l.id] -= value;
      for (const w of winners) payouts[w.id] += pot / winners.length;
    }
    return { payouts, holes, totals };
  },
};

/* ----------------------------- Stableford --------------------------------
   Points per hole by score relative to par (eagle+ 4, birdie 3, par 2,
   bogey 1, double+ 0). Most points wins the pot. Works great across a wide
   spread of handicaps. Net or gross.                                        */

function stablefordPoints(over) {
  if (over <= -2) return 4;
  if (over === -1) return 3;
  if (over === 0) return 2;
  if (over === 1) return 1;
  return 0;
}

const Stableford = {
  id: 'stableford',
  name: 'Stableford / Quota',
  min: 2,
  max: 8,
  description: 'Points per hole vs par (birdie 3, par 2, bogey 1…). Most points wins the pot.',
  defaultConfig: () => ({ mode: 'net', value: 20 }),
  compute(round, cfg) {
    const players = round.players;
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const payouts = zeroPayouts(players);
    const points = {};
    for (const p of players) points[p.id] = 0;
    const holes = [];

    for (const hole of round.course.holes) {
      if (!completed(round, hole)) { holes.push({ hole: hole.number, status: 'open' }); continue; }
      for (const p of players) {
        const s = pScore(round, hole, p.id, net);
        points[p.id] += stablefordPoints(s - Number(hole.par));
      }
      holes.push({ hole: hole.number, text: 'Scored' });
    }

    if (round.course.holes.some((h) => completed(round, h))) {
      const max = Math.max(...players.map((p) => points[p.id]));
      const winners = players.filter((p) => points[p.id] === max);
      const losers = players.filter((p) => points[p.id] !== max);
      const pot = value * losers.length;
      for (const l of losers) payouts[l.id] -= value;
      for (const w of winners) payouts[w.id] += pot / winners.length;
    }
    return { payouts, holes, points };
  },
};

/* ---------------------------- match-play core ----------------------------
   Shared by Nassau, Match Play and any other head-to-head team format.
   Returns holes won by side A and side B across completed holes.            */

function matchTally(round, teamA, teamB, net, from = 1, to = 18) {
  let a = 0;
  let b = 0;
  const perHole = [];
  for (const hole of round.course.holes) {
    if (hole.number < from || hole.number > to) continue;
    if (!completed(round, hole)) { perHole.push({ hole: hole.number, w: null }); continue; }
    const sa = bestBall(round, hole, teamA, net);
    const sb = bestBall(round, hole, teamB, net);
    if (sa < sb) { a++; perHole.push({ hole: hole.number, w: 'A' }); }
    else if (sb < sa) { b++; perHole.push({ hole: hole.number, w: 'B' }); }
    else perHole.push({ hole: hole.number, w: null });
  }
  return { a, b, perHole };
}

function defaultTeams(players) {
  const half = Math.ceil(players.length / 2);
  return [players.slice(0, half).map((p) => p.id), players.slice(half).map((p) => p.id)];
}

// A press is an extra match-play bet over a hole range, worth the same `value`.
// The side that wins the most holes in the range wins the bet. Presses are
// added manually during play and stored in cfg.presses = [{ from, to }].
function applyPresses(round, cfg, payouts, net) {
  const value = Number(cfg.value) || 0;
  const [teamA, teamB] = cfg.teams;
  for (const pr of cfg.presses || []) {
    const { a, b } = matchTally(round, teamA, teamB, net, pr.from, pr.to);
    if (a > b) { for (const id of teamA) payouts[id] += value; for (const id of teamB) payouts[id] -= value; }
    else if (b > a) { for (const id of teamB) payouts[id] += value; for (const id of teamA) payouts[id] -= value; }
  }
}

/** Match state (holes won by each side) through a given hole — used by the UI
    to show the running match status and drive the Press button. */
export function matchState(round, inst, throughHole = 18) {
  const net = inst.config.mode === 'net';
  const [teamA, teamB] = inst.config.teams;
  return matchTally(round, teamA, teamB, net, 1, throughHole);
}

/* -------------------------------- Nassau ---------------------------------
   Front 9, back 9 and total 18 — three separate match-play bets. 1v1 or
   2v2 best ball. `value` is per player, per segment.                        */

const Nassau = {
  id: 'nassau',
  name: 'Nassau',
  min: 2,
  max: 4,
  needsTeams: true,
  canPress: true,
  description: 'Front 9, back 9 and overall — three separate match-play bets. 1v1 or 2v2 best ball.',
  defaultConfig: (players) => ({ mode: 'net', value: 5, teams: defaultTeams(players), presses: [] }),
  compute(round, cfg) {
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const [teamA, teamB] = cfg.teams;
    const payouts = zeroPayouts(round.players);
    const holes = [];

    const segs = {
      front: matchTally(round, teamA, teamB, net, 1, 9),
      back: matchTally(round, teamA, teamB, net, 10, 18),
      total: matchTally(round, teamA, teamB, net, 1, 18),
    };
    for (const p of segs.total.perHole) {
      holes.push({ hole: p.hole, text: p.w == null ? 'Halved' : `Team ${p.w} wins` });
    }

    for (const seg of ['front', 'back', 'total']) {
      const { a, b } = segs[seg];
      let winners = null;
      let losers = null;
      if (a > b) { winners = teamA; losers = teamB; }
      else if (b > a) { winners = teamB; losers = teamA; }
      if (winners) {
        for (const id of winners) payouts[id] += value;
        for (const id of losers) payouts[id] -= value;
      }
    }
    applyPresses(round, cfg, payouts, net);
    return { payouts, holes, segs };
  },
};

/* ------------------------------ Match Play -------------------------------
   A single head-to-head match over the round. Most holes won takes the
   agreed amount. 1v1 or 2v2 best ball.                                      */

const MatchPlay = {
  id: 'matchplay',
  name: 'Match Play',
  min: 2,
  max: 4,
  needsTeams: true,
  canPress: true,
  description: 'One head-to-head match over 18 holes — most holes won takes the pot. 1v1 or 2v2.',
  defaultConfig: (players) => ({ mode: 'net', value: 10, teams: defaultTeams(players), presses: [] }),
  compute(round, cfg) {
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const [teamA, teamB] = cfg.teams;
    const payouts = zeroPayouts(round.players);
    const { a, b, perHole } = matchTally(round, teamA, teamB, net);

    let running = 0; // + means A up
    const holes = perHole.map((p) => {
      if (p.w === 'A') running++;
      else if (p.w === 'B') running--;
      const lead = running === 0 ? 'AS' : `${Math.abs(running)} up ${running > 0 ? 'A' : 'B'}`;
      return { hole: p.hole, text: p.w == null ? `Halved (${lead})` : `Team ${p.w} (${lead})` };
    });

    let winners = null;
    let losers = null;
    if (a > b) { winners = teamA; losers = teamB; }
    else if (b > a) { winners = teamB; losers = teamA; }
    if (winners) {
      for (const id of winners) payouts[id] += value;
      for (const id of losers) payouts[id] -= value;
    }
    applyPresses(round, cfg, payouts, net);
    return { payouts, holes };
  },
};

/* --------------------------------- Wolf ----------------------------------
   4-player game. The rotating Wolf partners with one player (2v2) or goes
   Lone Wolf (1v3) for bigger stakes. Choices are stored per hole in the
   config as picks[holeNumber] = { partnerId | null, lone }.                 */

const Wolf = {
  id: 'wolf',
  name: 'Wolf',
  min: 4,
  max: 4,
  needsPicks: true,
  birdie: true,
  description: '4 players. The rotating Wolf picks a partner or goes Lone Wolf for triple stakes.',
  defaultConfig: () => ({ mode: 'net', value: 2, loneMultiplier: 3, birdieDouble: false, picks: {} }),
  wolfForHole(round, holeIndex) {
    return round.players[holeIndex % round.players.length];
  },
  compute(round, cfg) {
    const players = round.players;
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const loneMult = Number(cfg.loneMultiplier) || 1;
    const payouts = zeroPayouts(players);
    const holes = [];

    round.course.holes.forEach((hole, i) => {
      const wolf = Wolf.wolfForHole(round, i);
      const others = players.filter((p) => p.id !== wolf.id);
      const pick = cfg.picks?.[hole.number] || {};
      if (!completed(round, hole)) {
        holes.push({ hole: hole.number, status: 'open', wolf: wolf.id });
        return;
      }

      const partnerValid = !pick.lone && pick.partnerId && others.some((o) => o.id === pick.partnerId);
      if (!partnerValid) {
        const wScore = pScore(round, hole, wolf.id, net);
        const fieldScore = bestBall(round, hole, others.map((o) => o.id), net);
        const base = value * loneMult;
        if (wScore < fieldScore) {
          const stake = base * holeMult(round, hole, [wolf.id], cfg);
          for (const o of others) { payouts[o.id] -= stake; payouts[wolf.id] += stake; }
          holes.push({ hole: hole.number, wolf: wolf.id, text: `Lone Wolf ${nameOf(round, wolf.id)} wins (+$${stake * others.length})` });
        } else if (wScore > fieldScore) {
          const winnerIds = others.filter((o) => pScore(round, hole, o.id, net) === fieldScore).map((o) => o.id);
          const stake = base * holeMult(round, hole, winnerIds, cfg);
          for (const o of others) { payouts[o.id] += stake; payouts[wolf.id] -= stake; }
          holes.push({ hole: hole.number, wolf: wolf.id, text: `Lone Wolf ${nameOf(round, wolf.id)} loses (-$${stake * others.length})` });
        } else {
          holes.push({ hole: hole.number, wolf: wolf.id, text: 'Lone Wolf pushes' });
        }
      } else {
        const team = [wolf.id, pick.partnerId];
        const opp = others.filter((o) => o.id !== pick.partnerId).map((o) => o.id);
        const teamScore = bestBall(round, hole, team, net);
        const oppScore = bestBall(round, hole, opp, net);
        if (teamScore < oppScore) {
          const stake = value * holeMult(round, hole, team, cfg);
          for (const id of team) payouts[id] += stake;
          for (const id of opp) payouts[id] -= stake;
          holes.push({ hole: hole.number, wolf: wolf.id, text: `${nameOf(round, wolf.id)} + ${nameOf(round, pick.partnerId)} win` });
        } else if (oppScore < teamScore) {
          const stake = value * holeMult(round, hole, opp, cfg);
          for (const id of team) payouts[id] -= stake;
          for (const id of opp) payouts[id] += stake;
          holes.push({ hole: hole.number, wolf: wolf.id, text: `${nameOf(round, wolf.id)} + ${nameOf(round, pick.partnerId)} lose` });
        } else {
          holes.push({ hole: hole.number, wolf: wolf.id, text: 'Halved' });
        }
      }
    });
    return { payouts, holes };
  },
};

/* --------------------------------- Sixes ---------------------------------
   "666" / Round Robin. 4 players; partners rotate every 6 holes. Each hole
   is a match worth `value`. Format decides how a team's hole score is set:
     ball  — the team's best single score
     total — the sum of both partners' scores
     both  — award `value` for low ball AND `value` for low total (2 pts).   */

const Sixes = {
  id: 'sixes',
  name: '666 (Sixes)',
  min: 4,
  max: 4,
  birdie: true,
  hasFormat: true,
  description: '4 players, rotating partners every 6 holes. Choose low ball, low total, or both.',
  defaultConfig: () => ({ mode: 'net', value: 2, format: 'ball', birdieDouble: false }),
  teamsForHole(players, holeNumber) {
    const [a, b, c, d] = players.map((p) => p.id);
    if (holeNumber <= 6) return [[a, b], [c, d]];
    if (holeNumber <= 12) return [[a, c], [b, d]];
    return [[a, d], [b, c]];
  },
  compute(round, cfg) {
    const players = round.players;
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const format = cfg.format || 'ball';
    const components = format === 'both' ? ['ball', 'total'] : [format];
    const payouts = zeroPayouts(players);
    const holes = [];

    const scoreTeam = (hole, ids, comp) =>
      comp === 'total' ? teamTotal(round, hole, ids, net) : bestBall(round, hole, ids, net);

    for (const hole of round.course.holes) {
      const [t1, t2] = Sixes.teamsForHole(players, hole.number);
      if (!completed(round, hole)) {
        holes.push({ hole: hole.number, status: 'open', teams: [t1, t2] });
        continue;
      }
      const parts = [];
      for (const comp of components) {
        const s1 = scoreTeam(hole, t1, comp);
        const s2 = scoreTeam(hole, t2, comp);
        let winner = null;
        let loser = null;
        if (s1 < s2) { winner = t1; loser = t2; }
        else if (s2 < s1) { winner = t2; loser = t1; }
        if (winner) {
          const stake = value * holeMult(round, hole, winner, cfg);
          for (const id of winner) payouts[id] += stake;
          for (const id of loser) payouts[id] -= stake;
          parts.push(`${names(round, winner)} take ${comp}`);
        } else {
          parts.push(`${comp} halved`);
        }
      }
      holes.push({ hole: hole.number, teams: [t1, t2], text: parts.join(' · ') });
    }
    return { payouts, holes };
  },
};

/* --------------------------------- Vegas ---------------------------------
   4 players, 2 teams. Each team's two scores form a number, low digit first
   (4 & 6 → 46). Difference between the two numbers × value is the payout;
   lower number wins. With the birdie option on, a team's birdie "flips" the
   opponent's number (digits reversed) to punish them harder.                */

function teamLowHigh(round, hole, ids, net) {
  const vals = ids.map((id) => pScore(round, hole, id, net)).filter((v) => v != null);
  if (vals.length < ids.length) return null;
  return { low: Math.min(...vals), high: Math.max(...vals) };
}
const concat = (a, b) => Number(`${a}${b}`);

const Vegas = {
  id: 'vegas',
  name: 'Vegas',
  min: 4,
  max: 4,
  needsTeams: true,
  birdie: true,
  birdieLabel: 'Birdies flip',
  description: '2 teams. Scores form a number (4 & 6 = 46); lower wins, difference × value. Birdies flip the opponent.',
  defaultConfig: (players) => ({ mode: 'gross', value: 1, birdieDouble: false, teams: defaultTeams(players) }),
  compute(round, cfg) {
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const [teamA, teamB] = cfg.teams;
    const payouts = zeroPayouts(round.players);
    const holes = [];

    for (const hole of round.course.holes) {
      if (!completed(round, hole)) { holes.push({ hole: hole.number, status: 'open' }); continue; }
      const A = teamLowHigh(round, hole, teamA, net);
      const B = teamLowHigh(round, hole, teamB, net);
      if (!A || !B) { holes.push({ hole: hole.number, status: 'open' }); continue; }

      let numA = concat(A.low, A.high);
      let numB = concat(B.low, B.high);
      if (cfg.birdieDouble) {
        if (hasBirdie(round, hole, teamA)) numB = concat(B.high, B.low);
        if (hasBirdie(round, hole, teamB)) numA = concat(A.high, A.low);
      }
      const diff = Math.abs(numA - numB);
      let winner = null;
      let loser = null;
      if (numA < numB) { winner = teamA; loser = teamB; }
      else if (numB < numA) { winner = teamB; loser = teamA; }
      if (winner) {
        const amt = diff * value;
        for (const id of winner) payouts[id] += amt;
        for (const id of loser) payouts[id] -= amt;
        holes.push({ hole: hole.number, text: `${numA} vs ${numB} — ${names(round, winner)} +$${amt}` });
      } else {
        holes.push({ hole: hole.number, text: `${numA} vs ${numB} — tie` });
      }
    }
    return { payouts, holes };
  },
};

/* -------------------------- Bingo Bango Bongo ----------------------------
   Three points per hole, awarded by tapping who won each event on the
   scorecard: Bingo (first on the green), Bango (closest once all are on),
   Bongo (first in the hole). Each point is a mini-skin worth `value`.
   Stored as picks[holeNumber] = { bingo, bango, bongo }.                    */

const BINGO_EVENTS = [
  { key: 'bingo', label: 'Bingo (first on)' },
  { key: 'bango', label: 'Bango (closest)' },
  { key: 'bongo', label: 'Bongo (first in)' },
];

const BingoBangoBongo = {
  id: 'bbb',
  name: 'Bingo Bango Bongo',
  min: 2,
  max: 6,
  needsPicks: true,
  noMode: true,
  events: BINGO_EVENTS,
  description: '3 points a hole — first on, closest, first in — tapped in as you play. Each point pays out.',
  defaultConfig: () => ({ value: 1, picks: {} }),
  compute(round, cfg) {
    const players = round.players;
    const value = Number(cfg.value) || 0;
    const n = players.length;
    const payouts = zeroPayouts(players);
    const holes = [];

    for (const hole of round.course.holes) {
      const pk = cfg.picks?.[hole.number] || {};
      const wins = [];
      for (const ev of BINGO_EVENTS) {
        const w = pk[ev.key];
        if (!w || !players.some((p) => p.id === w)) continue;
        for (const p of players) {
          if (p.id === w) payouts[p.id] += value * (n - 1);
          else payouts[p.id] -= value;
        }
        wins.push(`${ev.key}: ${nameOf(round, w)}`);
      }
      holes.push({ hole: hole.number, text: wins.length ? wins.join(' · ') : '—' });
    }
    return { payouts, holes };
  },
};

/* ------------------------------- registry -------------------------------- */

export const GAMES = {
  skins: Skins,
  wolf: Wolf,
  banker: Banker,
  sixes: Sixes,
  nassau: Nassau,
  matchplay: MatchPlay,
  vegas: Vegas,
  stableford: Stableford,
  bbb: BingoBangoBongo,
  stroke: Stroke,
};

export const GAME_LIST = [
  Skins, Wolf, Banker, Sixes, Nassau, MatchPlay, Vegas, Stableford, BingoBangoBongo, Stroke,
];

/** Combined payout across every active game in a round. */
export function combinedPayouts(round) {
  const payouts = zeroPayouts(round.players);
  for (const inst of round.games || []) {
    const game = GAMES[inst.gameId];
    if (!game) continue;
    const { payouts: gp } = game.compute(round, inst.config);
    for (const id of Object.keys(payouts)) payouts[id] += gp[id] || 0;
  }
  return payouts;
}

export { pScore, courseHandicap, strokesOnHole };
