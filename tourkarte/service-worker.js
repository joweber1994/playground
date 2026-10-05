/* Tourkarte – App-Hülle fürs iPhone. Strava und Komoot selbst werden nicht gecacht. */
var CACHE_VERSION = "tourkarte-v14";
var CACHE_PREFIX = "tourkarte-";

var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./map.js",
  "./strava.js",
  "./komoot.js",
  "./manifest.json",
  "./service-worker.js",
  "./icon.svg",
  "./icon-180.png",
  "./examples/beispiel.gpx"
];

function absoluteUrl(relativeUrl) {
  return new URL(relativeUrl, self.location).href;
}

async function storeResponse(cache, url, response) {
  if (!response || !response.ok || response.redirected) return;
  await cache.put(url, response.clone());
}

async function precache() {
  var cache = await caches.open(CACHE_VERSION);
  await Promise.all(ASSETS.map(async function (relativeUrl) {
    var url = absoluteUrl(relativeUrl);
    var response = await fetch(new Request(url, { cache: "reload" }));
    await storeResponse(cache, url, response);
  }));
}

self.addEventListener("install", function (event) {
  event.waitUntil(precache().then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (key) {
      return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_VERSION;
    }).map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async function () {
    var cache = await caches.open(CACHE_VERSION);
    try {
      var response = await fetch(request);
      if (response && response.ok) await storeResponse(cache, request.url, response);
      return response;
    } catch (error) {
      var cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") {
        var fallback = await cache.match(absoluteUrl("./index.html"));
        if (fallback) return fallback;
      }
      return new Response("Offline und nicht im Cache.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
