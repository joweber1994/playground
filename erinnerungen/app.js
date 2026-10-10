(function () {
  'use strict';

  var api = window.ErinnerungenLogik;
  var syncApi = window.HaushaltSync;
  if (!api) return;

  var state = api.blank();
  var session = null;
  var suppressPush = false;
  var localUpdatedAt = 0;

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
    author: document.getElementById('author-hint'),
    sync: document.getElementById('sync-status'),
    sheet: document.getElementById('sheet'),
    sheetCopy: document.getElementById('sheet-copy'),
    sheetKeep: document.getElementById('sheet-keep'),
    sheetTake: document.getElementById('sheet-take'),
    sheetCancel: document.getElementById('sheet-cancel'),
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
      if (!suppressPush && session) session.noteLocalEdit();
      return true;
    } catch (error) {
      return false;
    }
  }

  function myName() {
    if (!syncApi) return '';
    return syncApi.readConnection(window.localStorage).name;
  }

  function writeStored(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (error) { /* Private mode can reject storage. */ }
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
    if (item.name) {
      var who = document.createElement('p');
      who.className = 'card-name';
      who.textContent = item.name;
      body.appendChild(who);
    }
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
    var name = myName();
    if (els.author) {
      els.author.textContent = name
        ? 'Neue Einträge stehen auf deinen Namen: ' + name + '.'
        : 'Trag deinen Namen im Menü Haushalt ein. Er steht dann an jedem Eintrag.';
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
      var result = api.addItem(state, els.text.value, els.date.value, { name: myName() });
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
      if (result.item.name) message = result.item.text + ' steht auf der Liste, von ' + result.item.name + '.';
      if (result.item.date) message = result.item.text + ' steht auf der Liste, ' + api.whenLabel(result.item.date, today()) + (result.item.name ? ', von ' + result.item.name : '') + '.';
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
    if (syncApi) {
      var storedRaw = '';
      try { storedRaw = localStorage.getItem(syncApi.REMINDER_UPDATED_KEY) || ''; } catch (error) { storedRaw = ''; }
      var storedUpdatedAt = Number(storedRaw);
      localUpdatedAt = isFinite(storedUpdatedAt) ? storedUpdatedAt : 0;
    }
    startSession();
    window.addEventListener('storage', function (event) {
      if (!syncApi) return;
      if (event.key === syncApi.NAME_KEY) render();
      if (event.key !== syncApi.URL_KEY && event.key !== syncApi.HOUSEHOLD_KEY && event.key !== syncApi.LEGACY_HOUSEHOLD_KEY) return;
      startSession();
    });
    window.addEventListener('online', function () {
      if (session) session.retry();
    });
  }

  function setSyncStatus(name) {
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
      ask: 'Welche Liste gilt?'
    };
    els.sync.textContent = labels[name] || labels.local;
    els.sync.classList.toggle('is-live', name === 'live');
    els.sync.classList.toggle('is-wait', name === 'connecting' || name === 'saving' || name === 'offline' || name === 'reconnecting' || name === 'ask');
    els.sync.classList.toggle('is-bad', name === 'error' || name === 'denied' || name === 'invalid' || name === 'rejected');
  }

  function stopSession() {
    if (session) session.close();
    session = null;
  }

  function countLine(items) {
    var open = 0;
    (items || []).forEach(function (item) { if (!item.done) open += 1; });
    return open === 1 ? '1 offene Erinnerung' : open + ' offene Erinnerungen';
  }

  function adoptRemote(remote) {
    var parsed = api.parseShared(remote.state);
    if (!parsed.ok) return false;
    suppressPush = true;
    state = parsed.state;
    var stored = save();
    suppressPush = false;
    localUpdatedAt = remote.updatedAt;
    if (syncApi) writeStored(syncApi.REMINDER_UPDATED_KEY, String(remote.updatedAt));
    render();
    if (!stored) announce('Die gemeinsame Liste ist da. Speichern auf diesem Gerät ist fehlgeschlagen.');
    return true;
  }

  function closeAsk() {
    if (els.sheet) els.sheet.hidden = true;
  }

  function askWhichList(remote) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(choice) {
        if (settled) return;
        settled = true;
        closeAsk();
        resolve(choice);
      }
      var remoteParsed = api.parseShared(remote.state);
      var remoteCount = remoteParsed.ok ? countLine(remoteParsed.state.items) : 'unlesbar';
      els.sheetCopy.textContent = 'Auf diesem Gerät liegen ' + countLine(state.items) + ', gemeinsam ' + remoteCount + '. Eine Liste gilt danach auf beiden Geräten.';
      els.sheet.hidden = false;
      els.sheetKeep.onclick = function () { finish('push'); };
      els.sheetTake.onclick = function () { finish('adopt'); };
      els.sheetCancel.onclick = function () { finish('cancel'); };
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
      bucket: 'reminders',
      getSnapshot: function () {
        return { state: api.normalize(state), updatedAt: localUpdatedAt, untouched: state.items.length === 0 };
      },
      setUpdatedAt: function (value) {
        localUpdatedAt = value;
        writeStored(syncApi.REMINDER_UPDATED_KEY, String(value));
      },
      adopt: adoptRemote,
      ask: askWhichList,
      onStatus: setSyncStatus,
      fetch: window.fetch.bind(window),
      EventSource: window.EventSource,
      now: function () { return Date.now(); }
    });
  }

  init();
})();
