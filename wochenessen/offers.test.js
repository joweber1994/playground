const meals = require('./meals.js');
const offers = require('./offers.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

function store(id) {
  var found = null;
  offers.stores.forEach(function (item) {
    if (item.id === id) found = item;
  });
  return found;
}

function hasName(list, pattern) {
  return list.some(function (offer) { return pattern.test(offer.name); });
}

assertEqual(offers.weekKey, '2026-W41', 'Woche 41');
assertEqual(offers.validFrom, '2026-10-05', 'gültig ab 5.10.');
assertEqual(offers.validUntil, '2026-10-10', 'gültig bis 10.10.');
assertEqual(offers.stores.length, 4, 'vier lesbare Ketten');

var prechtl = store('prechtl');
assert(prechtl && /allen Prechtl-Märkten/.test(prechtl.note), 'Prechtl ist in jedem Markt gleich');
assert(hasName(prechtl.offers, /schnitzel/i), 'Prechtl hat Schnitzel');
assert(hasName(prechtl.offers, /hähnchen/i), 'Prechtl hat Hähnchen');
assert(hasName(prechtl.offers, /thunfisch/i), 'Prechtl hat Thunfisch');
assert(hasName(prechtl.offers, /seelachs/i), 'Prechtl hat Seelachs');
assert(prechtl.offers.length > 40, 'Prechtl-Liste ist gefüllt');

var aldi = store('aldi');
var aldiIds = meals.idsFromOffers(aldi.offers);
assert(aldiIds.indexOf('hackfleisch') !== -1, 'Aldi-Hackfleisch wird erkannt');
assert(aldiIds.indexOf('haehnchen') !== -1, 'Aldi-Hähnchen wird erkannt');
assert(aldi.otherCount > 0, 'Aldi zählt die übrigen Artikel');

var penny = store('penny');
assert(penny.offers.length > 100, 'Penny-Liste ist lang');

var lidl = store('lidl');
assert(lidl.offers.length < 10, 'Lidl-Aktionsprospekt hat kaum Lebensmittel');
assert(/kaum Zutaten/.test(lidl.note), 'Lidl-Hinweis nennt die Lücke');

var pantry = meals.defaultPantry();
function mealCount(item) {
  return meals.suggest(meals.idsFromOffers(item.offers), pantry).length;
}
assert(mealCount(penny) > mealCount(aldi), 'Penny schlägt mehr Gerichte vor als Aldi');
assert(mealCount(aldi) > mealCount(prechtl), 'Aldi schlägt mehr Gerichte vor als Prechtl');
assertEqual(mealCount(lidl), 0, 'aus dem Lidl-Prospekt wird kein Gericht');
assert(mealCount(penny) >= mealCount(aldi) && mealCount(penny) >= mealCount(prechtl), 'Penny ist die Vorgabe');

var unavailable = offers.unavailable.map(function (item) { return item.id; });
assert(unavailable.indexOf('rewe') !== -1, 'REWE ist nicht lesbar');
assert(unavailable.indexOf('netto') !== -1, 'Netto ist nicht lesbar');
assert(unavailable.indexOf('kaufland') !== -1, 'Kaufland ist nicht lesbar');

offers.stores.forEach(function (item) {
  assert(item.source.indexOf('http') === 0, item.id + ' hat eine Quelle');
  item.offers.forEach(function (offer) {
    assert(offer.name && offer.name.length <= 80, 'Name zu lang: ' + offer.name);
    assert(typeof offer.price === 'string', 'Preis ist Text');
    assert(typeof offer.amount === 'string', 'Menge ist Text');
  });
});

var prechtlIds = meals.idsFromOffers(prechtl.offers);
assert(prechtlIds.indexOf('schnitzel') !== -1, 'Prechtl-Schnitzel zählt');
assert(prechtlIds.indexOf('gulasch') !== -1, 'Prechtl-Gulasch zählt');
assert(prechtlIds.indexOf('hackfleisch') === -1, 'Rinder Gulasch wird nicht zu Hackfleisch');
assert(prechtlIds.indexOf('lachs') === -1, 'Lamm Lachse wird nicht zu Lachs');

var union = aldiIds.slice();
prechtlIds.forEach(function (id) {
  if (union.indexOf(id) === -1) union.push(id);
});
var aldiMeals = meals.suggest(aldiIds, pantry);
var prechtlMeals = meals.suggest(prechtlIds, pantry);
var bothMeals = meals.suggest(union, pantry);
assert(bothMeals.length > aldiMeals.length, 'Aldi und Prechtl zusammen schlagen mehr vor als Aldi allein');
assert(bothMeals.length > prechtlMeals.length, 'Aldi und Prechtl zusammen schlagen mehr vor als Prechtl allein');
assert(aldiIds.indexOf('fisch') === -1 && prechtlIds.indexOf('fisch') !== -1, 'Fisch gibt es bei Prechtl');
assert(prechtlIds.indexOf('hackfleisch') === -1 && aldiIds.indexOf('hackfleisch') !== -1, 'Hackfleisch gibt es bei Aldi');

console.log('offers tests ok');
