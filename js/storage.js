// storage.js — all persistence lives here. Everything is kept in the browser's
// localStorage so the app works fully offline (important on the course) with no
// account or server. Data survives across sessions on the same device/browser.

const KEYS = {
  players: 'golf.players',
  courses: 'golf.courses',
  rounds: 'golf.rounds',
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------- Players -------------------------------- */

export function getPlayers() {
  return read(KEYS.players);
}

export function savePlayer(player) {
  const players = getPlayers();
  if (player.id) {
    const i = players.findIndex((p) => p.id === player.id);
    if (i >= 0) players[i] = player;
    else players.push(player);
  } else {
    player.id = uid('plr');
    players.push(player);
  }
  write(KEYS.players, players);
  return player;
}

export function deletePlayer(id) {
  write(KEYS.players, getPlayers().filter((p) => p.id !== id));
}

/* ------------------------------- Courses -------------------------------- */

export function getCourses() {
  return read(KEYS.courses);
}

export function getCourse(id) {
  return getCourses().find((c) => c.id === id) || null;
}

export function saveCourse(course) {
  const courses = getCourses();
  if (course.id) {
    const i = courses.findIndex((c) => c.id === course.id);
    if (i >= 0) courses[i] = course;
    else courses.push(course);
  } else {
    course.id = uid('crs');
    courses.push(course);
  }
  write(KEYS.courses, courses);
  return course;
}

export function deleteCourse(id) {
  write(KEYS.courses, getCourses().filter((c) => c.id !== id));
}

/** Build a blank 18-hole course template (par 4s, sequential stroke index). */
export function blankCourse(name = '') {
  return {
    id: null,
    name,
    holes: Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: 4,
      strokeIndex: i + 1,
      yardage: '',
    })),
  };
}

/* -------------------------------- Rounds -------------------------------- */

export function getRounds() {
  return read(KEYS.rounds).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function getRound(id) {
  return getRounds().find((r) => r.id === id) || null;
}

export function saveRound(round) {
  const rounds = read(KEYS.rounds);
  if (round.id) {
    const i = rounds.findIndex((r) => r.id === round.id);
    if (i >= 0) rounds[i] = round;
    else rounds.push(round);
  } else {
    round.id = uid('rnd');
    rounds.push(round);
  }
  write(KEYS.rounds, rounds);
  return round;
}

export function deleteRound(id) {
  write(KEYS.rounds, read(KEYS.rounds).filter((r) => r.id !== id));
}
