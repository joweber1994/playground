(function () {
  'use strict';

  var api = window.ChoreWarsState;
  var syncApi = window.HaushaltSync || window.ChoreWarsSync;
  if (!api) return;

  var CLAIM_LOCK_MS = 450;
  var locks = new Set();
  var state = api.defaultState();
  var listFilter = { categoryId: 'all', query: '' };
  var sheetState = { onSubmit: null, onClose: null, lastFocus: null, generation: 0 };
  var suppressPush = false;
  var session = null;
  var localUpdatedAt = 0;
  var syncStatus = 'local';

  var els = {
    list: document.getElementById('chore-list'),
    filters: document.getElementById('filters'),
    search: document.getElementById('chore-search'),
    choreEmpty: document.getElementById('chore-empty'),
    history: document.getElementById('history-list'),
    empty: document.getElementById('history-empty'),
    stats: document.getElementById('stats-list'),
    reset: document.getElementById('reset-btn'),
    undo: document.getElementById('undo-btn'),
    redo: document.getElementById('redo-btn'),
    backup: document.getElementById('backup-btn'),
    add: document.getElementById('add-chore'),
    leader: document.getElementById('leader'),
    scoreboard: document.getElementById('scoreboard'),
    connectivity: document.getElementById('connectivity'),
    sync: document.getElementById('sync-status'),
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
      if (!suppressPush && session) session.noteLocalEdit();
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

  function sortedCategories() {
    return state.categories.slice().sort(function (a, b) { return a.sort - b.sort; });
  }

  function categoryById(id) {
    for (var i = 0; i < state.categories.length; i += 1) {
      if (state.categories[i].id === id) return state.categories[i];
    }
    return null;
  }

  function choreById(id) {
    for (var i = 0; i < state.chores.length; i += 1) {
      if (state.chores[i].id === id) return state.chores[i];
    }
    return null;
  }

  function choresIn(categoryId) {
    return state.chores.filter(function (chore) {
      if (categoryId === 'none') return !chore.categoryId;
      return chore.categoryId === categoryId;
    }).sort(function (a, b) { return a.sort - b.sort; });
  }

  function matchesQuery(chore) {
    var query = listFilter.query.trim().toLowerCase();
    if (!query) return true;
    return chore.title.toLowerCase().indexOf(query) !== -1;
  }

  function hasUncategorized() {
    return state.chores.some(function (chore) { return !chore.categoryId; });
  }

  function ensureFilter() {
    if (listFilter.categoryId === 'all' || listFilter.categoryId === 'none') return;
    if (!categoryById(listFilter.categoryId)) listFilter.categoryId = 'all';
  }

  function chipButton(label, id, active) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip' + (active ? ' is-active' : '');
    button.dataset.filter = id;
    button.textContent = label;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    return button;
  }

  function renderFilters() {
    ensureFilter();
    els.filters.replaceChildren();
    els.filters.append(chipButton('Alle', 'all', listFilter.categoryId === 'all'));
    sortedCategories().forEach(function (category) {
      els.filters.append(chipButton(category.name, category.id, listFilter.categoryId === category.id));
    });
    if (hasUncategorized() || listFilter.categoryId === 'none') {
      els.filters.append(chipButton('Ohne Kategorie', 'none', listFilter.categoryId === 'none'));
    }
    var manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'chip';
    manage.id = 'manage-categories';
    manage.textContent = 'Kategorien';
    els.filters.append(manage);
  }

  function visibleGroups() {
    var groups = [];
    if (listFilter.categoryId === 'all') {
      sortedCategories().forEach(function (category) {
        groups.push({ id: category.id, label: category.name, chores: choresIn(category.id).filter(matchesQuery) });
      });
      groups.push({ id: 'none', label: 'Ohne Kategorie', chores: choresIn('none').filter(matchesQuery) });
      return groups.filter(function (group) { return group.chores.length > 0; });
    }
    var chores = choresIn(listFilter.categoryId).filter(matchesQuery);
    return [{ id: listFilter.categoryId, label: '', chores: chores }];
  }

  function choreCard(chore) {
    var item = element('li', 'chore-card');
    item.dataset.chore = chore.id;

    var title = document.createElement('button');
    title.type = 'button';
    title.className = 'chore-title';
    title.dataset.edit = chore.id;
    title.textContent = chore.title;
    title.setAttribute('aria-label', chore.title + ' bearbeiten');

    var top = element('div', 'chore-top');
    top.append(title, element('p', 'points-badge', api.punkteLabel(chore.points)));

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

    item.append(top, actions);
    return item;
  }

  function renderChoreList() {
    var groups = visibleGroups();
    var shown = 0;
    els.list.replaceChildren();
    groups.forEach(function (group) {
      shown += group.chores.length;
      if (listFilter.categoryId === 'all' && group.label) {
        var label = element('li', 'group-label', group.label);
        label.setAttribute('role', 'presentation');
        els.list.append(label);
      }
      group.chores.forEach(function (chore) {
        els.list.append(choreCard(chore));
      });
    });
    var query = listFilter.query.trim();
    if (shown === 0) {
      els.choreEmpty.hidden = false;
      els.choreEmpty.textContent = query
        ? 'Keine Aufgabe passt zur Suche.'
        : 'Keine Aufgaben in dieser Kategorie.';
    } else {
      els.choreEmpty.hidden = true;
    }
  }

  function renderChores() {
    locks.clear();
    renderFilters();
    renderChoreList();
  }

  function renderHistory() {
    var items = state.history.slice(0, api.HISTORY_LIMIT);
    els.history.replaceChildren();
    els.empty.hidden = items.length > 0;
    els.history.hidden = items.length === 0;
    if (els.undo) els.undo.disabled = items.length === 0;
    if (els.redo) els.redo.disabled = !state.redo || state.redo.length === 0;

    items.forEach(function (entry) {
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
    var hook = sheetState.onClose;
    sheetState.onClose = null;
    els.sheet.hidden = true;
    if (els.app) els.app.removeAttribute('inert');
    var back = sheetState.lastFocus;
    sheetState.onSubmit = null;
    sheetState.lastFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
    if (hook) hook();
  }

  function openSheet(config) {
    var previous = sheetState.onClose;
    sheetState.onClose = null;
    if (previous) previous();
    sheetState.generation += 1;
    sheetState.lastFocus = document.activeElement;
    sheetState.onSubmit = config.onSubmit || null;
    sheetState.onClose = config.onClose || null;
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

  function categorySelect(selected) {
    var select = document.createElement('select');
    select.name = 'category';
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Ohne Kategorie';
    select.append(empty);
    sortedCategories().forEach(function (category) {
      var option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      select.append(option);
    });
    select.value = selected && categoryById(selected) ? selected : '';
    return select;
  }

  function presetCategory() {
    if (listFilter.categoryId === 'all' || listFilter.categoryId === 'none') return '';
    return listFilter.categoryId;
  }

  function canMove(chore, direction) {
    var siblings = choresIn(chore.categoryId ? chore.categoryId : 'none');
    var index = -1;
    for (var i = 0; i < siblings.length; i += 1) {
      if (siblings[i].id === chore.id) index = i;
    }
    var target = index + direction;
    return index >= 0 && target >= 0 && target < siblings.length;
  }

  function openChoreSheet(chore) {
    var current = chore ? choreById(chore.id) || chore : null;
    openSheet({
      title: current ? 'Aufgabe bearbeiten' : 'Aufgabe hinzufügen',
      submitLabel: 'Sichern',
      build: function (body) {
        var selected = current ? current.categoryId : presetCategory();
        body.append(
          field('Titel', textInput('title', current ? current.title : '', api.TITLE_MAX, 'sentences')),
          field('Punkte', pointsInput(current ? current.points : 10)),
          field('Kategorie', categorySelect(selected))
        );
        if (!current) return;
        var moves = element('div', 'sheet-move');
        moves.append(
          toolButton('Hoch', {
            'data-sheet-move': '-1',
            'aria-label': 'In der Kategorie nach oben',
            disabled: !canMove(current, -1)
          }),
          toolButton('Runter', {
            'data-sheet-move': '1',
            'aria-label': 'In der Kategorie nach unten',
            disabled: !canMove(current, 1)
          })
        );
        var remove = toolButton('Löschen', {
          'data-sheet-delete': current.id,
          'aria-label': current.title + ' löschen'
        }, 'sheet-choice tool-danger');
        body.append(moves, remove);
      },
      onSubmit: function () {
        var title = els.sheetBody.querySelector('[name="title"]').value;
        var points = els.sheetBody.querySelector('[name="points"]').value;
        var categoryId = els.sheetBody.querySelector('[name="category"]').value;
        var input = { title: title, points: points, categoryId: categoryId };
        var result = current
          ? api.updateChore(state, current.id, input)
          : api.addChore(state, input);
        if (!result.ok) return result.error;
        commit(result.state, current ? 'Aufgabe geändert.' : 'Aufgabe hinzugefügt.');
        return null;
      }
    });
  }

  function openCategorySheet() {
    openSheet({
      title: 'Kategorien',
      cancelLabel: 'Schließen',
      build: function (body) {
        if (state.categories.length === 0) {
          body.append(element('p', 'sheet-copy', 'Noch keine Kategorie. Aufgaben können auch ohne Kategorie bleiben.'));
        }
        sortedCategories().forEach(function (category) {
          var row = element('div', 'category-row');
          row.append(element('p', 'category-name', category.name));
          var actions = element('div', 'category-actions');
          actions.append(
            toolButton('Umbenennen', { 'data-category-rename': category.id }),
            toolButton('Löschen', {
              'data-category-delete': category.id,
              'aria-label': category.name + ' löschen'
            }, 'tool tool-danger')
          );
          row.append(actions);
          body.append(row);
        });
        body.append(field('Neue Kategorie', textInput('categoryName', '', api.NAME_MAX, 'words')));
        var add = toolButton('Kategorie anlegen', { 'data-category-add': '1' }, 'sheet-choice');
        body.append(add);
      }
    });
  }

  function openRenameCategorySheet(category) {
    openSheet({
      title: 'Kategorie umbenennen',
      submitLabel: 'Sichern',
      build: function (body) {
        body.append(field('Name', textInput('name', category.name, api.NAME_MAX, 'words')));
      },
      onSubmit: function () {
        var name = els.sheetBody.querySelector('[name="name"]').value;
        var result = api.renameCategory(state, category.id, name);
        if (!result.ok) return result.error;
        commit(result.state, 'Kategorie geändert.');
        openCategorySheet();
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

  function openDeleteCategorySheet(category) {
    openConfirmSheet({
      title: 'Kategorie löschen',
      submitLabel: 'Löschen',
      lines: [
        '„' + category.name + '“ wird entfernt.',
        'Die Aufgaben bleiben unter Ohne Kategorie.'
      ],
      onSubmit: function () {
        var result = api.deleteCategory(state, category.id);
        if (!result.ok) return result.error;
        if (listFilter.categoryId === category.id) listFilter.categoryId = 'none';
        commit(result.state, 'Kategorie gelöscht.');
        openCategorySheet();
        return null;
      }
    });
  }

  function completionSentence() {
    return api.playerStats(state).map(function (row) {
      var count = row.claims === 1 ? '1 Erledigung' : row.claims + ' Erledigungen';
      return row.name + ' hat ' + count;
    }).join(', ');
  }

  function openResetSheet() {
    openSheet({
      title: 'Zurücksetzen',
      cancelLabel: 'Abbrechen',
      build: function (body) {
        body.append(element('p', 'sheet-copy', 'Alles zurücksetzen löscht Punkte, Verlauf und die Erledigungen. Aufgaben und Namen bleiben.'));
        var everything = toolButton('Alles zurücksetzen', {}, 'sheet-choice tool-danger');
        var scores = toolButton('Nur die Punkte zurücksetzen', {}, 'sheet-choice');
        everything.addEventListener('click', function () {
          var done = completionSentence();
          openConfirmSheet({
            title: 'Alles zurücksetzen',
            submitLabel: 'Alles zurücksetzen',
            lines: [
              done + '.',
              'Punkte, Verlauf und alle Erledigungen werden gelöscht.',
              'Aufgaben und Namen bleiben. Das kann nicht rückgängig gemacht werden.'
            ],
            onSubmit: function () {
              commit(api.resetAll(state), 'Punkte, Verlauf und Erledigungen wurden zurückgesetzt.');
              return null;
            }
          });
        });
        scores.addEventListener('click', function () {
          openConfirmSheet({
            title: 'Nur die Punkte',
            submitLabel: 'Punkte zurücksetzen',
            lines: [
              'Punkte und der Verlauf werden geleert.',
              'Die Erledigungen bleiben stehen.',
              'Das kann nicht rückgängig gemacht werden.'
            ],
            onSubmit: function () {
              commit(api.resetScores(state), 'Punkte und Verlauf wurden zurückgesetzt.');
              return null;
            }
          });
        });
        body.append(everything, scores);
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

  function readStored(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (error) {
      return '';
    }
  }

  function writeStored(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (error) { /* Speicher voll oder gesperrt */ }
  }

  function playerLine(players) {
    return (players || []).map(function (player) {
      return (player.name || 'Spieler') + ' ' + (player.score || 0);
    }).join(' · ');
  }

  function isUntouched() {
    return JSON.stringify(api.serialize(state)) === JSON.stringify(api.serialize(api.defaultState()));
  }

  function renderSyncStatus() {
    if (!els.sync) return;
    var labels = {
      local: 'Nur dieses Gerät',
      connecting: 'Verbinden…',
      live: 'Gemeinsam verbunden',
      saving: 'Wird übertragen…',
      offline: 'Gemeinsam, gerade offline',
      reconnecting: 'Erneut verbinden…',
      error: 'Verbindung fehlgeschlagen',
      denied: 'Firebase verweigert den Zugriff',
      invalid: 'Gemeinsamer Stand unlesbar',
      rejected: 'Firebase hat den Stand abgelehnt',
      ask: 'Welcher Stand gilt?'
    };
    els.sync.textContent = labels[syncStatus] || labels.local;
    els.sync.classList.toggle('is-live', syncStatus === 'live');
    els.sync.classList.toggle('is-wait', syncStatus === 'connecting' || syncStatus === 'saving' || syncStatus === 'offline' || syncStatus === 'reconnecting' || syncStatus === 'ask');
    els.sync.classList.toggle('is-bad', syncStatus === 'error' || syncStatus === 'denied' || syncStatus === 'invalid' || syncStatus === 'rejected');
  }

  function setSyncStatus(name) {
    var changed = syncStatus !== name;
    syncStatus = name;
    renderSyncStatus();
    if (!changed) return;
    if (name === 'denied') announce('Firebase verweigert den Zugriff. Die Regeln aus dem Blatt müssen veröffentlicht sein.');
    else if (name === 'rejected') announce('Firebase hat den Stand abgelehnt.');
    else if (name === 'invalid') announce('Der gemeinsame Stand ist unlesbar.');
    else if (name === 'error') announce('Die Verbindung ist fehlgeschlagen.');
  }

  function stopSession() {
    if (session) session.close();
    session = null;
  }

  function adoptRemote(remote) {
    var parsed = api.parseImport(remote.state);
    if (!parsed.ok) return false;
    suppressPush = true;
    state = parsed.state;
    var saved = save();
    suppressPush = false;
    localUpdatedAt = remote.updatedAt;
    if (syncApi) writeStored(syncApi.UPDATED_KEY, String(remote.updatedAt));
    renderChores();
    renderHistory();
    renderStats();
    renderScores(false);
    announce(withSaveNote(api.leaderSentence(state) + '.', saved));
    return true;
  }

  function askWhichStand(remote) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(choice) {
        if (settled) return;
        settled = true;
        sheetState.onClose = null;
        resolve(choice);
      }
      var remoteLine = playerLine(remote.state && remote.state.players);
      var localLine = playerLine(state.players);
      openSheet({
        title: 'Zwei Stände',
        cancelLabel: 'Abbrechen',
        onClose: function () { finish('cancel'); },
        build: function (body) {
          body.append(element('p', 'sheet-copy', 'Auf diesem Gerät und im gemeinsamen Haushalt liegen unterschiedliche Punkte. Einer der beiden Stände gilt danach für beide.'));
          if (localLine) body.append(element('p', 'sheet-copy', 'Dieses Gerät: ' + localLine));
          if (remoteLine) body.append(element('p', 'sheet-copy', 'Gemeinsam: ' + remoteLine));
          var keep = toolButton('Stand dieses Geräts verwenden', {}, 'sheet-choice');
          var take = toolButton('Gemeinsamen Stand übernehmen', {}, 'sheet-choice');
          keep.addEventListener('click', function () {
            finish('push');
            closeSheet();
          });
          take.addEventListener('click', function () {
            finish('adopt');
            closeSheet();
          });
          body.append(keep, take);
        }
      });
    });
  }

  function startSession() {
    stopSession();
    if (!syncApi) {
      setSyncStatus('local');
      return;
    }
    var link = syncApi.readConnection(window.localStorage);
    if (!link.url || !link.householdId) {
      setSyncStatus('local');
      return;
    }
    session = syncApi.createSession({
      databaseURL: link.url,
      householdId: link.householdId,
      bucket: 'households',
      getSnapshot: function () {
        return {
          state: api.serialize(state),
          updatedAt: localUpdatedAt,
          untouched: isUntouched()
        };
      },
      setUpdatedAt: function (value) {
        localUpdatedAt = value;
        writeStored(syncApi.UPDATED_KEY, String(value));
      },
      adopt: adoptRemote,
      ask: askWhichStand,
      onStatus: setSyncStatus,
      fetch: window.fetch.bind(window),
      EventSource: window.EventSource,
      now: function () { return Date.now(); }
    });
  }

  function openSyncSheet() {
    if (!syncApi) return;
    openSheet({
      title: 'Gemeinsam nutzen',
      cancelLabel: 'Schließen',
      submitLabel: 'Zum Menü',
      build: function (body) {
        body.append(element('p', 'sheet-copy', 'Adresse, Kennwort und dein Name stehen im Menü Haushalt. Dieselbe Verbindung gilt für Chore Wars und Erinnerungen. Die Punkte bleiben der Stand von Chore Wars.'));
        var openHome = toolButton('Verbindung im Menü Haushalt', {}, 'sheet-choice');
        openHome.addEventListener('click', function () {
          window.location.href = '../index.html#verbindung';
        });
        body.append(openHome);
      },
      onSubmit: function () {
        window.location.href = '../index.html#verbindung';
        return 'stay';
      }
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
        var shareButton = toolButton('Verbindung im Menü', {}, 'sheet-choice');
        saveButton.addEventListener('click', exportStand);
        loadButton.addEventListener('click', function () {
          els.importFile.click();
        });
        shareButton.addEventListener('click', openSyncSheet);
        body.append(saveButton, loadButton, shareButton);
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
    var ownUrl = new URL('./service-worker.js', window.location.href).href;
    var current = navigator.serviceWorker.controller;
    var hadOwnController = !!(current && current.scriptURL === ownUrl);
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      updateConnectivity();
      var next = navigator.serviceWorker.controller;
      if (!next || next.scriptURL !== ownUrl) return;
      if (!hadOwnController) {
        hadOwnController = true;
        return;
      }
      window.location.reload();
    });
    navigator.serviceWorker.ready.then(updateConnectivity).catch(function () {});
  }

  function init() {
    var hadCurrent = false;
    try { hadCurrent = !!localStorage.getItem(api.STORAGE_KEY); } catch (error) { hadCurrent = false; }
    state = load();
    if (syncApi) {
      var storedUpdatedAt = Number(readStored(syncApi.UPDATED_KEY));
      localUpdatedAt = isFinite(storedUpdatedAt) ? storedUpdatedAt : 0;
    }
    if (!hadCurrent) {
      suppressPush = true;
      save();
      suppressPush = false;
    }
    renderScoreboard();
    renderChores();
    renderScores(false);
    renderHistory();
    renderStats();
    updateConnectivity();

    els.filters.addEventListener('click', function (event) {
      var manage = event.target.closest('#manage-categories');
      if (manage) {
        openCategorySheet();
        return;
      }
      var chip = event.target.closest('[data-filter]');
      if (!chip) return;
      listFilter.categoryId = chip.dataset.filter;
      renderChores();
    });

    els.search.addEventListener('input', function () {
      listFilter.query = els.search.value;
      renderChoreList();
    });

    els.sheetBody.addEventListener('click', function (event) {
      var move = event.target.closest('[data-sheet-move]');
      if (move && !move.disabled) {
        var current = choreById(els.sheetBody.querySelector('[data-sheet-delete]') && els.sheetBody.querySelector('[data-sheet-delete]').getAttribute('data-sheet-delete'));
        if (!current) return;
        var titleValue = els.sheetBody.querySelector('[name="title"]').value;
        var pointsValue = els.sheetBody.querySelector('[name="points"]').value;
        var categoryValue = els.sheetBody.querySelector('[name="category"]').value;
        var moved = api.moveChore(state, current.id, Number(move.getAttribute('data-sheet-move')));
        if (!moved.ok) {
          showSheetError(moved.error);
          return;
        }
        commit(moved.state, 'Reihenfolge geändert.');
        openChoreSheet(choreById(current.id));
        els.sheetBody.querySelector('[name="title"]').value = titleValue;
        els.sheetBody.querySelector('[name="points"]').value = pointsValue;
        els.sheetBody.querySelector('[name="category"]').value = categoryValue;
        return;
      }
      var remove = event.target.closest('[data-sheet-delete]');
      if (remove) {
        var chore = choreById(remove.getAttribute('data-sheet-delete'));
        if (chore) openDeleteSheet(chore);
        return;
      }
      var rename = event.target.closest('[data-category-rename]');
      if (rename) {
        var category = categoryById(rename.getAttribute('data-category-rename'));
        if (category) openRenameCategorySheet(category);
        return;
      }
      var drop = event.target.closest('[data-category-delete]');
      if (drop) {
        var target = categoryById(drop.getAttribute('data-category-delete'));
        if (target) openDeleteCategorySheet(target);
        return;
      }
      var addCategory = event.target.closest('[data-category-add]');
      if (addCategory) {
        var name = els.sheetBody.querySelector('[name="categoryName"]').value;
        var result = api.addCategory(state, name);
        if (!result.ok) {
          showSheetError(result.error);
          return;
        }
        commit(result.state, 'Kategorie angelegt.');
        openCategorySheet();
      }
    });

    els.list.addEventListener('click', function (event) {
      var claimButton = event.target.closest('button[data-player]');
      if (claimButton && !claimButton.disabled) {
        var card = claimButton.closest('[data-chore]');
        if (card) claim(card, claimButton);
        return;
      }
      var edit = event.target.closest('button[data-edit]');
      if (edit) {
        var chore = choreById(edit.getAttribute('data-edit'));
        if (chore) openChoreSheet(chore);
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

    els.undo.addEventListener('click', function () {
      if (els.undo.disabled) return;
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

    els.redo.addEventListener('click', function () {
      if (els.redo.disabled) return;
      var entry = state.redo && state.redo[0];
      var result = api.redo(state);
      if (!result.ok) {
        announce(result.error);
        return;
      }
      var message = entry
        ? 'Wiederholt: ' + entry.playerName + ', ' + entry.title + '.'
        : 'Buchung wiederhergestellt.';
      commit(result.state, message);
    });

    els.add.addEventListener('click', function () { openChoreSheet(null); });
    els.reset.addEventListener('click', openResetSheet);
    els.backup.addEventListener('click', openBackupSheet);
    if (els.sync) els.sync.addEventListener('click', openSyncSheet);

    els.sheetForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!sheetState.onSubmit) {
        closeSheet();
        return;
      }
      var generation = sheetState.generation;
      var error = sheetState.onSubmit();
      if (error === 'stay') return;
      if (error) {
        showSheetError(error);
        return;
      }
      if (sheetState.generation !== generation) return;
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

    window.addEventListener('online', function () {
      updateConnectivity();
      if (session) session.retry();
    });
    window.addEventListener('offline', function () {
      updateConnectivity();
      if (session) setSyncStatus('offline');
    });
    window.setInterval(refreshTimes, 30000);
    registerServiceWorker();
    renderSyncStatus();
    startSession();
    window.addEventListener('storage', function (event) {
      if (!syncApi) return;
      if (event.key !== syncApi.URL_KEY && event.key !== syncApi.HOUSEHOLD_KEY && event.key !== syncApi.LEGACY_HOUSEHOLD_KEY) return;
      startSession();
    });
  }

  init();
})();
