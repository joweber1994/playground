/* Liest die laufenden Angebote und schreibt wochenzettel/offers.js neu.
   node wochenzettel/refresh-offers.js zeigt nur die Zähler.
   node wochenzettel/refresh-offers.js --write ersetzt die Datei, wenn sich etwas geändert hat. */
var fs = require('fs');
var path = require('path');
var live = require('./live.js');
var offers = require('./offers.js');

var write = process.argv.indexOf('--write') !== -1;

function wrapper(catalog) {
  return '/* Wochenzettel – Angebote, automatisch gelesen am ' + catalog.extractedAt + '.\n' +
    '   node wochenzettel/refresh-offers.js --write schreibt diese Datei neu.\n' +
    '   Die Seite liest dieselben Quellen beim Öffnen noch einmal nach. */\n' +
    '(function (root, factory) {\n' +
    '  var api = factory();\n' +
    '  if (typeof module === \'object\' && module.exports) module.exports = api;\n' +
    '  else root.WochenzettelOffers = api;\n' +
    '})(typeof globalThis !== \'undefined\' ? globalThis : this, function () {\n' +
    '  return ' + JSON.stringify(catalog, null, 2) + ';\n' +
    '});\n';
}

live.refresh(offers, fetch, new Date()).then(function (result) {
  result.catalog.stores.forEach(function (store) {
    console.log(store.id + ' ' + store.offers.length + ' | ' + store.note);
  });
  console.log('changed ' + result.changed + ' ' + result.catalog.validFrom + ' ' + result.catalog.validUntil);
  if (!write || !result.changed) return;
  fs.writeFileSync(path.join(__dirname, 'offers.js'), wrapper(result.catalog));
  console.log('geschrieben');
}).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
