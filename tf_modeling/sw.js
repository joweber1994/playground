const CACHE = "tf_modeling-v1";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./solver.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-180.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        const fetched = fetch(event.request).then(function (response) {
          if (response && response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(function () {
          return cached;
        });
        return cached || fetched;
      });
    })
  );
});
