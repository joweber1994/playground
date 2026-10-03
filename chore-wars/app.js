(function () {
  'use strict';

  var STORAGE_KEY = 'chore-wars-v1';
  var SCORE_CAP = 999999;
  var HISTORY_LIMIT = 5;
  var CLAIM_LOCK_MS = 450;

  var CHORES = [
    { id: 'trash', title: 'Müll & Altglas wegbringen', points: 10 },
    { id: 'dishwasher', title: 'Spülmaschine ausräumen', points: 15 },
    { id: 'bathroom', title: 'Bad putzen', points: 50 },
    { id: 'camper', title: 'Camper saugen', points: 40 }
  ];

  var PLAYERS = [
    { id: 'p1', name: 'Spieler 1' },
    { id: 'p2', name: 'Spieler 2' }
  ];

  var RANKS = [
    { min: 0, title: 'Rekrut' },
    { min: 50, title: 'Kämpfer' },
    { min: 150, title: 'Veteran' },
    { min: 300, title: 'Champion' },
    { min: 600, title: 'Legende' }
  ];

  var locks = new Set();
  var state = defaultState();

  var els = {
    list: document.getElementById('chore-list'),
    history: document.getElementById('history-list'),
    empty: document.getElementById('history-empty'),
    reset: document.getElementById('reset-btn'),
    leader: document.getElementById('leader'),
    connectivity: document.getElementById('connectivity'),
    live: document.getElementById('live'),
    bar1: document.getElementById('bar-p1'),
    bar2: document.getElementById('bar-p2')
  };

  function defaultState() {
    return {
      players: PLAYERS.map(function (player) {
        return { id: player.id, name: player.name, score: 0 };
      }),
      history: []
    };
  }

  function punkteLabel(points) {
    return points === 1 ? '1 Punkt' : points + ' Punkte';
  }

  function rankFor(score) {
    var current = RANKS[0].title;
    RANKS.forEach(function (rank) {
      if (score >= rank.min) current = rank.title;
    });
    return current;
  }

  function playerName(id) {
    var match = PLAYERS.find(function (player) { return player.id === id; });
    return match ? match.name : 'Spieler';
  }

  function isHistoryItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.playerId !== 'p1' && item.playerId !== 'p2') return false;
    if (typeof item.title !== 'string' || item.title.length === 0 || item.title.length > 120) return false;
    var points = Number(item.points);
    var at = Number(item.at);
    if (!Number.isFinite(points) || points < 0 || points > 1000) return false;
    if (!Number.isFinite(at) || at < 0) return false;
    return true;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.players)) return defaultState();

      var players = PLAYERS.map(function (blueprint, index) {
        var stored = data.players.find(function (player) {
          return player && player.id === blueprint.id;
        }) || data.players[index] || {};
        var score = Number(stored.score);
        return {
          id: blueprint.id,
          name: blueprint.name,
          score: Number.isFinite(score) && score > 0 ? Math.min(SCORE_CAP, Math.floor(score)) : 0
        };
      });

      var history = Array.isArray(data.history)
        ? data.history.filter(isHistoryItem).slice(0, HISTORY_LIMIT).map(function (item) {
          return {
            id: typeof item.id === 'string' ? item.id : uid(),
            choreId: typeof item.choreId === 'string' ? item.choreId : '',
            title: item.title,
            points: Math.floor(Number(item.points)),
            playerId: item.playerId,
            playerName: playerName(item.playerId),
            at: Math.floor(Number(item.at))
          };
        })
        : [];

      return { players: players, history: history };
    } catch (error) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function formatWhen(timestamp) {
    var diff = Math.max(0, Date.now() - timestamp);
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'gerade eben';
    if (minutes === 1) return 'vor 1 Min.';
    if (minutes < 60) return 'vor ' + minutes + ' Min.';
    var hours = Math.floor(minutes / 60);
    if (hours === 1) return 'vor 1 Std.';
    if (hours < 24) return 'vor ' + hours + ' Std.';
    var days = Math.floor(hours / 24);
    if (days === 1) return 'gestern';
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit'
    }).format(new Date(timestamp));
  }

  function leaderSentence() {
    var first = state.players[0];
    var second = state.players[1];
    if (first.score === second.score) return 'Gleichstand';
    var leader = first.score > second.score ? first : second;
    var diff = Math.abs(first.score - second.score);
    return leader.name + ' führt mit ' + diff + ' ' + (diff === 1 ? 'Punkt' : 'Punkten');
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderChores() {
    els.list.replaceChildren();
    CHORES.forEach(function (chore) {
      var item = element('li', 'chore-card');
      item.dataset.chore = chore.id;
      item.dataset.points = String(chore.points);

      var top = element('div', 'chore-top');
      top.append(
        element('h3', 'chore-title', chore.title),
        element('p', 'points-badge', punkteLabel(chore.points))
      );

      var actions = element('div', 'claims');
      PLAYERS.forEach(function (player) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'claim claim-' + player.id;
        button.dataset.player = player.id;
        button.setAttribute(
          'aria-label',
          chore.title + ' für ' + player.name + ' holen, ' + punkteLabel(chore.points)
        );

        var line = element('span', 'claim-line');
        line.append(
          element('span', 'claim-name', player.name),
          element('span', 'claim-points', '+' + chore.points)
        );
        button.append(element('span', 'claim-kicker', 'Holen'), line);
        actions.append(button);
      });

      item.append(top, actions);
      els.list.append(item);
    });
  }

  function setScore(player, animate) {
    var value = document.getElementById('score-' + player.id);
    var target = String(player.score);
    if (!value) return;
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      value.textContent = target;
      value.dataset.value = target;
      value.dataset.anim = '';
      return;
    }

    var from = Number(value.dataset.value || value.textContent || 0);
    var token = uid();
    value.dataset.anim = token;
    var start = performance.now();
    var duration = 320;

    function frame(now) {
      if (value.dataset.anim !== token) return;
      var progress = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + (player.score - from) * eased);
      value.textContent = String(current);
      if (progress < 1) {
        requestAnimationFrame(frame);
        return;
      }
      value.dataset.value = target;
      value.textContent = target;
    }

    requestAnimationFrame(frame);
    var scoreWrap = value.closest('.score');
    if (scoreWrap) {
      scoreWrap.classList.remove('is-bump');
      void scoreWrap.offsetWidth;
      scoreWrap.classList.add('is-bump');
    }
  }

  function renderScores(animate) {
    var first = state.players[0];
    var second = state.players[1];
    var leaderId = null;
    if (first.score !== second.score) {
      leaderId = first.score > second.score ? first.id : second.id;
    }

    state.players.forEach(function (player) {
      setScore(player, animate);
      var rank = document.getElementById('rank-' + player.id);
      var crown = document.getElementById('crown-' + player.id);
      var card = document.getElementById('card-' + player.id);
      if (rank) rank.textContent = rankFor(player.score);
      if (crown) crown.hidden = player.id !== leaderId;
      if (card) card.classList.toggle('is-leading', player.id === leaderId);
    });

    els.leader.textContent = leaderSentence();

    var total = first.score + second.score;
    var share = total === 0 ? 50 : (first.score / total) * 100;
    els.bar1.style.width = share + '%';
    els.bar2.style.width = (100 - share) + '%';
  }

  function renderHistory() {
    var items = state.history.slice(0, HISTORY_LIMIT);
    els.history.replaceChildren();
    els.empty.hidden = items.length > 0;
    els.history.hidden = items.length === 0;

    items.forEach(function (entry) {
      var row = element('li', 'history-item history-' + entry.playerId);
      var when = document.createElement('time');
      when.dateTime = new Date(entry.at).toISOString();
      when.dataset.at = String(entry.at);
      when.textContent = formatWhen(entry.at);
      row.append(
        element('span', 'history-who', playerName(entry.playerId)),
        element('span', 'history-pts', '+' + entry.points),
        element('span', 'history-what', entry.title),
        when
      );
      els.history.append(row);
    });
  }

  function refreshTimes() {
    document.querySelectorAll('#history-list time').forEach(function (node) {
      var at = Number(node.dataset.at);
      if (Number.isFinite(at)) node.textContent = formatWhen(at);
    });
  }

  function spawnBurst(button, points, playerId) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var burst = element('span', 'burst burst-' + playerId, '+' + points);
    burst.setAttribute('aria-hidden', 'true');
    button.appendChild(burst);
    burst.addEventListener('animationend', function () {
      burst.remove();
    });
  }

  function announce(message) {
    els.live.textContent = message;
  }

  function claim(card, button) {
    var chore = CHORES.find(function (item) { return item.id === card.dataset.chore; });
    var player = state.players.find(function (item) { return item.id === button.dataset.player; });
    if (!chore || !player) return;

    var key = chore.id + ':' + player.id;
    if (locks.has(key)) return;

    if (player.score >= SCORE_CAP) {
      announce(player.name + ' hat die maximale Punktzahl erreicht.');
      return;
    }

    locks.add(key);
    button.disabled = true;
    player.score = Math.min(SCORE_CAP, player.score + chore.points);
    state.history.unshift({
      id: uid(),
      choreId: chore.id,
      title: chore.title,
      points: chore.points,
      playerId: player.id,
      playerName: player.name,
      at: Date.now()
    });
    state.history = state.history.slice(0, HISTORY_LIMIT);

    var saved = save();
    renderScores(true);
    renderHistory();
    spawnBurst(button, chore.points, player.id);
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (error) { /* optional */ }
    }

    var message = player.name + ' erhält ' + punkteLabel(chore.points) + ' für ' + chore.title +
      '. Stand: ' + state.players[0].score + ' zu ' + state.players[1].score + '.';
    if (!saved) message += ' Speichern auf diesem Gerät ist fehlgeschlagen.';
    announce(message);

    window.setTimeout(function () {
      locks.delete(key);
      if (button.isConnected) button.disabled = false;
    }, CLAIM_LOCK_MS);
  }

  function resetScores() {
    var confirmed = window.confirm('Punkte und Verlauf wirklich zurücksetzen? Das kann nicht rückgängig gemacht werden.');
    if (!confirmed) return;
    state = defaultState();
    save();
    renderScores(false);
    renderHistory();
    announce('Punkte und Verlauf wurden zurückgesetzt.');
  }

  function isLocalFile() {
    return window.location.protocol === 'file:';
  }

  function updateConnectivity() {
    var node = els.connectivity;
    node.classList.remove('is-ready', 'is-offline');
    if (isLocalFile()) {
      node.classList.add('is-ready');
      node.textContent = 'Lokal auf diesem Gerät';
      return;
    }
    if (!navigator.onLine) {
      node.classList.add('is-offline');
      node.textContent = 'Offline – alles bleibt auf diesem Gerät';
      return;
    }
    if (!('serviceWorker' in navigator)) {
      node.classList.add('is-ready');
      node.textContent = 'Lokal gespeichert';
      return;
    }
    if (navigator.serviceWorker.controller) {
      node.classList.add('is-ready');
      node.textContent = 'Offline-bereit';
      return;
    }
    node.textContent = 'Wird lokal gespeichert…';
  }

  function registerServiceWorker() {
    if (isLocalFile() || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js', {
      scope: './',
      updateViaCache: 'none'
    }).catch(function (error) {
      console.error('Service Worker konnte nicht registriert werden.', error);
    });
    navigator.serviceWorker.addEventListener('controllerchange', updateConnectivity);
    navigator.serviceWorker.ready.then(updateConnectivity).catch(function () {});
  }

  function init() {
    state = load();
    renderChores();
    renderScores(false);
    renderHistory();
    updateConnectivity();

    els.list.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-player]');
      if (!button || button.disabled) return;
      var card = button.closest('[data-chore]');
      if (!card) return;
      claim(card, button);
    });

    els.reset.addEventListener('click', resetScores);
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    window.setInterval(refreshTimes, 30000);
    registerServiceWorker();
  }

  init();
})();
