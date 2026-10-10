const fs = require('fs');
const path = require('path');
const sync = require('./haushalt-sync.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

var rulesFile = fs.readFileSync(path.join(__dirname, 'database.rules.json'), 'utf8');
var legacyRules = fs.readFileSync(path.join(__dirname, 'chore-wars/database.rules.json'), 'utf8');
assertEqual(rulesFile, sync.RULES_TEXT, 'Regeln im Modul und in der Datei');
assertEqual(legacyRules, sync.RULES_TEXT, 'dieselbe Datei liegt auch bei Chore Wars');

var plain = sync.normalizeDatabaseUrl('https://haus.firebaseio.com');
assert(plain.ok, 'firebaseio wird akzeptiert');
assertEqual(plain.value, 'https://haus.firebaseio.com', 'Basis-Adresse bleibt erhalten');

var region = sync.normalizeDatabaseUrl('https://Haus-default-rtdb.europe-west1.firebasedatabase.app/');
assert(region.ok, 'regionale Adresse wird akzeptiert');
assertEqual(region.value, 'https://haus-default-rtdb.europe-west1.firebasedatabase.app', 'Host wird kleingeschrieben und der Schrägstrich fällt weg');

var withJson = sync.normalizeDatabaseUrl('https://haus.firebaseio.com/.json');
assert(withJson.ok, 'angehängtes .json fällt weg');
assertEqual(withJson.value, 'https://haus.firebaseio.com', 'danach bleibt die Basis');

assert(!sync.normalizeDatabaseUrl('').ok, 'leere Adresse');
assert(!sync.normalizeDatabaseUrl('http://haus.firebaseio.com').ok, 'http reicht nicht');
assert(!sync.normalizeDatabaseUrl('https://example.com').ok, 'fremde Hosts bleiben draußen');
assert(!sync.normalizeDatabaseUrl('https://haus.firebaseio.com/households/x').ok, 'kein Pfad');
assert(!sync.normalizeDatabaseUrl('https://haus.firebaseio.com/?auth=1').ok, 'keine Parameter');
assert(!sync.normalizeDatabaseUrl('https://user:pass@haus.firebaseio.com').ok, 'kein eingebettetes Kennwort');

var householdPath = sync.standUrl('https://haus.firebaseio.com', 'a'.repeat(64));
var reminderPath = sync.standUrl('https://haus.firebaseio.com', 'a'.repeat(64), 'reminders');
assertEqual(householdPath, 'https://haus.firebaseio.com/households/' + 'a'.repeat(64) + '.json', 'Chore Wars bleibt im bisherigen Pfad');
assertEqual(reminderPath, 'https://haus.firebaseio.com/reminders/' + 'a'.repeat(64) + '.json', 'Erinnerungen haben einen eigenen Pfad');
assertEqual(sync.standUrl('https://haus.firebaseio.com', 'a'.repeat(64), 'anders'), householdPath, 'unbekannte Bereiche fallen auf Chore Wars zurück');
assert(sync.RULES_TEXT.indexOf('"reminders"') !== -1, 'Regeln nennen Erinnerungen');
assert(sync.RULES_TEXT.indexOf('"households"') !== -1, 'Regeln nennen den bisherigen Haushalt');

assert(!sync.requireName('   ').ok, 'leerer Name wird abgelehnt');
assertEqual(sync.requireName('  Anna  ').value, 'Anna', 'Name wird beschnitten');
assert(!sync.cleanName(new Array(26).join('a')).ok, 'zu langer Name');

function memoryStorage(initial) {
  var data = {};
  Object.keys(initial || {}).forEach(function (key) { data[key] = initial[key]; });
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) { data[key] = String(value); },
    removeItem: function (key) { delete data[key]; },
    data: data
  };
}

