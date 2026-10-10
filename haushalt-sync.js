/* Haushalt – gemeinsame Firebase-Verbindung für Chore Wars und Erinnerungen.
   Reine Entscheidungen plus eine kleine Sitzung. Im Browser als HaushaltSync, unter Node als Modul.
   Chore Wars bleibt unter households/{id}. Erinnerungen liegen darunter,
   damit die schon veröffentlichten Regeln den Zugriff erlauben.
   Chore Wars schreibt mit PATCH, damit der Erinnerungszweig stehen bleibt. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HaushaltSync = api;
    root.ChoreWarsSync = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var URL_KEY = 'haushalt-firebase-url';
  var HOUSEHOLD_KEY = 'haushalt-household-id';
  var NAME_KEY = 'haushalt-name';
  var SECRET_KEY = 'haushalt-secret';
  var LEGACY_URL_KEY = 'chore-wars-firebase-url';
  var LEGACY_HOUSEHOLD_KEY = 'chore-wars-household-id';
  var UPDATED_KEY = 'chore-wars-sync-at';
  var REMINDER_UPDATED_KEY = 'erinnerungen-sync-at';
  var SECRET_MIN = 8;
  var SECRET_MAX = 80;
  var NAME_MAX = 24;
  var ID_RULE = '$id.matches(/^[0-9a-f]{64}$/)';
  var DOC_RULE = "newData.hasChildren(['state', 'updatedAt']) && newData.child('updatedAt').isNumber() && newData.child('state').hasChildren()";

  function documentRule() {
    return {
      '.read': ID_RULE,
      '.write': ID_RULE,
      '.validate': DOC_RULE
    };
  }

  var RULES = {
    rules: {
      households: { $id: documentRule() }
    }
  };

  var RULES_TEXT = JSON.stringify(RULES, null, 2) + '\n';

  function fail(message) {
    return { ok: false, error: message };
  }

  function ok(value) {
    return { ok: true, value: value };
  }

  function normalizeDatabaseUrl(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return fail('Die Datenbank-Adresse fehlt.');
    raw = raw.replace(/\.json$/i, '').replace(/\/+$/, '');
    var url;
    try {
      url = new URL(raw);
    } catch (error) {
      return fail('Die Adresse ist ungültig.');
    }
    if (url.protocol !== 'https:') return fail('Die Adresse muss mit https:// beginnen.');
    var host = url.hostname.toLowerCase();
    var firebaseHost = host.endsWith('.firebaseio.com') || host.endsWith('.firebasedatabase.app');
    if (!firebaseHost) return fail('Das muss die Adresse der Firebase Realtime Database sein.');
    if (url.username || url.password) return fail('Die Adresse darf kein Kennwort enthalten.');
    if (url.search || url.hash) return fail('Die Adresse darf keine Parameter enthalten.');
    if (url.pathname && url.pathname !== '/') return fail('Nur die Basis-Adresse eintragen, ohne Pfad.');
    return ok(url.origin);
  }

  function readSecret(value) {
    var secret = String(value == null ? '' : value).trim();
    if (secret.length < SECRET_MIN) return fail('Das Kennwort braucht mindestens 8 Zeichen.');
    if (secret.length > SECRET_MAX) return fail('Das Kennwort darf höchstens 80 Zeichen haben.');
    return ok(secret);
  }

  function isHouseholdId(id) {
    return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);
  }

  function householdId(secret) {
    var accepted = readSecret(secret);
    if (!accepted.ok) return Promise.reject(new Error(accepted.error));
    var bytes = new TextEncoder().encode(accepted.value);
    return crypto.subtle.digest('SHA-256', bytes).then(function (digest) {
      var view = new Uint8Array(digest);
      var hex = '';
      for (var i = 0; i < view.length; i += 1) {
        var part = view[i].toString(16);
        hex += part.length === 1 ? '0' + part : part;
      }
      return hex;
    });
  }

  function standUrl(databaseURL, id, bucket) {
    if (bucket === 'reminders') return databaseURL + '/households/' + id + '/reminders.json';
    return databaseURL + '/households/' + id + '.json';
  }

  function cleanName(value) {
    var name = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (name.length > NAME_MAX) return fail('Der Name darf höchstens 24 Zeichen haben.');
    return ok(name);
  }

  function requireName(value) {
    var cleaned = cleanName(value);
    if (!cleaned.ok) return cleaned;
    if (!cleaned.value) return fail('Bitte einen Namen eintragen.');
    return cleaned;
  }

  function storageGet(storage, key) {
    if (!storage || !storage.getItem) return '';
    var value;
    try { value = storage.getItem(key); } catch (error) { return ''; }
    return value == null ? '' : String(value);
  }

  function storageSet(storage, key, value) {
    if (!storage) return;
    try {
      if (value) storage.setItem(key, value);
      else storage.removeItem(key);
    } catch (error) { /* Private mode can reject storage. */ }
  }

  function migrateConnection(storage) {
    if (!storageGet(storage, URL_KEY) && storageGet(storage, LEGACY_URL_KEY)) {
      storageSet(storage, URL_KEY, storageGet(storage, LEGACY_URL_KEY));
    }
    if (!storageGet(storage, HOUSEHOLD_KEY) && storageGet(storage, LEGACY_HOUSEHOLD_KEY)) {
      storageSet(storage, HOUSEHOLD_KEY, storageGet(storage, LEGACY_HOUSEHOLD_KEY));
    }
  }

  function readConnection(storage) {
    migrateConnection(storage);
    var name = cleanName(storageGet(storage, NAME_KEY));
    return {
      url: storageGet(storage, URL_KEY),
      householdId: storageGet(storage, HOUSEHOLD_KEY),
      name: name.ok ? name.value : '',
      secret: storageGet(storage, SECRET_KEY)
    };
  }

  function saveName(storage, value) {
    var cleaned = cleanName(value);
    if (!cleaned.ok) return cleaned;
    storageSet(storage, NAME_KEY, cleaned.value);
    return cleaned;
  }

  function saveConnection(storage, url, id, secret) {
    storageSet(storage, URL_KEY, url || '');
    storageSet(storage, HOUSEHOLD_KEY, id || '');
    storageSet(storage, LEGACY_URL_KEY, url || '');
    storageSet(storage, LEGACY_HOUSEHOLD_KEY, id || '');
    if (secret != null) storageSet(storage, SECRET_KEY, String(secret));
  }

  function disconnect(storage) {
    storageSet(storage, HOUSEHOLD_KEY, '');
    storageSet(storage, LEGACY_HOUSEHOLD_KEY, '');
  }

  function sameStand(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function decideInitial(options) {
    if (options.remoteUpdatedAt == null) return 'push';
    if (options.same) return 'same';
    if (options.untouched) return 'adopt';
    return 'ask';
  }

  function decideLive(options) {
    if (options.remoteUpdatedAt == null) return options.dirty ? 'push' : 'same';
    if (options.same) return 'same';
    if (options.dirty) return 'push';
    if (options.remoteUpdatedAt >= options.localUpdatedAt) return 'adopt';
    return 'push';
  }

  function readRemote(data) {
    if (data == null) return null;
    if (typeof data !== 'object' || Array.isArray(data)) return { invalid: true };
    if (!data.state || typeof data.state !== 'object' || Array.isArray(data.state)) return { invalid: true };
    if (typeof data.updatedAt !== 'number' || !isFinite(data.updatedAt)) return { invalid: true };
    return { state: data.state, updatedAt: data.updatedAt };
  }

  function httpError(response) {
    var error = new Error('status ' + response.status);
    error.status = response.status;
    return error;
  }

  function createSession(options) {
    var dirty = false;
    var live = false;
    var closed = false;
    var connecting = false;
    var timer = null;
    var writeGen = 0;
    var source = null;
    var delay = options.delay == null ? 300 : options.delay;
    var endpoint = standUrl(options.databaseURL, options.householdId, options.bucket);

    function status(name) {
      if (options.onStatus) options.onStatus(name);
    }

    function isOffline() {
      if (options.isOnline) return !options.isOnline();
      return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
    }

    function clearTimer() {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    }

    function put(payload, gen) {
      status('saving');
      return options.fetch(endpoint, {
        method: options.writeMethod === 'PATCH' ? 'PATCH' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store'
      }).then(function (response) {
        if (!response.ok) throw httpError(response);
        if (response.json) return response.json().catch(function () { return null; });
        return null;
      }).then(function () {
        if (closed) return;
        if (gen === writeGen) dirty = false;
        if (!dirty) status(source && source.readyState === 1 ? 'live' : 'connecting');
      }).catch(function (error) {
        if (closed) return;
        dirty = true;
        if (error && (error.status === 401 || error.status === 403)) status('denied');
        else if (error && error.status === 400) status('rejected');
        else status('error');
      });
    }

    function schedulePush() {
      if (closed) return;
      dirty = true;
      var gen = ++writeGen;
      clearTimer();
      timer = setTimeout(function () {
        timer = null;
        if (closed) return;
        var snap = options.getSnapshot();
        var updatedAt = options.now();
        options.setUpdatedAt(updatedAt);
        put({ state: snap.state, updatedAt: updatedAt }, gen);
      }, delay);
    }

    function applyRemote(data) {
      if (closed || !live) return;
      var remote = readRemote(data);
      if (remote && remote.invalid) {
        status('invalid');
        return;
      }
      var snap = options.getSnapshot();
      var decision = decideLive({
        remoteUpdatedAt: remote ? remote.updatedAt : null,
        localUpdatedAt: snap.updatedAt || 0,
        same: !!(remote && sameStand(remote.state, snap.state)),
        dirty: dirty
      });
      if (decision === 'adopt' && remote) {
        if (options.adopt(remote) === false) {
          status('invalid');
          return;
        }
        if (!dirty) status(source && source.readyState === 1 ? 'live' : 'connecting');
        return;
      }
      if (decision === 'push') schedulePush();
    }

    function startStream() {
      if (closed || source) return;
      source = new options.EventSource(endpoint);
      source.addEventListener('put', function (event) {
        var body;
        try {
          body = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        if (!body || body.path !== '/') return;
        applyRemote(body.data);
      });
      source.addEventListener('patch', function () {
        options.fetch(endpoint, { cache: 'no-store' }).then(function (response) {
          if (!response.ok) return null;
          return response.json();
        }).then(function (data) {
          applyRemote(data);
        }).catch(function () {});
      });
      source.addEventListener('cancel', function () {
        status('denied');
        if (source) source.close();
      });
      source.onopen = function () {
        if (closed || dirty) return;
        status('live');
      };
      source.onerror = function () {
        if (closed) return;
        if (source.readyState === 2) status('error');
        else status(dirty ? 'saving' : 'reconnecting');
      };
    }

    function arm(decision) {
      live = true;
      if (decision === 'push') schedulePush();
      else status('live');
      startStream();
    }

    function begin() {
      if (closed || connecting) return Promise.resolve();
      connecting = true;
      status('connecting');
      if (!isHouseholdId(options.householdId) || !normalizeDatabaseUrl(options.databaseURL).ok) {
        connecting = false;
        status('error');
        return Promise.resolve();
      }
      return options.fetch(endpoint, { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw httpError(response);
        return response.json();
      }).then(function (data) {
        if (closed) return;
        var remote = readRemote(data);
        if (remote && remote.invalid) {
          status('invalid');
          return;
        }
        if (dirty) {
          arm('push');
          return;
        }
        var snap = options.getSnapshot();
        var decision = decideInitial({
          remoteUpdatedAt: remote ? remote.updatedAt : null,
          same: !!(remote && sameStand(remote.state, snap.state)),
          untouched: !!snap.untouched
        });
        if (decision === 'ask') {
          status('ask');
          return Promise.resolve(options.ask(remote)).then(function (choice) {
            if (closed || (choice !== 'adopt' && choice !== 'push')) {
              status('local');
              return;
            }
            if (choice === 'adopt' && options.adopt(remote) === false) {
              status('invalid');
              return;
            }
            arm(choice === 'push' ? 'push' : 'same');
          });
        }
        if (decision === 'adopt' && options.adopt(remote) === false) {
          status('invalid');
          return;
        }
        arm(decision === 'push' ? 'push' : 'same');
      }).catch(function (error) {
        if (closed) return;
        if (error && (error.status === 401 || error.status === 403)) status('denied');
        else if (isOffline()) status('offline');
        else status('error');
      }).then(function () {
        connecting = false;
      });
    }

    var ready = begin();

    return {
      ready: ready,
      noteLocalEdit: function () {
        if (closed) return;
        dirty = true;
        if (live) schedulePush();
      },
      retry: function () {
        if (closed) return;
        if (!live) {
          begin();
          return;
        }
        if (!source || source.readyState === 2) {
          if (source) source.close();
          source = null;
          startStream();
        }
        if (dirty) schedulePush();
      },
      close: function () {
        closed = true;
        live = false;
        clearTimer();
        if (source) source.close();
        source = null;
      }
    };
  }

  return {
    URL_KEY: URL_KEY,
    HOUSEHOLD_KEY: HOUSEHOLD_KEY,
    NAME_KEY: NAME_KEY,
    SECRET_KEY: SECRET_KEY,
    LEGACY_URL_KEY: LEGACY_URL_KEY,
    LEGACY_HOUSEHOLD_KEY: LEGACY_HOUSEHOLD_KEY,
    UPDATED_KEY: UPDATED_KEY,
    REMINDER_UPDATED_KEY: REMINDER_UPDATED_KEY,
    SECRET_MIN: SECRET_MIN,
    SECRET_MAX: SECRET_MAX,
    NAME_MAX: NAME_MAX,
    RULES_TEXT: RULES_TEXT,
    normalizeDatabaseUrl: normalizeDatabaseUrl,
    readSecret: readSecret,
    cleanName: cleanName,
    requireName: requireName,
    migrateConnection: migrateConnection,
    readConnection: readConnection,
    saveName: saveName,
    saveConnection: saveConnection,
    disconnect: disconnect,
    isHouseholdId: isHouseholdId,
    householdId: householdId,
    standUrl: standUrl,
    sameStand: sameStand,
    decideInitial: decideInitial,
    decideLive: decideLive,
    readRemote: readRemote,
    createSession: createSession
  };
});
