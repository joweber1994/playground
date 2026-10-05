/* Wochenessen – offline cache. Only wochenessen-* caches are deleted. */
var CACHE_VERSION = 'wochenessen-v4';
var CACHE_PREFIX = 'wochenessen-';

var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './meals.js',
  './offers.js',
  './app.js',
  './manifest.json',
  './service-worker.js',
  './icon.svg'
];

function absoluteUrl(relativeUrl) {
  return new URL(relativeUrl, self.location).href;
}

function isServiceWorkerScript(request) {
  return new URL(request.url).pathname.endsWith('/service-worker.js');
}

function isManifest(request) {
  return new URL(request.url).pathname.endsWith('/manifest.json');
}

async function storeResponse(cache, url, response) {
  if (!response || !response.ok) {
    throw new Error('Precache fehlgeschlagen für ' + url + ' (' + (response ? response.status : 'keine Antwort') + ')');
  }

  if (!response.redirected) {
    await cache.put(url, response.clone());
    return;
  }

  var headers = new Headers(response.headers);
  headers.delete('content-encoding');
  var body = await response.clone().arrayBuffer();
  await cache.put(url, new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: headers
  }));
}

async function precache() {
  var cache = await caches.open(CACHE_VERSION);
  await Promise.all(ASSETS.map(async function (relativeUrl) {
    var url = absoluteUrl(relativeUrl);
    var response = await fetch(new Request(url, { cache: 'reload' }));
    await storeResponse(cache, url, response);
  }));
}

async function matchCached(cache, request) {
  var cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  var url = new URL(request.url);
  var alternates = [];
  if (url.pathname.endsWith('/')) {
    alternates.push(url.origin + url.pathname + 'index.html');
  } else if (url.pathname.endsWith('/index.html')) {
    alternates.push(url.origin + url.pathname.slice(0, -'index.html'.length));
  }

  for (var i = 0; i < alternates.length; i += 1) {
    var alternate = await cache.match(alternates[i], { ignoreSearch: true });
    if (alternate) return alternate;
  }

  return null;
}

async function fromNetwork(request) {
  var cache = await caches.open(CACHE_VERSION);
  var response = await fetch(request);
  if (response && response.ok) {
    try {
      await storeResponse(cache, request.url, response);
    } catch (error) {
      /* A live response is still usable if updating the cache fails. */
    }
  }
  return response;
}

async function cacheFirst(request) {
  var cache = await caches.open(CACHE_VERSION);
  var cached = await matchCached(cache, request);
  if (cached) return cached;

  try {
    return await fromNetwork(request);
  } catch (error) {
    if (request.mode === 'navigate') {
      var fallback = await cache.match(absoluteUrl('./index.html')) || await cache.match(absoluteUrl('./'));
      if (fallback) return fallback;
    }
    return new Response('Offline und nicht im Cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function networkFirst(request) {
  try {
    return await fromNetwork(request);
  } catch (error) {
    var cache = await caches.open(CACHE_VERSION);
    var cached = await matchCached(cache, request);
    if (cached) return cached;
    return new Response('Offline und nicht im Cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('install', function (event) {
  event.waitUntil(precache().then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (key) {
      return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_VERSION;
    }).map(function (key) {
      return caches.delete(key);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isServiceWorkerScript(request) || isManifest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
