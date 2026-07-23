// ui.js — every screen in the app. Screens are plain functions that build DOM
// into a root element. A tiny hash router in app.js decides which one to show.

import * as store from './storage.js';
import { GAME_LIST, GAMES, combinedPayouts, pScore } from './games.js';
import { courseHandicap, strokesOnHole, settle } from './scoring.js';

/* ----------------------------- DOM helpers ------------------------------- */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function go(hash) {
  location.hash = hash;
}

function header(title, { back } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', onclick: () => go(back) }, '‹') : h('span', { class: 'icon-btn ghost' }),
    h('h1', {}, title),
    h('span', { class: 'icon-btn ghost' }),
  );
}

function money(n) {
  const v = Math.round(n * 100) / 100;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`;
}

/* -------------------------------- Home ----------------------------------- */

export function renderHome(root) {
  const rounds = store.getRounds();
  root.append(
    h('header', { class: 'topbar hero' },
      h('h1', {}, '⛳ Golf Bets'),
    ),
    h('div', { class: 'screen' },
      h('button', { class: 'btn primary big', onclick: () => go('#/round/new') }, '+ New Round'),
      h('div', { class: 'row2' },
        h('button', { class: 'btn', onclick: () => go('#/players') }, '👥 Players'),
        h('button', { class: 'btn', onclick: () => go('#/courses') }, '🏌 Courses'),
      ),
      h('h2', { class: 'section' }, 'Recent rounds'),
      rounds.length === 0
        ? h('p', { class: 'muted' }, 'No rounds yet. Start one above.')
        : h('div', { class: 'list' }, rounds.map((r) => roundCard(r))),
    ),
  );
}

function roundCard(r) {
  const done = isRoundComplete(r);
  return h('button', {
    class: 'card link',
    onclick: () => go(done ? `#/round/${r.id}/results` : `#/round/${r.id}`),
  },
    h('div', { class: 'card-main' },
      h('strong', {}, r.courseName || 'Round'),
      h('span', { class: 'muted small' }, `${r.date} · ${r.players.map((p) => p.name).join(', ')}`),
    ),
    h('span', { class: `pill ${done ? 'done' : 'live'}` }, done ? 'Final' : 'In play'),
  );
}

function isRoundComplete(r) {
  return r.course.holes.every((hole) =>
    r.players.every((p) => {
      const v = r.scores?.[hole.number]?.[p.id];
      return v != null && v !== '';
    }));
}

/* ------------------------------- Players --------------------------------- */

export function renderPlayers(root, _params, rerender) {
  const players = store.getPlayers();
  const form = { name: '', handicap: '' };

  const nameInput = h('input', { class: 'input', placeholder: 'Name', value: '' });
  const hcpInput = h('input', { class: 'input', type: 'number', step: '0.1', placeholder: 'Handicap' });

  root.append(
    header('Players', { back: '#/' }),
    h('div', { class: 'screen' },
      h('div', { class: 'card form' },
        nameInput,
        hcpInput,
        h('button', {
          class: 'btn primary',
          onclick: () => {
            if (!nameInput.value.trim()) return;
            store.savePlayer({ name: nameInput.value.trim(), handicap: hcpInput.value || 0 });
            rerender();
          },
        }, 'Add'),
      ),
      players.length === 0
        ? h('p', { class: 'muted' }, 'No saved players yet.')
        : h('div', { class: 'list' }, players.map((p) => playerRow(p, rerender))),
    ),
  );
}

function playerRow(p, rerender) {
  return h('div', { class: 'card row' },
    h('div', { class: 'card-main' },
      h('strong', {}, p.name),
      h('span', { class: 'muted small' }, `Handicap ${p.handicap || 0}`),
    ),
    h('button', {
      class: 'icon-btn danger',
      onclick: () => { if (confirm(`Delete ${p.name}?`)) { store.deletePlayer(p.id); rerender(); } },
    }, '🗑'),
  );
}

/* ------------------------------- Courses --------------------------------- */

