const fs = require("fs");
const path = require("path");
const map = require("./map.js");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function colorDistance(a, b) {
  var total = 0;
  for (var channel = 0; channel < 3; channel += 1) {
    total += Math.abs(parseInt(a.slice(1 + channel * 2, 3 + channel * 2), 16) - parseInt(b.slice(1 + channel * 2, 3 + channel * 2), 16));
  }
  return total;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}

assert(Math.abs(map.haversineM(0, 0, 0, 1) - 111195) < 200, "ein Längengrad");
assertEqual(map.formatKm(1234000), "1.234 km", "Kilometer");
assertEqual(map.formatKm(8400), "8,4 km", "kurze Strecke");
assertEqual(map.formatHm(9400), "9.400 hm", "Höhenmeter");
assertEqual(map.formatDateRange("2026-05-12", "2026-05-19"), "12.–19. Mai 2026", "Datumsbereich");

var points = [10, 12, 13, 20, 18, 30].map(function (ele) { return { lat: 0, lon: 0, ele: ele }; });
assertEqual(map.elevationGainM(points), 20, "Höhengewinn");

var start = "2026-06-01T00:00:00Z";
var spike = [
  { lat: 47, lon: 11, time: start },
  { lat: 47, lon: 11.01, time: "2026-06-01T00:00:30Z" },
  { lat: 48.2, lon: 12.4, time: "2026-06-01T00:00:31Z" },
  { lat: 47, lon: 11.02, time: "2026-06-01T00:01:00Z" },
  { lat: 47, lon: 11.03, time: "2026-06-01T00:01:30Z" }
];
assertEqual(map.cleanPoints(spike).length, 4, "Ausreißer fällt weg");

var gpx = fs.readFileSync(path.join(__dirname, "examples", "beispiel.gpx"), "utf8");
var tour = map.parseGpx(gpx);
assertEqual(tour.name, "Beispieltour", "Name");
assertEqual(tour.stages.length, 2, "zwei Etappen");
assertEqual(tour.waypoints.length, 2, "Wegpunkte");
assert(tour.waypoints.some(function (point) { return point.name === "Joch"; }), "Joch");
var distance = tour.stages.reduce(function (sum, stage) {
  return sum + stage.segments.reduce(function (inner, segment) { return inner + map.pathDistanceM(segment); }, 0);
}, 0);
assert(distance > 100000 && distance < 250000, "Beispieldistanz " + distance);

var scene = map.buildScene(tour, { title: "Album & Tal", route: "#123456", colorByDay: true });
var north = scene.items.filter(function (item) { return item.op === "polyline"; })[0].paths[0];
assert(north[north.length - 1][1] < north[0][1], "Norden ist oben");
north.forEach(function (point) {
  assert(point[0] >= scene.mapRect[0] && point[0] <= scene.mapRect[0] + scene.mapRect[2], "Punkt in der Karte");
  assert(point[1] >= scene.mapRect[1] && point[1] <= scene.mapRect[1] + scene.mapRect[3], "Punkt in der Karte");
});
var svg = map.sceneToSvg(scene);
assert(svg.indexOf("Album &amp; Tal") !== -1, "Titel maskiert");
assert(svg.indexOf("#123456") !== -1, "Linienfarbe");
var stageStrokes = scene.items.filter(function (item) { return item.op === "polyline"; }).map(function (item) { return item.stroke; });
assert(stageStrokes.length >= 2 && stageStrokes[0] !== stageStrokes[1], "Etappenfarben unterscheiden sich");
assert(svg.indexOf("12.–13. Juni 2026") !== -1, "Datum");
assert(svg.indexOf('width="210mm"') !== -1, "Quadrat");
assert(svg.indexOf("Joch") !== -1, "Wegpunkt auf der Karte");

var plain = '<gpx version="1.1"><trk><name>Freitag</name><trkseg><trkpt lat="47" lon="11"><ele>10</ele></trkpt><trkpt lat="47.1" lon="11.1"></trkpt></trkseg></trk></gpx>';
assertEqual(map.parseGpx(plain).stages[0].name, "Freitag", "ohne Namensraum");

var merged = map.mergeTours([
  { name: null, stages: [{ name: "später", when: "2026-06-02", segments: [[{ lat: 47, lon: 11 }, { lat: 47.1, lon: 11.1 }]] }], waypoints: [] },
  { name: "Früh", stages: [{ name: "früher", when: "2026-06-01", segments: [[{ lat: 47, lon: 11 }, { lat: 47.2, lon: 11.2 }]] }], waypoints: [] }
]);
assertEqual(merged.stages[0].name, "früher", "Sortierung");
assertEqual(merged.name, "Früh", "erster Name");

