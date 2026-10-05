const komoot = require("./komoot.js");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}

assertEqual(komoot.loginPath("ada@example.com"), "/v006/account/email/ada%40example.com/", "E-Mail im Pfad");
assert(komoot.isBike({ sport: "gravel" }), "Gravel");
assert(komoot.isBike({ sport: "e_bikepacking" }), "E-Bikepacking");
assert(!komoot.isBike({ sport: "hike" }), "Wandern");
assertEqual(komoot.sportLabel({ sport: "mtb" }), "Mountainbike", "Mountainbike");
assertEqual(komoot.kindOf({ type: "tour_planned" }), "planned", "geplant");
assertEqual(komoot.kindOf({ type: "tour_recorded" }), "recorded", "aufgezeichnet");
assertEqual(komoot.tourDate({ date: "2026-06-12T08:00:00.000Z" }), "2026-06-12", "Tag");
assert(komoot.pageIsOlder([{ date: "2026-05-01T00:00:00.000Z" }], "2026-06-01"), "Seite liegt davor");
assert(!komoot.pageIsOlder([{ date: "2026-06-12T00:00:00.000Z" }], "2026-06-01"), "Seite reicht in den Zeitraum");
assertEqual(komoot.nextPath({ _links: { next: { href: "https://evil.example/v007/users/1/tours/" } } }), "", "fremde Adresse");
assertEqual(
  komoot.nextPath({ _links: { next: { href: "https://api.komoot.de/v007/users/42/tours/?page=1" } } }),
  "/v007/users/42/tours/?page=1",
  "nächste Seite"
);

var header = komoot.basicAuth("ada@example.com", "sä");
assertEqual(Buffer.from(header.slice(6), "base64").toString("utf8"), "ada@example.com:sä", "UTF-8 im Zugang");

var summary = komoot.summarize({
  id: 9,
  name: "Über den Pass",
  type: "tour_recorded",
  sport: "touringbicycle",
  date: "2026-06-12T08:00:00.000Z",
  distance: 42000,
  elevation_up: 800
});
assertEqual(summary.key, "komoot:9", "Schlüssel");
assertEqual(summary.when, "2026-06-12", "Datum der Zeile");
assertEqual(summary.distance, 42000, "Distanz");
assertEqual(summary.elevation, 800, "Höhenmeter");
assertEqual(summary.sportLabel, "Rad", "Sport");
assert(summary.bike, "Fahrrad");

var calls = [];
function fakeFetch(target, options) {
  calls.push({ url: target, options: options });
  if (target.indexOf("/account/email/") !== -1) {
    var auth = options.headers.Authorization;
    if (auth !== komoot.basicAuth("ada@example.com", "geheim")) {
      return Promise.resolve(text(403, { error: "BadCredentials", message: "Unknown user or wrong credentials." }));
    }
    return Promise.resolve(text(200, {
      username: "42",
      password: "api-token",
      user: { displayname: "Ada Ride" }
    }));
  }
  if (target.indexOf("/tours/?") !== -1) {
    assertEqual(options.headers.Authorization, komoot.basicAuth("42", "api-token"), "Liste mit Token");
    if (target.indexOf("page=1") !== -1) {
      return Promise.resolve(text(200, {
        _embedded: { tours: [{ id: 3, name: "Alt", type: "tour_recorded", sport: "hike", date: "2026-05-01T08:00:00.000Z" }] },
        _links: {}
      }));
    }
    return Promise.resolve(text(200, {
      _embedded: {
        tours: [
          { id: 9, name: "Über den Pass", type: "tour_recorded", sport: "touringbicycle", date: "2026-06-12T08:00:00.000Z", distance: 42000, elevation_up: 800 },
          { id: 10, name: "Plan", type: "tour_planned", sport: "touringbicycle", date: "2026-06-13T08:00:00.000Z" }
        ]
      },
      _links: { next: { href: "https://api.komoot.de/v007/users/42/tours/?page=1&limit=100" } }
    }));
  }
  if (target.indexOf(".gpx") !== -1) {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: function () {
        return Promise.resolve('<gpx version="1.1"><trk><name>Alpen</name><trkseg><trkpt lat="47.1" lon="11.2"></trkpt><trkpt lat="47.2" lon="11.3"></trkpt></trkseg></trk></gpx>');
      }
    });
  }
  return Promise.resolve(text(500, { message: target }));
}

function text(status, body) {
  return {
    ok: status < 400,
    status: status,
    text: function () { return Promise.resolve(JSON.stringify(body)); }
  };
}

komoot.login("ada@example.com", "falsch", fakeFetch).then(function () {
  throw new Error("falsches Passwort hätte scheitern müssen");
}, function (error) {
  assertEqual(error.message, "E-Mail oder Passwort stimmt nicht.", "falsches Passwort");
  return komoot.login("ada@example.com", "geheim", fakeFetch);
}).then(function (session) {
  assertEqual(session.userId, "42", "Benutzer");
  assertEqual(session.token, "api-token", "Token statt Passwort");
  assertEqual(session.displayName, "Ada Ride", "Name");
  assertEqual(JSON.stringify(session).indexOf("geheim"), -1, "Passwort bleibt außen");
  return komoot.listTours(session, "2026-06-01", fakeFetch);
}).then(function (tours) {
  assertEqual(tours.length, 3, "beide Seiten");
  assert(calls.some(function (call) { return call.url.indexOf("page=1") !== -1; }), "zweite Seite geholt");
  return komoot.downloadGpx({ userId: "42", token: "api-token" }, 9, fakeFetch);
}).then(function (gpx) {
  assert(gpx.indexOf("<gpx") !== -1, "GPX");
  assert(gpx.indexOf("47.1") !== -1, "Punkt");
  console.log("komoot.test.js ok");
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