export function renderCourses(root, _params, rerender) {
  const courses = store.getCourses();
  root.append(
    header('Courses', { back: '#/' }),
    h('div', { class: 'screen' },
      h('button', { class: 'btn primary', onclick: () => go('#/course/new') }, '+ New Course'),
      h('button', {
        class: 'btn',
        onclick: () => alert('📸 Photo import is coming soon — snap the scorecard and it auto-fills pars, stroke indexes and yardages. For now, enter the course by hand once and it\'s saved for reuse.'),
      }, '📸 Import from photo'),
      courses.length === 0
        ? h('p', { class: 'muted' }, 'No saved courses yet. Add one and reuse it every round.')
        : h('div', { class: 'list' }, courses.map((c) => h('div', { class: 'card row' },
            h('button', { class: 'card-main link', onclick: () => go(`#/course/${c.id}`) },
              h('strong', {}, c.name || 'Untitled course'),
              h('span', { class: 'muted small' }, `Par ${c.holes.reduce((s, x) => s + (Number(x.par) || 0), 0)}`),
            ),
            h('button', {
              class: 'icon-btn danger',
              onclick: () => { if (confirm(`Delete ${c.name}?`)) { store.deleteCourse(c.id); rerender(); } },
            }, '🗑'),
          ))),
    ),
  );
}

export function renderCourseEdit(root, params) {
  const isNew = params.id === 'new';
  const course = isNew ? store.blankCourse() : store.getCourse(params.id);
  if (!course) { go('#/courses'); return; }

  const nameInput = h('input', { class: 'input', placeholder: 'Course name', value: course.name || '' });

  const holeRows = course.holes.map((hole) => h('tr', {},
    h('td', { class: 'hnum' }, hole.number),
    h('td', {}, numCell(hole, 'par')),
    h('td', {}, numCell(hole, 'strokeIndex')),
    h('td', {}, numCell(hole, 'yardage')),
  ));

  function numCell(hole, key) {
    const input = h('input', { class: 'input tiny', type: 'number', value: hole[key] ?? '' });
    input.addEventListener('input', () => { hole[key] = input.value === '' ? '' : Number(input.value); });
    return input;
  }

  root.append(
    header(isNew ? 'New Course' : 'Edit Course', { back: '#/courses' }),
    h('div', { class: 'screen' },
      nameInput,
      h('div', { class: 'table-wrap' },
        h('table', { class: 'grid' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Par'), h('th', {}, 'SI'), h('th', {}, 'Yds'))),
          h('tbody', {}, holeRows),
        ),
      ),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          course.name = nameInput.value.trim() || 'Untitled course';
          store.saveCourse(course);
          go('#/courses');
        },
      }, 'Save Course'),
    ),
  );
}

/* ------------------------------ New Round -------------------------------- */

