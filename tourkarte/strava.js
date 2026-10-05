/* Tourkarte – Strava-Anmeldung und Auswahl der Fahrten.
   Im Browser als TourkarteStrava, unter Node als Modul. */

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TourkarteStrava = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var AUTHORIZE = "https://www.strava.com/oauth/authorize";
  var TOKEN = "https://www.strava.com/oauth/token";
  var API = "https://www.strava.com/api/v3";
  var RIDE_SPORTS = {
    Ride: true,
    MountainBikeRide: true,
    GravelRide: true,
    EBikeRide: true,
    EMountainBikeRide: true,
    Velomobile: true,
    Handcycle: true
  };
  var SPORT_LABELS = {
    Ride: "Rad",
    MountainBikeRide: "Mountainbike",
    GravelRide: "Gravel",
    EBikeRide: "E-Bike",
    EMountainBikeRide: "E-Mountainbike",
    Velomobile: "Velomobil",
    Handcycle: "Handbike",
    Hike: "Wandern",
    Walk: "Gehen",
    Run: "Laufen",
    TrailRun: "Trailrunning",
    Swim: "Schwimmen",
    VirtualRide: "Virtuell"
  };

  function authorizeUrl(clientId, redirectUri, state) {
    return AUTHORIZE + "?" + formEncode({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "activity:read_all",
      state: state
    });
  }

  function redirectUri(href) {
    var url = new URL(href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function makeState(clientId) {
    var nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return nonce + "." + String(clientId || "");
  }

  function parseCallback(href) {
    var url;
    try { url = new URL(href); } catch (error) { return null; }
    var code = url.searchParams.get("code");
    var error = url.searchParams.get("error");
    if (!code && !error) return null;
    var state = url.searchParams.get("state") || "";
    var dot = state.indexOf(".");
    return {
      code: code,
      error: error,
      state: state,
      clientId: dot === -1 ? "" : state.slice(dot + 1)
    };
  }

  function exchangeCode(session, code, fetchImpl) {
    return postToken(fetchImpl, {
      client_id: session.clientId,
      client_secret: session.clientSecret,
      code: code,
      grant_type: "authorization_code"
    }).then(function (payload) { return applyToken(session, payload); });
  }

  function refresh(session, fetchImpl) {
    return postToken(fetchImpl, {
      client_id: session.clientId,
      client_secret: session.clientSecret,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken
    }).then(function (payload) { return applyToken(session, payload); });
  }

  function ensureFresh(session, fetchImpl, nowSeconds) {
    var now = nowSeconds == null ? Date.now() / 1000 : nowSeconds;
    if (session.expiresAt && session.expiresAt > now + 120) return Promise.resolve(session);
    if (!session.refreshToken) return Promise.reject(new Error("Die Strava-Anmeldung ist abgelaufen. Bitte erneut verbinden."));
    return refresh(session, fetchImpl);
  }

  function listActivities(session, after, before, fetchImpl) {
    var page = 1;
    var all = [];
    function next() {
      if (page > 10) return Promise.resolve(all);
      var query = formEncode({ after: Math.floor(after), before: Math.floor(before), page: page, per_page: 200 });
      return apiGet(session, API + "/athlete/activities?" + query, fetchImpl).then(function (batch) {
        if (!Array.isArray(batch)) throw new Error("Unerwartete Antwort beim Lesen der Aktivitäten.");
        all = all.concat(batch);
        if (batch.length < 200) return all;
        page += 1;
        return next();
      });
    }
    return next();
  }

  function activityStreams(session, activityId, fetchImpl) {
    var query = formEncode({ keys: "latlng,altitude,time", key_by_type: "true", resolution: "high" });
    return apiGet(session, API + "/activities/" + Number(activityId) + "/streams?" + query, fetchImpl).then(normalizeStreams);
  }

  function pointsFromStreams(streams, startIso) {
    var normalized = normalizeStreams(streams);
    var latlng = streamData(normalized, "latlng") || [];
    var altitude = streamData(normalized, "altitude");
    var times = streamData(normalized, "time");
    var start = startIso ? Date.parse(startIso) : NaN;
    var points = [];
    latlng.forEach(function (pair, index) {
      if (!pair || pair.length < 2) return;
      var lat = Number(pair[0]);
      var lon = Number(pair[1]);
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
      var ele = null;
      if (altitude && index < altitude.length && isFinite(Number(altitude[index]))) {
        var value = Number(altitude[index]);
        if (value >= -500 && value <= 9000) ele = value;
      }
      var time = null;
      if (!isNaN(start) && times && index < times.length && isFinite(Number(times[index]))) {
        time = new Date(start + Number(times[index]) * 1000).toISOString().replace(".000Z", "Z");
      }
      points.push({ lat: lat, lon: lon, ele: ele, time: time });
    });
    return points;
  }

  function pointsFromPolyline(encoded) {
    return decodePolyline(encoded).map(function (pair) {
      return { lat: pair[0], lon: pair[1], ele: null, time: null };
    }).filter(function (point) {
      return isFinite(point.lat) && isFinite(point.lon) && !(point.lat === 0 && point.lon === 0);
    });
  }

  function decodePolyline(encoded) {
    var points = [];
    var index = 0;
    var lat = 0;
    var lon = 0;
    while (index < encoded.length) {
      var latChunk = decodeChunk(encoded, index);
      var lonChunk = decodeChunk(encoded, latChunk.index);
      lat += latChunk.delta;
      lon += lonChunk.delta;
      index = lonChunk.index;
      points.push([lat / 1e5, lon / 1e5]);
    }
    return points;
  }

  function isSelected(activity, sportMode, showIndoor) {
    var sport = String(activity.sport_type || activity.type || "");
    var indoor = Boolean(activity.trainer) || sport.indexOf("Virtual") === 0;
    if (indoor && !showIndoor) return false;
    if (sportMode === "all") return true;
    return Boolean(RIDE_SPORTS[sport]);
  }

  function sportLabel(activity) {
    var sport = String(activity.sport_type || activity.type || "");
    return SPORT_LABELS[sport] || sport || "Aktivität";
  }

  function localDate(activity) {
    var raw = activity.start_date_local || activity.start_date || "";
    return String(raw).slice(0, 10);
  }

  function localRangeEpoch(fromIso, toIso) {
    if (toIso < fromIso) throw new Error("Das Enddatum liegt vor dem Startdatum.");
    var start = localMidnight(fromIso);
    var end = localMidnight(toIso);
    end.setDate(end.getDate() + 1);
    return [Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)];
  }

  function athleteName(athlete) {
    if (!athlete) return "";
    return [athlete.firstname, athlete.lastname].filter(Boolean).join(" ");
  }

  function applyToken(session, payload) {
    if (!payload || !payload.access_token) throw new Error("Strava hat kein Zugangstoken geliefert.");
    var expiresAt = payload.expires_at;
    if (expiresAt == null && payload.expires_in != null) expiresAt = Math.floor(Date.now() / 1000 + Number(payload.expires_in));
    return {
      clientId: String(session.clientId),
      clientSecret: String(session.clientSecret),
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || session.refreshToken || "",
      expiresAt: Number(expiresAt || 0),
      athleteName: athleteName(payload.athlete) || session.athleteName || ""
    };
  }

  function postToken(fetchImpl, fields) {
    return request(fetchImpl, TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: formEncode(fields)
    });
  }

  function apiGet(session, url, fetchImpl) {
    return request(fetchImpl, url, {
      method: "GET",
      headers: { Authorization: "Bearer " + session.accessToken, Accept: "application/json" }
    });
  }

  function request(fetchImpl, url, options) {
    return fetchImpl(url, options).then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        if (text) {
          try { body = JSON.parse(text); } catch (error) { body = { message: text.slice(0, 300) }; }
        }
        if (response.status === 429) throw new Error("Strava begrenzt die Anfragen. Bitte in ein paar Minuten erneut versuchen.");
        if (!response.ok) throw new Error("Strava: " + faultMessage(body));
        return body;
      });
    }, function () {
      throw new Error("Keine Verbindung zu Strava.");
    });
  }

  function normalizeStreams(payload) {
    if (payload && !Array.isArray(payload) && (payload.latlng || payload.altitude || payload.time)) return payload;
    if (Array.isArray(payload)) {
      var streams = {};
      payload.forEach(function (stream) {
        if (stream && stream.type) streams[stream.type] = stream;
      });
      return streams;
    }
    throw new Error("Die GPS-Streams haben ein unbekanntes Format.");
  }

  function streamData(streams, name) {
    var stream = streams[name];
    return stream && stream.data ? stream.data : null;
  }

  function decodeChunk(encoded, index) {
    var result = 0;
    var shift = 0;
    var byte = 0;
    do {
      if (index >= encoded.length) throw new Error("Die Polylinie von Strava ist unvollständig.");
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    var delta = (result & 1) ? ~(result >> 1) : (result >> 1);
    return { delta: delta, index: index };
  }

  function faultMessage(payload) {
    if (payload && payload.message) return String(payload.message);
    return "die Anfrage wurde abgelehnt.";
  }

  function formEncode(fields) {
    return Object.keys(fields).filter(function (key) { return fields[key] != null && fields[key] !== ""; }).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(fields[key]);
    }).join("&");
  }

  function localMidnight(iso) {
    var parts = String(iso).slice(0, 10).split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
  }

  return {
    RIDE_SPORTS: RIDE_SPORTS,
    authorizeUrl: authorizeUrl,
    redirectUri: redirectUri,
    makeState: makeState,
    parseCallback: parseCallback,
    exchangeCode: exchangeCode,
    refresh: refresh,
    ensureFresh: ensureFresh,
    listActivities: listActivities,
    activityStreams: activityStreams,
    pointsFromStreams: pointsFromStreams,
    pointsFromPolyline: pointsFromPolyline,
    decodePolyline: decodePolyline,
    isSelected: isSelected,
    sportLabel: sportLabel,
    localDate: localDate,
    localRangeEpoch: localRangeEpoch,
    applyToken: applyToken
  };
});
