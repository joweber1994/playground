const strava = require("./strava.js");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}

var url = strava.authorizeUrl("42", "https://example.com/tourkarte/index.html", "nonce.42");
assert(url.indexOf("client_id=42") !== -1, "Client-ID");
assert(url.indexOf("scope=activity%3Aread_all") !== -1, "Scope");
assert(url.indexOf("redirect_uri=" + encodeURIComponent("https://example.com/tourkarte/index.html")) !== -1, "Rückleitung");
assertEqual(strava.redirectUri("https://example.com/tourkarte/?code=1#x"), "https://example.com/tourkarte/", "Rückleitung ohne Code");

var callback = strava.parseCallback("https://example.com/tourkarte/index.html?state=abc.99&code=geheim&scope=read");
assertEqual(callback.code, "geheim", "Code");
assertEqual(callback.clientId, "99", "Client aus dem State");
assertEqual(strava.parseCallback("https://example.com/tourkarte/"), null, "ohne Anmeldung");

assert(strava.isSelected({ sport_type: "GravelRide" }, "bike", false), "Gravel");
assert(!strava.isSelected({ sport_type: "Run" }, "bike", false), "Lauf");
assert(!strava.isSelected({ sport_type: "VirtualRide" }, "all", false), "virtuell");
assert(strava.isSelected({ sport_type: "VirtualRide" }, "all", true), "virtuell auf Wunsch");
assert(!strava.isSelected({ sport_type: "Ride", trainer: true }, "bike", false), "Rolle");
assert(strava.isSelected({ sport_type: "Hike" }, "all", false), "Wandern bei Alle");

var points = strava.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
assertEqual(points.length, 3, "drei Punkte");
assert(Math.abs(points[0][0] - 38.5) < 0.001, "Breite");
assert(Math.abs(points[0][1] + 120.2) < 0.001, "Länge");
assert(Math.abs(points[2][0] - 43.252) < 0.001, "dritter Punkt");

var timed = strava.pointsFromStreams({
  latlng: { data: [[47.1, 11.2], [47.2, 11.3]] },
  altitude: { data: [500, 800] },
  time: { data: [0, 60] }
}, "2026-06-01T08:00:00Z");
assertEqual(timed[0].ele, 500, "Höhe");
assertEqual(timed[1].time, "2026-06-01T08:01:00Z", "Zeit");
assertEqual(strava.pointsFromStreams([{ type: "latlng", data: [[47.1, 11.2], [47.2, 11.3]] }], null).length, 2, "Listenform");

var calls = [];
function fakeFetch(target, options) {
  calls.push({ url: target, options: options });
  if (target.indexOf("/oauth/token") !== -1) {
    var body = options.body;
    assert(body.indexOf("client_secret=geheim") !== -1, "Secret bleibt im Token-Tausch");
    return Promise.resolve(json(200, {
      access_token: body.indexOf("refresh_token") !== -1 ? "neu" : "frisch",
      refresh_token: "refresh-2",
      expires_at: 9999999999,
      athlete: { firstname: "Ada", lastname: "Ride" }
    }));
  }
  if (target.indexOf("/athlete/activities") !== -1) {
    assert(options.headers.Authorization === "Bearer neu", "frisches Token");
    return Promise.resolve(json(200, [
      { id: 5, name: "Über den Pass", sport_type: "Ride", distance: 42000 },
      { id: 6, name: "Lauf", sport_type: "Run" }
    ]));
  }
  return Promise.resolve(json(500, { message: target }));
}

function json(status, body) {
  return {
    ok: status < 400,
    status: status,
    text: function () { return Promise.resolve(JSON.stringify(body)); }
  };
}

strava.exchangeCode({ clientId: "7", clientSecret: "geheim" }, "code", fakeFetch).then(function (session) {
  assertEqual(session.accessToken, "frisch", "Access Token");
  assertEqual(session.athleteName, "Ada Ride", "Name");
  assertEqual(session.clientSecret, "geheim", "Secret bleibt auf dem Gerät");
  session.expiresAt = 0;
  return strava.ensureFresh(session, fakeFetch, 1000);
}).then(function (fresh) {
  assertEqual(fresh.accessToken, "neu", "erneuert");
  return strava.listActivities(fresh, 10, 20, fakeFetch);
}).then(function (activities) {
  assertEqual(activities.length, 2, "beide Aktivitäten, Filter macht die Oberfläche");
  assert(calls.some(function (call) { return call.options.headers && call.options.headers.Authorization === "Bearer neu"; }), "Liste mit neuem Token");
  var range = strava.localRangeEpoch("2026-05-20", "2026-05-20");
  assertEqual(range[1] - range[0], 86400, "ein Kalendertag");
  console.log("strava.test.js ok");
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