export function renderRoundNew(root) {
  const courses = store.getCourses();
  const players = store.getPlayers();

  if (courses.length === 0 || players.length === 0) {
    root.append(
      header('New Round', { back: '#/' }),
      h('div', { class: 'screen' },
        h('p', { class: 'muted' }, 'You need at least one saved course and one saved player first.'),
        courses.length === 0 && h('button', { class: 'btn primary', onclick: () => go('#/course/new') }, 'Add a course'),
        players.length === 0 && h('button', { class: 'btn primary', onclick: () => go('#/players') }, 'Add players'),
      ),
    );
    return;
  }

  const state = {
    courseId: courses[0].id,
    playerIds: new Set(),
    games: {}, // gameId -> config (present = selected)
  };

  const courseSelect = h('select', { class: 'input' },
    courses.map((c) => h('option', { value: c.id }, c.name)));
  courseSelect.value = state.courseId;
  courseSelect.addEventListener('change', () => { state.courseId = courseSelect.value; });

  const playersBox = h('div', { class: 'list' });
  const gamesBox = h('div', { class: 'list' });

  function selectedPlayers() {
    return players.filter((p) => state.playerIds.has(p.id));
  }

  function refreshGames() {
    gamesBox.innerHTML = '';
    const sel = selectedPlayers();
    for (const game of GAME_LIST) {
      const active = state.games[game.id] != null;
      const eligible = sel.length >= game.min && sel.length <= game.max;
      const card = h('div', { class: `card game ${active ? 'on' : ''} ${eligible ? '' : 'disabled'}` });
      const head = h('label', { class: 'game-head' },
        h('input', {
          type: 'checkbox', checked: active, disabled: !eligible,
          onchange: (e) => {
            if (e.target.checked) state.games[game.id] = game.defaultConfig(sel);
            else delete state.games[game.id];
            refreshGames();
          },
        }),
        h('div', {},
          h('strong', {}, game.name),
          h('div', { class: 'muted small' }, eligible ? game.description : `Needs ${game.min}${game.max !== game.min ? '–' + game.max : ''} players`),
        ),
      );
      card.append(head);
      if (active) card.append(gameConfigForm(game, state.games[game.id], sel));
      gamesBox.append(card);
    }
  }

  function refreshPlayers() {
    playersBox.innerHTML = '';
    for (const p of players) {
      playersBox.append(h('label', { class: 'card check' },
        h('input', {
          type: 'checkbox', checked: state.playerIds.has(p.id),
          onchange: (e) => { e.target.checked ? state.playerIds.add(p.id) : state.playerIds.delete(p.id); refreshGames(); },
        }),
        h('div', { class: 'card-main' },
          h('strong', {}, p.name),
          h('span', { class: 'muted small' }, `Hcp ${p.handicap || 0}`),
        ),
      ));
    }
  }

  refreshPlayers();
  refreshGames();

  root.append(
    header('New Round', { back: '#/' }),
    h('div', { class: 'screen' },
      h('h2', { class: 'section' }, 'Course'),
      courseSelect,
      h('h2', { class: 'section' }, 'Players'),
      playersBox,
      h('h2', { class: 'section' }, 'Games'),
      gamesBox,
      h('button', {
        class: 'btn primary big',
        onclick: () => startRound(state, courses, players),
      }, 'Start Round'),
    ),
  );
}

function gameConfigForm(game, cfg, players) {
  const rows = [];
  rows.push(h('div', { class: 'field-row' },
    h('label', {}, 'Scoring'),
    toggle(cfg.mode === 'net', 'Net', 'Gross', (isNet) => { cfg.mode = isNet ? 'net' : 'gross'; }),
  ));
  rows.push(h('div', { class: 'field-row' },
    h('label', {}, game.id === 'stroke' ? 'Winner takes ($)' : 'Value ($)'),
    numberField(cfg, 'value'),
  ));
  if (game.id === 'wolf') {
    rows.push(h('div', { class: 'field-row' },
      h('label', {}, 'Lone Wolf ×'),
      numberField(cfg, 'loneMultiplier'),
    ));
  }
  if (game.needsTeams) {
    rows.push(teamPicker(cfg, players));
  }
  return h('div', { class: 'game-config' }, rows);
}

function teamPicker(cfg, players) {
  const wrap = h('div', { class: 'teams' });
  function draw() {
    wrap.innerHTML = '';
    wrap.append(h('div', { class: 'muted small' }, 'Assign each player to Team A or B:'));
    for (const p of players) {
      const inA = cfg.teams[0].includes(p.id);
      wrap.append(h('div', { class: 'field-row' },
        h('span', {}, p.name),
        toggle(inA, 'A', 'B', (isA) => {
          cfg.teams = cfg.teams.map((t) => t.filter((id) => id !== p.id));
          cfg.teams[isA ? 0 : 1].push(p.id);
        }),
      ));
    }
  }
  draw();
  return wrap;
}

function toggle(initial, onLabel, offLabel, onChange) {
  let state = initial;
  const btn = h('button', { class: `toggle ${state ? 'on' : ''}` }, state ? onLabel : offLabel);
  btn.addEventListener('click', () => {
    state = !state;
    btn.textContent = state ? onLabel : offLabel;
    btn.classList.toggle('on', state);
    onChange(state);
  });
  return btn;
}

function numberField(obj, key) {
  const input = h('input', { class: 'input tiny', type: 'number', step: '0.5', value: obj[key] ?? '' });
  input.addEventListener('input', () => { obj[key] = input.value === '' ? '' : Number(input.value); });
  return input;
}

