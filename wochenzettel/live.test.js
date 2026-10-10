const live = require('./live.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

assertEqual(live.priceText('1,29'), '1.29', 'Komma wird zum Preis');
assertEqual(live.priceText(4.949999809265137), '4.95', 'Preis wird auf Cent gerundet');
assertEqual(live.priceText(0), '', 'Null ist kein Preis');
assertEqual(live.priceText(''), '', 'leerer Preis bleibt leer');
assertEqual(live.aldiPrice({ amountRelevant: 39 }), '0.39', 'Aldi nennt den Preis in Cent');

assertEqual(live.pennyWeek(new Date('2026-10-10T12:00:00+02:00')), '2026-41', 'Penny-Woche 41');
assertEqual(live.pennyWeek(new Date('2026-10-12T12:00:00+02:00')), '2026-42', 'ab Montag ist Woche 42');

var flyers = [
  {
    name: 'Aktionsprospekt',
    offerStartDate: '2026-10-12',
    offerEndDate: '2026-10-17',
    flyerUrlAbsolute: 'https://www.lidl.de/l/prospekte/aktionsprospekt-12-10-2026-17-10-2026-267832/ar/0?lf=HHZ'
  },
  {
    name: 'Aktionsprospekt',
    offerStartDate: '2026-10-05',
    offerEndDate: '2026-10-10',
    flyerUrlAbsolute: 'https://www.lidl.de/l/prospekte/aktionsprospekt-05-10-2026-10-10-2026-7ad9f3/ar/0?lf=HHZ'
  },
  {
    name: 'Deine Lidl Plus Vorteile',
    offerStartDate: '2026-08-28',
    offerEndDate: '2050-08-28',
    flyerUrlAbsolute: 'https://www.lidl.de/l/prospekte/plus/ar/0'
  }
];
var current = live.pickLidlFlyer(flyers, '2026-10-10');
assert(current && current.flyerUrlAbsolute.indexOf('7ad9f3') !== -1, 'heute gilt der laufende Aktionsprospekt');
assert(live.pickLidlFlyer(flyers, '2026-10-11') == null, 'am Sonntag wird nicht das Heft der nächsten Woche genommen');
assert(live.pickLidlFlyer(flyers, '2026-10-12').flyerUrlAbsolute.indexOf('267832') !== -1, 'ab Montag gilt das neue Heft');

var categories = live.pennyCategoriesFromHtml(
  '<button data-category-id="ab-montag--fleisch-und-wurst" data-week="current"></button>' +
  '<button data-category-id="ab-montag--naechste-woche" data-week="next"></button>'
);
assertEqual(categories.join(','), 'fleisch-und-wurst', 'Penny nimmt nur die laufende Woche');

var html = '<script id="__NEXT_DATA__" type="application/json">{"brochures":[{' +
  '"id":"5fda2d89-77ec-4538-8adb-957a4fcd58ca","title":"Aktuelle Angebote","publisher":{"name":"dm-drogerie markt"},' +
  '"validFrom":"2026-10-01T00:00:00.000+0200","validUntil":"2026-10-15T23:00:00.000+0200","type":"DYNAMIC"},' +
  '{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","title":"Adventskalender","publisher":{"name":"Rossmann"},' +
  '"validFrom":"2026-09-13T00:00:00.000+0200","validUntil":"2026-10-11T23:00:00.000+0200"}]}</script>';
var brochures = live.brochuresFromHtml(html);
assertEqual(brochures.length, 2, 'Prospekte aus der Seite');
assert(live.coversDay(brochures[0].validFrom, brochures[0].validUntil, '2026-10-10'), 'dm gilt heute');
assert(!live.coversDay('2026-10-12', '2026-10-17', '2026-10-10'), 'das nächste Heft gilt noch nicht');

var base = {
  weekKey: '2026-W41',
  validFrom: '2026-10-05',
  validUntil: '2026-10-10',
  extractedAt: '2026-10-05',
  stores: [
    { id: 'lidl', name: 'Lidl', source: 'alt', note: 'alt', otherCount: 3, offers: [{ name: 'Alt', price: '1.00', amount: '' }] },
    { id: 'penny', name: 'Penny', source: 'alt', note: 'alt', otherCount: 0, offers: [{ name: 'Alt', price: '1.00', amount: '' }] }
  ],
  unavailable: [{ id: 'rewe', name: 'REWE', reason: 'bleibt' }]
};
var kept = live.applyReads(base, [{ ok: false, id: 'lidl' }], new Date('2026-10-10T12:00:00+02:00'));
assertEqual(kept.changed, false, 'ein Fehlschlag lässt den Markt stehen');
assertEqual(kept.catalog.stores[0].offers[0].name, 'Alt', 'der alte Lidl-Artikel bleibt');
assertEqual(kept.catalog.unavailable[0].id, 'rewe', 'REWE bleibt außen vor');

var updated = live.applyReads(base, [{
  ok: true,
  id: 'lidl',
  offers: [{ name: 'Neu', price: '2.00', amount: '' }],
  note: 'neu',
  source: 'https://example.test/lidl',
  otherCount: 0,
  validFrom: '2026-10-12',
  validUntil: '2026-10-17'
}], new Date('2026-10-12T12:00:00+02:00'));
assertEqual(updated.changed, true, 'ein gelesenes Heft ersetzt den Markt');
assertEqual(updated.catalog.stores[0].offers[0].name, 'Neu', 'der neue Artikel steht');
assertEqual(updated.catalog.stores[1].offers[0].name, 'Alt', 'Penny bleibt, wenn Penny nicht gelesen wurde');
assertEqual(updated.catalog.validUntil, '2026-10-17', 'das Gültig-bis folgt dem gelesenen Heft');
assertEqual(updated.catalog.weekKey, '2026-W42', 'die Woche springt mit');

var empty = live.applyReads(base, [{ ok: true, id: 'lidl', offers: [] }], new Date('2026-10-10T12:00:00+02:00'));
assertEqual(empty.catalog.stores[0].offers.length, 1, 'eine leere Lesung löscht die Liste nicht');

var fuller = {
  weekKey: '2026-W41',
  validFrom: '2026-10-05',
  validUntil: '2026-10-10',
  extractedAt: '2026-10-05',
  stores: [{
    id: 'lidl',
    name: 'Lidl',
    source: 'https://www.lidl.de/l/prospekte/aktionsprospekt-05-10-2026-10-10-2026-7ad9f3/view/flyer/page/1',
    note: 'von Hand',
    otherCount: 4,
    offers: [{ name: 'Alt', price: '1.00', amount: '' }, { name: 'Noch einer', price: '2.00', amount: '' }]
  }],
  unavailable: []
};
var sameHeft = live.applyReads(fuller, [{
  ok: true,
  id: 'lidl',
  revision: 'aktionsprospekt-05-10-2026-10-10-2026-7ad9f3',
  offers: [{ name: 'Kürzer', price: '3.00', amount: '' }],
  note: 'automatisch',
  source: 'https://www.lidl.de/l/prospekte/aktionsprospekt-05-10-2026-10-10-2026-7ad9f3/ar/0',
  validFrom: '2026-10-05',
  validUntil: '2026-10-10'
}], new Date('2026-10-10T12:00:00+02:00'));
assertEqual(sameHeft.changed, false, 'dasselbe Heft behält die längere Liste');
assertEqual(sameHeft.catalog.stores[0].offers.length, 2, 'die handgelesenen Artikel bleiben');

var nextHeft = live.applyReads(fuller, [{
  ok: true,
  id: 'lidl',
  revision: 'aktionsprospekt-12-10-2026-17-10-2026-267832',
  offers: [{ name: 'Neu', price: '3.00', amount: '' }],
  note: 'neue Woche',
  source: 'https://www.lidl.de/l/prospekte/aktionsprospekt-12-10-2026-17-10-2026-267832/ar/0',
  validFrom: '2026-10-12',
  validUntil: '2026-10-17'
}], new Date('2026-10-12T12:00:00+02:00'));
assertEqual(nextHeft.changed, true, 'ein neues Heft ersetzt die Liste');
assertEqual(nextHeft.catalog.stores[0].offers[0].name, 'Neu', 'der Artikel der neuen Woche steht');

console.log('live tests ok');