var legacy = memoryStorage({
  'chore-wars-firebase-url': 'https://haus.firebaseio.com',
  'chore-wars-household-id': 'ab'.repeat(32)
});
var migrated = sync.readConnection(legacy);
assertEqual(migrated.url, 'https://haus.firebaseio.com', 'alte Adresse wird übernommen');
assertEqual(migrated.householdId, 'ab'.repeat(32), 'alter Pfad wird übernommen');
assertEqual(legacy.data['haushalt-firebase-url'], 'https://haus.firebaseio.com', 'neue Adresse wird gespeichert');
sync.saveName(legacy, '  Jonas  ');
assertEqual(sync.readConnection(legacy).name, 'Jonas', 'Name bleibt auf dem Gerät');
sync.disconnect(legacy);
assertEqual(sync.readConnection(legacy).householdId, '', 'Trennen löscht auch den alten Pfad');
assertEqual(sync.readConnection(legacy).url, 'https://haus.firebaseio.com', 'die Adresse bleibt zum erneuten Verbinden');

assert(!sync.readSecret('kurz').ok, 'zu kurzes Kennwort');
assert(sync.readSecret('  haushalt1  ').ok, 'Kennwort wird beschnitten');
assertEqual(sync.readSecret('  haushalt1  ').value, 'haushalt1', 'beschnittenes Kennwort');
assert(!sync.readSecret(new Array(82).join('a')).ok, 'zu langes Kennwort');

assertEqual(sync.decideInitial({ remoteUpdatedAt: null, same: false, untouched: false }), 'push', 'leerer Haushalt wird gefüllt');
assertEqual(sync.decideInitial({ remoteUpdatedAt: 5, same: true, untouched: false }), 'same', 'gleicher Stand bleibt');
assertEqual(sync.decideInitial({ remoteUpdatedAt: 5, same: false, untouched: true }), 'adopt', 'frisches Gerät übernimmt');
assertEqual(sync.decideInitial({ remoteUpdatedAt: 5, same: false, untouched: false }), 'ask', 'zwei gefüllte Stände fragen nach');

assertEqual(sync.decideLive({ remoteUpdatedAt: null, dirty: false, same: false, localUpdatedAt: 1 }), 'same', 'gelöschter Fernstand überschreibt lokal nicht');
assertEqual(sync.decideLive({ remoteUpdatedAt: null, dirty: true, same: false, localUpdatedAt: 1 }), 'push', 'lokale Änderung stellt den Stand wieder her');
assertEqual(sync.decideLive({ remoteUpdatedAt: 9, dirty: true, same: false, localUpdatedAt: 4 }), 'push', 'ungesendete Änderung gewinnt gegen die Leitung');
assertEqual(sync.decideLive({ remoteUpdatedAt: 9, dirty: false, same: false, localUpdatedAt: 4 }), 'adopt', 'neuerer Fernstand wird übernommen');
assertEqual(sync.decideLive({ remoteUpdatedAt: 3, dirty: false, same: false, localUpdatedAt: 4 }), 'push', 'neuerer Lokalstand wird gesendet');
assertEqual(sync.decideLive({ remoteUpdatedAt: 4, dirty: false, same: true, localUpdatedAt: 4 }), 'same', 'Echo der eigenen Sendung');

assertEqual(sync.readRemote(null), null, 'leerer Knoten');
assert(sync.readRemote({ updatedAt: 1 }).invalid, 'Stand ohne state ist ungültig');
assertEqual(sync.readRemote({ state: { version: 3 }, updatedAt: 7 }).updatedAt, 7, 'gültiger Fernstand');

function response(body, status) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () { return Promise.resolve(body); }
  };
}

function FakeSource(url) {
  this.url = url;
  this.readyState = 1;
  this.listeners = {};
  FakeSource.latest = this;
}

FakeSource.prototype.addEventListener = function (name, fn) {
  this.listeners[name] = fn;
};

FakeSource.prototype.close = function () {
  this.readyState = 2;
  this.closed = true;
};