function startRound(state, courses, players) {
  const sel = players.filter((p) => state.playerIds.has(p.id));
  if (sel.length < 2) { alert('Pick at least 2 players.'); return; }
  if (Object.keys(state.games).length === 0) { alert('Pick at least one game.'); return; }
  const course = courses.find((c) => c.id === state.courseId);

  const round = {
    id: null,
    date: new Date().toISOString().slice(0, 10),
    courseId: course.id,
    courseName: course.name,
    course: JSON.parse(JSON.stringify(course)), // snapshot so later edits don't change history
    players: sel.map((p) => ({ id: p.id, name: p.name, handicap: Number(p.handicap) || 0 })),
    scores: {},
    games: Object.entries(state.games).map(([gameId, config]) => ({
      instId: store.uid('gm'), gameId, config,
    })),
  };
  const saved = store.saveRound(round);
  go(`#/round/${saved.id}`);
}

/* ------------------------------ Scorecard -------------------------------- */

const holeCursor = {}; // roundId -> hole number currently shown

export function renderScorecard(root, params, rerender) {
  const round = store.getRound(params.id);
  if (!round) { go('#/'); return; }
  const holes = round.course.holes;
  let current = holeCursor[round.id] || firstIncompleteHole(round) || 1;
  holeCursor[round.id] = current;

  function save() { store.saveRound(round); }

  const standings = h('div', { class: 'standings' });
  function drawStandings() {
    standings.innerHTML = '';
    const payouts = combinedPayouts(round);
    const sorted = [...round.players].sort((a, b) => payouts[b.id] - payouts[a.id]);
    standings.append(h('div', { class: 'muted small center' }, 'Running total'));
    standings.append(h('div', { class: 'standings-row' }, sorted.map((p) =>
      h('div', { class: 'standing' },
        h('span', { class: 'sname' }, p.name),
        h('span', { class: `samt ${payouts[p.id] >= 0 ? 'up' : 'down'}` }, money(payouts[p.id])),
      ))));
  }

  const body = h('div', { class: 'card-body' });
  function drawHole() {
    holeCursor[round.id] = current;
    const hole = holes.find((x) => x.number === current);
    body.innerHTML = '';

    body.append(h('div', { class: 'hole-head' },
      h('button', { class: 'icon-btn', disabled: current <= 1, onclick: () => { if (current > 1) { current--; drawHole(); } } }, '‹'),
      h('div', { class: 'hole-title' },
        h('div', { class: 'hbig' }, `Hole ${hole.number}`),
        h('div', { class: 'muted small' }, `Par ${hole.par} · SI ${hole.strokeIndex}${hole.yardage ? ' · ' + hole.yardage + ' yds' : ''}`),
      ),
      h('button', { class: 'icon-btn', disabled: current >= 18, onclick: () => { if (current < 18) { current++; drawHole(); } } }, '›'),
    ));

    for (const p of round.players) {
      const strokes = strokesOnHole(courseHandicap(p), hole.strokeIndex);
      const val = round.scores?.[hole.number]?.[p.id] ?? '';
      const input = h('input', { class: 'score-input', type: 'number', inputmode: 'numeric', value: val, placeholder: '–' });
      input.addEventListener('input', () => {
        round.scores[hole.number] = round.scores[hole.number] || {};
        if (input.value === '') delete round.scores[hole.number][p.id];
        else round.scores[hole.number][p.id] = Number(input.value);
        save();
        drawStandings();
      });
      body.append(h('div', { class: 'score-row' },
        h('div', { class: 'sp-name' },
          h('strong', {}, p.name),
          strokes ? h('span', { class: 'dots' }, strokes > 0 ? '•'.repeat(Math.min(strokes, 4)) : '') : null,
        ),
        h('div', { class: 'stepper' },
          h('button', { class: 'step', onclick: () => bump(input, p, hole, -1) }, '−'),
          input,
          h('button', { class: 'step', onclick: () => bump(input, p, hole, 1) }, '+'),
        ),
      ));
    }

    // Wolf per-hole partner / lone control.
    const wolfInst = round.games.find((g) => g.gameId === 'wolf');
    if (wolfInst) body.append(wolfControl(round, wolfInst, hole, save));

    drawStandings();
  }

  function bump(input, p, hole, delta) {
    const base = input.value === '' ? hole.par : Number(input.value);
    const next = Math.max(1, base + delta);
    input.value = next;
    round.scores[hole.number] = round.scores[hole.number] || {};
    round.scores[hole.number][p.id] = next;
    save();
    drawStandings();
  }

  drawHole();

  root.append(
    header(round.courseName, { back: '#/' }),
    h('div', { class: 'screen' },
      h('div', { class: 'card' }, body),
      standings,
      h('button', { class: 'btn primary', onclick: () => go(`#/round/${round.id}/results`) }, 'View Payouts →'),
    ),
  );
}

