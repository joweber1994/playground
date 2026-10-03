const api = require('./state.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

var fresh = api.defaultState();
assertEqual(fresh.players.length, 2, 'zwei Spieler');
assertEqual(fresh.chores.length, 4, 'vier Startaufgaben');
assertEqual(fresh.players[0].score, 0, 'Startstand Spieler 1');
assertEqual(fresh.players[0].name, 'Spieler 1', 'Standardname');
assertEqual(fresh.history.length, 0, 'leerer Verlauf');

var legacy = api.migrate({
  players: [
    { id: 'p1', name: 'Spieler 1', score: 25 },
    { id: 'p2', name: 'Spieler 2', score: 10.9 }
  ],
  history: [
    { id: 'h1', choreId: 'trash', title: 'Müll & Altglas wegbringen', points: 10, playerId: 'p1', playerName: 'Spieler 1', at: 30 },
    { id: 'h2', choreId: 'bathroom', title: 'Bad putzen', points: 50, playerId: 'p2', playerName: 'Spieler 2', at: 20 },
    { id: 'h3', choreId: 'trash', title: 'Müll & Altglas wegbringen', points: 10, playerId: 'p1', playerName: 'Spieler 1', at: 10 },
    { playerId: 'p3', title: 'fremd', points: 5, at: 1 }
  ]
});
assertEqual(legacy.players[0].score, 25, 'alter Stand Spieler 1');
assertEqual(legacy.players[1].score, 10, 'alter Stand Spieler 2 wird gekürzt');
assertEqual(legacy.players[0].name, 'Spieler 1', 'alte Namen bleiben die Standardnamen');
assertEqual(legacy.chores.length, 4, 'ohne Aufgabenliste bleiben die Startaufgaben');
assertEqual(legacy.history.length, 3, 'ungültige Verläufe fallen weg');
assertEqual(legacy.totals.length, 2, 'Statistik entsteht aus dem alten Verlauf');
var p1Trash = legacy.totals.filter(function (row) { return row.playerId === 'p1' && row.choreId === 'trash'; })[0];
assertEqual(p1Trash.count, 2, 'zwei Müll-Erledigungen');

var named = api.migrate({
  version: 2,
  players: [
    { id: 'p1', name: '  Alex  ', score: -4 },
    { id: 'p2', name: 'Sam', score: api.SCORE_CAP + 50 }
  ],
  chores: [
    { id: 'windows', title: 'Fenster', points: 20, sort: 1 },
    { id: 'windows', title: 'doppelt', points: 5, sort: 0 },
    { id: 'floor', title: 'Boden', points: 30, sort: 0 }
  ],
  history: [],
  totals: []
});
assertEqual(named.players[0].name, 'Alex', 'Name wird beschnitten');
assertEqual(named.players[0].score, 0, 'negativer Stand wird 0');
assertEqual(named.players[1].score, api.SCORE_CAP, 'Stand hat eine Obergrenze');
assertEqual(named.chores.map(function (chore) { return chore.id; }).join(','), 'floor,windows', 'Sortierung und doppelte Kennung');

var keptTotals = api.migrate({
  version: 2,
  players: [
    { id: 'p1', name: 'Alex', score: 0 },
    { id: 'p2', name: 'Sam', score: 0 }
  ],
  chores: [{ id: 'trash', title: 'Müll', points: 10, sort: 0 }],
  history: [
    { id: 'h1', choreId: 'trash', title: 'Müll', points: 10, playerId: 'p1', playerName: 'Alex', at: 5 }
  ],
  totals: []
});
assertEqual(keptTotals.totals.length, 0, 'leere Statistik wird nicht aus dem Verlauf neu gebaut');
assertEqual(keptTotals.history.length, 1, 'Verlauf bleibt erhalten');

var base = api.defaultState();
var booked = api.claim(base, 'bathroom', 'p1', { now: 1000, id: 'buch-1' });
assert(booked.ok, 'Buchen gelingt');
assertEqual(base.players[0].score, 0, 'Buchen ändert den vorigen Stand nicht');
assertEqual(booked.state.players[0].score, 50, 'Bad gibt 50 Punkte');
assertEqual(booked.state.history[0].playerName, 'Spieler 1', 'Name zum Zeitpunkt der Buchung');
assertEqual(booked.state.totals[0].count, 1, 'Zähler steigt');

var renamed = api.renamePlayer(booked.state, 'p1', 'Alex');
assert(renamed.ok, 'Umbenennen gelingt');
assertEqual(renamed.state.history[0].playerName, 'Spieler 1', 'alter Verlauf behält den Namen');
var again = api.claim(renamed.state, 'bathroom', 'p1', { now: 2000, id: 'buch-2' });
assertEqual(again.state.history[0].playerName, 'Alex', 'neue Buchung nutzt den neuen Namen');
assertEqual(again.state.totals[0].count, 2, 'Zähler zählt beide Buchungen');

var undone = api.undo(again.state);
assert(undone.ok, 'Rückgängig gelingt');
assertEqual(undone.state.players[0].score, 50, 'Punkte der letzten Buchung fallen weg');
assertEqual(undone.state.history.length, 1, 'eine Buchung bleibt');
assertEqual(undone.state.totals[0].count, 1, 'Zähler sinkt');
assert(!api.undo(api.defaultState()).ok, 'ohne Verlauf gibt es nichts zurückzunehmen');

var reset = api.resetScores(again.state);
assertEqual(reset.players[0].score, 0, 'Reset leert die Punkte');
assertEqual(reset.players[0].name, 'Alex', 'Reset behält den Namen');
assertEqual(reset.history.length, 0, 'Reset leert den Verlauf');
assertEqual(reset.chores.length, 4, 'Reset behält die Aufgaben');
assertEqual(reset.totals[0].count, 2, 'Reset behält die Statistik');

var added = api.addChore(reset, { title: '  Pflanzen gießen ', points: '12' }, { id: 'plants' });
assert(added.ok, 'Aufgabe hinzufügen');
assertEqual(added.state.chores[added.state.chores.length - 1].title, 'Pflanzen gießen', 'Titel wird beschnitten');
assertEqual(added.state.chores[added.state.chores.length - 1].points, 12, 'Punkte aus Text');
assert(!api.addChore(reset, { title: '   ', points: 5 }).ok, 'leerer Titel');
assert(!api.addChore(reset, { title: 'Ok', points: 0 }).ok, 'null Punkte');
assert(!api.addChore(reset, { title: 'Ok', points: 1000 }).ok, 'zu viele Punkte');
assert(!api.addChore(reset, { title: 'x'.repeat(81), points: 5 }).ok, 'Titel zu lang');

var edited = api.updateChore(added.state, 'plants', { title: 'Blumen', points: 8 });
assert(edited.ok, 'Aufgabe ändern');
assertEqual(edited.state.chores[edited.state.chores.length - 1].title, 'Blumen', 'neuer Titel');
var withTotal = api.claim(edited.state, 'plants', 'p2', { now: 3000, id: 'buch-3' });
var retitled = api.updateChore(withTotal.state, 'plants', { title: 'Blumen gießen', points: 8 });
var plantTotal = retitled.state.totals.filter(function (row) { return row.choreId === 'plants'; })[0];
assertEqual(plantTotal.title, 'Blumen gießen', 'Statistik übernimmt den neuen Titel');

var moved = api.moveChore(retitled.state, 'plants', -1);
assert(moved.ok, 'nach oben');
assertEqual(moved.state.chores[moved.state.chores.length - 2].id, 'plants', 'Aufgabe rückt vor');
assert(!api.moveChore(moved.state, moved.state.chores[0].id, -1).ok, 'die erste Aufgabe bleibt oben');

var removable = moved.state;
while (removable.chores.length > 1) {
  removable = api.deleteChore(removable, removable.chores[0].id).state;
}
assertEqual(removable.chores.length, 1, 'eine Aufgabe bleibt');
assert(!api.deleteChore(removable, removable.chores[0].id).ok, 'die letzte Aufgabe bleibt bestehen');
assertEqual(api.playerStats(removable).filter(function (row) { return row.playerId === 'p2'; })[0].claims > 0, true, 'Statistik der gelöschten Aufgaben bleibt');

assert(!api.renamePlayer(fresh, 'p1', '   ').ok, 'leerer Name');
assert(!api.renamePlayer(fresh, 'p1', 'A'.repeat(25)).ok, 'Name zu lang');
assert(api.renamePlayer(fresh, 'p1', 'A'.repeat(24)).ok, 'Name mit 24 Zeichen');
var alex = api.renamePlayer(fresh, 'p1', 'Alex').state;
assert(!api.renamePlayer(alex, 'p2', 'alex').ok, 'gleiche Namen');

var capped = api.defaultState();
capped.players[0].score = api.SCORE_CAP;
assert(!api.claim(capped, 'trash', 'p1').ok, 'an der Obergrenze wird nicht gebucht');

var many = api.defaultState();
for (var i = 0; i < api.HISTORY_LIMIT + 1; i += 1) {
  many = api.claim(many, 'trash', 'p1', { now: 1000 + i, id: 'n' + i }).state;
}
assertEqual(many.history.length, api.HISTORY_LIMIT, 'Verlauf ist auf 50 begrenzt');
assertEqual(many.totals[0].count, api.HISTORY_LIMIT + 1, 'Statistik zählt auch aus dem Verlauf gefallene Buchungen');

var exported = api.serialize(many);
var imported = api.parseImport(JSON.stringify(exported));
assert(imported.ok, 'gesicherter Stand lässt sich laden');
assertEqual(imported.state.players[0].score, exported.players[0].score, 'Punkte überstehen die Sicherung');
assertEqual(imported.state.history.length, exported.history.length, 'Verlauf übersteht die Sicherung');
assert(!api.parseImport('{').ok, 'kaputtes JSON');
assert(!api.parseImport('{"version":1}').ok, 'fremde Datei');
assert(!api.parseImport('{"version":2,"players":[],"chores":[{"id":"x","title":"","points":1}]}').ok, 'unvollständiger Stand');

assertEqual(api.rankFor(0), 'Rekrut', 'Rang am Anfang');
assertEqual(api.rankFor(600), 'Legende', 'höchster Rang');
assertEqual(api.leaderSentence(booked.state), 'Spieler 1 führt mit 50 Punkten', 'Führungssatz');
assertEqual(api.punkteLabel(1), '1 Punkt', 'Einzahl');

console.log('state.test.js: ok');
