const ticker = require('./ticker.js');
const offers = require('../wochenessen/offers.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

var stores = [
  {
    id: 'penny',
    name: 'Penny',
    offers: [
      { name: 'BARILLA Pasta', price: '0.88', amount: 'je 500 g' },
      { name: 'BARILLA Pastasauce', price: '1.79', amount: 'je 400 g' },
      { name: 'De Cecco Pasta', price: '1.49', amount: 'je 500 g' },
      { name: 'Schoko-Reis Tafel', price: '1.11', amount: '' },
      { name: 'Expressreis', price: '0.99', amount: 'je 500 g' },
      { name: 'Leberkäse', price: '1.99', amount: '' }
    ]
  }
];

assert(ticker.queryMatchesOffer('Barilla Nudel', 'BARILLA Pasta'), 'Barilla Nudel trifft BARILLA Pasta');
assert(!ticker.queryMatchesOffer('Barilla Nudel', 'BARILLA Pastasauce'), 'Barilla Nudel ist keine Pastasauce');
assert(!ticker.queryMatchesOffer('Barilla Nudel', 'De Cecco Pasta'), 'ohne Barilla keine Erinnerung');
assert(ticker.queryMatchesOffer('Pasta', 'De Cecco Pasta'), 'Pasta trifft De Cecco');
assert(!ticker.queryMatchesOffer('Pasta', 'BARILLA Pastasauce'), 'Pasta ist keine Pastasauce');
assert(ticker.queryMatchesOffer('Barilla', 'BARILLA Pastasauce'), 'nur die Marke trifft auch die Sauce');
assert(!ticker.queryMatchesOffer('Reis', 'Schoko-Reis Tafel'), 'Schoko-Reis ist kein Kochreis');
assert(ticker.queryMatchesOffer('Reis', 'Expressreis'), 'Expressreis zählt als Reis');
assert(!ticker.queryMatchesOffer('Käse', 'Leberkäse'), 'Leberkäse ist kein Käse');
assertEqual(ticker.formatPrice('0.88'), '0,88 €', 'Preis mit Komma');

var added = ticker.addItem(ticker.blank(), '  Barilla Nudel  ', { id: 'barilla' });
assert(added.ok, 'Artikel lässt sich merken');
assertEqual(added.state.items[0].query, 'Barilla Nudel', 'Leerzeichen fallen weg');
assertEqual(added.state.items[0].id, 'barilla', 'Kennung bleibt');
var again = ticker.addItem(added.state, 'barilla nudeln');
assert(!again.ok, 'dieselbe Nudel steht nicht doppelt');
assertEqual(again.error, 'Steht schon auf dem Ticker.', 'Hinweis bei Doppelung');

var rows = ticker.reminders(added.state, stores);
assertEqual(rows.length, 1, 'ein gemerkter Artikel');
assertEqual(rows[0].hits.length, 1, 'nur die Pasta, nicht die Sauce');
assertEqual(rows[0].hits[0].storeName, 'Penny', 'Markt steht dabei');
assertEqual(rows[0].hits[0].name, 'BARILLA Pasta', 'Artikelname aus dem Angebot');
assertEqual(rows[0].hits[0].price, '0,88 €', 'Preis der Pasta');
assertEqual(rows[0].hits[0].amount, 'je 500 g', 'Menge der Pasta');

var removed = ticker.removeItem(added.state, 'barilla');
assert(removed.ok, 'Eintrag lässt sich entfernen');
assertEqual(removed.state.items.length, 0, 'Ticker ist danach leer');
assert(!ticker.removeItem(removed.state, 'barilla').ok, 'fehlender Eintrag bleibt ein Fehler');

assert(!ticker.addItem(ticker.blank(), '   ').ok, 'leerer Name bleibt draußen');
assert(!ticker.addItem(ticker.blank(), 'a').ok, 'zu kurzer Name bleibt draußen');
assert(!ticker.addItem(ticker.blank(), 'x'.repeat(81)).ok, 'zu langer Name bleibt draußen');

var full = ticker.blank();
for (var i = 0; i < 20; i += 1) {
  var filled = ticker.addItem(full, 'Name' + i, { id: 'a' + i });
  assert(filled.ok, 'Eintrag ' + i + ' passt noch');
  full = filled.state;
}
assert(!ticker.addItem(full, 'Nameextra').ok, 'der Ticker hat eine Obergrenze');

var messy = ticker.normalize({
  items: [
    { id: 'eins', query: 'Barilla Nudel' },
    { id: 'zwei', query: 'BARILLA Pasta' },
    { query: 'Haferflocken' },
    { id: 'leer', query: ' ' }
  ]
});
assertEqual(messy.items.length, 2, 'Synonym und Leeres fallen beim Lesen weg');
assertEqual(messy.items[0].query, 'Barilla Nudel', 'der erste Name bleibt');
assertEqual(messy.items[1].query, 'Haferflocken', 'anderer Artikel bleibt');

var penny = null;
offers.stores.forEach(function (store) {
  if (store.id === 'penny') penny = store;
});
var live = ticker.reminders(added.state, offers.stores);
assert(live[0].hits.some(function (hit) { return hit.name === 'BARILLA Pasta' && hit.storeName === 'Penny'; }), 'Penny führt BARILLA Pasta');
assert(!live[0].hits.some(function (hit) { return hit.name === 'BARILLA Pastasauce'; }), 'Pastasauce löst Barilla Nudel nicht aus');
assert(penny, 'Penny ist im Prospekt');

console.log('ticker tests ok');
