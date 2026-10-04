/* Chore Wars – gemeinsamer Stand über die Firebase Realtime Database.
   Reine Entscheidungen plus eine kleine Sitzung. Im Browser als ChoreWarsSync, unter Node als Modul. */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoreWarsSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var URL_KEY = 'chore-wars-firebase-url';
  var HOUSEHOLD_KEY = 'chore-wars-household-id';
  var UPDATED_KEY = 'chore-wars-sync-at';
  var SECRET_MIN = 8;
  var SECRET_MAX = 80;

  var RULES = {
    rules: {
      households: {
        $id: {
          '.read': '$id.matches(/^[0-9a-f]{64}$/)',
          '.write': '$id.matches(/^[0-9a-f]{64}$/)',
          '.validate': "newData.hasChildren(['state', 'updatedAt']) && newData.child('updatedAt').isNumber() && newData.child('state').hasChildren()"
        }
      }
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

  function standUrl(databaseURL, id) {
    return databaseURL + '/households/' + id + '.json';
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
    var endpoint = standUrl(options.databaseURL, options.householdId);

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
        method: 'PUT',
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
    UPDATED_KEY: UPDATED_KEY,
    SECRET_MIN: SECRET_MIN,
    SECRET_MAX: SECRET_MAX,
    RULES_TEXT: RULES_TEXT,
    normalizeDatabaseUrl: normalizeDatabaseUrl,
    readSecret: readSecret,
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