var many = [];
for (var i = 0; i < 140000; i += 1) {
  many.push({ lat: 47 + i * 0.00001, lon: 11 + (i % 200) * 0.00002, ele: 800 + (i % 40), time: null });
}
var longSvg = map.sceneToSvg(map.buildScene({
  name: null,
  stages: [{ name: "Lang", when: "2026-06-12", segments: [many] }],
  waypoints: []
}, { title: "Lang" }));
assert(longSvg.indexOf("<path") !== -1, "lange Strecke bleibt zeichenbar");
assert(longSvg.indexOf("Lang") !== -1, "Titel der langen Strecke");

var withMap = map.buildScene(tour, { title: "Beispieltour", basemap: true });
assert(withMap.tiles.length > 4 && withMap.tiles.length <= 48, "Hintergrundkacheln " + withMap.tiles.length);
assert(withMap.tiles.every(function (tile) { return tile.url.indexOf("https://tile.openstreetmap.org/") === 0; }), "OpenStreetMap");
var mapSvg = map.sceneToSvg(withMap);
assert(mapSvg.indexOf("<image ") !== -1, "Kacheln im SVG");
assert(mapSvg.indexOf("OpenStreetMap") !== -1, "Quellenangabe");

var facts = map.stageFacts(tour);
assertEqual(facts.length, 2, "zwei Etappen in der Zusammenfassung");
assert(facts[0].km > 10000 && facts[1].km > 10000, "Kilometer je Etappe");
assert(facts[0].hm > 0 && facts[1].hm > 0, "Höhenmeter je Etappe");
assertEqual(facts[0].shortDate, "12.6.", "Datum der ersten Etappe");
var seen = {};
for (var colorIndex = 0; colorIndex < 17; colorIndex += 1) {
  var day = map.dayColor(colorIndex, 17);
  assert(!seen[day], "Farbe doppelt " + day);
  seen[day] = true;
  if (colorIndex) assert(colorDistance(map.dayColor(colorIndex - 1, 17), day) > 80, "Nachbarfarben zu ähnlich");
}
assertEqual(map.largerPlace({ suburb: "Lagjja 2", city: "Shkodër", municipality: "Bashkia Shkodër" }), "Shkodër", "Stadt vor Stadtteil");
assertEqual(map.largerPlace({ municipality: "Bashkia Tiranë" }), "Tiranë", "Gemeinde ohne Vorsilbe");
var namedScene = map.buildScene(tour, {
  title: "Beispieltour",
  stagePlaces: [{ start: "Landeck", end: "Imst" }, { start: "Imst", end: "Innsbruck" }]
});
var named = map.sceneToSvg(namedScene);
assert(named.indexOf("1. Etappe") !== -1, "Etappe in der Übersicht");
assert(named.indexOf("Landeck") !== -1, "Start der Etappe");
assert(named.indexOf("Innsbruck") !== -1, "Ziel der Etappe");
var kmNotes = namedScene.items.filter(function (item) { return item.op === "text" && item.text === facts[0].kmLabel; });
var hmNotes = namedScene.items.filter(function (item) { return item.op === "text" && item.text === facts[0].hmLabel; });
assert(kmNotes.length && hmNotes.length && kmNotes[0].anchor === "end" && hmNotes[0].anchor === "end", "Kilometer und Höhenmeter rechtsbündig");
assertEqual(map.tidyPlace("Municipal Unit of Patras"), "Patras", "Verwaltungskürzel");
assert(named.indexOf(facts[0].kmLabel) !== -1, "Kilometer auf der Karte");
var route = withMap.items.filter(function (item) { return item.op === "polyline"; })[0].paths[0];
route.forEach(function (point) {
  assert(point[0] >= withMap.mapRect[0] && point[0] <= withMap.mapRect[0] + withMap.mapRect[2], "Linie auf der Karte");
  assert(point[1] >= withMap.mapRect[1] && point[1] <= withMap.mapRect[1] + withMap.mapRect[3], "Linie auf der Karte");
});

