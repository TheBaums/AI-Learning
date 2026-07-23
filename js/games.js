// games.js — the betting-game engine. Each game is a self-contained module that
// knows how to configure itself and how to turn entered scores into a
// zero-sum payout map {playerId: dollars}. Positive = player is owed money,
// negative = player owes money. The sum across all players is always ~0.
//
// Every compute() returns { payouts, holes } where `holes` is a per-hole
// breakdown used to render the running results table.

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

function completed(round, hole) {
  return holeComplete(round.players, round.scores?.[hole.number]);
}

const nameOf = (round, id) => round.players.find((p) => p.id === id)?.name || '?';

/* --------------------------------- Skins --------------------------------- */

const Skins = {
  id: 'skins',
  name: 'Skins',
  min: 2,
  max: 8,
  description: 'Each hole is worth money. Lowest score wins the skin; ties carry the pot forward.',
  defaultConfig: () => ({ mode: 'net', value: 5, carryover: true }),
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
        for (const p of players) {
          if (p.id === w) payouts[p.id] += value * skins * (players.length - 1);
          else payouts[p.id] -= value * skins;
        }
        holes.push({ hole: hole.number, winner: w, skins, text: `${nameOf(round, w)} wins ${skins} skin${skins > 1 ? 's' : ''}` });
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
  description: 'A rotating "banker" plays a match against every other player each hole. Low score wins the wager.',
  defaultConfig: () => ({ mode: 'net', value: 2 }),
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
          payouts[banker.id] += wager; payouts[opp.id] -= wager; delta += wager; won++;
        } else if (bScore > oScore) {
          payouts[banker.id] -= wager; payouts[opp.id] += wager; delta -= wager; lost++;
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

/* -------------------------------- Nassau ---------------------------------
   Head-to-head match play across three bets: front 9, back 9, and total 18.
   Supports 1-v-1 or 2-v-2 (best ball). `value` is per player, per segment.  */

const Nassau = {
  id: 'nassau',
  name: 'Nassau',
  min: 2,
  max: 4,
  needsTeams: true,
  description: 'Front 9, back 9 and overall — three separate match-play bets. 1v1 or 2v2 best ball.',
  defaultConfig: (players) => ({
    mode: 'net',
    value: 5,
    // Default: split players evenly into two sides.
    teams: [
      players.slice(0, Math.ceil(players.length / 2)).map((p) => p.id),
      players.slice(Math.ceil(players.length / 2)).map((p) => p.id),
    ],
  }),
  compute(round, cfg) {
    const players = round.players;
    const net = cfg.mode === 'net';
    const value = Number(cfg.value) || 0;
    const [teamA, teamB] = cfg.teams;
    const payouts = zeroPayouts(players);
    const holes = [];

    const segWins = { front: [0, 0], back: [0, 0], total: [0, 0] };
    for (const hole of round.course.holes) {
      if (!completed(round, hole)) {
        holes.push({ hole: hole.number, status: 'open' });
        continue;
      }
      const a = bestBall(round, hole, teamA, net);
      const b = bestBall(round, hole, teamB, net);
      let winnerIdx = -1;
      if (a < b) winnerIdx = 0;
      else if (b < a) winnerIdx = 1;

      if (winnerIdx >= 0) {
        segWins.total[winnerIdx]++;
        if (hole.number <= 9) segWins.front[winnerIdx]++;
        else segWins.back[winnerIdx]++;
      }
      holes.push({
        hole: hole.number,
        text: winnerIdx < 0 ? 'Halved' : `Team ${winnerIdx === 0 ? 'A' : 'B'} wins`,
      });
    }

    // Settle each of the three bets.
    for (const seg of ['front', 'back', 'total']) {
      const [wa, wb] = segWins[seg];
      let winners = null;
      let losers = null;
      if (wa > wb) { winners = teamA; losers = teamB; }
      else if (wb > wa) { winners = teamB; losers = teamA; }
      if (winners) {
        for (const id of winners) payouts[id] += value;
        for (const id of losers) payouts[id] -= value;
      }
    }
    return { payouts, holes, segWins };
  },
};

/* --------------------------------- Wolf ----------------------------------
   4-player game. The "Wolf" rotates each hole and, after watching the tee
   shots, either partners with one player (2v2) or goes it alone (Lone Wolf,
   1v3) for bigger stakes. Partner/Lone choices are stored per hole in the
   game config as `picks[holeNumber] = { partnerId | null, lone }`.           */

const Wolf = {
  id: 'wolf',
  name: 'Wolf',
  min: 4,
  max: 4,
  needsPicks: true,
  description: '4 players. The rotating Wolf picks a partner or goes Lone Wolf for triple stakes.',
  defaultConfig: () => ({ mode: 'net', value: 2, loneMultiplier: 3, picks: {} }),
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
        // Lone Wolf: wolf vs the best of the other three.
        const wScore = pScore(round, hole, wolf.id, net);
        const fieldScore = bestBall(round, hole, others.map((o) => o.id), net);
        const stake = value * loneMult;
        if (wScore < fieldScore) {
          for (const o of others) { payouts[o.id] -= stake; payouts[wolf.id] += stake; }
          holes.push({ hole: hole.number, wolf: wolf.id, text: `Lone Wolf ${nameOf(round, wolf.id)} wins (+$${stake * others.length})` });
        } else if (wScore > fieldScore) {
          for (const o of others) { payouts[o.id] += stake; payouts[wolf.id] -= stake; }
          holes.push({ hole: hole.number, wolf: wolf.id, text: `Lone Wolf ${nameOf(round, wolf.id)} loses (-$${stake * others.length})` });
        } else {
          holes.push({ hole: hole.number, wolf: wolf.id, text: 'Lone Wolf pushes' });
        }
      } else {
        // 2v2: wolf + partner vs the other two.
        const team = [wolf.id, pick.partnerId];
        const opp = others.filter((o) => o.id !== pick.partnerId).map((o) => o.id);
        const teamScore = bestBall(round, hole, team, net);
        const oppScore = bestBall(round, hole, opp, net);
        if (teamScore < oppScore) {
          for (const id of team) payouts[id] += value;
          for (const id of opp) payouts[id] -= value;
          holes.push({ hole: hole.number, wolf: wolf.id, text: `${nameOf(round, wolf.id)} + ${nameOf(round, pick.partnerId)} win` });
        } else if (oppScore < teamScore) {
          for (const id of team) payouts[id] -= value;
          for (const id of opp) payouts[id] += value;
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
   "666" / Round Robin. 4 players; partnerships rotate every 6 holes so each
   player partners each other player for one 6-hole segment. Each hole is a
   best-ball match worth `value` per player.                                  */

const Sixes = {
  id: 'sixes',
  name: '666 (Sixes)',
  min: 4,
  max: 4,
  description: '4 players, rotating partners every 6 holes. Best-ball match each hole.',
  defaultConfig: () => ({ mode: 'net', value: 2 }),
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
    const payouts = zeroPayouts(players);
    const holes = [];

    for (const hole of round.course.holes) {
      const [t1, t2] = Sixes.teamsForHole(players, hole.number);
      if (!completed(round, hole)) {
        holes.push({ hole: hole.number, status: 'open', teams: [t1, t2] });
        continue;
      }
      const s1 = bestBall(round, hole, t1, net);
      const s2 = bestBall(round, hole, t2, net);
      if (s1 < s2) {
        for (const id of t1) payouts[id] += value;
        for (const id of t2) payouts[id] -= value;
        holes.push({ hole: hole.number, text: `${t1.map((id) => nameOf(round, id)).join(' & ')} win` });
      } else if (s2 < s1) {
        for (const id of t2) payouts[id] += value;
        for (const id of t1) payouts[id] -= value;
        holes.push({ hole: hole.number, text: `${t2.map((id) => nameOf(round, id)).join(' & ')} win` });
      } else {
        holes.push({ hole: hole.number, text: 'Halved' });
      }
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
  stroke: Stroke,
};

export const GAME_LIST = [Skins, Wolf, Banker, Sixes, Nassau, Stroke];

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
