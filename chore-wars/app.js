(function () {
  'use strict';

  var api = window.ChoreWarsState;
  if (!api) return;

  var CLAIM_LOCK_MS = 450;
  var locks = new Set();
  var state = api.defaultState();
  var sheetState = { onSubmit: null, lastFocus: null };

  var els = {
    list: document.getElementById('chore-list'),
    history: document.getElementById('history-list'),
    empty: document.getElementById('history-empty'),
    stats: document.getElementById('stats-list'),
    reset: document.getElementById('reset-btn'),
    backup: document.getElementById('backup-btn'),
    add: document.getElementById('add-chore'),
    leader: document.getElementById('leader'),
    scoreboard: document.getElementById('scoreboard'),
    connectivity: document.getElementById('connectivity'),
    live: document.getElementById('live'),
    bar1: document.getElementById('bar-p1'),
    bar2: document.getElementById('bar-p2'),
    sheet: document.getElementById('sheet'),
    sheetForm: document.getElementById('sheet-form'),
    sheetTitle: document.getElementById('sheet-title'),
    sheetBody: document.getElementById('sheet-body'),
    sheetError: document.getElementById('sheet-error'),
    sheetSubmit: document.getElementById('sheet-submit'),
    sheetCancel: document.getElementById('sheet-cancel'),
    importFile: document.getElementById('import-file'),
    app: document.querySelector('.app')
  };

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function load() {
    try {
      var raw = localStorage.getItem(api.STORAGE_KEY);
      if (raw) return api.migrate(JSON.parse(raw));
    } catch (error) { /* v2 unlesbar, danach den alten Stand versuchen */ }
    try {
      var legacy = localStorage.getItem(api.LEGACY_KEY);
      if (legacy) return api.migrate(JSON.parse(legacy));
    } catch (error) { /* alter Stand unlesbar */ }
    return api.defaultState();
  }

  function save() {
    try {
      localStorage.setItem(api.STORAGE_KEY, JSON.stringify(api.serialize(state)));
      return true;
    } catch (error) {
      return false;
    }
  }

  function announce(message) {
    els.live.textContent = message;
  }

  function withSaveNote(message, saved) {
    return saved ? message : message + ' Speichern auf diesem Gerät ist fehlgeschlagen.';
  }

  function commit(next, message) {
    state = next;
    var saved = save();
    renderChores();
    renderHistory();
    renderStats();
    renderScores(false);
    announce(withSaveNote(message, saved));
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

  function renderScoreboard() {
    els.scoreboard.replaceChildren();
    state.players.forEach(function (player) {
      var card = element('article', 'player player-' + player.id);
      card.id = 'card-' + player.id;

      var name = document.createElement('button');
      name.type = 'button';
      name.className = 'player-name';
      name.dataset.rename = player.id;
      name.textContent = player.name;

      var score = element('p', 'score');
      var value = element('span', 'score-value', String(player.score));
      value.id = 'score-' + player.id;
      value.dataset.value = String(player.score);
      score.append(value, element('span', 'sr-only', ' Punkte'));

      var rank = element('p', 'rank', api.rankFor(player.score));
      rank.id = 'rank-' + player.id;
      var crown = element('p', 'crown', 'Führung');
      crown.id = 'crown-' + player.id;
      crown.hidden = true;

      card.append(name, score, rank, crown);
      els.scoreboard.append(card);
      if (player.id === 'p1') {
        var vs = element('p', 'vs', 'VS');
        vs.setAttribute('aria-hidden', 'true');
        els.scoreboard.append(vs);
      }
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
    var token = String(Date.now()) + Math.random().toString(36).slice(2, 6);
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
    if (!document.getElementById('score-p1')) renderScoreboard();
    var first = state.players[0];
    var second = state.players[1];
    var leaderId = null;
    if (first.score !== second.score) {
      leaderId = first.score > second.score ? first.id : second.id;
    }

    state.players.forEach(function (player) {
      var nameButton = document.querySelector('[data-rename="' + player.id + '"]');
      if (nameButton) {
        nameButton.textContent = player.name;
        nameButton.setAttribute('aria-label', player.name + ' umbenennen');
      }
      setScore(player, animate);
      var rank = document.getElementById('rank-' + player.id);
      var crown = document.getElementById('crown-' + player.id);
      var card = document.getElementById('card-' + player.id);
      if (rank) rank.textContent = api.rankFor(player.score);
      if (crown) crown.hidden = player.id !== leaderId;
      if (card) card.classList.toggle('is-leading', player.id === leaderId);
    });

    els.leader.textContent = api.leaderSentence(state);

    var total = first.score + second.score;
    var share = total === 0 ? 50 : (first.score / total) * 100;
    els.bar1.style.width = share + '%';
    els.bar2.style.width = (100 - share) + '%';
  }

  function toolButton(label, attrs, className) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className || 'tool';
    button.textContent = label;
    Object.keys(attrs).forEach(function (key) {
      if (key === 'disabled') button.disabled = attrs[key];
      else button.setAttribute(key, attrs[key]);
    });
    return button;
  }

  function renderChores() {
    locks.clear();
    els.list.replaceChildren();
    var chores = state.chores.slice().sort(function (a, b) { return a.sort - b.sort; });
    chores.forEach(function (chore, index) {
      var item = element('li', 'chore-card');
      item.dataset.chore = chore.id;

      var top = element('div', 'chore-top');
      top.append(
        element('h3', 'chore-title', chore.title),
        element('p', 'points-badge', api.punkteLabel(chore.points))
      );

      var tools = element('div', 'chore-tools');
      tools.append(
        toolButton('Hoch', {
          'data-move': '-1',
          'aria-label': chore.title + ' nach oben',
          disabled: index === 0
        }),
        toolButton('Runter', {
          'data-move': '1',
          'aria-label': chore.title + ' nach unten',
          disabled: index === chores.length - 1
        }),
        toolButton('Bearbeiten', {
          'data-edit': chore.id,
          'aria-label': chore.title + ' bearbeiten'
        }),
        toolButton('Löschen', {
          'data-delete': chore.id,
          'aria-label': chore.title + ' löschen'
        }, 'tool tool-danger')
      );

      var actions = element('div', 'claims');
      state.players.forEach(function (player) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'claim claim-' + player.id;
        button.dataset.player = player.id;
        button.setAttribute(
          'aria-label',
          chore.title + ' für ' + player.name + ' holen, ' + api.punkteLabel(chore.points)
        );
        var line = element('span', 'claim-line');
        line.append(
          element('span', 'claim-name', player.name),
          element('span', 'claim-points', '+' + chore.points)
        );
        button.append(element('span', 'claim-kicker', 'Holen'), line);
        actions.append(button);
      });

      item.append(top, tools, actions);
      els.list.append(item);
    });
  }

  function renderHistory() {
    var items = state.history.slice(0, api.HISTORY_LIMIT);
    els.history.replaceChildren();
    els.empty.hidden = items.length > 0;
    els.history.hidden = items.length === 0;

    items.forEach(function (entry, index) {
      var row = element('li', 'history-item history-' + entry.playerId);
      var when = document.createElement('time');
      when.dateTime = new Date(entry.at).toISOString();
      when.dataset.at = String(entry.at);
      when.textContent = formatWhen(entry.at);
      row.append(
        element('span', 'history-who', entry.playerName),
        element('span', 'history-pts', '+' + entry.points),
        element('span', 'history-what', entry.title),
        when
      );
      if (index === 0) {
        row.append(toolButton('Rückgängig', {
          'data-undo': '1',
          'aria-label': 'Letzte Buchung rückgängig machen'
        }, 'undo'));
      }
      els.history.append(row);
    });
  }

  function refreshTimes() {
    document.querySelectorAll('#history-list time').forEach(function (node) {
      var at = Number(node.dataset.at);
      if (Number.isFinite(at)) node.textContent = formatWhen(at);
    });
  }

  function renderStats() {
    els.stats.replaceChildren();
    api.playerStats(state).forEach(function (row) {
      var card = element('li', 'stats-card stats-' + row.playerId);
      var countText = row.claims === 0
        ? 'Noch keine Erledigung.'
        : (row.claims === 1 ? '1 Erledigung' : row.claims + ' Erledigungen');
      card.append(
        element('p', 'stats-name', row.name),
        element('p', 'stats-count', countText)
      );
      if (row.topChore) {
        var times = row.topChore.count === 1 ? '1-mal' : row.topChore.count + '-mal';
        card.append(element('p', 'stats-top', 'Am häufigsten: ' + row.topChore.title + ', ' + times));
      }
      els.stats.append(card);
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

  function showSheetError(message) {
    els.sheetError.hidden = false;
    els.sheetError.textContent = message;
  }

  function closeSheet() {
    els.sheet.hidden = true;
    if (els.app) els.app.removeAttribute('inert');
    var back = sheetState.lastFocus;
    sheetState.onSubmit = null;
    sheetState.lastFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  function openSheet(config) {
    sheetState.lastFocus = document.activeElement;
    sheetState.onSubmit = config.onSubmit || null;
    els.sheetTitle.textContent = config.title;
    els.sheetBody.replaceChildren();
    if (config.build) config.build(els.sheetBody);
    els.sheetError.hidden = true;
    els.sheetError.textContent = '';
    els.sheetCancel.textContent = config.cancelLabel || 'Abbrechen';
    var showSubmit = !!config.submitLabel;
    els.sheetSubmit.hidden = !showSubmit;
    els.sheetSubmit.disabled = !showSubmit;
    if (showSubmit) {
      els.sheetSubmit.textContent = config.submitLabel;
      els.sheetSubmit.classList.toggle('is-danger', !!config.danger);
    }
    els.sheet.hidden = false;
    if (els.app) els.app.setAttribute('inert', '');
    var focusTarget = els.sheetBody.querySelector('input, button');
    if (!focusTarget && showSubmit) focusTarget = els.sheetSubmit;
    if (!focusTarget) focusTarget = els.sheetCancel;
    if (focusTarget) focusTarget.focus();
  }

  function field(labelText, input) {
    var wrap = element('label', 'field');
    wrap.append(element('span', null, labelText), input);
    return wrap;
  }

  function textInput(name, value, maxLength, capitalize) {
    var input = document.createElement('input');
    input.type = 'text';
    input.name = name;
    input.value = value || '';
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    input.autocapitalize = capitalize || 'sentences';
    input.enterKeyHint = 'done';
    return input;
  }

  function pointsInput(value) {
    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'points';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.value = value == null ? '' : String(value);
    input.maxLength = 3;
    input.autocomplete = 'off';
    input.enterKeyHint = 'done';
    return input;
  }

  function openChoreSheet(chore) {
    openSheet({
      title: chore ? 'Aufgabe bearbeiten' : 'Aufgabe hinzufügen',
      submitLabel: 'Sichern',
      build: function (body) {
        body.append(
          field('Titel', textInput('title', chore ? chore.title : '', api.TITLE_MAX, 'sentences')),
          field('Punkte', pointsInput(chore ? chore.points : 10))
        );
      },
      onSubmit: function () {
        var title = els.sheetBody.querySelector('[name="title"]').value;
        var points = els.sheetBody.querySelector('[name="points"]').value;
        var result = chore
          ? api.updateChore(state, chore.id, { title: title, points: points })
          : api.addChore(state, { title: title, points: points });
        if (!result.ok) return result.error;
        commit(result.state, chore ? 'Aufgabe geändert.' : 'Aufgabe hinzugefügt.');
        return null;
      }
    });
  }

  function openRenameSheet(player) {
    openSheet({
      title: 'Spieler umbenennen',
      submitLabel: 'Sichern',
      build: function (body) {
        body.append(field('Name', textInput('name', player.name, api.NAME_MAX, 'words')));
      },
      onSubmit: function () {
        var name = els.sheetBody.querySelector('[name="name"]').value;
        var result = api.renamePlayer(state, player.id, name);
        if (!result.ok) return result.error;
        commit(result.state, 'Name geändert.');
        return null;
      }
    });
  }

  function openConfirmSheet(config) {
    openSheet({
      title: config.title,
      submitLabel: config.submitLabel,
      danger: true,
      build: function (body) {
        config.lines.forEach(function (line) {
          body.append(element('p', 'sheet-copy', line));
        });
      },
      onSubmit: config.onSubmit
    });
  }

  function openDeleteSheet(chore) {
    openConfirmSheet({
      title: 'Aufgabe löschen',
      submitLabel: 'Löschen',
      lines: [
        '„' + chore.title + '“ wird aus der Liste genommen.',
        'Bisherige Punkte und die Statistik bleiben.'
      ],
      onSubmit: function () {
        var result = api.deleteChore(state, chore.id);
        if (!result.ok) return result.error;
        commit(result.state, 'Aufgabe gelöscht.');
        return null;
      }
    });
  }

  function openResetSheet() {
    openConfirmSheet({
      title: 'Punkte zurücksetzen',
      submitLabel: 'Zurücksetzen',
      lines: [
        'Punkte und der Verlauf werden geleert.',
        'Aufgaben, Namen und die Statistik bleiben.',
        'Das kann nicht rückgängig gemacht werden.'
      ],
      onSubmit: function () {
        commit(api.resetScores(state), 'Punkte und Verlauf wurden zurückgesetzt.');
        return null;
      }
    });
  }

  function openImportSheet(next) {
    var names = next.players.map(function (player) { return player.name; }).join(' und ');
    openConfirmSheet({
      title: 'Stand ersetzen',
      submitLabel: 'Ersetzen',
      lines: [
        names,
        next.chores.length + (next.chores.length === 1 ? ' Aufgabe' : ' Aufgaben'),
        'Der bisherige Stand auf diesem Gerät wird ersetzt.'
      ],
      onSubmit: function () {
        commit(next, 'Stand geladen.');
        return null;
      }
    });
  }

  function downloadStand(json) {
    var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'chore-wars-stand.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    announce('Stand wird gesichert.');
  }

  function exportStand() {
    var json = JSON.stringify(api.serialize(state), null, 2);
    var file = new File([json], 'chore-wars-stand.json', { type: 'application/json' });
    var canShare = false;
    try {
      canShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (error) {
      canShare = false;
    }
    closeSheet();
    if (!canShare) {
      downloadStand(json);
      return;
    }
    navigator.share({ files: [file], title: 'Chore Wars' }).then(function () {
      announce('Stand gesichert.');
    }).catch(function (error) {
      if (error && error.name === 'AbortError') return;
      downloadStand(json);
    });
  }

  function openBackupSheet() {
    openSheet({
      title: 'Sicherung',
      cancelLabel: 'Schließen',
      build: function (body) {
        body.append(element('p', 'sheet-copy', 'Die Datei enthält Aufgaben, Namen, Punkte, Verlauf und Statistik.'));
        var saveButton = toolButton('Stand sichern', {}, 'sheet-choice');
        var loadButton = toolButton('Stand laden', {}, 'sheet-choice');
        saveButton.addEventListener('click', exportStand);
        loadButton.addEventListener('click', function () {
          els.importFile.click();
        });
        body.append(saveButton, loadButton);
      }
    });
  }

  function claim(card, button) {
    var choreId = card.dataset.chore;
    var playerId = button.dataset.player;
    var key = choreId + ':' + playerId;
    if (locks.has(key)) return;

    var result = api.claim(state, choreId, playerId);
    if (!result.ok) {
      announce(result.error);
      return;
    }

    var chore = null;
    for (var i = 0; i < state.chores.length; i += 1) {
      if (state.chores[i].id === choreId) chore = state.chores[i];
    }
    locks.add(key);
    button.disabled = true;
    state = result.state;
    var saved = save();
    renderHistory();
    renderStats();
    renderScores(true);
    if (chore) spawnBurst(button, chore.points, playerId);
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (error) { /* optional */ }
    }

    var player = null;
    for (var p = 0; p < state.players.length; p += 1) {
      if (state.players[p].id === playerId) player = state.players[p];
    }
    var message = (player ? player.name : 'Spieler') + ' erhält ' +
      api.punkteLabel(chore ? chore.points : 0) + ' für ' + (chore ? chore.title : 'die Aufgabe') +
      '. Stand: ' + state.players[0].score + ' zu ' + state.players[1].score + '.';
    announce(withSaveNote(message, saved));

    window.setTimeout(function () {
      locks.delete(key);
      if (button.isConnected) button.disabled = false;
    }, CLAIM_LOCK_MS);
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
    var hadCurrent = false;
    try { hadCurrent = !!localStorage.getItem(api.STORAGE_KEY); } catch (error) { hadCurrent = false; }
    state = load();
    if (!hadCurrent) save();
    renderScoreboard();
    renderChores();
    renderScores(false);
    renderHistory();
    renderStats();
    updateConnectivity();

    els.list.addEventListener('click', function (event) {
      var claimButton = event.target.closest('button[data-player]');
      if (claimButton && !claimButton.disabled) {
        var card = claimButton.closest('[data-chore]');
        if (card) claim(card, claimButton);
        return;
      }
      var move = event.target.closest('button[data-move]');
      if (move && !move.disabled) {
        var moveCard = move.closest('[data-chore]');
        if (!moveCard) return;
        var moved = api.moveChore(state, moveCard.dataset.chore, Number(move.dataset.move));
        if (!moved.ok) {
          announce(moved.error);
          return;
        }
        commit(moved.state, 'Reihenfolge geändert.');
        return;
      }
      var edit = event.target.closest('button[data-edit]');
      if (edit) {
        var editCard = edit.closest('[data-chore]');
        var chore = null;
        if (editCard) {
          for (var i = 0; i < state.chores.length; i += 1) {
            if (state.chores[i].id === editCard.dataset.chore) chore = state.chores[i];
          }
        }
        if (chore) openChoreSheet(chore);
        return;
      }
      var remove = event.target.closest('button[data-delete]');
      if (remove) {
        var deleteCard = remove.closest('[data-chore]');
        var target = null;
        if (deleteCard) {
          for (var d = 0; d < state.chores.length; d += 1) {
            if (state.chores[d].id === deleteCard.dataset.chore) target = state.chores[d];
          }
        }
        if (target) openDeleteSheet(target);
      }
    });

    els.scoreboard.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-rename]');
      if (!button) return;
      var player = null;
      for (var i = 0; i < state.players.length; i += 1) {
        if (state.players[i].id === button.dataset.rename) player = state.players[i];
      }
      if (player) openRenameSheet(player);
    });

    els.history.addEventListener('click', function (event) {
      var button = event.target.closest('[data-undo]');
      if (!button) return;
      var entry = state.history[0];
      var result = api.undo(state);
      if (!result.ok) {
        announce(result.error);
        return;
      }
      var message = entry
        ? 'Rückgängig: ' + entry.playerName + ', ' + entry.title + '.'
        : 'Buchung rückgängig gemacht.';
      commit(result.state, message);
    });

    els.add.addEventListener('click', function () { openChoreSheet(null); });
    els.reset.addEventListener('click', openResetSheet);
    els.backup.addEventListener('click', openBackupSheet);

    els.sheetForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!sheetState.onSubmit) {
        closeSheet();
        return;
      }
      var error = sheetState.onSubmit();
      if (error) {
        showSheetError(error);
        return;
      }
      closeSheet();
    });

    els.sheet.addEventListener('click', function (event) {
      if (event.target.closest('[data-sheet-close]')) closeSheet();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !els.sheet.hidden) closeSheet();
    });

    els.importFile.addEventListener('change', function () {
      var file = els.importFile.files && els.importFile.files[0];
      els.importFile.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var result = api.parseImport(String(reader.result || ''));
        if (!result.ok) {
          if (els.sheet.hidden) openBackupSheet();
          showSheetError(result.error);
          return;
        }
        openImportSheet(result.state);
      };
      reader.onerror = function () {
        if (els.sheet.hidden) openBackupSheet();
        showSheetError('Die Datei konnte nicht gelesen werden.');
      };
      reader.readAsText(file);
    });

    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    window.setInterval(refreshTimes, 30000);
    registerServiceWorker();
  }

  init();
})();
