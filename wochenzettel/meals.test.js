const meals = require('./meals.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

assert(!meals.MARKETS && !meals.marketById, 'keine Filialauswahl');
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
assertEqual(rolled.state.marketId, undefined, 'gespeicherte Filiale wird ignoriert');
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
assertEqual(kept.state.marketId, undefined, 'Filiale der gleichen Woche wird ignoriert');

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
assertEqual(list.length, 0, 'ohne Auswahl bleibt die Einkaufsliste leer');
var chosen = meals.chosenIds(ideas, null);
assertEqual(chosen.length, 0, 'ohne Auswahl ist nichts ausgewählt');
assertEqual(meals.chosenIds(ideas, []).length, 0, 'abgewählte Liste bleibt leer');
var explicit = meals.chosenIds(ideas, [ideas[0].id, 'fehlt']);
assertEqual(explicit.length, 1, 'gespeicherte Auswahl bleibt');
assertEqual(explicit[0], ideas[0].id, 'das gewählte Gericht bleibt');
var bareList = meals.shoppingList(bare, null);
assertEqual(bareList.length, 0, 'null wird nicht zu den ersten Gerichten');
var pickedBare = meals.shoppingList(bare, ['hackpfanne']);
assert(pickedBare.some(function (item) { return item.id === 'reis'; }), 'gewähltes Gericht bringt seine Zutaten');
var emptyPlan = meals.shopPlan(ideas, null, []);
assertEqual(emptyPlan.offers.length, 0, 'ohne Auswahl keine Angebotsgruppen');
assertEqual(emptyPlan.missing.length, 0, 'ohne Auswahl keine fehlenden Zutaten');

var keptNull = meals.normalizeState({
  weekKey: meals.weekKey(monday),
  offers: ['hackfleisch'],
  pantry: [],
  picked: null
}, monday);
assertEqual(keptNull.state.picked, null, 'gespeichertes null bleibt leer und wird nicht aufgefüllt');

var keptPick = meals.normalizeState({
  weekKey: meals.weekKey(monday),
  offers: ['hackfleisch'],
  pantry: [],
  picked: ['hackpfanne', 'unbekannt']
}, monday);
assertEqual(keptPick.state.picked.join(','), 'hackpfanne', 'explizite Auswahl bleibt');

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
assert(plannedItem('fisch').label.indexOf('Raubling') === -1, 'Gruppenname nennt keine Filiale');
assertEqual(plannedItem('kaese').label, 'Aldi Süd oder Prechtl', 'Käse gibt es in beiden Ketten');
assertEqual(planned.missing.length, 1, 'Sahne bleibt übrig');
assertEqual(planned.missing[0].id, 'sahne', 'die fehlende Zutat ist Sahne');

assertEqual(meals.offerCategory('Schweine Schnitzel'), 'fleisch', 'Schnitzel ist Fleisch');
assertEqual(meals.offerCategory('Seelachsfilet'), 'fisch', 'Seelachs ist Fisch');
assertEqual(meals.offerCategory('Lamm Lachse'), 'fleisch', 'Lamm Lachse bleibt Fleisch');
assertEqual(meals.offerCategory('Äpfel, fein säuerlich'), 'gemuese', 'Äpfel sind Obst');
assertEqual(meals.offerCategory('Berchtesgadener Land Bergbauernmilch'), 'kuehl', 'Milch ist Kühlregal');
assertEqual(meals.offerCategory('De Cecco Pasta'), 'vorrat', 'Pasta ist Vorrat');
assertEqual(meals.offerCategory('Apfelsaft'), 'getraenke', 'Apfelsaft ist ein Getränk');
assertEqual(meals.offerCategory('Milka Schokolade'), 'suesses', 'Schokolade ist ein Snack');
assertEqual(meals.offerCategory('HAPPY END Küchentücher'), 'sonstiges', 'Küchentücher bleiben übrig');
assertEqual(meals.offerCategoryById('fehlt').id, 'alle', 'unbekannte Kategorie ist Alle');

var own = meals.suggest([], [], [{
  id: 'c1',
  custom: true,
  title: 'Eigene Suppe',
  minutes: 25,
  steps: ['Köcheln.'],
  ingredients: [{ id: 'nudeln', amount: '200 g' }, { id: 'zwiebel', amount: '1' }],
  rev: 1
}]);
assertEqual(own.length, 1, 'eigenes Gericht bleibt ohne Prospekt sichtbar');
assert(own[0].custom, 'eigenes Gericht ist markiert');
assertEqual(own[0].missing.length, 2, 'ohne Vorrat stehen beide Zutaten auf der Liste');

var evenings = meals.cleanEvenings([
  { day: 'mo', recipeId: 'c1', cook: 'Alex', rev: 2 },
  { day: 'mo', recipeId: 'alt', cook: 'Sam', rev: 1 },
  { day: 'xx', recipeId: 'c1', cook: 'Niemand', rev: 9 }
]);
assertEqual(evenings.length, 1, 'nur bekannte Tage bleiben');
assertEqual(evenings[0].cook, 'Alex', 'neuere Kochzeit gewinnt');

var stock = meals.addInventory([], 'Reis', '500 g', 2);
assert(stock.created, 'Reis wird eingetragen');
var stockRows = [{ id: meals.nextInventoryId(stock.inventory), name: stock.draft.name, amount: stock.draft.amount, rev: stock.draft.rev, deleted: false }];
assert(meals.coveredIds(stockRows).indexOf('reis') !== -1, 'Reis im Vorrat deckt die Zutat');
var homeIdeas = meals.suggest(['hackfleisch', 'paprika'], meals.coveredIds(stockRows));
var homePfanne = null;
homeIdeas.forEach(function (recipe) { if (recipe.id === 'hackpfanne') homePfanne = recipe; });
assert(homePfanne && homePfanne.missing.every(function (item) { return item.id !== 'reis'; }), 'gedeckter Reis bleibt vom Zettel');
var oil = meals.addInventory([], 'Olivenöl', '', 1);
var oilRows = [{ id: 'v1', name: oil.draft.name, amount: '', rev: 1, deleted: false }];
assert(meals.coveredIds(oilRows).indexOf('oel') !== -1, 'Olivenöl deckt Öl');
var coffee = meals.addInventory([], 'Kaffee', '1 Packung', 1);
assert(coffee.created, 'unbekannter Name bleibt ein Vorratseintrag');
assertEqual(meals.coveredIds([{ id: 'v1', name: 'Kaffee', amount: '1 Packung', rev: 1, deleted: false }]).length, 0, 'unbekannter Vorrat erfindet keine Zutat');
var mergedStock = meals.addInventory(stockRows, 'reis', '1 kg', 4);
assert(mergedStock.merged, 'derselbe Name wird zusammengeführt');
assertEqual(mergedStock.inventory.length, 1, 'aus Reis und reis wird eine Zeile');
assertEqual(mergedStock.inventory[0].amount, '1 kg', 'die neue Menge ersetzt die alte');
assertEqual(mergedStock.inventory[0].name, 'Reis', 'die erste Schreibweise bleibt');
var stepped = meals.stepInventory(stockRows, stockRows[0].id, 1, 6);
assert(stepped.ok, 'Menge lässt sich erhöhen');
assertEqual(stepped.inventory[0].amount, '600 g', 'ab 100 springt die Menge in Hundertern');
var back = meals.stepInventory(stepped.inventory, stockRows[0].id, -1, 7);
assertEqual(back.inventory[0].amount, '500 g', 'die Menge geht wieder zurück');
var counted = meals.stepInventory([{ id: 'v9', name: 'Kaffee', amount: '', units: 0, rev: 1, deleted: false }], 'v9', 1, 8);
assertEqual(counted.inventory[0].units, 1, 'ohne Mengenzahl zählt die Stückzahl');
assert(!meals.stepInventory(stockRows, 'v999', 1, 9).ok, 'unbekannte Zeile bleibt unverändert');
var blankName = meals.addInventory(stockRows, '   ', '1', 5);
assert(!blankName.ok && blankName.reason === 'empty', 'leerer Name wird abgelehnt');
var seeded = meals.ensureInventory(null, meals.defaultPantry());
meals.defaultPantry().forEach(function (id) {
  assert(meals.coveredIds(seeded).indexOf(id) !== -1, 'Startvorrat deckt ' + id);
});
var clearedStock = meals.ensureInventory({ inventorySet: true, inventory: [] }, meals.defaultPantry());
assertEqual(clearedStock.length, 0, 'geleerter Vorrat wird nicht wieder befüllt');

var catalogTitle = meals.RECIPES.filter(function (recipe) { return recipe.id === 'hackpfanne'; })[0].title;
var editedIdeas = meals.suggest(['hackfleisch', 'paprika'], [], [], [{
  id: 'hackpfanne',
  title: 'Schnelle Pfanne',
  minutes: 20,
  steps: ['Anbraten.', 'Fertig.'],
  ingredients: [
    { id: 'hackfleisch', amount: '300 g' },
    { id: 'paprika', amount: '1' },
    { id: 'salat', amount: '1 Kopf' }
  ],
  rev: 5
}]);
var editedPfanne = null;
editedIdeas.forEach(function (recipe) { if (recipe.id === 'hackpfanne') editedPfanne = recipe; });
assert(editedPfanne, 'das geänderte Gericht bleibt ein Vorschlag');
assertEqual(editedPfanne.title, 'Schnelle Pfanne', 'der Titel kommt aus der Änderung');
assert(editedPfanne.edited, 'die Änderung ist markiert');
assertEqual(editedPfanne.steps.join('|'), 'Anbraten.|Fertig.', 'die Schritte bleiben am Gericht');
assert(editedPfanne.missing.some(function (item) { return item.id === 'salat'; }), 'die neue Zutat fehlt auf dem Zettel');
assert(editedPfanne.missing.every(function (item) { return item.id !== 'reis'; }), 'weggelassener Reis kommt nicht auf den Zettel');
assertEqual(meals.RECIPES.filter(function (recipe) { return recipe.id === 'hackpfanne'; })[0].title, catalogTitle, 'der eingebaute Katalog bleibt');
var editedPlan = meals.shopPlan(editedIdeas, ['hackpfanne'], [
  { id: 'aldi', name: 'Aldi Süd', offers: ['hackfleisch', 'paprika'] }
]);
assert(editedPlan.missing.some(function (item) { return item.id === 'salat'; }), 'der Einkaufsplan folgt der geänderten Zutat');
assert(editedPlan.missing.every(function (item) { return item.id !== 'reis'; }), 'der Plan lässt die entfernte Zutat weg');
var editedOfferIds = [];
editedPlan.offers.forEach(function (group) {
  group.items.forEach(function (item) { editedOfferIds.push(item.id); });
});
assert(editedOfferIds.indexOf('hackfleisch') !== -1, 'Angebote nutzen die geänderten Zutaten');
assert(editedOfferIds.indexOf('reis') === -1, 'Reis ist kein Angebot mehr an diesem Gericht');
var restoredIdeas = meals.suggest(['hackfleisch', 'paprika'], [], [], meals.resetOverride([{
  id: 'hackpfanne',
  title: 'Schnelle Pfanne',
  minutes: 20,
  steps: ['Anbraten.'],
  ingredients: [
    { id: 'hackfleisch', amount: '300 g' },
    { id: 'salat', amount: '1' }
  ],
  rev: 5
}], 'hackpfanne', 9));
var restoredPfanne = null;
restoredIdeas.forEach(function (recipe) { if (recipe.id === 'hackpfanne') restoredPfanne = recipe; });
assertEqual(restoredPfanne.title, 'Hackpfanne mit Paprika', 'Zurücksetzen zeigt das ursprüngliche Gericht');
assert(!restoredPfanne.edited, 'nach dem Zurücksetzen ist nichts mehr geändert');
assert(restoredPfanne.missing.some(function (item) { return item.id === 'reis'; }), 'die ursprüngliche Zutat ist wieder nötig');
assert(restoredPfanne.steps.length >= 2, 'das ursprüngliche Rezept hängt wieder am Gericht');

console.log('meals tests ok');
