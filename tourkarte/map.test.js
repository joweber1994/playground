const fs = require("fs");
const path = require("path");
const map = require("./map.js");

function assert(condition, label) {
  if (!condition) throw new Error(label);
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
assert(svg.indexOf("#1e4d5c") !== -1, "zweite Etappe");
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

console.log("map.test.js ok");
