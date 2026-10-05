const meals = require('./meals.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

assertEqual(meals.MARKETS.length, 5, 'fünf Prechtl-Märkte');
assertEqual(meals.marketById('oberaudorf').name, 'Oberaudorf', 'Marktname');
assertEqual(meals.marketById('fehlt').id, 'raubling', 'unbekannter Markt fällt auf Raubling');
assert(meals.RECIPES.length >= 16, 'genug Rezepte für eine Woche');
assert(meals.defaultPantry().indexOf('nudeln') !== -1, 'Nudeln gelten als zu Hause');
assert(meals.defaultPantry().indexOf('eier') !== -1, 'Eier gelten als zu Hause');
assert(meals.defaultPantry().indexOf('reis') !== -1, 'Reis gilt als zu Hause');

var monday = new Date(2026, 9, 5);
var sunday = new Date(2026, 9, 4);
assertEqual(meals.weekKey(monday), meals.weekKey(new Date(2026, 9, 11)), 'Montag und Sonntag derselben Woche');
assert(meals.weekKey(monday) !== meals.weekKey(sunday), 'der Vortag ist die vorige Woche');

var rolled = meals.normalizeState({
  marketId: 'bad-aibling',
  weekKey: meals.weekKey(sunday),
  offers: ['hackfleisch', 'paprika'],
  pantry: ['zwiebel'],
  picked: ['bolognese']
}, monday);
assert(rolled.weekChanged, 'neue Woche wird erkannt');
assertEqual(rolled.state.offers.length, 0, 'Angebote der alten Woche fallen weg');
assertEqual(rolled.state.marketId, 'bad-aibling', 'der Markt bleibt');
assertEqual(rolled.state.pantry[0], 'zwiebel', 'Vorrat bleibt');
assertEqual(rolled.state.picked, null, 'Auswahl der alten Woche fällt weg');

var kept = meals.normalizeState({
  marketId: 'raubling',
  weekKey: meals.weekKey(monday),
  offers: ['hackfleisch', 'unbekannt'],
  pantry: [],
  picked: []
}, monday);
assert(!kept.weekChanged, 'dieselbe Woche bleibt');
assertEqual(kept.state.offers.length, 1, 'nur bekannte Angebote bleiben');
assertEqual(kept.state.pantry.length, 0, 'leerer Vorrat bleibt leer');
assertEqual(kept.state.picked.length, 0, 'leere Auswahl bleibt leer');

assertEqual(meals.suggest([], meals.defaultPantry()).length, 0, 'ohne Angebot kein Vorschlag');

var ideas = meals.suggest(['hackfleisch', 'paprika'], meals.defaultPantry());
assert(ideas.length > 0, 'Angebote ergeben Essen');
assert(ideas[0].hits.length >= ideas[ideas.length - 1].hits.length, 'mehr Angebote stehen oben');
var pfanne = null;
ideas.forEach(function (recipe) {
  if (recipe.id === 'hackpfanne') pfanne = recipe;
});
assert(pfanne, 'Hackpfanne nutzt beide Angebote');
assertEqual(pfanne.hits.length, 2, 'Hackfleisch und Paprika zählen');
var missingIds = pfanne.missing.map(function (item) { return item.id; });
assert(missingIds.indexOf('reis') === -1, 'Reis aus dem Vorrat fehlt nicht auf dem Zettel');
assert(missingIds.indexOf('zwiebel') === -1, 'Zwiebeln aus dem Vorrat fehlen nicht');

var bare = meals.suggest(['hackfleisch', 'paprika'], []);
var barePfanne = null;
bare.forEach(function (recipe) {
  if (recipe.id === 'hackpfanne') barePfanne = recipe;
});
assert(barePfanne.missing.some(function (item) { return item.id === 'reis'; }), 'ohne Vorrat kommt Reis auf den Zettel');

var typed = meals.matchOfferText('Hackfleisch und Paprika, 2.99');
assert(typed.indexOf('hackfleisch') !== -1, 'Hackfleisch wird erkannt');
assert(typed.indexOf('paprika') !== -1, 'Paprika wird erkannt');
assertEqual(meals.matchOfferText('Salz').length, 0, 'Vorrat ohne Angebot wird nicht als Angebot erkannt');
assert(meals.matchOfferText('Gemischtes Hackfleisch').indexOf('hackfleisch') !== -1, 'Gemischtes Hackfleisch zählt');
assert(meals.matchOfferText('Hähnchen-Unterkeulen').indexOf('haehnchen') !== -1, 'Hähnchen-Unterkeulen zählen');
assert(meals.matchOfferText('Seelachsfilet').indexOf('fisch') !== -1, 'Seelachs ist Fisch');
assert(meals.matchOfferText('Seelachsfilet').indexOf('lachs') === -1, 'Seelachs ist kein Lachs');
assert(meals.matchOfferText('Lamm Lachse').indexOf('lachs') === -1, 'Lamm Lachse ist kein Lachs');
assert(meals.matchOfferText('Rinder Gulasch').indexOf('gulasch') !== -1, 'Gulasch wird erkannt');
assert(meals.matchOfferText('Rinder Gulasch').indexOf('hackfleisch') === -1, 'Rinder Gulasch ist kein Hackfleisch');
assert(meals.matchOfferText('schwarze Tomaten').indexOf('passata') === -1, 'frische Tomaten sind keine Passata');
assert(meals.matchOfferText('Bio-Tomaten, passiert').indexOf('passata') !== -1, 'passierte Tomaten zählen');
assert(meals.matchOfferText('Meraner Weinkäse').indexOf('kaese') !== -1, 'Weinkäse zählt als Käse');
assert(meals.matchOfferText('Berchtesgadener Land Bergbauernmilch').indexOf('milch') !== -1, 'Bergbauernmilch zählt');
assert(meals.matchOfferText('ZOTT Sahnejoghurt').indexOf('joghurt') !== -1, 'Sahnejoghurt ist Joghurt');
assert(meals.matchOfferText('ZOTT Sahnejoghurt').indexOf('sahne') === -1, 'Sahnejoghurt ist keine Sahne');
assert(meals.matchOfferText('BARILLA Pastasauce').indexOf('nudeln') === -1, 'Pastasauce ist keine Pasta');
assert(meals.matchOfferText('Reisnudeln').indexOf('reis') === -1, 'Reisnudeln sind kein Reis');
assert(meals.matchOfferText('Expressreis').indexOf('reis') !== -1, 'Expressreis zählt als Reis');
assert(meals.matchOfferText('Schoko-Reis Tafel').indexOf('reis') === -1, 'Schoko-Reis ist kein Kochreis');
assert(meals.matchOfferText('Apfelsaft').indexOf('aepfel') === -1, 'Apfelsaft sind keine Äpfel');
assert(meals.matchOfferText('Leberkäse').indexOf('kaese') === -1, 'Leberkäse ist kein Käse');
assert(meals.matchOfferText('Salat mit Rinderfiletstreifen').indexOf('salat') === -1, 'fertiger Salat ist kein Kopfsalat');
assert(meals.matchOfferText('Feldsalat').indexOf('salat') !== -1, 'Feldsalat zählt');
assert(meals.matchOfferText('Fischthekensalat').indexOf('salat') === -1, 'Fischthekensalat ist kein Kopfsalat');

var list = meals.shoppingList(ideas, null);
assert(Array.isArray(list), 'Einkaufsliste ist eine Liste');
var chosen = meals.chosenIds(ideas, null);
assert(chosen.length > 0 && chosen.length <= 3, 'ohne Auswahl gelten die ersten drei');
assertEqual(meals.chosenIds(ideas, []).length, 0, 'abgewählte Liste bleibt leer');

var both = meals.suggest(['hackfleisch', 'bohnen', 'mais', 'passata'], []);
var chili = null;
both.forEach(function (recipe) { if (recipe.id === 'chili') chili = recipe; });
assert(chili && chili.hits.length >= 3, 'Chili sammelt mehrere Angebote');

var planned = meals.shopPlan([{
  id: 'kombi',
  title: 'Kombi',
  hits: [
    { id: 'hackfleisch', name: 'Hackfleisch', amount: '300 g' },
    { id: 'fisch', name: 'Fischfilet', amount: '2' },
    { id: 'kaese', name: 'Käse', amount: '80 g' }
  ],
  missing: [{ id: 'sahne', name: 'Sahne', amount: '200 ml' }]
}], ['kombi'], [
  { id: 'aldi', name: 'Aldi Süd', offers: ['hackfleisch', 'kaese'] },
  { id: 'prechtl', name: 'Prechtl', offers: ['fisch', 'kaese'] }
]);
function plannedItem(id) {
  var found = null;
  planned.offers.forEach(function (group) {
    group.items.forEach(function (item) {
      if (item.id === id) found = { label: group.label, item: item };
    });
  });
  return found;
}
assertEqual(plannedItem('hackfleisch').label, 'Aldi Süd', 'Hackfleisch liegt bei Aldi');
assertEqual(plannedItem('fisch').label, 'Prechtl', 'Fisch liegt bei Prechtl');
assertEqual(plannedItem('kaese').label, 'Aldi Süd oder Prechtl', 'Käse gibt es in beiden Märkten');
assertEqual(planned.missing.length, 1, 'Sahne bleibt übrig');
assertEqual(planned.missing[0].id, 'sahne', 'die fehlende Zutat ist Sahne');

console.log('meals tests ok');
