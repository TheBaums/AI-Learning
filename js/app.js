// app.js — entry point + a tiny hash router. Each route clears the root element
// and calls the matching screen renderer from ui.js.

import * as ui from './ui.js';

const root = document.getElementById('app');

const routes = [
  { re: /^#\/$/, view: ui.renderHome },
  { re: /^#\/players$/, view: ui.renderPlayers },
  { re: /^#\/courses$/, view: ui.renderCourses },
  { re: /^#\/course\/([^/]+)$/, view: ui.renderCourseEdit, keys: ['id'] },
  { re: /^#\/round\/new$/, view: ui.renderRoundNew },
  { re: /^#\/round\/([^/]+)\/results$/, view: ui.renderResults, keys: ['id'] },
  { re: /^#\/round\/([^/]+)$/, view: ui.renderScorecard, keys: ['id'] },
];

function render() {
  const hash = location.hash || '#/';
  root.innerHTML = '';
  window.scrollTo(0, 0);

  for (const route of routes) {
    const m = hash.match(route.re);
    if (m) {
      const params = {};
      (route.keys || []).forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      route.view(root, params, render);
      return;
    }
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', render);
window.addEventListener('load', render);
render();

// Register the service worker for offline use (best-effort; ignored on file://).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
