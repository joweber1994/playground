const barcode = require('./barcode.js');
const ean = require('./ean.js');
const meals = require('./meals.js');
const shop = require('./shop.js');

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

var nutella = {
  code: '3017620422003',
  status: 1,
  status_verbose: 'product found',
  product: {
    product_name_de: 'Nutella',
    product_name: 'Nutella',
    brands: 'Nutella, Ferrero',
    quantity: '400 g e'
  }
};
assertEqual(barcode.productName(nutella), 'Nutella', 'deutscher Name aus Open Food Facts');

var germanOnly = {
  status: 1,
  product: {
    product_name_de: 'Guts-Leberwurst',
    product_name: '',
    brands: 'Böklunder',
    quantity: ''
  }
};
assertEqual(barcode.productName(germanOnly), 'Guts-Leberwurst', 'product_name_de gewinnt vor der Marke');

var fallback = {
  status: 1,
  product: { product_name: 'Spaghetti n.5', brands: 'Barilla', quantity: '500 g' }
};
assertEqual(barcode.productName(fallback), 'Spaghetti n.5', 'product_name, wenn kein deutscher Name da ist');

var brandOnly = { status: 1, product: { brands: 'Barilla', quantity: '500 g' } };
assertEqual(barcode.productName(brandOnly), 'Barilla', 'Marke, wenn kein Name da ist');

var quantityOnly = { status: 1, product: { quantity: '500 g' } };
assertEqual(barcode.productName(quantityOnly), '500 g', 'Menge als letzter Ausweg');

assertEqual(barcode.productName({ status: 0, status_verbose: 'product not found', code: '4011111111116' }), '', 'unbekanntes Produkt hat keinen Namen');
assertEqual(barcode.productName({ status: 1, code: '3017620422003', product: { code: '3017620422003' } }), '', 'aus den Ziffern wird kein Artikel erfunden');

var pasta = barcode.addScanned([], '3017620422003', 'Spaghetti', 10);
assert(pasta.created, 'erster Scan legt den Artikel an');
assertEqual(pasta.units, 1, 'eine Packung');
assertEqual(pasta.inventory.length, 1, 'eine Zeile');
assert(meals.coveredIds(pasta.inventory).indexOf('nudeln') !== -1, 'gescannte Pasta zählt als Nudeln im Vorrat');
var kept = meals.ensureInventory({ inventorySet: true, inventory: pasta.inventory }, []);
assertEqual(kept.length, 1, 'gescannter Vorrat bleibt stehen');
assertEqual(kept[0].barcode, '3017620422003', 'der Strichcode bleibt am Eintrag');
assertEqual(kept[0].units, 1, 'die Stückzahl bleibt am Eintrag');

var again = barcode.addScanned(pasta.inventory, '3017620422003', 'Spaghetti', 11);
assert(again.incremented, 'derselbe Strichcode zählt hoch');
assertEqual(again.units, 2, 'zweite Packung');
assertEqual(again.inventory.length, 1, 'keine zweite Zeile');
assertEqual(again.name, 'Spaghetti', 'der Name bleibt');

var renamed = barcode.renameItem(again.inventory, again.id, 'Nudeln', 12);
assert(renamed.renamed, 'der Name lässt sich korrigieren');
assertEqual(barcode.savedName(renamed.inventory, '3017620422003'), 'Nudeln', 'der Strichcode merkt sich den neuen Namen');
var afterRename = barcode.addScanned(renamed.inventory, '3017620422003', 'Nutella', 13);
assertEqual(afterRename.name, 'Nudeln', 'ein erneuter Scan nimmt den korrigierten Namen');
assertEqual(afterRename.units, 3, 'der Zähler läuft weiter');

var unknown = '4011111111116';
assertEqual(barcode.savedName([], unknown), '', 'unbekannter Strichcode hat noch keinen Namen');
var named = barcode.addScanned([], unknown, 'Haferkekse', 20);
assertEqual(barcode.savedName(named.inventory, unknown), 'Haferkekse', 'der vergebene Name bleibt auf dem Gerät');
var namedAgain = barcode.addScanned(named.inventory, unknown, barcode.savedName(named.inventory, unknown), 21);
assertEqual(namedAgain.name, 'Haferkekse', 'der gespeicherte Name wird wiederverwendet');
assertEqual(namedAgain.units, 2, 'derselbe unbekannte Strichcode zählt hoch');
assertEqual(namedAgain.inventory.length, 1, 'der unbekannte Artikel bleibt eine Zeile');

var removed = namedAgain.inventory.map(function (row) {
  return Object.assign({}, row, { deleted: true });
});
assertEqual(barcode.savedName(removed, unknown), 'Haferkekse', 'der Name bleibt auch nach dem Entfernen');
var restored = barcode.addScanned(removed, unknown, barcode.savedName(removed, unknown), 22);
assertEqual(restored.units, 1, 'nach dem Entfernen fängt die Stückzahl neu an');
assertEqual(restored.name, 'Haferkekse', 'der gemerkte Name kommt zurück');

var history = shop.pushHistory(shop.emptyHistory(), {
  inventory: named.inventory
});
var undone = shop.undoHistory(history, { inventory: namedAgain.inventory });
assertEqual(undone.state.inventory[0].units, 1, 'Rückgängig behält die Stückzahl');
assertEqual(undone.state.inventory[0].barcode, unknown, 'Rückgängig behält den Strichcode');

assertEqual(barcode.canonical('036000291452'), '0036000291452', 'UPC-A wird als EAN-13 geführt');
assertEqual(barcode.canonical('123'), '', 'zu kurze Ziffern sind kein Strichcode');
assert(!barcode.addScanned([], '1234567', 'Erfunden', 1).ok, 'ohne gültigen Strichcode wird nichts angelegt');

function paint(bits, modulePx) {
  var quiet = 10 * modulePx;
  var width = quiet * 2 + bits.length * modulePx;
  var height = 48;
  var data = new Uint8ClampedArray(width * height * 4);
  var i;
  for (i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 244;
    data[i + 3] = 255;
  }
  var m;
  for (m = 0; m < bits.length; m += 1) {
    if (bits[m] !== '1') continue;
    var x0 = quiet + m * modulePx;
    var y;
    var dx;
    for (y = 4; y < height - 4; y += 1) {
      for (dx = 0; dx < modulePx; dx += 1) {
        var o = (y * width + x0 + dx) * 4;
        data[o] = data[o + 1] = data[o + 2] = 12;
      }
    }
  }
  return { width: width, height: height, data: data };
}

function reverseBits(bits) {
  return bits.split('').reverse().join('');
}

['3017620422003', '73513537', '0036000291452'].forEach(function (code) {
  [2, 4].forEach(function (modulePx) {
    var bits = ean.encode(code);
    assert(bits.length === (code.length === 8 ? 67 : 95), 'Bitlänge ' + code);
    assertEqual(ean.decode(paint(bits, modulePx)), code, 'Scan ' + code + ' bei ' + modulePx + 'px');
    assertEqual(ean.decode(paint(reverseBits(bits), modulePx)), code, 'Scan gedreht ' + code);
  });
});

var blank = { width: 80, height: 40, data: new Uint8ClampedArray(80 * 40 * 4) };
assertEqual(ean.decode(blank), '', 'leeres Bild ergibt keinen Artikel');

console.log('barcode ok');