FakeSource.prototype.emit = function (name, data) {
  this.listeners[name]({ data: JSON.stringify(data) });
};

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function runSession() {
  var store = { state: { version: 3, marker: 'lokal' }, updatedAt: 0, untouched: false };
  var puts = [];
  var adopted = [];
  var asked = [];
  var statuses = [];
  var remote = null;
  var askChoice = 'cancel';

  function fetchImpl(url, options) {
    if (!options || !options.method || options.method === 'GET') {
      return Promise.resolve(response(remote, 200));
    }
    puts.push(JSON.parse(options.body));
    remote = JSON.parse(options.body);
    return Promise.resolve(response(remote, 200));
  }

  var session = sync.createSession({
    databaseURL: 'https://haus.firebaseio.com',
    householdId: 'a'.repeat(64),
    getSnapshot: function () { return { state: store.state, updatedAt: store.updatedAt, untouched: store.untouched }; },
    setUpdatedAt: function (value) { store.updatedAt = value; },
    adopt: function (payload) {
      adopted.push(payload);
      store.state = payload.state;
      store.updatedAt = payload.updatedAt;
      return true;
    },
    ask: function (payload) {
      asked.push(payload);
      return Promise.resolve(askChoice);
    },
    onStatus: function (name) { statuses.push(name); },
    fetch: fetchImpl,
    EventSource: FakeSource,
    now: function () { return 1000 + puts.length; },
    delay: 0
  });

  return session.ready.then(function () { return wait(20); }).then(function () {
    assertEqual(puts.length, 1, 'leerer Haushalt erhält den lokalen Stand');
    assertEqual(puts[0].state.marker, 'lokal', 'gesendet wird der lokale Stand');
    assertEqual(store.updatedAt, 1000, 'Zeitstempel wird gemerkt');
    assertEqual(statuses[statuses.length - 1], 'live', 'Verbindung steht');
    assertEqual(FakeSource.latest.url, sync.standUrl('https://haus.firebaseio.com', 'a'.repeat(64)), 'Stream nutzt den Haushaltspfad');

    store.state = { version: 3, marker: 'neu' };
    session.noteLocalEdit();
    return wait(20);
  }).then(function () {
    assertEqual(puts.length, 2, 'lokale Änderung wird übertragen');
    assertEqual(puts[1].state.marker, 'neu', 'die neue Markierung ist im Haushalt');

    FakeSource.latest.emit('put', {
      path: '/',
      data: { state: { version: 3, marker: 'fern' }, updatedAt: 5000 }
    });
    assertEqual(adopted.length, 1, 'neuerer Fernstand wird übernommen');
    assertEqual(store.state.marker, 'fern', 'lokal steht danach der Fernstand');

    session.noteLocalEdit();
    store.state = { version: 3, marker: 'lokal-danach' };
    FakeSource.latest.emit('put', {
      path: '/',
      data: { state: { version: 3, marker: 'veraltet' }, updatedAt: 9 }
    });
    return wait(20);
  }).then(function () {
    assertEqual(adopted.length, 1, 'eine ungesendete Änderung übernimmt den älteren Fernstand nicht');
    assertEqual(puts[puts.length - 1].state.marker, 'lokal-danach', 'danach geht der lokale Stand raus');
    session.close();
    assert(FakeSource.latest.closed, 'Stream wird geschlossen');

    remote = { state: { version: 3, marker: 'gemeinsam' }, updatedAt: 8 };
    store = { state: { version: 3, marker: 'eigen' }, updatedAt: 2, untouched: false };
    puts = [];
    adopted = [];
    asked = [];
    askChoice = 'adopt';
    session = sync.createSession({
      databaseURL: 'https://haus.firebaseio.com',
      householdId: 'b'.repeat(64),
      getSnapshot: function () { return { state: store.state, updatedAt: store.updatedAt, untouched: store.untouched }; },
      setUpdatedAt: function (value) { store.updatedAt = value; },
      adopt: function (payload) {
        adopted.push(payload);
        store.state = payload.state;
        store.updatedAt = payload.updatedAt;
        return true;
      },
      ask: function (payload) {
        asked.push(payload);
        return Promise.resolve(askChoice);
      },
      onStatus: function () {},
      fetch: fetchImpl,
      EventSource: FakeSource,
      now: function () { return 50; },
      delay: 0
    });
    return session.ready.then(function () { return wait(20); });
  }).then(function () {
    assertEqual(asked.length, 1, 'zwei verschiedene Stände werden gefragt');
    assertEqual(adopted.length, 1, 'die Antwort übernimmt den gemeinsamen Stand');
    assertEqual(puts.length, 0, 'Übernehmen sendet den alten Lokalstand nicht');
    assertEqual(store.state.marker, 'gemeinsam', 'danach gilt der gemeinsame Stand');
    session.close();

    remote = { state: { version: 3, marker: 'gemeinsam' }, updatedAt: 8 };
    store = { state: { version: 3, marker: 'frisch' }, updatedAt: 0, untouched: true };
    adopted = [];
    asked = [];
    session = sync.createSession({
      databaseURL: 'https://haus.firebaseio.com',
      householdId: 'c'.repeat(64),
      getSnapshot: function () { return { state: store.state, updatedAt: store.updatedAt, untouched: store.untouched }; },
      setUpdatedAt: function (value) { store.updatedAt = value; },
      adopt: function (payload) {
        adopted.push(payload);
        store.state = payload.state;
        return true;
      },
      ask: function () { throw new Error('frisches Gerät fragt nicht'); },
      onStatus: function () {},
      fetch: fetchImpl,
      EventSource: FakeSource,
      now: function () { return 50; },
      delay: 0
    });
    return session.ready;
  }).then(function () {
    assertEqual(adopted.length, 1, 'frisches Gerät übernimmt ohne Frage');
    session.close();

    var denied = [];
    session = sync.createSession({
      databaseURL: 'https://haus.firebaseio.com',
      householdId: 'd'.repeat(64),
      getSnapshot: function () { return store; },
      setUpdatedAt: function () {},
      adopt: function () { return true; },
      ask: function () { return 'cancel'; },
      onStatus: function (name) { denied.push(name); },
      fetch: function () { return Promise.resolve(response({ error: 'Permission denied' }, 401)); },
      EventSource: FakeSource,
      now: function () { return 1; },
      delay: 0
    });
    return session.ready.then(function () {
      assertEqual(denied[denied.length - 1], 'denied', 'gesperrte Regeln werden benannt');
      session.close();
    });
  });
}

