/* Chore Wars – Stand, Migration und Buchungen.
   Reine Funktionen, ohne DOM. Im Browser als ChoreWarsState, unter Node als Modul. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoreWarsState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STORAGE_KEY = 'chore-wars-v2';
  var LEGACY_KEY = 'chore-wars-v1';
  var SCORE_CAP = 999999;
  var HISTORY_LIMIT = 50;
  var TITLE_MAX = 80;
  var HISTORY_TITLE_MAX = 120;
  var NAME_MAX = 24;
  var POINTS_MIN = 1;
  var POINTS_MAX = 999;
  var TOTAL_CAP = 1000000;
  var PLAYER_IDS = ['p1', 'p2'];
  var DEFAULT_NAMES = { p1: 'Spieler 1', p2: 'Spieler 2' };

  var DEFAULT_CHORES = [
    { id: 'trash', title: 'Müll & Altglas wegbringen', points: 10, sort: 0 },
    { id: 'dishwasher', title: 'Spülmaschine ausräumen', points: 15, sort: 1 },
    { id: 'bathroom', title: 'Bad putzen', points: 50, sort: 2 },
    { id: 'camper', title: 'Camper saugen', points: 40, sort: 3 }
  ];

  var RANKS = [
    { min: 0, title: 'Rekrut' },
    { min: 50, title: 'Kämpfer' },
    { min: 150, title: 'Veteran' },
    { min: 300, title: 'Champion' },
    { min: 600, title: 'Legende' }
  ];

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function copyChore(chore) {
    return {
      id: chore.id,
      title: chore.title,
      points: chore.points,
      sort: chore.sort
    };
  }

  function defaultChores() {
    return DEFAULT_CHORES.map(copyChore);
  }

  function defaultState() {
    return {
      version: 2,
      players: [
        { id: 'p1', name: DEFAULT_NAMES.p1, score: 0 },
        { id: 'p2', name: DEFAULT_NAMES.p2, score: 0 }
      ],
      chores: defaultChores(),
      history: [],
      totals: []
    };
  }

  function collapseSpaces(value) {
    return value.trim().replace(/\s+/g, ' ');
  }

  function cleanName(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var name = collapseSpaces(value);
    if (name.length < 1 || name.length > NAME_MAX) return fallback;
    return name;
  }

  function cleanTitleValue(value, max) {
    if (typeof value !== 'string') return '';
    var title = collapseSpaces(value);
    if (title.length < 1 || title.length > max) return '';
    return title;
  }

  function clampScore(value) {
    var score = Number(value);
    if (!Number.isFinite(score) || score <= 0) return 0;
    return Math.min(SCORE_CAP, Math.floor(score));
  }

  function fail(message) {
    return { ok: false, error: message };
  }

  function ok(state) {
    return { ok: true, state: state };
  }

  function readTitle(value) {
    if (typeof value !== 'string' || collapseSpaces(value).length < 1) {
      return fail('Titel fehlt.');
    }
    var title = collapseSpaces(value);
    if (title.length > TITLE_MAX) return fail('Titel ist zu lang.');
    return { ok: true, value: title };
  }

  function readPoints(value) {
    var raw = value;
    if (typeof raw === 'string') raw = raw.trim();
    if (raw == null || raw === '') return fail('Punkte zwischen 1 und 999.');
    if (typeof raw === 'string' && !/^\d+$/.test(raw)) return fail('Punkte zwischen 1 und 999.');
    var points = Number(raw);
    if (!Number.isFinite(points) || Math.floor(points) !== points || points < POINTS_MIN || points > POINTS_MAX) {
      return fail('Punkte zwischen 1 und 999.');
    }
    return { ok: true, value: points };
  }

  function readPlayerName(value) {
    if (typeof value !== 'string' || collapseSpaces(value).length < 1) return fail('Name fehlt.');
    var name = collapseSpaces(value);
    if (name.length > NAME_MAX) return fail('Name ist zu lang.');
    return { ok: true, value: name };
  }

  function playersFrom(data) {
    var source = data && Array.isArray(data.players) ? data.players : [];
    var players = PLAYER_IDS.map(function (id, index) {
      var stored = null;
      for (var i = 0; i < source.length; i += 1) {
        if (source[i] && source[i].id === id) {
          stored = source[i];
          break;
        }
      }
      if (!stored) stored = source[index] || {};
      return {
        id: id,
        name: cleanName(stored.name, DEFAULT_NAMES[id]),
        score: clampScore(stored.score)
      };
    });
    if (players[0].name.toLowerCase() === players[1].name.toLowerCase()) {
      players[1].name = DEFAULT_NAMES.p2;
      if (players[0].name.toLowerCase() === players[1].name.toLowerCase()) {
        players[0].name = DEFAULT_NAMES.p1;
      }
    }
    return players;
  }

  function reindex(chores) {
    return chores.map(function (chore, index) {
      var next = copyChore(chore);
      next.sort = index;
      return next;
    });
  }

  function choresFrom(data) {
    if (!data || !Array.isArray(data.chores)) return defaultChores();
    var seen = {};
    var parsed = [];
    data.chores.forEach(function (chore, index) {
      if (!chore || typeof chore !== 'object') return;
      if (typeof chore.id !== 'string') return;
      var id = chore.id.trim();
      if (!id || id.length > 80 || seen[id]) return;
      var title = cleanTitleValue(chore.title, TITLE_MAX);
      if (!title) return;
      var points = Number(chore.points);
      if (!Number.isFinite(points) || Math.floor(points) !== points || points < POINTS_MIN || points > POINTS_MAX) return;
      var sort = Number(chore.sort);
      seen[id] = true;
      parsed.push({
        id: id,
        title: title,
        points: points,
        sort: Number.isFinite(sort) ? sort : index
      });
    });
    if (parsed.length === 0) return defaultChores();
    parsed.sort(function (a, b) { return a.sort - b.sort; });
    return reindex(parsed);
  }

  function isHistoryItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.playerId !== 'p1' && item.playerId !== 'p2') return false;
    if (typeof item.title !== 'string' || collapseSpaces(item.title).length < 1 || collapseSpaces(item.title).length > HISTORY_TITLE_MAX) {
      return false;
    }
    var points = Number(item.points);
    var at = Number(item.at);
    if (!Number.isFinite(points) || Math.floor(points) !== points || points < 1 || points > 1000) return false;
    if (!Number.isFinite(at) || at < 0) return false;
    return true;
  }

  function playerById(players, id) {
    for (var i = 0; i < players.length; i += 1) {
      if (players[i].id === id) return players[i];
    }
    return null;
  }

  function historyFrom(data, players) {
    if (!data || !Array.isArray(data.history)) return [];
    var items = [];
    data.history.forEach(function (item) {
      if (!isHistoryItem(item)) return;
      if (items.length >= HISTORY_LIMIT) return;
      var player = playerById(players, item.playerId);
      var fallback = player ? player.name : DEFAULT_NAMES[item.playerId];
      var choreId = typeof item.choreId === 'string' ? item.choreId.trim().slice(0, 80) : '';
      items.push({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 80) : uid(),
        choreId: choreId,
        title: collapseSpaces(item.title),
        points: Math.floor(Number(item.points)),
        playerId: item.playerId,
        playerName: cleanName(item.playerName, fallback),
        at: Math.floor(Number(item.at))
      });
    });
    return items;
  }

  function totalsFromHistory(history) {
    var map = {};
    var order = [];
    history.forEach(function (item) {
      var key = item.playerId + '\0' + item.choreId;
      if (!map[key]) {
        map[key] = {
          playerId: item.playerId,
          choreId: item.choreId,
          title: item.title,
          count: 0
        };
        order.push(key);
      }
      map[key].count += 1;
    });
    return order.map(function (key) { return map[key]; });
  }

  function sanitizeTotals(rows) {
    if (!Array.isArray(rows)) return [];
    var map = {};
    var order = [];
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      if (row.playerId !== 'p1' && row.playerId !== 'p2') return;
      if (typeof row.choreId !== 'string') return;
      var choreId = row.choreId.trim().slice(0, 80);
      var title = cleanTitleValue(row.title, HISTORY_TITLE_MAX);
      if (!title) return;
      var count = Math.floor(Number(row.count));
      if (!Number.isFinite(count) || count < 1 || count > TOTAL_CAP) return;
      var key = row.playerId + '\0' + choreId;
      if (!map[key]) {
        map[key] = { playerId: row.playerId, choreId: choreId, title: title, count: 0 };
        order.push(key);
      }
      map[key].title = title;
      map[key].count = Math.min(TOTAL_CAP, map[key].count + count);
    });
    return order.map(function (key) { return map[key]; });
  }

  function migrate(data) {
    if (!data || typeof data !== 'object') return defaultState();
    var players = playersFrom(data);
    var state = {
      version: 2,
      players: players,
      chores: choresFrom(data),
      history: historyFrom(data, players),
      totals: Array.isArray(data.totals) ? sanitizeTotals(data.totals) : totalsFromHistory(historyFrom(data, players))
    };
    return state;
  }

  function findChore(state, id) {
    for (var i = 0; i < state.chores.length; i += 1) {
      if (state.chores[i].id === id) return state.chores[i];
    }
    return null;
  }

  function bumpTotal(state, playerId, choreId, title, delta) {
    var row = null;
    for (var i = 0; i < state.totals.length; i += 1) {
      if (state.totals[i].playerId === playerId && state.totals[i].choreId === choreId) {
        row = state.totals[i];
        break;
      }
    }
    if (!row) {
      if (delta > 0) {
        state.totals.push({
          playerId: playerId,
          choreId: choreId,
          title: title,
          count: delta
        });
      }
      return;
    }
    if (title) row.title = title;
    row.count += delta;
    if (row.count <= 0) {
      state.totals = state.totals.filter(function (item) { return item !== row; });
    }
  }

  function claim(state, choreId, playerId, options) {
    var next = migrate(state);
    var chore = findChore(next, choreId);
    var player = playerById(next.players, playerId);
    if (!chore || !player) return fail('Aufgabe oder Spieler fehlt.');
    if (player.score + chore.points > SCORE_CAP) {
      return fail(player.name + ' hat die maximale Punktzahl erreicht.');
    }
    player.score += chore.points;
    var now = options && options.now != null ? options.now : Date.now();
    var id = options && options.id ? options.id : uid();
    next.history.unshift({
      id: id,
      choreId: chore.id,
      title: chore.title,
      points: chore.points,
      playerId: player.id,
      playerName: player.name,
      at: Math.floor(Number(now))
    });
    if (next.history.length > HISTORY_LIMIT) next.history = next.history.slice(0, HISTORY_LIMIT);
    bumpTotal(next, player.id, chore.id, chore.title, 1);
    return ok(next);
  }

  function undo(state) {
    var next = migrate(state);
    if (next.history.length === 0) return fail('Nichts zum Rückgängigmachen.');
    var entry = next.history[0];
    var player = playerById(next.players, entry.playerId);
    if (player) player.score = Math.max(0, player.score - entry.points);
    bumpTotal(next, entry.playerId, entry.choreId, entry.title, -1);
    next.history = next.history.slice(1);
    return ok(next);
  }

  function resetScores(state) {
    var next = migrate(state);
    next.players.forEach(function (player) { player.score = 0; });
    next.history = [];
    return next;
  }

  function addChore(state, input, options) {
    var title = readTitle(input && input.title);
    if (!title.ok) return title;
    var points = readPoints(input && input.points);
    if (!points.ok) return points;
    var next = migrate(state);
    var sort = 0;
    next.chores.forEach(function (chore) {
      if (chore.sort >= sort) sort = chore.sort + 1;
    });
    next.chores.push({
      id: options && options.id ? options.id : uid(),
      title: title.value,
      points: points.value,
      sort: sort
    });
    next.chores = reindex(next.chores.slice().sort(function (a, b) { return a.sort - b.sort; }));
    return ok(next);
  }

  function updateChore(state, id, input) {
    var title = readTitle(input && input.title);
    if (!title.ok) return title;
    var points = readPoints(input && input.points);
    if (!points.ok) return points;
    var next = migrate(state);
    var chore = findChore(next, id);
    if (!chore) return fail('Aufgabe fehlt.');
    chore.title = title.value;
    chore.points = points.value;
    next.totals.forEach(function (row) {
      if (row.choreId === id) row.title = title.value;
    });
    return ok(next);
  }

  function deleteChore(state, id) {
    var next = migrate(state);
    if (next.chores.length <= 1) return fail('Die letzte Aufgabe bleibt bestehen.');
    if (!findChore(next, id)) return fail('Aufgabe fehlt.');
    next.chores = reindex(next.chores.filter(function (chore) { return chore.id !== id; }));
    return ok(next);
  }

  function moveChore(state, id, direction) {
    var next = migrate(state);
    var chores = next.chores.slice().sort(function (a, b) { return a.sort - b.sort; });
    var index = -1;
    for (var i = 0; i < chores.length; i += 1) {
      if (chores[i].id === id) index = i;
    }
    var target = index + direction;
    if (index < 0 || target < 0 || target >= chores.length) {
      return fail('Die Aufgabe lässt sich nicht verschieben.');
    }
    var current = chores[index];
    chores[index] = chores[target];
    chores[target] = current;
    next.chores = reindex(chores);
    return ok(next);
  }

  function renamePlayer(state, playerId, name) {
    var cleaned = readPlayerName(name);
    if (!cleaned.ok) return cleaned;
    var next = migrate(state);
    var player = playerById(next.players, playerId);
    if (!player) return fail('Spieler fehlt.');
    var other = null;
    for (var i = 0; i < next.players.length; i += 1) {
      if (next.players[i].id !== playerId) other = next.players[i];
    }
    if (other && other.name.toLowerCase() === cleaned.value.toLowerCase()) {
      return fail('Die Namen müssen sich unterscheiden.');
    }
    player.name = cleaned.value;
    return ok(next);
  }

  function playerStats(state) {
    var next = migrate(state);
    return next.players.map(function (player) {
      var rows = next.totals.filter(function (row) { return row.playerId === player.id; });
      var claims = 0;
      var top = null;
      rows.forEach(function (row) {
        claims += row.count;
        if (!top || row.count > top.count || (row.count === top.count && row.title.localeCompare(top.title, 'de') < 0)) {
          top = { choreId: row.choreId, title: row.title, count: row.count };
        }
      });
      return {
        playerId: player.id,
        name: player.name,
        claims: claims,
        topChore: top
      };
    });
  }

  function serialize(state) {
    return migrate(state);
  }

  function parseImport(raw) {
    var data = raw;
    if (typeof raw === 'string') {
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return fail('Die Datei ist kein gültiger Stand.');
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return fail('Diese Datei ist kein Chore-Wars-Stand.');
    }
    if (data.version !== 2 || !Array.isArray(data.players) || !Array.isArray(data.chores) || data.chores.length === 0) {
      return fail('Diese Datei ist kein Chore-Wars-Stand.');
    }
    var state = migrate(data);
    var kept = false;
    for (var i = 0; i < state.chores.length; i += 1) {
      for (var j = 0; j < data.chores.length; j += 1) {
        if (data.chores[j] && data.chores[j].id === state.chores[i].id) kept = true;
      }
    }
    if (!kept) return fail('Der Stand ist unvollständig.');
    return ok(state);
  }

  function rankFor(score) {
    var current = RANKS[0].title;
    RANKS.forEach(function (rank) {
      if (score >= rank.min) current = rank.title;
    });
    return current;
  }

  function punkteLabel(points) {
    return points === 1 ? '1 Punkt' : points + ' Punkte';
  }

  function leaderSentence(state) {
    var next = migrate(state);
    var first = next.players[0];
    var second = next.players[1];
    if (first.score === second.score) return 'Gleichstand';
    var leader = first.score > second.score ? first : second;
    var diff = Math.abs(first.score - second.score);
    return leader.name + ' führt mit ' + diff + ' ' + (diff === 1 ? 'Punkt' : 'Punkten');
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    LEGACY_KEY: LEGACY_KEY,
    SCORE_CAP: SCORE_CAP,
    HISTORY_LIMIT: HISTORY_LIMIT,
    TITLE_MAX: TITLE_MAX,
    NAME_MAX: NAME_MAX,
    POINTS_MIN: POINTS_MIN,
    POINTS_MAX: POINTS_MAX,
    defaultState: defaultState,
    migrate: migrate,
    claim: claim,
    undo: undo,
    resetScores: resetScores,
    addChore: addChore,
    updateChore: updateChore,
    deleteChore: deleteChore,
    moveChore: moveChore,
    renamePlayer: renamePlayer,
    playerStats: playerStats,
    serialize: serialize,
    parseImport: parseImport,
    rankFor: rankFor,
    punkteLabel: punkteLabel,
    leaderSentence: leaderSentence
  };
});
