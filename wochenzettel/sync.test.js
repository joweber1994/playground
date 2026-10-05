const fs = require('fs');
const path = require('path');
const sync = require('./sync.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

var rulesFile = fs.readFileSync(path.join(__dirname, '..', 'chore-wars', 'database.rules.json'), 'utf8');
assertEqual(rulesFile, sync.RULES_TEXT, 'Regeln im Modul und in der Datei');
assert(sync.SECRET_KEY && sync.SECRET_KEY !== sync.URL_KEY && sync.SECRET_KEY !== sync.HOUSEHOLD_KEY, 'Kennwort liegt getrennt vom Haushaltspfad');
assert(sync.standUrl('https://haus.firebaseio.com', 'ab'.repeat(32)).indexOf('geheimnis') === -1, 'der Firebase-Pfad enthält das Kennwort nicht');

assertEqual(sync.decideInitial({ remoteUpdatedAt: 5, same: false, untouched: false }), 'merge', 'zwei gefüllte Zettel werden zusammengeführt');
assertEqual(sync.decideInitial({ remoteUpdatedAt: 5, same: false, untouched: true }), 'adopt', 'frisches Gerät übernimmt');
assertEqual(sync.decideLive({ remoteUpdatedAt: 9, dirty: true, same: false, localUpdatedAt: 4 }), 'merge', 'ungesendete Änderung überschreibt den anderen Haken nicht');
assertEqual(sync.decideLive({ remoteUpdatedAt: 9, dirty: false, same: false, localUpdatedAt: 4 }), 'adopt', 'ruhendes Gerät übernimmt');

var local = {
  weekKey: '2026-W40',
  weekRev: 1,
  pantry: ['nudeln'],
  pantryLog: { nudeln: { on: true, rev: 1 } },
  lines: [{ id: 'm1', name: 'Brot', amounts: ['1 Laib'], addedBy: 'Alex', rev: 2, deleted: false }],
  checkMeta: { 'plan:reis': { on: true, by: 'Alex', rev: 3 } },
  checked: ['plan:reis'],
  extraAmounts: { paprika: ['1 Netz'] },
  claims: [{ storeId: 'prechtl', by: 'Alex', on: true, rev: 2 }],
  recipes: [],
  staples: []
};
var remote = {
  weekKey: '2026-W40',
  weekRev: 1,
  pantry: ['milch'],
  pantryLog: { milch: { on: true, rev: 4 }, nudeln: { on: false, rev: 5 } },
  lines: [{ id: 'm1', name: 'Brot', amounts: ['500 g'], addedBy: 'Sam', rev: 1, deleted: false }],
  checkMeta: { 'plan:milch': { on: true, by: 'Sam', rev: 4 }, 'plan:reis': { on: false, by: 'Sam', rev: 1 } },
  checked: ['plan:milch'],
  extraAmounts: { paprika: ['2'] },
  claims: [{ storeId: 'prechtl', by: 'Sam', on: true, rev: 6 }],
  recipes: [],
  staples: []
};
var merged = sync.mergeStands(local, remote);
assert(merged.checked.indexOf('plan:reis') !== -1, 'der neuere Haken von Alex bleibt');
assert(merged.checked.indexOf('plan:milch') !== -1, 'der Haken von Sam kommt dazu');
assertEqual(merged.checkMeta['plan:reis'].by, 'Alex', 'abgehakt von Alex');
assertEqual(merged.lines[0].amounts.join(' · '), '1 Laib · 500 g', 'Mengen werden angehängt');
assertEqual(merged.lines[0].addedBy, 'Alex', 'angelegt von der neueren Zeile');
assert(merged.extraAmounts.paprika.indexOf('1 Netz') !== -1 && merged.extraAmounts.paprika.indexOf('2') !== -1, 'Zusatzmengen bleiben beide');
assertEqual(merged.claims[0].by, 'Sam', 'der spätere Anspruch auf den Markt gilt');
assert(merged.pantry.indexOf('milch') !== -1, 'Milch von Sam ist zu Hause');
assert(merged.pantry.indexOf('nudeln') === -1, 'Sam hat Nudeln später verbraucht');

var nextWeek = sync.mergeStands(local, {
  weekKey: '2026-W41',
  weekRev: 10,
  pantry: ['nudeln'],
  pantryLog: { nudeln: { on: true, rev: 1 } },
  lines: [],
  checkMeta: {},
  recipes: [{ id: 'c1', title: 'Suppe', custom: true, rev: 2, deleted: false }],
  staples: [{ id: 's1', name: 'Kaffee', amount: '1', rev: 2, deleted: false }]
});
assertEqual(nextWeek.weekKey, '2026-W41', 'die neuere Woche gilt');
assertEqual(nextWeek.lines.length, 0, 'die alte Liste wird nicht in die neue Woche gezogen');
assert(nextWeek.pantry.indexOf('nudeln') !== -1, 'der Vorrat bleibt über die Woche');
assertEqual(nextWeek.recipes[0].id, 'c1', 'eigene Gerichte bleiben');
assertEqual(nextWeek.staples[0].name, 'Kaffee', 'feste Artikel bleiben');

var wiped = sync.mergeStands(
  { weekKey: '2026-W40', weekRev: 1, lines: [], checkMeta: { 'line:m9': { on: true, by: 'Alex', rev: 8 } }, checked: ['line:m9'] },
  { weekKey: '2026-W40', weekRev: 1, lines: [{ id: 'm2', name: 'Salz', amounts: [], rev: 1 }], checkMeta: {}, checked: [] }
);
assert(wiped.checked.indexOf('line:m9') !== -1, 'ein ganzer Fernstand löscht den lokalen Haken nicht');
assertEqual(wiped.lines.length, 1, 'die Zeile des anderen bleibt');

console.log('sync.test.js: ok');
