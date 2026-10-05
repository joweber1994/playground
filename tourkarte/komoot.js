/* Tourkarte – Komoot-Anmeldung und GPX der eigenen Touren.
   Im Browser als TourkarteKomoot, unter Node als Modul.
   Komoot gibt nach der Anmeldung ein Zugangstoken zurück. Das Kontopasswort
   wird nicht gespeichert. */

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TourkarteKomoot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var API = "https://api.komoot.de";
  var BIKE = {
    touringbicycle: true,
    mtb: true,
    mtb_easy: true,
    racebike: true,
    gravel: true,
    citybike: true,
    bike: true,
    bicycle: true,
    bikepacking: true,
    e_touringbicycle: true,
    e_mtb: true,
    e_mtb_easy: true,
    e_racebike: true,
    e_gravel: true,
    e_citybike: true,
    e_bikepacking: true
  };
  var SPORT_LABELS = {
    touringbicycle: "Rad",
    racebike: "Rennrad",
    mtb: "Mountainbike",
    mtb_easy: "Mountainbike",
    gravel: "Gravel",
    citybike: "Stadtrad",
    bike: "Rad",
    bicycle: "Rad",
    bikepacking: "Bikepacking",
    e_touringbicycle: "E-Bike",
    e_mtb: "E-Mountainbike",
    e_mtb_easy: "E-Mountainbike",
    e_racebike: "E-Rennrad",
    e_gravel: "E-Gravel",
    e_citybike: "E-Stadtrad",
    e_bikepacking: "E-Bikepacking",
    hike: "Wandern",
    mountaineering: "Bergtour",
    jogging: "Laufen",
    nordicwalking: "Nordic Walking"
  };

  function login(email, password, fetchImpl) {
    var clean = String(email || "").trim();
    if (clean.indexOf("@") === -1 || !password) {
      return Promise.reject(new Error("E-Mail und Passwort von Komoot eintragen."));
    }
    return request(fetchImpl, API + loginPath(clean), {
      method: "GET",
      headers: {
        Authorization: basicAuth(clean, password),
        Accept: "application/json"
      }
    }, true).then(function (payload) {
      return sessionFromLogin(clean, payload);
    });
  }

  function listTours(session, fromIso, fetchImpl) {
    var path = "/v007/users/" + encodeURIComponent(session.userId) + "/tours/?sort_field=date&sort_direction=desc&page=0&limit=100";
    var all = [];
    var pages = 0;
    function next() {
      if (!path || pages >= 15) return Promise.resolve(all);
      pages += 1;
      var current = path;
      return request(fetchImpl, API + current, {
        method: "GET",
        headers: {
          Authorization: basicAuth(session.userId, session.token),
          Accept: "application/hal+json, application/json"
        }
      }, false).then(function (payload) {
        var batch = toursFromPage(payload);
        all = all.concat(batch);
        if (pageIsOlder(batch, fromIso)) return all;
        path = nextPath(payload);
        return next();
      });
    }
    return next();
  }

  function downloadGpx(session, tourId, fetchImpl) {
    if (!/^\d+$/.test(String(tourId))) return Promise.reject(new Error("Die Tournummer ist ungültig."));
    return request(fetchImpl, API + "/v007/tours/" + tourId + ".gpx", {
      method: "GET",
      headers: {
        Authorization: basicAuth(session.userId, session.token),
        Accept: "application/gpx+xml, application/xml, text/xml"
      }
    }, false, true).then(function (text) {
      if (String(text).indexOf("<gpx") === -1) throw new Error("Komoot hat kein GPX geliefert.");
      return text;
    });
  }

  function summarize(tour) {
    var elevation = tour.elevation_up != null ? tour.elevation_up : tour.elevation;
    return {
      key: "komoot:" + tour.id,
      source: "komoot",
      id: tour.id,
      name: tour.name || ("Tour " + tour.id),
      when: tourDate(tour),
      distance: finite(tour.distance),
      elevation: elevation == null || elevation === "" ? null : finite(elevation),
      sportLabel: sportLabel(tour),
      kind: kindOf(tour),
      bike: isBike(tour)
    };
  }

  function loginPath(email) {
    return "/v006/account/email/" + encodeURIComponent(String(email).trim()) + "/";
  }

  function sessionFromLogin(email, payload) {
    if (!payload || !payload.username || !payload.password) throw new Error("Komoot hat keinen Zugang geliefert.");
    var user = payload.user || {};
    return {
      email: email,
      userId: String(payload.username),
      token: String(payload.password),
      displayName: String(user.displayname || email)
    };
  }

  function toursFromPage(payload) {
    var embedded = payload && payload._embedded;
    var tours = embedded && embedded.tours;
    if (!Array.isArray(tours)) throw new Error("Unerwartete Antwort beim Lesen der Touren.");
    return tours.filter(function (tour) { return tour && tour.id != null; });
  }

  function nextPath(payload) {
    var link = payload && payload._links && payload._links.next;
    var href = link && link.href;
    if (!href) return "";
    var url;
    try { url = new URL(href, API); } catch (error) { return ""; }
    if (url.origin !== API) return "";
    if (url.pathname.indexOf("/v006/") !== 0 && url.pathname.indexOf("/v007/") !== 0) return "";
    if (url.pathname.split("/").indexOf("..") !== -1) return "";
    return url.pathname + url.search;
  }

  function pageIsOlder(tours, fromIso) {
    if (!fromIso || !tours || !tours.length) return false;
    var days = tours.map(tourDate);
    if (days.some(function (day) { return !day; })) return false;
    return days.every(function (day) { return day < fromIso; });
  }

  function tourDate(tour) {
    var raw = tour && (tour.date || tour.start_date) || "";
    var day = String(raw).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
  }

  function kindOf(tour) {
    return String(tour && tour.type || "") === "tour_planned" ? "planned" : "recorded";
  }

  function isBike(tour) {
    var sport = String(tour && tour.sport || "");
    if (BIKE[sport]) return true;
    return /bike|bicycle|mtb|gravel|bikepack/i.test(sport);
  }

  function sportLabel(tour) {
    var sport = String(tour && tour.sport || "");
    return SPORT_LABELS[sport] || sport || "Tour";
  }

  function basicAuth(user, secret) {
    return "Basic " + encodeBase64(String(user) + ":" + String(secret));
  }

  function request(fetchImpl, url, options, duringLogin, asText) {
    options.referrerPolicy = "no-referrer";
    options.cache = "no-store";
    return fetchImpl(url, options).then(function (response) {
      return response.text().then(function (text) {
        if (response.status === 429) throw new Error("Komoot begrenzt die Anfragen. Bitte in ein paar Minuten erneut versuchen.");
        if (!response.ok) throw new Error(faultMessage(text, response.status, duringLogin));
        if (asText) return text;
        var body = null;
        if (text) {
          try { body = JSON.parse(text); } catch (error) { body = { message: text.slice(0, 300) }; }
        }
        return body;
      });
    }, function () {
      throw new Error("Keine Verbindung zu Komoot.");
    });
  }

  function faultMessage(text, status, duringLogin) {
    var body = null;
    if (text) {
      try { body = JSON.parse(text); } catch (error) { body = null; }
    }
    if (duringLogin && (status === 401 || status === 403)) return "E-Mail oder Passwort stimmt nicht.";
    if (status === 401 || status === 403) return "Die Komoot-Anmeldung ist abgelaufen. Bitte erneut verbinden.";
    if (body && body.message) return "Komoot: " + body.message;
    return "Komoot hat die Anfrage abgelehnt.";
  }

  function encodeBase64(text) {
    var binary = unescape(encodeURIComponent(text));
    return btoa(binary);
  }

  function finite(value) {
    var number = Number(value);
    return isFinite(number) ? number : 0;
  }

  return {
    login: login,
    listTours: listTours,
    downloadGpx: downloadGpx,
    summarize: summarize,
    loginPath: loginPath,
    sessionFromLogin: sessionFromLogin,
    toursFromPage: toursFromPage,
    nextPath: nextPath,
    pageIsOlder: pageIsOlder,
    tourDate: tourDate,
    kindOf: kindOf,
    isBike: isBike,
    sportLabel: sportLabel,
    basicAuth: basicAuth
  };
});
