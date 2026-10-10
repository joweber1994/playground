const reminders = require('./reminders.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

var TODAY = '2026-10-10';

var added = reminders.addItem(reminders.blank(), '  Mülltonne  ', TODAY, { id: 'muell' });
assert(added.ok, 'Mülltonne lässt sich merken');
assertEqual(added.item.text, 'Mülltonne', 'Text wird beschnitten');
assertEqual(added.item.date, TODAY, 'Datum bleibt');
assertEqual(added.item.done, false, 'neu ist offen');
assertEqual(added.state.items[0].id, 'muell', 'neue Erinnerung steht vorn');

var empty = reminders.addItem(reminders.blank(), '   ', '');
assert(!empty.ok, 'leerer Text wird abgelehnt');
assertEqual(empty.error, 'Bitte einen Text eingeben.', 'Hinweis bei leerem Text');

var badDate = reminders.addItem(reminders.blank(), 'Versicherung', '2026-02-31');
assert(!badDate.ok, '31. Februar ist ungültig');
assertEqual(badDate.state.items.length, 0, 'ungültiges Datum speichert nichts');

var longText = reminders.addItem(reminders.blank(), new Array(121 + 1).join('a'), '');
assert(!longText.ok, 'mehr als 120 Zeichen werden abgelehnt');

var undated = reminders.addItem(added.state, 'Oma anrufen', null, { id: 'oma' });
assert(undated.ok && undated.item.date === '', 'ohne Datum bleibt das Feld leer');

var tomorrow = reminders.addItem(undated.state, 'Blumen', '2026-10-11', { id: 'blumen' });
var later = reminders.addItem(tomorrow.state, 'Versicherung', '2026-12-01', { id: 'vertrag' });
var yesterday = reminders.addItem(later.state, 'Apotheke', '2026-10-09', { id: 'apo' });
var older = reminders.addItem(yesterday.state, 'Steuer', '2026-10-01', { id: 'steuer' });

var view = reminders.groups(older.state, TODAY);
assertEqual(view.open.map(function (item) { return item.id; }).join(','), 'steuer,apo,muell,blumen,vertrag,oma', 'fällig zuerst, dann Datum, ohne Datum am Ende');
assertEqual(view.due.length, 3, 'gestern, älter und heute sind fällig');
assertEqual(reminders.whenLabel('2026-10-10', TODAY), 'heute', 'heute');
assertEqual(reminders.whenLabel('2026-10-11', TODAY), 'morgen', 'morgen');
assertEqual(reminders.whenLabel('2026-10-09', TODAY), 'gestern', 'gestern');
assertEqual(reminders.whenLabel('2026-10-01', TODAY), 'überfällig · 1.10.2026', 'älteres Datum');
assertEqual(reminders.whenLabel('2026-10-31', '2026-10-31'), 'heute', 'Monatswechsel bleibt ein Datum');
assertEqual(reminders.whenKind('2026-11-01', '2026-10-31'), 'tomorrow', 'morgen über die Monatsgrenze');

var done = reminders.toggleItem(older.state, 'muell');
assert(done.ok && done.state.items.filter(function (item) { return item.id === 'muell'; })[0].done, 'abhaken');
assertEqual(reminders.groups(done.state, TODAY).due.length, 2, 'erledigte zählen nicht als fällig');
var reopened = reminders.toggleItem(done.state, 'muell');
assert(reopened.ok && !reopened.state.items.filter(function (item) { return item.id === 'muell'; })[0].done, 'wieder öffnen');

var removed = reminders.removeItem(older.state, 'oma');
assert(removed.ok, 'entfernen');
assert(!reminders.removeItem(removed.state, 'oma').ok, 'zweites Entfernen scheitert');
assert(!reminders.toggleItem(removed.state, 'fehlt').ok, 'unbekannte Id');

var cleared = reminders.clearDone(done.state);
assert(!cleared.items.some(function (item) { return item.done; }), 'erledigte löschen');
assert(cleared.items.some(function (item) { return item.id === 'apo'; }), 'offene bleiben');

var messy = reminders.normalize({
  items: [
    { id: 'a', text: '  Eins  ', date: '', done: 'false' },
    { id: 'a', text: 'Doppelt', date: '' },
    { id: '', text: 'ohne Id', date: '' },
    { id: 'b', text: 'kaputt', date: 'gestern' },
    { text: 'fehlt' },
    { id: 'c', text: 'Fertig', date: null, done: true }
  ]
});
assertEqual(messy.items.length, 2, 'kaputte Einträge fallen weg');
assertEqual(messy.items[0].done, false, 'nur echtes true gilt als erledigt');
assertEqual(messy.items[1].text, 'Fertig', 'null-Datum bleibt leer');

var full = reminders.blank();
var i;
for (i = 0; i < reminders.LIST_MAX; i += 1) {
  full = reminders.addItem(full, 'Punkt ' + i, '', { id: 'n' + i }).state;
}
assertEqual(full.items.length, reminders.LIST_MAX, 'Liste fasst 80');
assert(!reminders.addItem(full, 'zu viel', '').ok, 'die 81. wird abgelehnt');
var withDone = reminders.toggleItem(full, 'n0');
var afterClear = reminders.addItem(reminders.clearDone(withDone.state), 'wieder Platz', '');
assert(afterClear.ok, 'nach dem Löschen ist wieder Platz');

assertEqual(reminders.todayFromDate(new Date(2026, 9, 10)), '2026-10-10', 'lokales Datum');

var clash = reminders.addItem(added.state, 'nochmal', '', { id: 'muell' });
assertEqual(clash.item.id, 'muell-1', 'gleiche Id bekommt einen Zusatz');

console.log('reminders tests ok');