assertEqual(map.searchPlacesUrl("  "), "", "leere Suche");
assertEqual(
  map.searchPlacesUrl("Olymp Berg", "10.0000,48.0000,12.0000,46.0000"),
  "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=Olymp%20Berg&viewbox=10.0000,48.0000,12.0000,46.0000&bounded=0",
  "Suchadresse"
);
assertEqual(map.tourViewbox(null), "", "ohne Tour");
assertEqual(map.tourViewbox({ stages: [], waypoints: [] }), "", "ohne Koordinaten");
assertEqual(map.tourViewbox({
  stages: [{ segments: [[{ lat: 47, lon: 11 }, { lat: 47.5, lon: 11.5 }]] }],
  waypoints: []
}), "10.7500,47.7500,11.7500,46.7500", "Viewbox um die Tour");
var dense = [];
for (var n = 0; n < 5000; n += 1) dense.push({ lat: 46.5, lon: 10.5 + n * 0.0001 });
assert(map.tourViewbox({ stages: [{ segments: [dense] }], waypoints: [] }).length > 0, "lange Tour");
var found = map.placesFromSearch([
  { name: "Olymp", display_name: "Olymp, Sölden, Österreich", lat: "46.95", lon: "10.96" },
  { name: "Olymp", display_name: "Olymp, Sölden, Österreich", lat: "46.95", lon: "10.96" },
  { display_name: "Biwak, Tirol", lat: "47.1", lon: "11.2" },
  { name: "Kaputt", lat: "nope", lon: "11" },
  null
]);
assertEqual(found.length, 2, "Vorschläge");
assertEqual(found[0].name, "Olymp", "Name");
assertEqual(found[0].lat, 46.95, "Breite");
assertEqual(found[0].lon, 10.96, "Länge");
assertEqual(found[1].name, "Biwak", "Name aus der Anzeige");
assertEqual(map.placesFromSearch({ error: "Unable to geocode" }).length, 0, "Fehlerobjekt");
assertEqual(map.formatLatLon(46.95, 10.96), "46,9500 · 10,9600", "Koordinaten");
var withOlymp = {
  name: tour.name,
  stages: tour.stages,
  waypoints: tour.waypoints.concat([{ lat: 47.05, lon: 11.4, name: "Olymp" }])
};
var olympSvg = map.sceneToSvg(map.buildScene(withOlymp, { title: "Olymp", basemap: false }));
assert(olympSvg.indexOf("Olymp") !== -1, "gesetzter Punkt auf der Karte");

var stageScene = map.buildStageScene(tour, 1, {
  colorByDay: true,
  basemap: false,
  fmt: "square",
  stagePlaces: [{ start: "Landeck", end: "Imst" }, { start: "Imst", end: "Innsbruck" }]
});
var stageSvg = map.sceneToSvg(stageScene);
assertEqual(stageScene.kind, "stage", "Etappenseite");
assertEqual(stageScene.stageIndex, 1, "Index der Etappe");
assert(stageSvg.indexOf("Tag 2") !== -1, "Name der Etappe");
assert(stageSvg.indexOf("Tag 1") === -1, "fremde Etappe fehlt");
assert(stageSvg.indexOf("13. Juni 2026") !== -1, "Datum der Etappe");
assert(stageSvg.indexOf("12. Juni") === -1, "fremdes Datum fehlt");
assert(stageSvg.indexOf("Imst") !== -1, "Start auf der Etappe");
assert(stageSvg.indexOf("Innsbruck") !== -1, "Ziel auf der Etappe");
assert(stageSvg.indexOf(facts[1].kmLabel) !== -1, "Kilometer der Etappe");
assert(stageSvg.indexOf(facts[1].hmLabel) !== -1, "Höhenmeter der Etappe");
assert(stageSvg.indexOf("1. Etappe") === -1, "keine Übersichtsliste");
var stageLines = stageScene.items.filter(function (item) { return item.op === "polyline"; });
assertEqual(stageLines.length, 1, "eine Linie");
assertEqual(stageLines[0].stroke, map.dayColor(1, 2), "Farbe des Tages");
var namedStage = map.sceneToSvg(map.buildStageScene(tour, 0, { stageTitle: "Morgen", basemap: false }));
assert(namedStage.indexOf("Morgen") !== -1, "eigener Etappenname");
var missingStage = false;
try { map.buildStageScene(tour, 9, {}); } catch (error) { missingStage = /gibt es nicht/.test(error.message); }
assert(missingStage, "unbekannte Etappe");

var kept = map.buildScene(tour, {
  title: "Beispieltour",
  included: [false, true],
  colorByDay: true,
  basemap: false,
  stagePlaces: [{ start: "Landeck", end: "Imst" }, { start: "Imst", end: "Innsbruck" }]
});
var keptSvg = map.sceneToSvg(kept);
assert(keptSvg.indexOf("2. Etappe") !== -1, "Nummer bleibt");
assert(keptSvg.indexOf("1. Etappe") === -1, "ausgeblendete Etappe");
assert(keptSvg.indexOf("Innsbruck") !== -1, "Ziel der sichtbaren Etappe");
assert(keptSvg.indexOf("Landeck") === -1, "Start der ausgeblendeten Etappe");
var keptLines = kept.items.filter(function (item) { return item.op === "polyline"; });
assertEqual(keptLines.length, 1, "eine Linie in der Übersicht");
assertEqual(keptLines[0].stroke, map.dayColor(1, 2), "Farbe bleibt am Tag");
var noneKept = false;
try {
  map.buildScene(tour, { included: [false, false] });
} catch (error) {
  noneKept = /Keine Etappe/.test(error.message);
}
assert(noneKept, "leere Übersicht");

