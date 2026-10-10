/* Wochenzettel – gemeinsamer Stand, zeilenweise.
   Dieselbe Firebase-Adresse und dasselbe Kennwort wie Chore Wars, eigener Pfad.
   Im Browser als WochenzettelSync, unter Node als Modul. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WochenzettelSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var URL_KEY = 'wochenzettel-firebase-url';
  var HOUSEHOLD_KEY = 'wochenzettel-household-id';
  var SECRET_KEY = 'wochenzettel-household-secret';
  var UPDATED_KEY = 'wochenzettel-sync-at';
  var NAME_KEY = 'wochenzettel-display-name';
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
      },
      zettel: {
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

  function num(value) {
    var rev = Number(value);
    if (!Number.isFinite(rev) || rev < 0) return 0;
    return Math.floor(rev);
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
    return databaseURL + '/zettel/' + id + '.json';
  }

  function sameStand(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function decideInitial(options) {
    if (options.remoteUpdatedAt == null) return 'push';
    if (options.same) return 'same';
    if (options.untouched) return 'adopt';
    return 'merge';
  }

  function decideLive(options) {
    if (options.remoteUpdatedAt == null) return options.dirty ? 'push' : 'same';
    if (options.same) return 'same';
    if (options.dirty) return 'merge';
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

  function asList(value) {
    return Array.isArray(value) ? value : [];
  }

  function unionText(left, right, limit) {
    var out = [];
    asList(left).concat(asList(right)).forEach(function (item) {
      var text = String(item == null ? '' : item).trim().replace(/\s+/g, ' ');
      if (!text || out.indexOf(text) !== -1) return;
      if (out.length >= limit) return;
      out.push(text);
    });
    return out;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeById(left, right, idOf, combine) {
    var map = {};
    asList(left).forEach(function (item) {
      var id = idOf(item);
      if (id) map[id] = { left: item };
    });
    asList(right).forEach(function (item) {
      var id = idOf(item);
      if (!id) return;
      if (!map[id]) map[id] = {};
      map[id].right = item;
    });
    var out = [];
    Object.keys(map).forEach(function (id) {
      out.push(combine(map[id].left, map[id].right));
    });
    return out;
  }

  function mergeLine(left, right) {
    if (!left) return right;
    if (!right) return left;
    var winner = num(right.rev) >= num(left.rev) ? right : left;
    var loser = winner === right ? left : right;
    if (winner.deleted && num(winner.rev) >= num(loser.rev)) return clone(winner);
    var next = clone(winner);
    next.deleted = false;
    next.amounts = unionText(left.amounts, right.amounts, 6);
    if (!next.addedBy && loser.addedBy) next.addedBy = loser.addedBy;
    return next;
  }

  function flagMap(ids, log) {
    var out = {};
    var source = log && typeof log === 'object' ? log : {};
    Object.keys(source).forEach(function (id) {
      var row = source[id];
      if (!row || typeof row !== 'object') return;
      out[id] = { on: !!row.on, rev: num(row.rev) };
    });
    asList(ids).forEach(function (id) {
      if (typeof id !== 'string' || !id || out[id]) return;
      out[id] = { on: true, rev: 0 };
    });
    return out;
  }

  function mergeFlags(leftIds, leftLog, rightIds, rightLog) {
    var left = flagMap(leftIds, leftLog);
    var right = flagMap(rightIds, rightLog);
    var out = {};
    Object.keys(left).concat(Object.keys(right)).forEach(function (id) {
      if (out[id]) return;
      var a = left[id];
      var b = right[id];
      if (!a) out[id] = b;
      else if (!b) out[id] = a;
      else out[id] = b.rev >= a.rev ? b : a;
    });
    return out;
  }

  function idsOn(map) {
    return Object.keys(map).filter(function (id) { return map[id].on; });
  }

  function metaFrom(stand) {
    var meta = {};
    var source = stand && stand.checkMeta && typeof stand.checkMeta === 'object' ? stand.checkMeta : {};
    Object.keys(source).forEach(function (key) {
      var row = source[key];
      if (!row || typeof row !== 'object') return;
      if (key.indexOf('plan:') !== 0 && key.indexOf('line:') !== 0) return;
      meta[key] = { on: !!row.on, by: String(row.by || ''), rev: num(row.rev) };
    });
    asList(stand && stand.checked).forEach(function (key) {
      if (typeof key !== 'string') return;
      if (!meta[key]) meta[key] = { on: true, by: '', rev: 0 };
    });
    return meta;
  }

  function mergeMeta(left, right) {
    var a = metaFrom(left);
    var b = metaFrom(right);
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (key) {
      if (out[key]) return;
      if (!a[key]) out[key] = b[key];
      else if (!b[key]) out[key] = a[key];
      else out[key] = b[key].rev >= a[key].rev ? b[key] : a[key];
    });
    return out;
  }

  function checkedFrom(meta) {
    return Object.keys(meta).filter(function (key) { return meta[key].on; });
  }

  function mergeMaps(left, right) {
    var out = {};
    var a = left && typeof left === 'object' ? left : {};
    var b = right && typeof right === 'object' ? right : {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (key) {
      if (out[key]) return;
      out[key] = unionText(a[key], b[key], 12);
      if (!out[key].length) delete out[key];
    });
    return out;
  }

  function mergeNamed(left, right, idOf) {
    return mergeById(left, right, idOf, function (a, b) {
      if (!a) return b;
      if (!b) return a;
      var winner = num(b.rev) >= num(a.rev) ? b : a;
      var loser = winner === b ? a : b;
      if (winner.deleted && num(winner.rev) >= num(loser.rev)) return clone(winner);
      var next = clone(winner);
      next.deleted = false;
      if (!next.addedBy && loser.addedBy) next.addedBy = loser.addedBy;
      return next;
    });
  }

  function mergeEvenings(left, right) {
    return mergeById(left, right, function (row) { return row && row.day; }, function (a, b) {
      if (!a) return b;
      if (!b) return a;
      return num(b.rev) >= num(a.rev) ? b : a;
    });
  }

  function mergeClaims(left, right) {
    return mergeById(left, right, function (row) { return row && row.storeId; }, function (a, b) {
      if (!a) return b;
      if (!b) return a;
      return num(b.rev) >= num(a.rev) ? b : a;
    });
  }

  function weekFields(stand) {
    return {
      lines: asList(stand.lines),
      checkMeta: metaFrom(stand),
      checked: checkedFrom(metaFrom(stand)),
      extras: stand.extras && typeof stand.extras === 'object' ? stand.extras : {},
      extraAmounts: stand.extraAmounts && typeof stand.extraAmounts === 'object' ? stand.extraAmounts : {},
      skipped: asList(stand.skipped),
      skippedLog: stand.skippedLog && typeof stand.skippedLog === 'object' ? stand.skippedLog : {},
      claims: asList(stand.claims),
      evenings: asList(stand.evenings),
      picked: stand.picked == null ? null : asList(stand.picked),
      pickedRev: num(stand.pickedRev),
      storeIds: asList(stand.storeIds),
      storeRev: num(stand.storeRev)
    };
  }

  function persistent(left, right) {
    var pantry = mergeFlags(left.pantry, left.pantryLog, right.pantry, right.pantryLog);
    var recipes = mergeNamed(left.recipes, right.recipes, function (row) { return row && row.id; });
    var staples = mergeNamed(left.staples, right.staples, function (row) { return row && row.id; });
    var inventory = mergeNamed(left.inventory, right.inventory, function (row) { return row && row.id; });
    var overrides = mergeNamed(left.overrides, right.overrides, function (row) { return row && row.id; });
    var inventorySet = !!(left.inventorySet || right.inventorySet);
    return {
      pantry: idsOn(pantry),
      pantryLog: pantry,
      recipes: recipes,
      staples: staples,
      inventory: inventory,
      inventorySet: inventorySet,
      overrides: overrides
    };
  }

  function mergeWeek(left, right) {
    var lines = mergeById(left.lines, right.lines, function (row) { return row && row.id; }, mergeLine);
    var checkMeta = mergeMeta(left, right);
    var skipped = mergeFlags(left.skipped, left.skippedLog, right.skipped, right.skippedLog);
    var storeIds = num(right.storeRev) >= num(left.storeRev) ? asList(right.storeIds) : asList(left.storeIds);
    var picked = num(right.pickedRev) >= num(left.pickedRev)
      ? (right.picked == null ? null : asList(right.picked))
      : (left.picked == null ? null : asList(left.picked));
    return {
      lines: lines,
      checkMeta: checkMeta,
      checked: checkedFrom(checkMeta),
      extras: mergeMaps(left.extras, right.extras),
      extraAmounts: mergeMaps(left.extraAmounts, right.extraAmounts),
      skipped: idsOn(skipped),
      skippedLog: skipped,
      claims: mergeClaims(left.claims, right.claims),
      evenings: mergeEvenings(left.evenings, right.evenings),
      picked: picked,
      pickedRev: Math.max(num(left.pickedRev), num(right.pickedRev)),
      storeIds: storeIds,
      storeRev: Math.max(num(left.storeRev), num(right.storeRev))
    };
  }

  function mergeStands(local, remote) {
    var left = local && typeof local === 'object' ? local : {};
    var right = remote && typeof remote === 'object' ? remote : {};
    var kept = persistent(left, right);
    var weekKey = left.weekKey || right.weekKey || '';
    var weekRev = Math.max(num(left.weekRev), num(right.weekRev));
    var week;
    if (left.weekKey && right.weekKey && left.weekKey !== right.weekKey) {
      var winner = num(right.weekRev) >= num(left.weekRev) ? right : left;
      week = weekFields(winner);
      weekKey = winner.weekKey;
      weekRev = num(winner.weekRev);
    } else {
      week = mergeWeek(left, right);
      if (num(right.weekRev) >= num(left.weekRev) && right.weekKey) weekKey = right.weekKey;
      else if (left.weekKey) weekKey = left.weekKey;
    }
    var merged = {
      weekKey: weekKey,
      weekRev: weekRev,
      marketId: num(right.weekRev) >= num(left.weekRev) ? (right.marketId || left.marketId || '') : (left.marketId || right.marketId || '')
    };
    Object.keys(kept).forEach(function (key) { merged[key] = kept[key]; });
    Object.keys(week).forEach(function (key) { merged[key] = week[key]; });
    return merged;
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

    function takeMerged(remote) {
      var snap = options.getSnapshot();
      var merged;
      try {
        merged = options.merge(snap.state, remote.state);
      } catch (error) {
        status('invalid');
        return false;
      }
      var updatedAt = options.now();
      if (options.adopt({ state: merged, updatedAt: updatedAt }) === false) {
        status('invalid');
        return false;
      }
      options.setUpdatedAt(updatedAt);
      return true;
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
      if (decision === 'merge' && remote) {
        if (!takeMerged(remote)) return;
        schedulePush();
        return;
      }
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
          if (remote) {
            if (!takeMerged(remote)) return;
          }
          arm('push');
          return;
        }
        var snap = options.getSnapshot();
        var decision = decideInitial({
          remoteUpdatedAt: remote ? remote.updatedAt : null,
          same: !!(remote && sameStand(remote.state, snap.state)),
          untouched: !!snap.untouched
        });
        if (decision === 'merge' && remote) {
          if (!takeMerged(remote)) return;
          arm('push');
          return;
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
    SECRET_KEY: SECRET_KEY,
    UPDATED_KEY: UPDATED_KEY,
    NAME_KEY: NAME_KEY,
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
    mergeStands: mergeStands,
    createSession: createSession
  };
});