function runRetry() {
  var fetches = 0;
  var puts = [];
  var statuses = [];
  var online = false;
  var store = { state: { version: 3, marker: 'lokal' }, updatedAt: 0, untouched: false };
  var session = sync.createSession({
    databaseURL: 'https://haus.firebaseio.com',
    householdId: 'e'.repeat(64),
    getSnapshot: function () { return store; },
    setUpdatedAt: function (value) { store.updatedAt = value; },
    adopt: function () { throw new Error('offline adopt'); },
    ask: function () { throw new Error('offline ask'); },
    onStatus: function (name) { statuses.push(name); },
    fetch: function (url, options) {
      fetches += 1;
      if (fetches === 1) return Promise.reject(new Error('offline'));
      if (!options || !options.method || options.method === 'GET') return Promise.resolve(response(null, 200));
      puts.push(JSON.parse(options.body));
      return Promise.resolve(response(JSON.parse(options.body), 200));
    },
    EventSource: FakeSource,
    now: function () { return 70; },
    delay: 0,
    isOnline: function () { return online; }
  });
  return session.ready.then(function () {
    assertEqual(statuses[statuses.length - 1], 'offline', 'Start ohne Netz bleibt lokal benannt');
    online = true;
    store.state = { version: 3, marker: 'offline-edit' };
    session.noteLocalEdit();
    session.retry();
    return wait(30);
  }).then(function () {
    assertEqual(puts.length, 1, 'nach dem Netz wird der lokale Stand gesendet');
    assertEqual(puts[0].state.marker, 'offline-edit', 'die offline gemachte Änderung ist dabei');
    assertEqual(statuses[statuses.length - 1], 'live', 'danach ist der Haushalt verbunden');
    session.close();
  });
}

sync.householdId('haushalt1').then(function (id) {
  assertEqual(id, '8da4487cdfb3e7add6a7c079b2303a7645009419de8ee7788994ad1bad2f3e2a', 'Kennwort wird zum festen Haushaltspfad');
  assert(sync.isHouseholdId(id), 'der Pfad hat 64 Hex-Zeichen');
  return sync.householdId('kurz');
}).then(function () {
  throw new Error('kurzes Kennwort darf keinen Pfad erzeugen');
}).catch(function (error) {
  assert(/mindestens 8/.test(error.message), 'kurzes Kennwort erklärt den Fehler');
  return runSession();
}).then(function () {
  return runRetry();
}).then(function () {
  console.log('sync tests ok');
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