var overviewMap = map.buildScene(tour, { title: "Beispieltour", basemap: true });
var stageMap = map.buildStageScene(tour, 1, { basemap: true, stageTitle: "Tag 2" });
var otherStage = map.buildStageScene(tour, 0, { basemap: true });
function tileItem(scene) {
  return scene.items.filter(function (item) { return item.op === "tiles"; })[0];
}
function frameItem(scene) {
  return scene.items.filter(function (item) { return item.op === "rect" && item.stroke; })[0];
}
var overviewTiles = tileItem(overviewMap);
var stageTiles = tileItem(stageMap);
assert(overviewTiles.clipId && overviewTiles.clipId !== stageTiles.clipId, "eigene Ausschnitte");
assert(stageTiles.clipId !== tileItem(otherStage).clipId, "Etappen getrennt");
assert(Math.abs((frameItem(stageMap).y + frameItem(stageMap).h) - (stageMap.mapRect[1] + stageMap.mapRect[3])) < 0.05, "Rahmen unten");
assert(stageTiles.clip[1] + stageTiles.clip[3] <= stageMap.mapRect[1] + stageMap.mapRect[3], "Kacheln im Rahmen");
assert(stageMap.mapRect[1] + stageMap.mapRect[3] - (stageTiles.clip[1] + stageTiles.clip[3]) < 6, "Kacheln bis zum unteren Rand");
var overviewSvgClip = map.sceneToSvg(overviewMap);
var stageSvgClip = map.sceneToSvg(stageMap);
assert(overviewSvgClip.indexOf('id="' + overviewTiles.clipId + '"') !== -1, "Ausschnitt der Übersicht");
assert(overviewSvgClip.indexOf("url(#" + overviewTiles.clipId + ")") !== -1, "Übersicht nutzt den eigenen Ausschnitt");
assert(stageSvgClip.indexOf("url(#" + stageTiles.clipId + ")") !== -1, "Etappe nutzt den eigenen Ausschnitt");
assert(overviewSvgClip.indexOf(stageTiles.clipId) === -1, "fremde Etappe nicht in der Übersicht");
assert(frameItem(stageMap).strokeWidth >= 8, "Rahmenstrich bleibt sichtbar");

assertEqual(map.fileSlug("Übersicht"), "uebersicht", "Slug");
assertEqual(map.fileSlug("Straße"), "strasse", "Eszett");
assertEqual(
  map.albumFilenames(["Übersicht", "1. Etappe", "Tag 2"], "jpg").join("|"),
  "00-uebersicht.jpg|01-1-etappe.jpg|02-tag-2.jpg",
  "Dateinamen der Seiten"
);

function unzipStored(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var files = [];
  var offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    var size = view.getUint32(offset + 18, true);
    var nameLen = view.getUint16(offset + 26, true);
    var extra = view.getUint16(offset + 28, true);
    var nameStart = offset + 30;
    var name = Buffer.from(bytes.slice(nameStart, nameStart + nameLen)).toString("utf8");
    var dataStart = nameStart + nameLen + extra;
    files.push({ name: name, data: Buffer.from(bytes.slice(dataStart, dataStart + size)) });
    offset = dataStart + size;
  }
  return files;
}
var packed = map.zipStored([
  { name: "00-uebersicht.jpg", data: new Uint8Array([255, 216, 255, 1, 2, 3]) },
  { name: "01-etappe.jpg", data: new Uint8Array([9, 8, 7]) }
]);
var unpacked = unzipStored(packed);
assertEqual(unpacked.length, 2, "zwei Dateien im Zip");
assertEqual(unpacked[0].name, "00-uebersicht.jpg", "Übersicht zuerst");
assertEqual(unpacked[1].name, "01-etappe.jpg", "Etappe danach");
assertEqual(Buffer.from(unpacked[0].data).toString("hex"), "ffd8ff010203", "Inhalt der Übersicht");
assertEqual(Buffer.from(unpacked[1].data).toString("hex"), "090807", "Inhalt der Etappe");

console.log("map.test.js ok");
