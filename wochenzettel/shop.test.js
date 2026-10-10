const shop = require('./shop.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

var empty = shop.addManual([], [], {}, '   ', '');
assert(!empty.ok && empty.reason === 'empty', 'leerer Name wird abgelehnt');

var longName = shop.addManual([], [], {}, new Array(82).join('a'), '');
assert(!longName.ok && longName.reason === 'long', 'zu langer Name wird abgelehnt');

var longAmount = shop.addManual([], [], {}, 'Milch', new Array(82).join('x'));
assert(!longAmount.ok && longAmount.reason === 'amount', 'zu lange Menge wird abgelehnt');

var created = shop.addManual([], [], {}, '  Milch  ', '');
assert(created.created, 'neuer Artikel wird angelegt');
assertEqual(created.draft.name, 'Milch', 'Name wird beschnitten');
assertEqual(created.draft.amounts.length, 0, 'ohne Menge bleibt die Menge leer');

var withQty = shop.addManual([], [], {}, 'Brot', '1 Laib');
var lines = [{
  id: shop.nextLineId([]),
  name: withQty.draft.name,
  amounts: withQty.draft.amounts.slice(),
  price: '',
  storeId: '',
  storeName: ''
}];
assertEqual(lines[0].id, 'm1', 'erste Zeile heißt m1');
assertEqual(lines[0].amounts[0], '1 Laib', 'Menge bleibt erhalten');

var again = shop.addManual(lines, [], {}, 'brot', '');
assert(again.already, 'gleiche Bezeichnung ist keine zweite Zeile');
assertEqual(again.lines, lines, 'unveränderte Liste bleibt dieselbe');

var merged = shop.addManual(lines, [], {}, 'BROT', '500 g');
assert(merged.merged, 'neue Menge wird ergänzt');
assertEqual(merged.lines[0].amounts.join(' · '), '1 Laib · 500 g', 'Mengen stehen hintereinander');
assertEqual(lines[0].amounts.length, 1, 'die alte Zeile bleibt unverändert');

var sameQty = shop.addManual(merged.lines, [], {}, 'Brot', '500 g');
assert(sameQty.already, 'dieselbe Menge wird nicht doppelt ergänzt');

var plan = [{ id: 'paprika', name: 'Paprika', amounts: ['3 Stück'] }];
var onPlan = shop.addManual([], plan, {}, 'paprika', '');
assert(onPlan.already && onPlan.planId === 'paprika', 'Zutat aus dem Gericht ist schon auf der Liste');

var planQty = shop.addManual([], plan, {}, 'Paprika', '1 Netz');
assert(planQty.merged, 'zusätzliche Menge hängt an der Zutat');
assertEqual(planQty.extraAmounts.paprika[0], '1 Netz', 'Menge liegt bei der Zutat');

var planAgain = shop.addManual([], plan, planQty.extraAmounts, 'Paprika', '3 Stück');
assert(planAgain.already, 'Menge aus dem Gericht zählt als schon da');

var offer = shop.addOffer([], [], {
  name: '  Haferdrink  ',
  price: '0.99',
  amount: '1 l',
  storeId: 'aldi',
  storeName: 'Aldi Süd'
});
assert(offer.created, 'Angebot legt eine Zeile an');
assertEqual(offer.draft.name, 'Haferdrink', 'Angebotsname');
assertEqual(offer.draft.price, '0.99', 'Preis bleibt am Angebot');
assertEqual(offer.draft.storeId, 'aldi', 'Markt bleibt am Angebot');
assertEqual(offer.draft.amounts[0], '1 l', 'kurze Menge vom Angebot bleibt');

var offerLines = [{
  id: 'm2',
  name: offer.draft.name,
  amounts: offer.draft.amounts.slice(),
  price: offer.draft.price,
  storeId: offer.draft.storeId,
  storeName: offer.draft.storeName
}];
assert(shop.offerListed(offerLines, [], 'aldi', 'haferdrink'), 'Knopf erkennt die Zeile');
var offerAgain = shop.addOffer(offerLines, [], {
  name: 'Haferdrink',
  price: '0.99',
  amount: '1 l',
  storeId: 'aldi',
  storeName: 'Aldi Süd',
  now: 40
});
assert(offerAgain.removed && !offerAgain.created, 'zweiter Tipp nimmt das Angebot von der Liste');
assert(offerAgain.lines[0].deleted, 'die Zeile wird zum Grabstein');
assertEqual(offerAgain.lines[0].rev, 40, 'Grabstein bekommt eine neue Zeit');
assert(!offerLines[0].deleted, 'die ursprüngliche Zeile bleibt unverändert');
assert(!shop.offerListed(offerAgain.lines, [], 'aldi', 'Haferdrink'), 'Knopf ist nach dem Abwählen aus');

var otherStore = shop.addOffer(offerLines, [], {
  name: 'Haferdrink',
  price: '1.09',
  amount: '',
  storeId: 'lidl',
  storeName: 'Lidl'
});
assert(otherStore.created, 'derselbe Name in einem anderen Markt ist eine eigene Zeile');
assert(!shop.offerListed(offerLines, [], 'lidl', 'Haferdrink'), 'der andere Markt ist noch nicht markiert');

var generic = [{ id: 'm3', name: 'Milch', amounts: ['1 l'], price: '', storeId: '', storeName: '' }];
var enrich = shop.addOffer(generic, [], {
  name: 'Milch',
  price: '1.19',
  amount: '',
  storeId: 'penny',
  storeName: 'Penny'
});
assert(enrich.already && enrich.enriched, 'Angebot ergänzt die Zeile ohne Markt');
assertEqual(enrich.lines[0].storeId, 'penny', 'Markt wird nachgetragen');
assertEqual(enrich.lines[0].price, '1.19', 'Preis wird nachgetragen');
assertEqual(generic[0].storeId, '', 'die ursprüngliche Zeile bleibt unverändert');

var blocked = shop.addOffer([], plan, { name: 'Paprika', price: '1.49', storeId: 'lidl', storeName: 'Lidl' });
assert(blocked.already && !blocked.created, 'Angebot mit dem Namen einer Zutat legt keine zweite Zeile an');
assert(!shop.offerListed([], plan, 'lidl', 'Paprika'), 'Zutat aus dem Gericht zählt den Knopf nicht als an');

var paprikaLines = [
  { id: 'm5', name: 'Paprika', amounts: [], price: '1.49', storeId: 'lidl', storeName: 'Lidl', rev: 1, deleted: false },
  { id: 'm6', name: 'Paprika', amounts: [], price: '1.29', storeId: 'aldi', storeName: 'Aldi Süd', rev: 2, deleted: false }
];
assert(shop.offerListed(paprikaLines, plan, 'lidl', 'Paprika'), 'eigene Zeile macht den Knopf an');
var offPaprika = shop.addOffer(paprikaLines, plan, {
  name: 'Paprika',
  price: '1.49',
  storeId: 'lidl',
  storeName: 'Lidl',
  now: 90
});
assert(offPaprika.removed, 'zweiter Tipp nimmt nur die Angebotszeile weg');
assert(offPaprika.lines[0].deleted && offPaprika.lines[0].rev === 90, 'Lidl-Zeile wird zum Grabstein');
assert(!offPaprika.lines[1].deleted && offPaprika.lines[1].storeId === 'aldi', 'dieselbe Bezeichnung im anderen Markt bleibt');
assert(!paprikaLines[0].deleted && !paprikaLines[1].deleted, 'die Ausgangszeilen bleiben unverändert');
assert(!shop.offerListed(offPaprika.lines, plan, 'lidl', 'Paprika'), 'nach dem Abwählen zählt die Zutat nicht');
assert(shop.offerListed(offPaprika.lines, plan, 'aldi', 'Paprika'), 'der andere Markt bleibt markiert');
assertEqual(plan[0].name, 'Paprika', 'die Zutat aus dem Gericht bleibt auf dem Plan');

var checked = shop.toggleChecked([], shop.planCheckKey('paprika'));
assertEqual(checked[0], 'plan:paprika', 'Haken setzt die Zutat');
var open = shop.toggleChecked(checked, 'plan:paprika');
assertEqual(open.length, 0, 'zweiter Tipp nimmt den Haken weg');

var saved = shop.shopFromSaved({
  lines: [
    { id: 'm1', name: ' Salz ', amounts: ['1 Pkg'], price: '', storeId: '', storeName: '' },
    { id: 'm1', name: 'Doppelt', amounts: [], price: '', storeId: '', storeName: '' },
    { name: 'Ohne Id', amounts: [] },
    null
  ],
  checked: ['line:m1', 'line:weg', 'plan:reis', 'plan:reis', 'kaputt', ''],
  extraAmounts: { reis: ['1 kg', '1 kg', ''] }
}, false);
assertEqual(saved.lines.length, 1, 'ungültige Zeilen fallen weg');
assertEqual(saved.lines[0].name, 'Salz', 'gespeicherter Name wird beschnitten');
assertEqual(saved.checked.join(','), 'line:m1,plan:reis', 'nur gültige Haken bleiben');
assertEqual(saved.extraAmounts.reis.length, 1, 'doppelte Zusatzmenge fällt weg');

['Raubling', 'Brannenburg', 'Bad Aibling', 'Bad Feilnbach', 'Oberaudorf'].forEach(function (town) {
  var branched = shop.shopFromSaved({
    lines: [{ id: 'm9', name: 'Butter', amounts: ['20 g'], price: '', storeId: 'prechtl', storeName: 'Prechtl ' + town }],
    checked: ['line:m9', 'plan:hackfleisch']
  }, false);
  assertEqual(branched.lines[0].storeName, 'Prechtl', 'Filiale ' + town + ' fällt vom Kettennamen');
  assertEqual(branched.lines[0].storeId, 'prechtl', 'die Kette bleibt bei ' + town);
  assertEqual(branched.checked.join(','), 'line:m9,plan:hackfleisch', 'Haken bleiben trotz alter Filiale');
});

var plainChain = shop.shopFromSaved({
  lines: [{ id: 'm8', name: 'Äpfel', amounts: ['2'], price: '', storeId: 'penny', storeName: 'Penny' }],
  checked: ['line:m8']
}, false);
assertEqual(plainChain.lines[0].storeName, 'Penny', 'Kettenname ohne Ort bleibt');

var rolled = shop.shopFromSaved({
  lines: [{ id: 'm1', name: 'Salz', amounts: [], price: '', storeId: '', storeName: '' }],
  checked: ['line:m1', 'plan:reis']
}, true);
assertEqual(rolled.lines.length, 0, 'neue Woche leert die Zeilen');
assertEqual(rolled.checked.length, 0, 'neue Woche leert die Haken');

var text = shop.listText([
  { label: 'Penny', items: [{ name: 'Äpfel', detail: '2', checked: false }, { name: 'Brot', detail: '', checked: true }] }
]);
assert(text.indexOf('Penny\n- Äpfel 2') === 0, 'offene Zeile steht oben');
assert(text.indexOf('Im Wagen\nPenny\n- Brot') !== -1, 'Haken stehen unter Im Wagen');

var hidden = shop.withoutSkipped({
  offers: [{ id: 'penny', label: 'Penny', items: [{ id: 'apfel', name: 'Apfel' }, { id: 'brot', name: 'Brot' }] }],
  missing: [{ id: 'milch', name: 'Milch' }]
}, ['apfel']);
assertEqual(hidden.offers[0].items.length, 1, 'weggelassene Zutat fällt aus dem Angebot');
assertEqual(hidden.offers[0].items[0].id, 'brot', 'die andere Zutat bleibt');
assertEqual(hidden.missing.length, 1, 'fehlende Zutat bleibt, solange sie nicht weggelassen ist');

var trip = shop.finishTrip({
  lines: [{ id: 'm1', name: 'Öl', amounts: ['1 Fl'], price: '', storeId: '', storeName: '', addedBy: 'Alex', rev: 1, deleted: false }],
  checked: ['plan:eier', 'line:m1', 'plan:hackfleisch'],
  pantry: [],
  skipped: [],
  planItems: [{ id: 'eier', name: 'Eier' }, { id: 'hackfleisch', name: 'Hackfleisch' }],
  pantryItems: [{ id: 'eier', name: 'Eier' }, { id: 'oel', name: 'Öl' }],
  now: 20
});
assertEqual(trip.bought, 3, 'drei abgehakte Artikel sind gekauft');
assert(trip.pantry.indexOf('eier') !== -1, 'abgehakte Grundzutat ist zu Hause');
assert(trip.pantry.indexOf('oel') !== -1, 'abgehakte eigene Grundzutat ist zu Hause');
assert(trip.pantry.indexOf('hackfleisch') === -1, 'Fleisch ist keine Grundzutat');
assert(trip.skipped.indexOf('eier') !== -1 && trip.skipped.indexOf('hackfleisch') !== -1, 'gekaufte Zutaten bleiben diese Woche weg');
assert(trip.lines[0].deleted, 'eigene Zeile im Wagen wird geleert');
assertEqual(trip.checked.length, 0, 'der Wagen ist leer');

var openLine = shop.finishTrip({
  lines: [{ id: 'm2', name: 'Salz', amounts: [], price: '', storeId: '', storeName: '' }],
  checked: [],
  pantry: ['salz'],
  skipped: [],
  planItems: [],
  pantryItems: [{ id: 'salz', name: 'Salz' }],
  now: 1
});
assertEqual(openLine.bought, 0, 'ohne Haken bleibt der Einkauf offen');
assert(!openLine.lines[0].deleted, 'offene Zeile bleibt stehen');

var marked = shop.applyCheck([], {}, 'plan:reis', 'Alex', 8);
assertEqual(marked.checked[0], 'plan:reis', 'Haken merkt die Zeile');
assertEqual(marked.checkMeta['plan:reis'].by, 'Alex', 'Haken merkt die Person');
var cleared = shop.applyCheck(marked.checked, marked.checkMeta, 'plan:reis', 'Sam', 9);
assertEqual(cleared.checked.length, 0, 'zweiter Tipp nimmt den Haken weg');
assert(!cleared.checkMeta['plan:reis'].on && cleared.checkMeta['plan:reis'].rev === 9, 'das Zurücknehmen bleibt mit neuerer Zeit');

var claimed = shop.setClaim([], 'prechtl', 'Alex', true, 4);
assertEqual(shop.claimFor(claimed, 'prechtl').by, 'Alex', 'Markt ist beansprucht');
var released = shop.setClaim(claimed, 'prechtl', 'Alex', false, 5);
assertEqual(shop.claimFor(released, 'prechtl'), null, 'freigegebener Markt ist offen');

var staple = shop.addStaple([], 'Kaffee', '1 Pkg', 3);
assert(staple.created, 'fester Artikel wird angelegt');
var stapleLines = [{ id: shop.nextStapleId([]), name: staple.draft.name, amount: staple.draft.amount, rev: 3, deleted: false }];
var stapleAgain = shop.addStaple(stapleLines, 'kaffee', '1 Pkg', 4);
assert(stapleAgain.already, 'derselbe feste Artikel bleibt eine Zeile');

function mini(name) {
  return {
    lines: [{ id: 'm1', name: name, amounts: [], price: '', storeId: '', storeName: '', rev: 1, deleted: false }]
  };
}

var history = shop.emptyHistory();
for (var step = 0; step < shop.HISTORY_CAP + 1; step += 1) {
  history = shop.pushHistory(history, mini('n' + step));
}
assertEqual(history.undo.length, shop.HISTORY_CAP, 'Verlauf hält etwa 30 Stände');
assertEqual(history.redo.length, 0, 'ein neuer Schritt leert Wiederholen');
var undone = shop.undoHistory(history, mini('jetzt'));
assertEqual(undone.state.lines[0].name, 'n' + shop.HISTORY_CAP, 'Rückgängig holt den letzten Stand');
assertEqual(undone.history.redo[0].lines[0].name, 'jetzt', 'Wiederholen merkt den aktuellen Stand');
assertEqual(undone.history.undo.length, shop.HISTORY_CAP - 1, 'Rückgängig ist selbst kein weiterer Schritt');
var redone = shop.redoHistory(undone.history, undone.state);
assertEqual(redone.state.lines[0].name, 'jetzt', 'Wiederholen stellt den neueren Stand her');
var branched = shop.pushHistory(undone.history, undone.state);
assertEqual(branched.redo.length, 0, 'ein neuer Schritt nach Rückgängig leert Wiederholen');
var walk = history;
var current = mini('jetzt');
var oldest = null;
for (var back = 0; back < shop.HISTORY_CAP + 5; back += 1) {
  var next = shop.undoHistory(walk, current);
  if (!next.state) break;
  oldest = next.state;
  current = next.state;
  walk = next.history;
}
assertEqual(oldest.lines[0].name, 'n1', 'der älteste Stand fällt aus dem Verlauf');
var none = shop.undoHistory(shop.emptyHistory(), mini('x'));
assertEqual(none.state, null, 'ohne Verlauf bleibt Rückgängig leer');
assertEqual(shop.redoHistory(shop.emptyHistory(), mini('x')).state, null, 'ohne Verlauf bleibt Wiederholen leer');

var live = mini('Milch');
live.pantry = ['salz'];
var keptHistory = shop.pushHistory(shop.emptyHistory(), live);
live.lines[0].name = 'Brot';
live.pantry.push('mehl');
var copied = shop.undoHistory(keptHistory, mini('anders'));
assertEqual(copied.state.lines[0].name, 'Milch', 'der Verlauf speichert eine Kopie der Zeile');
assertEqual(copied.state.pantry.join(','), 'salz', 'der Verlauf speichert eine Kopie vom Vorrat');

var withStock = mini('Milch');
withStock.inventory = [{ id: 'v1', name: 'Reis', amount: '500 g', rev: 1, deleted: false }];
var stockHistory = shop.pushHistory(shop.emptyHistory(), withStock);
withStock.inventory[0].amount = '1 kg';
withStock.inventory.push({ id: 'v2', name: 'Kaffee', amount: '', rev: 2, deleted: false });
var stockUndo = shop.undoHistory(stockHistory, mini('anders'));
assertEqual(stockUndo.state.inventory.length, 1, 'der Verlauf speichert den Vorrat mit');
assertEqual(stockUndo.state.inventory[0].amount, '500 g', 'der Vorrat im Verlauf ist eine Kopie');

var week = {
  lines: [
    { id: 'm1', name: 'Milch', amounts: ['1'], price: '', storeId: '', storeName: '', rev: 1, deleted: false },
    { id: 'm2', name: 'Alt', amounts: [], price: '', storeId: '', storeName: '', rev: 1, deleted: true }
  ],
  checked: ['line:m1', 'plan:reis'],
  checkMeta: {
    'line:m1': { on: true, by: 'Alex', rev: 1 },
    'plan:reis': { on: true, by: 'Alex', rev: 2 }
  },
  skipped: ['nudeln'],
  skippedLog: { nudeln: { on: true, rev: 1 } },
  extraAmounts: { reis: ['1 kg'] },
  picked: ['bolognese'],
  pickedRev: 3,
  evenings: [{ day: 'mo', recipeId: 'bolognese', cook: 'Alex', rev: 4 }],
  pantry: ['salz'],
  staples: [{ id: 's1', name: 'Kaffee', amount: '1', rev: 1, deleted: false }]
};
var cleared = shop.clearList(week, 50);
assert(cleared.lines[0].deleted && cleared.lines[0].rev === 50, 'lebende Zeile wird zum Grabstein');
assert(cleared.lines[1].deleted && cleared.lines[1].rev === 1, 'alter Grabstein behält die Zeit');
assert(!week.lines[0].deleted, 'die ursprüngliche Zeile bleibt unangetastet');
assertEqual(cleared.checked.length, 0, 'Haken sind leer');
assert(!cleared.checkMeta['plan:reis'].on && cleared.checkMeta['plan:reis'].rev === 50, 'Haken bleiben als aus');
assertEqual(cleared.skipped.length, 0, 'weggelassene Zutaten sind weg');
assert(!cleared.skippedLog.nudeln.on && cleared.skippedLog.nudeln.rev === 50, 'Weglassen bleibt als aus');
assertEqual(Object.keys(cleared.extraAmounts).length, 0, 'zusätzliche Mengen sind leer');
assert(Array.isArray(cleared.picked) && cleared.picked.length === 0, 'Auswahl ist ein leeres Feld');
assertEqual(cleared.pickedRev, 50, 'Auswahl hat eine neue Zeit');
assertEqual(cleared.evenings.length, 7, 'die Abende der Woche sind geleert');
assert(cleared.evenings.every(function (row) {
  return row.recipeId === '' && row.cook === '' && row.rev === 50;
}), 'kein Gericht und kein Koch bleibt an einem Abend');
assertEqual(week.pantry[0], 'salz', 'Vorrat bleibt');
assert(!week.staples[0].deleted && week.staples[0].name === 'Kaffee', 'feste Artikel bleiben');
var beforeClear = shop.pushHistory(shop.emptyHistory(), week);
var afterClear = {
  lines: cleared.lines,
  checked: cleared.checked,
  checkMeta: cleared.checkMeta,
  skipped: cleared.skipped,
  skippedLog: cleared.skippedLog,
  extraAmounts: cleared.extraAmounts,
  picked: cleared.picked,
  pickedRev: cleared.pickedRev,
  evenings: cleared.evenings,
  pantry: week.pantry,
  staples: week.staples
};
var restored = shop.undoHistory(beforeClear, afterClear);
assert(!restored.state.lines[0].deleted, 'Rückgängig holt die Zeile zurück');
assertEqual(restored.state.picked[0], 'bolognese', 'Rückgängig holt das Gericht zurück');
assertEqual(restored.state.evenings[0].recipeId, 'bolognese', 'Rückgängig holt den Abend zurück');
var clearedAgain = shop.redoHistory(restored.history, restored.state);
assert(clearedAgain.state.lines[0].deleted, 'Wiederholen leert die Zeile wieder');
assertEqual(clearedAgain.state.picked.length, 0, 'Wiederholen lässt die Auswahl leer');

console.log('shop.test.js: ok');
