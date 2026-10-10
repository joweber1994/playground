(function () {
  'use strict';

  var api = window.ErinnerungenLogik;
  if (!api) return;

  var state = api.blank();

  var els = {
    connectivity: document.getElementById('connectivity'),
    banner: document.getElementById('due-banner'),
    form: document.getElementById('form'),
    text: document.getElementById('text'),
    date: document.getElementById('date'),
    note: document.getElementById('note'),
    empty: document.getElementById('empty'),
    openList: document.getElementById('open-list'),
    doneWrap: document.getElementById('done-wrap'),
    doneList: document.getElementById('done-list'),
    clearDone: document.getElementById('clear-done'),
    live: document.getElementById('live')
  };

  function announce(message) {
    if (!els.live) return;
    els.live.textContent = '';
    window.setTimeout(function () {
      els.live.textContent = message;
    }, 30);
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(api.STORAGE_KEY); } catch (error) { raw = null; }
    if (!raw) return api.blank();
    try { return api.normalize(JSON.parse(raw)); } catch (error) { return api.blank(); }
  }

  function save() {
    try {
      localStorage.setItem(api.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }

  function today() {
    return api.todayFromDate(new Date());
  }

  function findItem(id) {
    var found = null;
    state.items.forEach(function (item) {
      if (item.id === id) found = item;
    });
    return found;
  }

  function card(item, day) {
    var li = document.createElement('li');
    li.className = 'card';
    var kind = api.whenKind(item.date, day);
    if (!item.done && (kind === 'overdue' || kind === 'today')) li.classList.add('is-due');
    if (item.done) li.classList.add('is-done');

    var check = document.createElement('button');
    check.type = 'button';
    check.className = 'check';
    check.setAttribute('data-toggle', item.id);
    check.setAttribute('aria-pressed', item.done ? 'true' : 'false');
    check.setAttribute('aria-label', item.done ? item.text + ' wieder öffnen' : item.text + ' erledigen');
    var mark = document.createElement('span');
    mark.className = 'check-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✓';
    check.appendChild(mark);

    var body = document.createElement('div');
    body.className = 'card-body';
    var title = document.createElement('p');
    title.className = 'card-text';
    title.textContent = item.text;
    body.appendChild(title);
    var label = api.whenLabel(item.date, day);
    if (label) {
      var when = document.createElement('p');
      when.className = 'card-when';
      when.textContent = label;
      body.appendChild(when);
    }

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.setAttribute('data-remove', item.id);
    remove.textContent = 'Entfernen';
    remove.setAttribute('aria-label', item.text + ' entfernen');

    li.appendChild(check);
    li.appendChild(body);
    li.appendChild(remove);
    return li;
  }

  function fillList(list, items, day) {
    list.textContent = '';
    items.forEach(function (item) {
      list.appendChild(card(item, day));
    });
  }

  function render() {
    var day = today();
    var view = api.groups(state, day);
    fillList(els.openList, view.open, day);
    fillList(els.doneList, view.done, day);
    els.openList.hidden = view.open.length === 0;
    els.doneWrap.hidden = view.done.length === 0;
    if (view.open.length === 0) {
      els.empty.hidden = false;
      els.empty.textContent = view.done.length ? 'Nichts liegt mehr an.' : 'Noch keine Erinnerung.';
    } else {
      els.empty.hidden = true;
    }
    if (view.due.length === 0) {
      els.banner.hidden = true;
      els.banner.textContent = '';
    } else if (view.due.length === 1) {
      els.banner.hidden = false;
      els.banner.textContent = '1 Erinnerung ist fällig.';
    } else {
      els.banner.hidden = false;
      els.banner.textContent = view.due.length + ' Erinnerungen sind fällig.';
    }
  }

  function onListClick(event) {
    var toggle = event.target.closest('[data-toggle]');
    var remove = event.target.closest('[data-remove]');
    if (toggle) {
      var id = toggle.getAttribute('data-toggle');
      var before = findItem(id);
      var result = api.toggleItem(state, id);
      if (!result.ok) {
        els.note.textContent = result.error;
        announce(result.error);
        return;
      }
      state = result.state;
      var stored = save();
      render();
      var message = before && before.done ? before.text + ' ist wieder offen.' : (before ? before.text + ' ist erledigt.' : 'Geändert.');
      if (!stored) message += ' Speichern auf diesem Gerät ist fehlgeschlagen.';
      els.note.textContent = '';
      announce(message);
      return;
    }
    if (!remove) return;
    var removeId = remove.getAttribute('data-remove');
    var gone = findItem(removeId);
    var removed = api.removeItem(state, removeId);
    if (!removed.ok) {
      els.note.textContent = removed.error;
      announce(removed.error);
      return;
    }
    state = removed.state;
    var kept = save();
    render();
    var removedMessage = (gone ? gone.text : 'Eintrag') + ' ist entfernt.';
    if (!kept) removedMessage += ' Speichern auf diesem Gerät ist fehlgeschlagen.';
    els.note.textContent = '';
    announce(removedMessage);
  }

  function isLocalFile() {
    return window.location.protocol === 'file:';
  }

  function updateConnectivity() {
    var node = els.connectivity;
    node.classList.remove('is-ready', 'is-offline');
    if (isLocalFile()) {
      node.classList.add('is-ready');
      node.textContent = 'Auf diesem Gerät';
      return;
    }
    if (!navigator.onLine) {
      node.classList.add('is-offline');
      node.textContent = 'Offline – die Liste bleibt auf diesem Gerät';
      return;
    }
    if (!('serviceWorker' in navigator) || navigator.serviceWorker.controller) {
      node.classList.add('is-ready');
      node.textContent = 'Offline-bereit';
      return;
    }
    node.textContent = 'Wird auf diesem Gerät gespeichert…';
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
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
  }

  function init() {
    state = load();
    render();
    els.form.addEventListener('submit', function (event) {
      event.preventDefault();
      var result = api.addItem(state, els.text.value, els.date.value);
      if (!result.ok) {
        els.note.textContent = result.error;
        announce(result.error);
        els.text.focus();
        return;
      }
      state = result.state;
      var stored = save();
      els.text.value = '';
      els.date.value = '';
      els.note.textContent = '';
      render();
      var message = result.item.text + ' steht auf der Liste.';
      if (result.item.date) message = result.item.text + ' steht auf der Liste, ' + api.whenLabel(result.item.date, today()) + '.';
      if (!stored) message += ' Speichern auf diesem Gerät ist fehlgeschlagen.';
      announce(message);
      els.text.focus();
    });
    els.openList.addEventListener('click', onListClick);
    els.doneList.addEventListener('click', onListClick);
    els.clearDone.addEventListener('click', function () {
      var count = api.groups(state, today()).done.length;
      if (!count) return;
      state = api.clearDone(state);
      var stored = save();
      render();
      var message = count === 1 ? '1 erledigte Erinnerung ist gelöscht.' : count + ' erledigte Erinnerungen sind gelöscht.';
      if (!stored) message += ' Speichern auf diesem Gerät ist fehlgeschlagen.';
      announce(message);
    });
    updateConnectivity();
    registerServiceWorker();
  }

  init();
})();