function wolfControl(round, inst, hole, save) {
  const players = round.players;
  const wolf = players[(hole.number - 1) % players.length];
  const others = players.filter((p) => p.id !== wolf.id);
  inst.config.picks = inst.config.picks || {};
  const pick = inst.config.picks[hole.number] || {};

  const wrap = h('div', { class: 'wolf-control' });
  function draw() {
    wrap.innerHTML = '';
    wrap.append(h('div', { class: 'muted small' }, `🐺 Wolf: ${wolf.name} — pick a partner or go Lone`));
    const btns = h('div', { class: 'wolf-btns' });
    for (const o of others) {
      const on = pick.partnerId === o.id && !pick.lone;
      btns.append(h('button', {
        class: `chip ${on ? 'on' : ''}`,
        onclick: () => { inst.config.picks[hole.number] = { partnerId: o.id, lone: false }; save(); draw(); },
      }, o.name));
    }
    const loneOn = pick.lone || !pick.partnerId;
    btns.append(h('button', {
      class: `chip lone ${loneOn ? 'on' : ''}`,
      onclick: () => { inst.config.picks[hole.number] = { partnerId: null, lone: true }; save(); draw(); },
    }, '🐺 Lone'));
    wrap.append(btns);
  }
  draw();
  return wrap;
}

function firstIncompleteHole(round) {
  for (const hole of round.course.holes) {
    const done = round.players.every((p) => round.scores?.[hole.number]?.[p.id] != null);
    if (!done) return hole.number;
  }
  return 18;
}

/* -------------------------------- Results -------------------------------- */

export function renderResults(root, params) {
  const round = store.getRound(params.id);
  if (!round) { go('#/'); return; }

  const combined = combinedPayouts(round);
  const sorted = [...round.players].sort((a, b) => combined[b.id] - combined[a.id]);
  const transfers = settle(combined);

  const gameSections = round.games.map((inst) => {
    const game = GAMES[inst.gameId];
    const { payouts } = game.compute(round, inst.config);
    return h('details', { class: 'card game-result' },
      h('summary', {},
        h('strong', {}, game.name),
        h('span', { class: 'muted small' }, ` · ${inst.config.mode} · $${inst.config.value}`),
      ),
      h('div', { class: 'result-rows' }, round.players.map((p) =>
        h('div', { class: 'result-row' },
          h('span', {}, p.name),
          h('span', { class: payouts[p.id] >= 0 ? 'up' : 'down' }, money(payouts[p.id])),
        ))),
    );
  });

  root.append(
    header('Payouts', { back: `#/round/${round.id}` }),
    h('div', { class: 'screen' },
      h('h2', { class: 'section' }, 'Total'),
      h('div', { class: 'card' },
        h('div', { class: 'result-rows big' }, sorted.map((p) =>
          h('div', { class: 'result-row' },
            h('strong', {}, p.name),
            h('strong', { class: combined[p.id] >= 0 ? 'up' : 'down' }, money(combined[p.id])),
          ))),
      ),
      h('h2', { class: 'section' }, 'Settle up'),
      transfers.length === 0
        ? h('p', { class: 'muted' }, 'All square — nobody owes anything yet.')
        : h('div', { class: 'card' }, h('div', { class: 'result-rows' }, transfers.map((t) =>
            h('div', { class: 'result-row' },
              h('span', {}, `${nameById(round, t.from)} → ${nameById(round, t.to)}`),
              h('strong', { class: 'up' }, `$${t.amount}`),
            )))),
      h('h2', { class: 'section' }, 'By game'),
      ...gameSections,
      h('button', { class: 'btn', onclick: () => go(`#/round/${round.id}`) }, '← Back to scorecard'),
    ),
  );
}

function nameById(round, id) {
  return round.players.find((p) => p.id === id)?.name || '?';
}
