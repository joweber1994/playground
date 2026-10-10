(function () {
  'use strict';

  var syncApi = window.HaushaltSync;

  var els = {
    name: document.getElementById('person-name'),
    note: document.getElementById('link-note'),
    sync: document.getElementById('sync-status'),
    sheet: document.getElementById('sheet'),
    form: document.getElementById('link-form'),
    url: document.getElementById('database-url'),
    secret: document.getElementById('secret'),
    rules: document.getElementById('rules'),
    error: document.getElementById('sheet-error'),
    disconnect: document.getElementById('disconnect'),
    cancel: document.getElementById('sheet-cancel'),
    submit: document.getElementById('sheet-submit'),
    panel: document.getElementById('verbindung')
  };

  function isLocalFile() {
    return window.location.protocol === 'file:';
  }

  function registerServiceWorker() {
    if (isLocalFile() || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./service-worker.js', {
      scope: './',
      updateViaCache: 'none'
    }).catch(function (error) {
      console.error('Service Worker konnte nicht registriert werden.', error);
    });
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) {
        hadController = true;
        return;
      }
      window.location.reload();
    });
  }

  function connection() {
    if (!syncApi) return { url: '', householdId: '', name: '' };
    return syncApi.readConnection(window.localStorage);
  }

  function showNote(message) {
    if (els.note) els.note.textContent = message || '';
  }

  function showError(message) {
    if (!els.error) return;
    els.error.hidden = !message;
    els.error.textContent = message || '';
  }

  function renderStatus() {
    var link = connection();
    var on = !!(link.url && link.householdId);
    if (els.sync) {
      els.sync.textContent = on ? 'Gemeinsam eingerichtet' : 'Nur dieses Gerät';
      els.sync.classList.toggle('is-live', on);
    }
    if (els.name && document.activeElement !== els.name) els.name.value = link.name;
    if (els.disconnect) els.disconnect.hidden = !on;
  }

  function saveTypedName(value) {
    if (!syncApi) return;
    var result = syncApi.saveName(window.localStorage, value);
    if (!result.ok) {
      showNote(result.error);
      return;
    }
    showNote(result.value ? 'Name gespeichert: ' + result.value + '.' : '');
    renderStatus();
  }

  function openSheet() {
    if (!syncApi || !els.sheet) return;
    var link = connection();
    els.url.value = link.url;
    els.secret.value = '';
    els.rules.value = syncApi.RULES_TEXT;
    showError('');
    els.disconnect.hidden = !(link.url && link.householdId);
    els.sheet.hidden = false;
    els.url.focus();
  }

  function closeSheet() {
    if (els.sheet) els.sheet.hidden = true;
    if (els.submit) els.submit.disabled = false;
  }

  function connect(event) {
    event.preventDefault();
    if (!syncApi) return;
    showError('');
    var name = syncApi.requireName(els.name.value);
    if (!name.ok) {
      showNote(name.error);
      closeSheet();
      els.name.focus();
      return;
    }
    syncApi.saveName(window.localStorage, name.value);
    var urlResult = syncApi.normalizeDatabaseUrl(els.url.value);
    if (!urlResult.ok) {
      showError(urlResult.error);
      return;
    }
    var secretResult = syncApi.readSecret(els.secret.value);
    if (!secretResult.ok) {
      showError(secretResult.error);
      return;
    }
    els.submit.disabled = true;
    syncApi.householdId(secretResult.value).then(function (id) {
      syncApi.saveConnection(window.localStorage, urlResult.value, id);
      closeSheet();
      showNote('Verbunden als ' + name.value + '. Chore Wars und Erinnerungen nutzen dieselbe Verbindung.');
      renderStatus();
    }).catch(function () {
      els.submit.disabled = false;
      showError('Das Kennwort konnte nicht verarbeitet werden.');
    });
  }

  function init() {
    if (!syncApi) return;
    renderStatus();
    if (els.name) {
      els.name.addEventListener('change', function () { saveTypedName(els.name.value); });
    }
    if (els.sync) els.sync.addEventListener('click', openSheet);
    if (els.form) els.form.addEventListener('submit', connect);
    if (els.cancel) els.cancel.addEventListener('click', closeSheet);
    if (els.sheet) {
      els.sheet.addEventListener('click', function (event) {
        if (event.target === els.sheet || event.target.closest('[data-sheet-close]')) closeSheet();
      });
    }
    if (els.disconnect) {
      els.disconnect.addEventListener('click', function () {
        syncApi.disconnect(window.localStorage);
        closeSheet();
        showNote('Getrennt. Die Listen bleiben auf diesem Gerät und in Firebase.');
        renderStatus();
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && els.sheet && !els.sheet.hidden) closeSheet();
    });
    if (window.location.hash === '#verbindung' && els.panel) {
      els.panel.scrollIntoView({ block: 'start' });
    }
  }

  registerServiceWorker();
  init();
})();
