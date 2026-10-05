/* Tourkarte auf dem iPhone: Strava oder Komoot verbinden, Etappen wählen, Album durchblättern. */

(function () {
  var STORAGE = "tourkarte-strava-v1";
  var KOMOOT_STORAGE = "tourkarte-komoot-v1";
  var STATE_KEY = "tourkarte-oauth-state";
  var WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  var ROUTES = ["#9c3412", "#1c1916", "#1e4d5c", "#3e5340"];

  var state = {
    mode: "setup",
    panel: "home",
    job: "",
    session: null,
    komoot: null,
    komootEmail: "",
    rides: [],
    selected: {},
    range: { from: "", to: "" },
    sport: "bike",
    kind: "recorded",
    sourceFilter: "all",
    showIndoor: false,
    query: "",
    tour: null,
    placeQuery: "",
    placeHits: [],
    placeHint: "",
    placeActive: -1,
    placeGeneration: 0,
    source: "",
    skipped: [],
    options: {
      title: "",
      startLabel: "",
      endLabel: "",
      fmt: "square",
      route: "#9c3412",
      colorByDay: false,
      basemap: true
    },
    error: "",
    status: "",
    pendingCode: "",
    pngBlob: null,
    pngSvg: "",
    embeddedSvg: "",
    mapGeneration: 0,
    photos: [],
    photoSerial: 0,
    albumIndex: 0,
    sheets: {},
    cancel: false
  };

  var screen;

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    screen = document.getElementById("screen");
    state.session = loadSession();
    state.komoot = loadKomoot();
    state.komootEmail = state.komoot && state.komoot.email || "";
    var callback = TourkarteStrava.parseCallback(location.href);
    if (callback) {
      var expected = sessionStorage.getItem(STATE_KEY);
      history.replaceState(null, "", location.pathname);
      state.panel = "strava";
      if (callback.error) {
        state.error = callback.error === "access_denied"
          ? "Strava hat den Zugriff nicht erlaubt."
          : "Strava hat die Anmeldung abgebrochen.";
        state.mode = "setup";
      } else if (expected && callback.state && expected !== callback.state) {
        state.error = "Die Anmeldung passt nicht zum Start. Bitte erneut verbinden.";
        state.mode = "setup";
      } else if (state.session && state.session.clientSecret) {
        state.pendingCode = callback.code;
        state.mode = "working";
        state.job = "strava-exchange";
        render();
        finishExchange(callback.code);
        registerWorker();
        return;
      } else {
        state.pendingCode = callback.code;
        if (callback.clientId) state.session = { clientId: callback.clientId, clientSecret: "" };
        state.mode = "finish";
      }
    } else if (hasStrava() || hasKomoot()) {
      state.mode = "pick";
      state.sourceFilter = hasStrava() && hasKomoot() ? "all" : (hasKomoot() ? "komoot" : "strava");
      ensureRange();
    } else {
      state.mode = "setup";
      state.panel = "home";
    }
    render();
    if (state.mode === "pick") loadActivities();
    registerWorker();
  }

  function render() {
    if (state.mode === "setup") {
      if (state.panel === "strava") screen.innerHTML = stravaConnectHtml();
      else if (state.panel === "komoot") screen.innerHTML = komootConnectHtml();
      else screen.innerHTML = homeHtml();
    } else if (state.mode === "finish") screen.innerHTML = finishHtml();
    else if (state.mode === "pick") screen.innerHTML = pickHtml();
    else if (state.mode === "working") screen.innerHTML = workingHtml();
    else if (state.mode === "map") screen.innerHTML = mapHtml();
    bind();
    if (state.mode === "pick") paintRides();
    if (state.mode === "map") {
      refreshPreview();
      fillPlaces();
      paintPlaceSearch();
    }
  }

  function bind() {
    var connect = document.getElementById("connect");
    if (connect) connect.addEventListener("click", startAuth);
    var komootConnect = document.getElementById("komoot-connect");
    if (komootConnect) komootConnect.addEventListener("click", startKomoot);
    var backHome = document.getElementById("back-home");
    if (backHome) backHome.addEventListener("click", function () {
      state.panel = "home";
      state.error = "";
      render();
    });
    var openStrava = document.getElementById("open-strava");
    if (openStrava) openStrava.addEventListener("click", function () {
      if (hasStrava()) openPick("strava");
      else {
        state.panel = "strava";
        state.error = "";
        render();
      }
    });
    var openKomoot = document.getElementById("open-komoot");
    if (openKomoot) openKomoot.addEventListener("click", function () {
      if (hasKomoot()) openPick("komoot");
      else {
        state.panel = "komoot";
        state.error = "";
        render();
      }
    });
    var openAll = document.getElementById("open-all");
    if (openAll) openAll.addEventListener("click", function () { openPick("all"); });
    var dropStrava = document.getElementById("drop-strava");
    if (dropStrava) dropStrava.addEventListener("click", disconnectStrava);
    var dropKomoot = document.getElementById("drop-komoot");
    if (dropKomoot) dropKomoot.addEventListener("click", disconnectKomoot);
    var gpx = document.getElementById("gpx");
    if (gpx) gpx.addEventListener("change", function () { readGpxFiles(gpx.files); });
    var example = document.getElementById("example");
    if (example) example.addEventListener("click", loadExample);
    var complete = document.getElementById("complete");
    if (complete) complete.addEventListener("click", completeAuth);
    var load = document.getElementById("load");
    if (load) load.addEventListener("click", loadActivities);
    var sources = document.getElementById("sources");
    if (sources) sources.addEventListener("click", function () {
      state.mode = "setup";
      state.panel = "home";
      state.error = "";
      render();
    });
    var draw = document.getElementById("draw");
    if (draw) draw.addEventListener("click", drawSelected);
    var cancel = document.getElementById("cancel");
    if (cancel) cancel.addEventListener("click", function () {
      state.cancel = true;
      var progress = document.getElementById("progress");
      if (progress) progress.textContent = "Wird abgebrochen…";
    });
    var back = document.getElementById("back");
    if (back) back.addEventListener("click", function () {
      state.mode = state.source === "gpx" ? "setup" : "pick";
      render();
    });
    bindChips("sport", function (value) {
      state.sport = value;
      paintRides();
    });
    bindChips("source", function (value) {
      state.sourceFilter = value;
      paintRides();
    });
    bindChips("kind", function (value) {
      state.kind = value;
      paintRides();
    });
    bindChips("format", function (value) {
      state.options.fmt = value;
      refreshPreview();
    });
    var indoor = document.getElementById("indoor");
    if (indoor) indoor.addEventListener("change", function () {
      state.showIndoor = indoor.checked;
      paintRides();
    });
    var query = document.getElementById("query");
    if (query) query.addEventListener("input", function () {
      state.query = query.value;
      paintRides();
    });
    var from = document.getElementById("from");
    var to = document.getElementById("to");
    if (from) from.addEventListener("change", function () { state.range.from = from.value; });
    if (to) to.addEventListener("change", function () { state.range.to = to.value; });
    var all = document.getElementById("all");
    if (all) all.addEventListener("click", toggleVisible);
    document.querySelectorAll("[data-share]").forEach(function (button) {
      button.addEventListener("click", function () {
        var kind = button.getAttribute("data-share");
        if (kind === "svg") shareSvgFile(button);
        else if (kind === "album") shareAlbum(button);
        else sharePngFile(button);
      });
    });
    ["title", "start-label", "end-label"].forEach(function (id) {
      var field = document.getElementById(id);
      if (!field) return;
      field.addEventListener("input", function () {
        if (id === "title") state.options.title = field.value;
        if (id === "start-label") state.options.startLabel = field.value;
        if (id === "end-label") state.options.endLabel = field.value;
        refreshPreview();
      });
    });
    var byDay = document.getElementById("by-day");
    if (byDay) byDay.addEventListener("change", function () {
      state.options.colorByDay = byDay.checked;
      paintStageDots();
      refreshPreview();
    });
    var basemap = document.getElementById("basemap");
    if (basemap) basemap.addEventListener("change", function () {
      state.options.basemap = basemap.checked;
      refreshPreview();
    });
    bindStageEditors();
    bindAlbum();
    bindPhotos();
    document.querySelectorAll("[data-route]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.options.route = button.getAttribute("data-route");
        document.querySelectorAll("[data-route]").forEach(function (item) {
          item.classList.toggle("on", item === button);
        });
        refreshPreview();
        paintStageDots();
      });
    });
    bindWaypointList();
    var placeQuery = document.getElementById("place-query");
    if (placeQuery) {
      placeQuery.addEventListener("input", function () {
        schedulePlaceSearch(placeQuery.value);
      });
      placeQuery.addEventListener("keydown", function (event) {
        var hits = state.placeHits || [];
        if (event.key === "ArrowDown" && hits.length) {
          event.preventDefault();
          state.placeActive = (state.placeActive + 1) % hits.length;
          paintPlaceSearch();
        } else if (event.key === "ArrowUp" && hits.length) {
          event.preventDefault();
          state.placeActive = state.placeActive <= 0 ? hits.length - 1 : state.placeActive - 1;
          paintPlaceSearch();
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (hits.length) choosePlace(hits[state.placeActive >= 0 ? state.placeActive : 0]);
          else schedulePlaceSearch(placeQuery.value, 0);
        } else if (event.key === "Escape") {
          state.placeHits = [];
          state.placeActive = -1;
          state.placeGeneration += 1;
          clearTimeout(state.placeTimer);
          state.placeHint = "";
          paintPlaceSearch();
        }
      });
    }
  }

  function stageListHtml() {
    var facts = state.tour ? TourkarteMap.stageFacts(state.tour) : [];
    if (!facts.length) return "";
    ensurePlaces(facts.length);
    var album = facts.length >= 2;
    var rows = facts.map(function (fact, index) {
      var place = state.options.stagePlaces[index];
      var stage = state.tour.stages[index] || {};
      var on = stage.included !== false;
      var title = (index + 1) + ". Etappe";
      return [
        '<article class="stage' + (album && !on ? " off" : "") + '" data-stage-card="' + index + '">',
        '<span class="dot" data-stage-dot style="background:' + stageColor(index, facts.length) + '"></span>',
        "<div>",
        '<div class="stage-line">',
        "<h3>" + esc(title) + "</h3>",
        '<span class="when">' + esc(fact.shortDate || fact.date) + "</span>",
        "<span></span>",
        '<span class="km">' + esc(fact.kmLabel) + "</span>",
        '<span class="hm">' + esc(fact.hmLabel) + "</span>",
        "</div>",
        album
          ? '<label>Name<input data-stage-name="' + index + '" value="' + esc(stage.name || "") + '" placeholder="Name der Etappe"></label>'
          : (fact.name ? "<p>" + esc(fact.name) + "</p>" : ""),
        '<div class="dates">',
        '<label>Start<input data-stage="' + index + '" data-place="start" value="' + esc(place.start) + '" placeholder="Ort"></label>',
        '<label>Ziel<input data-stage="' + index + '" data-place="end" value="' + esc(place.end) + '" placeholder="Ort"></label>',
        "</div>",
        album ? '<label class="checkline"><input type="checkbox" data-stage-on="' + index + '"' + (on ? " checked" : "") + "> In der Übersicht</label>" : "",
        album ? '<button type="button" class="text-button stage-open" data-open-stage="' + index + '">Etappe ansehen</button>' : "",
        "</div>",
        "</article>"
      ].join("");
    }).join("");
    return '<section class="stages"><h2>Etappen</h2>' + rows + "</section>";
  }

  function ensurePlaces(count) {
    var current = state.options.stagePlaces || [];
    var next = [];
    for (var index = 0; index < count; index += 1) {
      next.push({
        start: current[index] && current[index].start || "",
        end: current[index] && current[index].end || ""
      });
    }
    state.options.stagePlaces = next;
    return next;
  }

  function stageColor(index, count) {
    if (state.options.colorByDay && count > 1) {
      return TourkarteMap.dayColor(index, count);
    }
    return state.options.route;
  }

  function fillPlaces() {
    if (!state.tour || state.fillingPlaces) return;
    ensurePlaces((state.tour.stages || []).length);
    var jobs = [];
    (state.tour.stages || []).forEach(function (stage, index) {
      var points = [];
      (stage.segments || []).forEach(function (segment) { points = points.concat(segment || []); });
      if (points.length < 2) return;
      [["start", points[0]], ["end", points[points.length - 1]]].forEach(function (pair) {
        if (!state.options.stagePlaces[index][pair[0]]) jobs.push({ index: index, key: pair[0], point: pair[1] });
      });
    });
    if (!jobs.length) return;
    var generation = state.placeGeneration || 0;
    state.fillingPlaces = true;
    var cursor = 0;
    function step() {
      if (generation !== state.placeGeneration) {
        state.fillingPlaces = false;
        return;
      }
      if (cursor >= jobs.length) {
        state.fillingPlaces = false;
        var done = document.getElementById("map-status");
        if (done) done.textContent = "";
        refreshPreview();
        return;
      }
      var job = jobs[cursor];
      cursor += 1;
      var status = document.getElementById("map-status");
      if (status) status.textContent = "Orte werden gesucht, " + cursor + " von " + jobs.length;
      nearestTown(job.point).then(function (name) {
        if (generation !== state.placeGeneration || !name) return;
        var inputs = document.querySelectorAll('[data-stage="' + job.index + '"][data-place="' + job.key + '"]');
        var typed = inputs.length ? inputs[0].value.trim() : state.options.stagePlaces[job.index][job.key];
        if (typed) return;
        state.options.stagePlaces[job.index][job.key] = name;
        inputs.forEach(function (input) { input.value = name; });
      }).catch(function () {}).then(function () {
        setTimeout(step, 1100);
      });
    }
    step();
  }

  var townCache = {};
  var placeCache = {};
  var nominatimNotBefore = 0;
  var nominatimTail = Promise.resolve();

  function nominatimFetch(url, stillWanted) {
    var task = nominatimTail.then(function () {
      return waitNominatim(stillWanted);
    }).then(function (ready) {
      if (!ready) return null;
      nominatimNotBefore = Date.now() + 1100;
      return fetch(url, {
        headers: {
          "Accept-Language": "de,en",
          "User-Agent": "tourkarte"
        }
      });
    });
    nominatimTail = task.then(function () { return null; }, function () { return null; });
    return task;
  }

  function waitNominatim(stillWanted) {
    return new Promise(function (resolve) {
      function check() {
        if (stillWanted && !stillWanted()) {
          resolve(false);
          return;
        }
        var wait = nominatimNotBefore - Date.now();
        if (wait > 0) setTimeout(check, wait);
        else resolve(true);
      }
      check();
    });
  }

  function nearestTown(point) {
    if (!point || point.lat == null || point.lon == null) return Promise.resolve("");
    var key = Number(point.lat).toFixed(2) + "," + Number(point.lon).toFixed(2);
    if (!townCache[key]) {
      var url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=10&lat=" + encodeURIComponent(point.lat) + "&lon=" + encodeURIComponent(point.lon);
      townCache[key] = nominatimFetch(url).then(function (response) {
        if (!response || !response.ok) throw new Error("Ort");
        return response.json();
      }).then(function (payload) {
        return TourkarteMap.largerPlace(payload && payload.address, payload && payload.name);
      }).catch(function (error) {
        delete townCache[key];
        throw error;
      });
    }
    return townCache[key];
  }

  function placeSearchHtml() {
    var disabled = state.tour ? "" : " disabled";
    var open = state.placeHits && state.placeHits.length;
    return [
      '<section class="waypoints">',
      "<h2>Besondere Punkte</h2>",
      '<label>Ort suchen<input id="place-query" type="search" value="' + esc(state.placeQuery || "") + '" placeholder="z. B. Olymp" autocomplete="off" autocorrect="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="' + (open ? "true" : "false") + '" aria-controls="place-results"' + disabled + "></label>",
      '<div id="place-results" class="place-results" role="listbox"' + (open ? "" : " hidden") + "></div>",
      '<p id="place-hint" class="status" aria-live="polite"' + (state.placeHint ? "" : " hidden") + ">" + esc(state.placeHint || "") + "</p>",
      '<div id="waypoint-mount" aria-live="polite">' + waypointMountHtml() + "</div>",
      "</section>"
    ].join("");
  }

  function waypointMountHtml() {
    if (!state.tour) return '<p class="status">Zuerst eine Tour laden.</p>';
    var points = state.tour.waypoints || [];
    if (!points.length) return '<p class="status">Noch keine besonderen Punkte.</p>';
    return "<ul class=\"waypoint-list\">" + points.map(function (point, index) {
      var name = point.name || "Ohne Namen";
      var coord = TourkarteMap.formatLatLon(point.lat, point.lon);
      return [
        '<li class="waypoint-row">',
        "<span><strong>" + esc(name) + "</strong>",
        coord ? "<small>" + esc(coord) + "</small>" : "",
        "</span>",
        '<button type="button" class="text-button" data-remove-waypoint="' + index + '" aria-label="' + esc(name) + ' entfernen">Entfernen</button>',
        "</li>"
      ].join("");
    }).join("") + "</ul>";
  }

  function paintWaypointList() {
    var mount = document.getElementById("waypoint-mount");
    if (!mount) return;
    mount.innerHTML = waypointMountHtml();
    bindWaypointList();
  }

  function bindWaypointList() {
    document.querySelectorAll("[data-remove-waypoint]").forEach(function (button) {
      button.addEventListener("click", function () {
        removeWaypoint(Number(button.getAttribute("data-remove-waypoint")));
      });
    });
  }

  function paintPlaceSearch() {
    var input = document.getElementById("place-query");
    var results = document.getElementById("place-results");
    var hint = document.getElementById("place-hint");
    var open = state.placeHits && state.placeHits.length;
    if (input) {
      input.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && state.placeActive >= 0) input.setAttribute("aria-activedescendant", "place-option-" + state.placeActive);
      else input.removeAttribute("aria-activedescendant");
    }
    if (hint) {
      hint.textContent = state.placeHint || "";
      hint.hidden = !state.placeHint;
    }
    if (!results) return;
    if (!open) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    results.hidden = false;
    results.innerHTML = state.placeHits.map(function (place, index) {
      var coord = TourkarteMap.formatLatLon(place.lat, place.lon);
      return [
        '<button type="button" class="place-hit' + (index === state.placeActive ? " on" : "") + '" id="place-option-' + index + '" role="option" data-place="' + index + '" aria-selected="' + (index === state.placeActive ? "true" : "false") + '">',
        "<strong>" + esc(place.name) + "</strong>",
        place.label && place.label !== place.name ? "<small>" + esc(place.label) + "</small>" : "",
        coord ? '<small class="coord">' + esc(coord) + "</small>" : "",
        "</button>"
      ].join("");
    }).join("");
    results.querySelectorAll("[data-place]").forEach(function (button) {
      button.addEventListener("click", function () {
        choosePlace(state.placeHits[Number(button.getAttribute("data-place"))]);
      });
    });
    var active = document.getElementById("place-option-" + state.placeActive);
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function schedulePlaceSearch(value, delay) {
    state.placeQuery = value;
    state.placeGeneration += 1;
    var generation = state.placeGeneration;
    clearTimeout(state.placeTimer);
    var trimmed = String(value || "").trim();
    if (trimmed.length < 2) {
      state.placeHits = [];
      state.placeActive = -1;
      state.placeHint = trimmed ? "Mindestens zwei Buchstaben." : "";
      paintPlaceSearch();
      return;
    }
    state.placeTimer = setTimeout(function () {
      if (generation !== state.placeGeneration) return;
      var viewbox = TourkarteMap.tourViewbox(state.tour);
      var cacheKey = trimmed.toLowerCase() + "|" + viewbox;
      if (placeCache[cacheKey]) {
        showPlaceHits(placeCache[cacheKey], generation);
        return;
      }
      state.placeHits = [];
      state.placeActive = -1;
      state.placeHint = "Wird gesucht…";
      paintPlaceSearch();
      var url = TourkarteMap.searchPlacesUrl(trimmed, viewbox);
      nominatimFetch(url, function () { return generation === state.placeGeneration; }).then(function (response) {
        if (generation !== state.placeGeneration || !response) return null;
        if (!response.ok) throw new Error("Suche");
        return response.json();
      }).then(function (payload) {
        if (generation !== state.placeGeneration || payload == null) return;
        if (payload && payload.error) throw new Error("Suche");
        var hits = TourkarteMap.placesFromSearch(payload);
        placeCache[cacheKey] = hits;
        showPlaceHits(hits, generation);
      }).catch(function () {
        if (generation !== state.placeGeneration) return;
        state.placeHits = [];
        state.placeActive = -1;
        state.placeHint = "Die Ortssuche ist gerade nicht erreichbar.";
        paintPlaceSearch();
      });
    }, delay == null ? 450 : delay);
  }

  function showPlaceHits(hits, generation) {
    if (generation !== state.placeGeneration) return;
    state.placeHits = hits;
    state.placeActive = hits.length ? 0 : -1;
    state.placeHint = hits.length ? "" : "Keine Orte gefunden.";
    paintPlaceSearch();
  }

  function choosePlace(place) {
    if (!place) return;
    if (!state.tour) {
      state.placeHits = [];
      state.placeActive = -1;
      state.placeHint = "Zuerst eine Tour laden.";
      paintPlaceSearch();
      return;
    }
    if (!state.tour.waypoints) state.tour.waypoints = [];
    var exists = state.tour.waypoints.some(function (point) {
      return point.name === place.name
        && Math.abs(Number(point.lat) - place.lat) < 0.00001
        && Math.abs(Number(point.lon) - place.lon) < 0.00001;
    });
    if (!exists) state.tour.waypoints.push({ lat: place.lat, lon: place.lon, name: place.name });
    state.placeQuery = "";
    state.placeHits = [];
    state.placeActive = -1;
    state.placeGeneration += 1;
    clearTimeout(state.placeTimer);
    state.placeHint = exists ? place.name + " steht schon auf der Karte." : "";
    var input = document.getElementById("place-query");
    if (input) input.value = "";
    paintPlaceSearch();
    paintWaypointList();
    if (!exists) refreshPreview();
  }

  function removeWaypoint(index) {
    if (!state.tour || !state.tour.waypoints) return;
    if (index < 0 || index >= state.tour.waypoints.length) return;
    state.tour.waypoints.splice(index, 1);
    paintWaypointList();
    refreshPreview();
  }

  function resetPlaceSearch() {
    clearTimeout(state.placeTimer);
    state.placeQuery = "";
    state.placeHits = [];
    state.placeHint = "";
    state.placeActive = -1;
    state.placeGeneration += 1;
  }

  function paintStageDots() {
    var count = document.querySelectorAll("[data-stage-dot]").length;
    document.querySelectorAll("[data-stage-dot]").forEach(function (dot, index) {
      dot.style.background = stageColor(index, count);
    });
  }

  function homeHtml() {
    return [
      '<header class="top">',
      '<p class="eyebrow">Fotoalbum</p>',
      "<h1>Tourkarte</h1>",
      '<p class="lead">Etappen aus Strava oder Komoot auswählen. Daraus wird ein Album: die Übersicht und eine Seite je Tag.</p>',
      "</header>",
      errorHtml(),
      '<section class="sources">',
      sourceCard("strava", "Strava", "Fahrten", hasStrava()
        ? (state.session.athleteName ? "Verbunden als " + state.session.athleteName + "." : "Mit Strava verbunden.")
        : "Aufgezeichnete Aktivitäten mit GPS.", hasStrava(), hasStrava() && hasKomoot()),
      sourceCard("komoot", "Komoot", "Touren", hasKomoot()
        ? (state.komoot.displayName ? "Verbunden als " + state.komoot.displayName + "." : "Mit Komoot verbunden.")
        : "Aufgezeichnete und geplante Touren, direkt als GPX.", hasKomoot(), hasStrava() && hasKomoot()),
      "</section>",
      hasStrava() && hasKomoot() ? '<button type="button" id="open-all" class="primary">Alle Touren in einer Liste</button>' : "",
      '<p class="or">oder eine GPX-Datei</p>',
      '<label class="secondary file-button">GPX wählen<input id="gpx" type="file" accept=".gpx,application/gpx+xml,text/xml" multiple hidden></label>',
      '<button type="button" id="example" class="text-button">Beispiel ansehen</button>'
    ].join("");
  }

  function sourceCard(source, eyebrow, title, copy, connected, quiet) {
    var open = source === "strava" ? "open-strava" : "open-komoot";
    var drop = source === "strava" ? "drop-strava" : "drop-komoot";
    return [
      '<article class="source">',
      '<p class="eyebrow">' + esc(eyebrow) + "</p>",
      "<h2>" + esc(title) + "</h2>",
      "<p>" + esc(copy) + "</p>",
      '<button type="button" id="' + open + '" class="' + (quiet ? "secondary" : "primary") + '">' + (connected ? "Touren anzeigen" : "Verbinden") + "</button>",
      connected ? '<button type="button" id="' + drop + '" class="text-button">Trennen</button>' : "",
      "</article>"
    ].join("");
  }

  function stravaConnectHtml() {
    var host = location.hostname || "diese Domain";
    var oauthNote = canOAuth()
      ? ""
      : '<p class="error">Die Strava-Anmeldung braucht die Seite über https. Auf dem iPhone die gehostete Adresse öffnen, nicht die Datei selbst.</p>';
    return [
      '<header class="top">',
      '<button type="button" id="back-home" class="text-button back">Quellen</button>',
      '<p class="eyebrow">Strava</p>',
      "<h1>Verbinden</h1>",
      '<p class="lead">Die eigenen Aktivitäten lesen. Client-ID und Client-Secret bleiben auf diesem Gerät.</p>',
      "</header>",
      errorHtml(),
      oauthNote,
      "<details class=\"steps\">",
      "<summary>Strava einmal einrichten</summary>",
      "<ol>",
      '<li><a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> öffnen und eine App anlegen.</li>',
      "<li>Als Authorization Callback Domain eintragen: <strong>" + esc(host) + "</strong></li>",
      "<li>Client-ID und Client-Secret hier einfügen.</li>",
      "</ol>",
      "</details>",
      '<label>Client-ID<input id="client-id" inputmode="numeric" autocomplete="off" value="' + esc(state.session && state.session.clientId || "") + '"></label>',
      '<label>Client-Secret<input id="client-secret" type="password" autocomplete="off"></label>',
      '<button type="button" id="connect" class="primary">Mit Strava verbinden</button>'
    ].join("");
  }

  function komootConnectHtml() {
    var fileNote = location.protocol === "file:"
      ? '<p class="error">Komoot braucht die Seite über den lokalen Server oder über https.</p>'
      : "";
    return [
      '<header class="top">',
      '<button type="button" id="back-home" class="text-button back">Quellen</button>',
      '<p class="eyebrow">Komoot</p>',
      "<h1>Verbinden</h1>",
      '<p class="lead">E-Mail und Passwort der Komoot-Anmeldung. Das Passwort wird nur zum Einloggen benutzt und nicht gespeichert. Auf diesem Gerät bleibt der Zugang zu den eigenen Touren.</p>',
      "</header>",
      errorHtml(),
      fileNote,
      '<label>E-Mail<input id="komoot-email" type="email" autocomplete="username" value="' + esc(state.komootEmail) + '"></label>',
      '<label>Passwort<input id="komoot-password" type="password" autocomplete="current-password"></label>',
      '<button type="button" id="komoot-connect" class="primary">Mit Komoot verbinden</button>'
    ].join("");
  }

  function finishHtml() {
    return [
      '<header class="top">',
      '<p class="eyebrow">Strava</p>',
      "<h1>Zugang bestätigen</h1>",
      "<p class=\"lead\">Strava hat zugestimmt. Das Client-Secret noch einmal eintragen, dann werden die Fahrten geladen.</p>",
      "</header>",
      errorHtml(),
      '<label>Client-ID<input id="client-id" inputmode="numeric" autocomplete="off" value="' + esc((state.session && state.session.clientId) || "") + '"></label>',
      '<label>Client-Secret<input id="client-secret" type="password" autocomplete="off"></label>',
      '<button type="button" id="complete" class="primary">Fahrten laden</button>'
    ].join("");
  }

  function pickHtml() {
    var eyebrow = state.sourceFilter === "strava" ? "Strava" : (state.sourceFilter === "komoot" ? "Komoot" : "Touren");
    var showKind = hasKomoot() && state.sourceFilter !== "strava";
    var showIndoor = hasStrava() && state.sourceFilter !== "komoot";
    return [
      '<header class="top split">',
      "<div><p class=\"eyebrow\">" + esc(eyebrow) + "</p><h1>Etappen wählen</h1></div>",
      '<button type="button" id="sources" class="text-button">Quellen</button>',
      "</header>",
      '<p class="who">' + esc(connectedLine()) + "</p>",
      errorHtml(),
      '<div class="dates">',
      '<label>Von<input id="from" type="date" value="' + esc(state.range.from) + '"></label>',
      '<label>Bis<input id="to" type="date" value="' + esc(state.range.to) + '"></label>',
      "</div>",
      hasStrava() && hasKomoot() ? '<p class="filter-label">Quelle</p><div class="chips" id="source">' + chip("source", "all", "Alle") + chip("source", "strava", "Strava") + chip("source", "komoot", "Komoot") + "</div>" : "",
      '<p class="filter-label">Sport</p>',
      '<div class="chips" id="sport">',
      chip("sport", "bike", "Fahrrad"),
      chip("sport", "all", "Alle"),
      "</div>",
      showKind ? '<p class="filter-label">Art</p><div class="chips" id="kind">' + chip("kind", "recorded", "Aufgezeichnet") + chip("kind", "planned", "Geplant") + chip("kind", "all", "Alle") + "</div>" : "",
      showIndoor ? '<label class="checkline"><input id="indoor" type="checkbox"' + (state.showIndoor ? " checked" : "") + "> Indoor und virtuell zeigen</label>" : "",
      '<label class="search">Suche<input id="query" type="search" value="' + esc(state.query) + '" placeholder="Name der Tour"></label>',
      '<button type="button" id="load" class="secondary">Touren laden</button>',
      '<p id="status" class="status" aria-live="polite">' + esc(state.status) + "</p>",
      '<div class="list-tools"><p id="shown" class="count"></p><button type="button" id="all" class="text-button">Sichtbare an- oder abwählen</button></div>',
      '<div id="rides" class="rides"></div>',
      '<div class="dock">',
      '<button type="button" id="draw" class="primary">Karte zeichnen</button>',
      '<label class="secondary file-button dock-file">GPX öffnen<input id="gpx" type="file" accept=".gpx,application/gpx+xml,text/xml" multiple hidden></label>',
      "</div>"
    ].join("");
  }

  function workingHtml() {
    return [
      '<div class="working">',
      '<p class="eyebrow">Tourkarte</p>',
      '<p id="progress" class="status-big" aria-live="polite">' + esc(state.status || "Die Touren werden geholt…") + "</p>",
      '<button type="button" id="cancel" class="secondary">Abbrechen</button>',
      "</div>"
    ].join("");
  }

  function mapHtml() {
    if (stageCount() >= 2) return albumHtml();
    return singleMapHtml();
  }

  function singleMapHtml() {
    return [
      '<header class="top split">',
      '<button type="button" id="back" class="text-button">Zurück</button>',
      "<h1>Albumseite</h1>",
      "</header>",
      errorHtml(),
      state.skipped.length ? '<p class="status">' + esc(skippedText()) + "</p>" : "",
      '<div id="preview" class="preview"></div>',
      overviewControlsHtml(),
      '<p id="map-status" class="status"></p>',
      stageListHtml(),
      photoHtml(0),
      shareButtonsHtml(),
      saveHintHtml()
    ].join("");
  }

  function albumHtml() {
    var facts = TourkarteMap.stageFacts(state.tour);
    ensurePlaces(facts.length);
    var pages = [
      '<section class="album-page" data-album-page="overview">',
      errorHtml(),
      state.skipped.length ? '<p class="status">' + esc(skippedText()) + "</p>" : "",
      '<div id="preview" class="preview"></div>',
      overviewControlsHtml(),
      '<p id="map-status" class="status"></p>',
      stageListHtml(),
      shareButtonsHtml(),
      saveHintHtml(),
      "</section>"
    ];
    facts.forEach(function (fact, index) { pages.push(stagePageHtml(fact, index)); });
    return [
      '<header class="top split">',
      '<button type="button" id="back" class="text-button">Zurück</button>',
      "<h1>Album</h1>",
      "</header>",
      '<div class="album-nav">',
      '<div class="album-bar">',
      '<button type="button" id="album-prev" class="text-button" disabled>Vorherige</button>',
      '<p id="album-pos" class="album-pos" aria-live="polite">Übersicht</p>',
      '<button type="button" id="album-next" class="text-button">Nächste</button>',
      "</div>",
      '<div class="album-home" id="album-home-row" hidden>',
      '<button type="button" id="album-home" class="text-button">Zur Übersicht</button>',
      "</div>",
      "</div>",
      '<div class="album-track" id="album-track" tabindex="0" aria-label="Albumseiten">',
      pages.join(""),
      "</div>"
    ].join("");
  }

  function stagePageHtml(fact, index) {
    var stage = state.tour.stages[index] || {};
    var place = (state.options.stagePlaces && state.options.stagePlaces[index]) || { start: "", end: "" };
    var on = stage.included !== false;
    var meta = [fact.kmLabel, fact.hmLabel].filter(Boolean).join(" · ");
    return [
      '<section class="album-page" data-album-page="' + index + '">',
      '<p class="eyebrow">Etappe ' + (index + 1) + (fact.date ? " · " + esc(fact.date) : "") + "</p>",
      '<div id="preview-stage-' + index + '" class="preview"></div>',
      meta ? '<p class="stage-meta">' + esc(meta) + "</p>" : "",
      '<label>Name<input data-stage-name="' + index + '" value="' + esc(stage.name || "") + '" placeholder="Name der Etappe"></label>',
      '<div class="dates">',
      '<label>Start<input data-stage="' + index + '" data-place="start" value="' + esc(place.start) + '" placeholder="Ort"></label>',
      '<label>Ziel<input data-stage="' + index + '" data-place="end" value="' + esc(place.end) + '" placeholder="Ort"></label>',
      "</div>",
      '<label class="checkline"><input type="checkbox" data-stage-on="' + index + '"' + (on ? " checked" : "") + "> In der Übersicht</label>",
      '<p class="status" data-included-note="' + index + '"' + (on ? " hidden" : "") + ">Diese Etappe ist nicht in der Übersicht.</p>",
      photoHtml(index),
      '<p id="stage-status-' + index + '" class="status"></p>',
      shareButtonsHtml(),
      "</section>"
    ].join("");
  }

  function overviewControlsHtml() {
    var stages = stageCount();
    return [
      '<label>Titel<input id="title" value="' + esc(state.options.title) + '" placeholder="Titel der Tour"></label>',
      '<div class="dates">',
      '<label>Start<input id="start-label" value="' + esc(state.options.startLabel) + '" placeholder="Ort"></label>',
      '<label>Ziel<input id="end-label" value="' + esc(state.options.endLabel) + '" placeholder="Ort"></label>',
      "</div>",
      placeSearchHtml(),
      '<div class="chips" id="format">',
      chip("format", "square", "Quadrat"),
      chip("format", "a4", "A4 quer"),
      chip("format", "a4-hoch", "A4 hoch"),
      "</div>",
      '<div class="swatches">' + ROUTES.map(function (color) {
        return '<button type="button" class="swatch' + (color === state.options.route ? " on" : "") + '" data-route="' + color + '" style="background:' + color + '" aria-label="Linienfarbe ' + color + '"></button>';
      }).join("") + "</div>",
      '<label class="checkline"><input id="basemap" type="checkbox"' + (state.options.basemap ? " checked" : "") + "> Karte im Hintergrund</label>",
      stages > 1 ? '<label class="checkline"><input id="by-day" type="checkbox"' + (state.options.colorByDay ? " checked" : "") + "> Etappen farblich</label>" : ""
    ].join("");
  }

  function shareButtonsHtml() {
    return [
      '<button type="button" class="primary" data-share="svg">' + (saveOnDesktop() ? "SVG speichern" : "SVG teilen") + "</button>",
      '<button type="button" class="secondary" data-share="png">' + (saveOnDesktop() ? "Bild speichern" : "Bild teilen") + "</button>",
      albumSaveHtml()
    ].join("");
  }

  function albumSaveHtml() {
    if (stageCount() < 2) return "";
    return [
      '<button type="button" class="secondary" data-share="album">' + (saveOnDesktop() ? "Alle Seiten speichern" : "Alle Seiten teilen") + "</button>",
      '<p class="status">Die Seiten lassen sich als Fotos in ein CEWE-, Saal-Digital- oder Pixum-Fotobuch laden.</p>'
    ].join("");
  }

  function saveHintHtml() {
    return saveOnDesktop() ? '<p class="status">Im Fenster den Ordner Desktop wählen. Die Datei liegt danach dort.</p>' : "";
  }

  function photoHtml(index) {
    var count = (state.photos[index] || []).length;
    return [
      '<section class="photos">',
      "<h2>Fotos</h2>",
      '<p class="status" data-photo-empty="' + index + '"' + (count ? " hidden" : "") + ">Noch keine Fotos an diesem Tag.</p>",
      '<div class="photo-grid' + (count === 1 ? " single" : "") + '" data-photo-grid="' + index + '">' + photoFigures(index) + "</div>",
      '<label class="secondary file-button">Fotos hinzufügen<input type="file" accept="image/*" multiple hidden data-add-photo="' + index + '"></label>',
      '<p class="status" data-photo-note="' + index + '"></p>',
      '<p class="status">Die Fotos bleiben auf diesem Gerät. Sie stehen auf dem Bild dieser Etappe.</p>',
      "</section>"
    ].join("");
  }

  function photoFigures(index) {
    return (state.photos[index] || []).map(function (photo) {
      return [
        '<figure class="photo">',
        '<img src="' + esc(photo.url) + '" alt="' + esc(photo.name || "Foto") + '">',
        '<button type="button" class="text-button" data-remove-photo="' + index + '" data-photo-id="' + esc(photo.id) + '">Entfernen</button>',
        "</figure>"
      ].join("");
    }).join("");
  }

  function errorHtml() {
    return state.error ? '<p class="error">' + esc(state.error) + "</p>" : "";
  }

  function chip(group, value, label) {
    var current = group === "sport" ? state.sport
      : group === "source" ? state.sourceFilter
      : group === "kind" ? state.kind
      : state.options.fmt;
    return '<button type="button" class="chip' + (current === value ? " on" : "") + '" data-' + group + '="' + value + '">' + label + "</button>";
  }

  function bindChips(group, onChange) {
    document.querySelectorAll("[data-" + group + "]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll("[data-" + group + "]").forEach(function (item) { item.classList.remove("on"); });
        button.classList.add("on");
        onChange(button.getAttribute("data-" + group));
      });
    });
  }

  function startAuth() {
    state.error = "";
    if (!canOAuth()) {
      state.error = "Die Strava-Anmeldung braucht https.";
      render();
      return;
    }
    var clientId = valueOf("client-id");
    var clientSecret = valueOf("client-secret");
    if (!/^\d+$/.test(clientId) || !clientSecret) {
      state.error = "Client-ID und Client-Secret aus den Strava-Einstellungen eintragen.";
      state.panel = "strava";
      render();
      return;
    }
    var oauthState = TourkarteStrava.makeState(clientId);
    sessionStorage.setItem(STATE_KEY, oauthState);
    state.session = {
      clientId: clientId,
      clientSecret: clientSecret,
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      athleteName: ""
    };
    saveSession(state.session);
    location.assign(TourkarteStrava.authorizeUrl(clientId, TourkarteStrava.redirectUri(location.href), oauthState));
  }

  function completeAuth() {
    var clientId = valueOf("client-id");
    var clientSecret = valueOf("client-secret");
    if (!/^\d+$/.test(clientId) || !clientSecret || !state.pendingCode) {
      state.error = "Client-ID, Client-Secret und der Strava-Code werden gebraucht.";
      render();
      return;
    }
    state.session = {
      clientId: clientId,
      clientSecret: clientSecret,
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      athleteName: state.session && state.session.athleteName || ""
    };
    state.mode = "working";
    state.job = "strava-exchange";
    state.cancel = false;
    state.status = "Strava wird verbunden…";
    render();
    finishExchange(state.pendingCode);
  }

  function startKomoot() {
    state.error = "";
    var email = valueOf("komoot-email");
    var password = valueOf("komoot-password");
    state.komootEmail = email;
    if (email.indexOf("@") === -1 || !password) {
      state.error = "E-Mail und Passwort von Komoot eintragen.";
      state.panel = "komoot";
      render();
      return;
    }
    state.cancel = false;
    state.job = "komoot-login";
    state.mode = "working";
    state.status = "Komoot wird verbunden…";
    render();
    TourkarteKomoot.login(email, password, fetch).then(function (session) {
      if (state.cancel) {
        state.cancel = false;
        state.mode = "setup";
        state.panel = "komoot";
        render();
        return;
      }
      state.komoot = session;
      state.komootEmail = session.email;
      saveKomoot(session);
      state.error = "";
      openPick("komoot");
    }).catch(function (error) {
      state.error = error.message || "Die Anmeldung ist fehlgeschlagen.";
      state.mode = "setup";
      state.panel = "komoot";
      render();
    });
  }

  function openPick(filter) {
    state.sourceFilter = filter;
    state.mode = "pick";
    state.error = "";
    ensureRange();
    render();
    loadActivities();
  }

  function finishExchange(code) {
    TourkarteStrava.exchangeCode(state.session, code, fetch).then(function (session) {
      if (state.cancel) {
        state.cancel = false;
        state.mode = "setup";
        state.panel = "strava";
        render();
        return;
      }
      state.session = session;
      state.pendingCode = "";
      saveSession(session);
      state.error = "";
      openPick(hasKomoot() ? "all" : "strava");
    }).catch(function (error) {
      state.error = error.message || "Die Anmeldung ist fehlgeschlagen.";
      state.panel = "strava";
      state.mode = state.session && state.session.clientSecret ? "setup" : "finish";
      render();
    });
  }

  function loadActivities() {
    ensureRange();
    var fromField = document.getElementById("from");
    var toField = document.getElementById("to");
    if (fromField && fromField.value) state.range.from = fromField.value;
    if (toField && toField.value) state.range.to = toField.value;
    if (state.range.to < state.range.from) {
      state.error = "Das Enddatum liegt vor dem Startdatum.";
      state.status = "";
      render();
      return;
    }
    state.error = "";
    state.status = "Touren werden gelesen…";
    setStatus(state.status);
    var button = document.getElementById("load");
    if (button) button.disabled = true;
    var jobs = [];
    if (hasStrava()) jobs.push(settle(loadStravaRides()));
    if (hasKomoot()) jobs.push(settle(loadKomootRides()));
    if (!jobs.length) {
      state.error = "Keine Quelle verbunden.";
      state.status = "";
      render();
      return;
    }
    Promise.all(jobs).then(function (parts) {
      var rides = [];
      var errors = [];
      parts.forEach(function (part) {
        rides = rides.concat(part.rides);
        if (part.error) errors.push(part.error);
      });
      rides = rides.filter(function (ride) {
        return inRangeDate(ride.when, state.range.from, state.range.to);
      });
      rides.sort(compareRides);
      var keep = {};
      rides.forEach(function (ride) {
        if (state.selected[ride.key]) keep[ride.key] = true;
      });
      state.rides = rides;
      state.selected = keep;
      state.error = errors.join(" ");
      state.status = rides.length ? "" : (state.error ? "" : "In diesem Zeitraum liegen keine Touren.");
      setStatus(state.status);
      if (button) button.disabled = false;
      var banner = document.querySelector(".error");
      if (state.error && !banner) render();
      else {
        if (banner && state.error) banner.textContent = state.error;
        if (banner && !state.error) banner.remove();
        paintRides();
      }
    });
  }

  function settle(promise) {
    return promise.then(function (rides) {
      return { rides: rides, error: "" };
    }, function (error) {
      return { rides: [], error: error.message || "Die Touren konnten nicht gelesen werden." };
    });
  }

  function loadStravaRides() {
    var range = TourkarteStrava.localRangeEpoch(state.range.from, state.range.to);
    return TourkarteStrava.ensureFresh(state.session, fetch).then(function (session) {
      state.session = session;
      saveSession(session);
      return TourkarteStrava.listActivities(session, range[0], range[1], fetch);
    }).then(function (activities) {
      return activities.map(stravaRide);
    });
  }

  function loadKomootRides() {
    return TourkarteKomoot.listTours(state.komoot, state.range.from, fetch).then(function (tours) {
      return tours.map(TourkarteKomoot.summarize);
    }).catch(function (error) {
      if (/abgelaufen/i.test(error.message || "")) {
        state.komoot = null;
        localStorage.removeItem(KOMOOT_STORAGE);
      }
      throw error;
    });
  }

  function stravaRide(activity) {
    var elevation = activity.total_elevation_gain;
    return {
      key: "strava:" + activity.id,
      source: "strava",
      id: activity.id,
      name: activity.name || "Fahrt",
      when: TourkarteStrava.localDate(activity),
      distance: Number(activity.distance) || 0,
      elevation: elevation == null || elevation === "" ? null : Number(elevation),
      sportLabel: TourkarteStrava.sportLabel(activity),
      kind: "recorded",
      activity: activity
    };
  }

  function paintRides() {
    var list = document.getElementById("rides");
    if (!list) return;
    var rides = visibleRides();
    var shown = document.getElementById("shown");
    if (shown) {
      if (!state.rides.length) shown.textContent = "";
      else if (rides.length === state.rides.length) {
        shown.textContent = rides.length + (rides.length === 1 ? " Tour" : " Touren");
      } else {
        shown.textContent = rides.length + " von " + state.rides.length;
      }
    }
    if (!state.rides.length) {
      list.innerHTML = "";
      updateDraw();
      return;
    }
    if (!rides.length) {
      list.innerHTML = '<p class="status">Nichts passt zum Filter. „Alle“ bei Sport und Art zeigt die übrigen Touren.</p>';
      updateDraw();
      return;
    }
    list.innerHTML = ridesHtml(rides);
    list.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("change", function () {
        var id = input.getAttribute("data-id");
        if (input.checked) state.selected[id] = true;
        else delete state.selected[id];
        updateDraw();
      });
    });
    updateDraw();
  }

  function ridesHtml(rides) {
    var html = "";
    var current = null;
    rides.forEach(function (ride) {
      var label = dayHeading(ride.when);
      if (label !== current) {
        if (current !== null) html += "</section>";
        current = label;
        html += '<section class="day"><h2>' + esc(label) + "</h2>";
      }
      html += rideHtml(ride);
    });
    if (current !== null) html += "</section>";
    return html;
  }

  function rideHtml(ride) {
    var checked = state.selected[ride.key] ? " checked" : "";
    var distance = ride.distance ? TourkarteMap.formatKm(Number(ride.distance)) : "";
    var gain = ride.elevation != null && isFinite(Number(ride.elevation)) ? TourkarteMap.formatHm(Number(ride.elevation)) : "";
    var meta = [distance, gain, ride.sportLabel, ride.kind === "planned" ? "Geplant" : ""].filter(Boolean).join(" · ");
    var komoot = ride.source === "komoot";
    return [
      '<label class="ride">',
      '<input type="checkbox" data-id="' + esc(ride.key) + '"' + checked + ">",
      '<span class="ride-body">',
      '<span class="ride-top"><strong>' + esc(ride.name) + "</strong>",
      '<span class="badge"><span class="mark" style="background:' + (komoot ? "#3e5340" : "#9c3412") + '"></span>' + (komoot ? "Komoot" : "Strava") + "</span>",
      "</span>",
      meta ? "<small>" + esc(meta) + "</small>" : "",
      "</span></label>"
    ].join("");
  }

  function visibleRides() {
    var query = state.query.trim().toLowerCase();
    var kind = state.sourceFilter === "strava" ? "recorded" : state.kind;
    return state.rides.filter(function (ride) {
      if (state.sourceFilter !== "all" && ride.source !== state.sourceFilter) return false;
      if (kind === "planned" && ride.kind !== "planned") return false;
      if (kind === "recorded" && ride.kind === "planned") return false;
      if (ride.source === "strava" && !TourkarteStrava.isSelected(ride.activity, state.sport, state.showIndoor)) return false;
      if (ride.source === "komoot" && state.sport === "bike" && !ride.bike) return false;
      if (query && String(ride.name || "").toLowerCase().indexOf(query) === -1) return false;
      return true;
    });
  }

  function toggleVisible() {
    var rides = visibleRides();
    var allOn = rides.length && rides.every(function (ride) { return state.selected[ride.key]; });
    rides.forEach(function (ride) {
      if (allOn) delete state.selected[ride.key];
      else state.selected[ride.key] = true;
    });
    paintRides();
  }

  function updateDraw() {
    var button = document.getElementById("draw");
    if (!button) return;
    var count = Object.keys(state.selected).length;
    button.disabled = count === 0;
    button.textContent = count ? "Karte aus " + count + (count === 1 ? " Etappe" : " Etappen") : "Etappen auswählen";
  }

  function drawSelected() {
    var chosen = state.rides.filter(function (ride) { return state.selected[ride.key]; });
    chosen.sort(compareRides);
    if (!chosen.length) return;
    state.cancel = false;
    state.job = "draw";
    state.skipped = [];
    state.mode = "working";
    state.status = "GPX wird geholt, 0 von " + chosen.length;
    render();
    var stages = [];
    var waypoints = [];
    var index = 0;
    function step() {
      if (state.cancel) {
        state.mode = "pick";
        state.status = "Abgebrochen.";
        render();
        return;
      }
      if (index >= chosen.length) {
        finishDraw(stages, chosen, waypoints);
        return;
      }
      var ride = chosen[index];
      index += 1;
      state.status = "GPX wird geholt, " + index + " von " + chosen.length;
      var progress = document.getElementById("progress");
      if (progress) progress.textContent = state.status;
      var pending = ride.source === "komoot" ? komootStage(ride, waypoints) : stravaStage(ride);
      pending.then(function (next) {
        stages = stages.concat(next);
        step();
      }).catch(function (error) {
        if (/begrenzt|Authorization|abgelaufen/i.test(error.message || "")) {
          if (ride.source === "komoot" && /abgelaufen/i.test(error.message || "")) {
            state.komoot = null;
            localStorage.removeItem(KOMOOT_STORAGE);
          }
          state.error = error.message;
          state.mode = "pick";
          render();
          return;
        }
        state.skipped.push((ride.name || "Tour") + ": " + (error.message || "ohne GPS"));
        step();
      });
    }
    step();
  }

  function finishDraw(stages, chosen, waypoints) {
    if (!stages.length) {
      state.error = "In den gewählten Touren liegt keine GPS-Linie.";
      state.mode = "pick";
      render();
      return;
    }
    var sources = {};
    chosen.forEach(function (ride) { sources[ride.source] = true; });
    var keys = Object.keys(sources);
    state.tour = { name: null, stages: stages, waypoints: waypoints || [] };
    resetPlaceSearch();
    state.source = keys.length === 1 ? keys[0] : "mixed";
    if (!state.options.title && stages.length === 1) state.options.title = stages[0].name;
    state.options.stagePlaces = [];
    resetAlbum();
    state.placeGeneration = (state.placeGeneration || 0) + 1;
    state.mode = "map";
    state.error = "";
    render();
  }

  function stravaStage(ride) {
    var activity = ride.activity;
    return TourkarteStrava.ensureFresh(state.session, fetch).then(function (session) {
      state.session = session;
      saveSession(session);
      return TourkarteStrava.activityStreams(session, activity.id, fetch);
    }).then(function (streams) {
      var points = TourkarteStrava.pointsFromStreams(streams, activity.start_date);
      if (points.length < 2) {
        var encoded = activity.map && (activity.map.polyline || activity.map.summary_polyline);
        if (encoded) points = TourkarteStrava.pointsFromPolyline(encoded);
      }
      if (points.length < 2) {
        state.skipped.push(ride.name || ("Fahrt " + ride.id));
        return [];
      }
      return [{
        name: ride.name || ("Fahrt " + ride.id),
        when: ride.when,
        segments: [points]
      }];
    });
  }

  function komootStage(ride, waypoints) {
    return TourkarteKomoot.downloadGpx(state.komoot, ride.id, fetch).then(function (text) {
      var tour;
      try {
        tour = TourkarteMap.parseGpx(text, ride.name);
      } catch (error) {
        state.skipped.push((ride.name || "Tour") + ": " + error.message);
        return [];
      }
      if (waypoints) {
        (tour.waypoints || []).forEach(function (point) {
          if (!point || !point.name || point.lat == null || point.lon == null) return;
          waypoints.push({ lat: point.lat, lon: point.lon, name: point.name });
        });
      }
      return (tour.stages || []).map(function (stage) {
        if (!stage.when && ride.when) stage.when = ride.when;
        if (!stage.name) stage.name = ride.name;
        return stage;
      });
    });
  }

  function readGpxFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    Promise.all(files.map(function (file) {
      return file.text().then(function (text) {
        return TourkarteMap.parseGpx(text, file.name.replace(/\.gpx$/i, ""));
      });
    })).then(function (tours) {
      state.tour = TourkarteMap.mergeTours(tours);
      state.source = "gpx";
      resetPlaceSearch();
      state.skipped = [];
      state.options.title = state.tour.name || "";
      state.options.stagePlaces = [];
      resetAlbum();
      state.placeGeneration = (state.placeGeneration || 0) + 1;
      state.error = "";
      state.mode = "map";
      render();
    }).catch(function (error) {
      state.error = error.message || "Die GPX-Datei lässt sich nicht lesen.";
      render();
    });
  }

  function loadExample() {
    state.error = "";
    fetch("./examples/beispiel.gpx").then(function (response) {
      if (!response.ok) throw new Error("Das Beispiel ist nicht erreichbar.");
      return response.text();
    }).then(function (text) {
      state.tour = TourkarteMap.parseGpx(text, "Beispieltour");
      state.source = "gpx";
      resetPlaceSearch();
      state.skipped = [];
      state.options.title = state.tour.name || "Beispieltour";
      state.options.stagePlaces = [];
      resetAlbum();
      state.placeGeneration = (state.placeGeneration || 0) + 1;
      state.mode = "map";
      render();
    }).catch(function (error) {
      state.error = error.message;
      render();
    });
  }

  function overviewSvg() {
    var scene = TourkarteMap.buildScene(state.tour, {
      title: state.options.title,
      startLabel: state.options.startLabel,
      endLabel: state.options.endLabel,
      fmt: state.options.fmt,
      route: state.options.route,
      colorByDay: state.options.colorByDay,
      basemap: state.options.basemap,
      stagePlaces: state.options.stagePlaces,
      included: includedFlags()
    });
    return { scene: scene, svg: TourkarteMap.sceneToSvg(scene) };
  }

  function stageSvg(index) {
    var scene = TourkarteMap.buildStageScene(state.tour, index, {
      stageTitle: stageTitle(index),
      fmt: state.options.fmt,
      route: state.options.route,
      colorByDay: state.options.colorByDay,
      basemap: state.options.basemap,
      stagePlaces: state.options.stagePlaces
    });
    return { scene: scene, svg: TourkarteMap.sceneToSvg(scene) };
  }

  function refreshPreview() {
    if (!state.tour) return;
    sheetKeys().forEach(paintSheet);
  }

  function paintSheet(key) {
    var node = previewNode(key);
    if (!node || !state.tour) return;
    var drawn;
    try {
      drawn = key === "overview" ? overviewSvg() : stageSvg(Number(key));
    } catch (error) {
      node.innerHTML = '<p class="error">' + esc(error.message) + "</p>";
      return;
    }
    var slot = ensureSlot(key);
    slot.generation += 1;
    var generation = slot.generation;
    slot.scene = drawn.scene;
    slot.svg = drawn.svg;
    slot.embeddedSvg = "";
    placeSvg(node, drawn.svg, drawn.scene);
    var status = sheetStatus(key);
    if (!drawn.scene.tiles || !drawn.scene.tiles.length) {
      if (status && !(key === "overview" && state.fillingPlaces)) status.textContent = "";
      storePicture(key);
      return;
    }
    if (status) status.textContent = "Hintergrundkarte wird geladen…";
    embedTiles(drawn.scene.tiles).then(function (missing) {
      if (!state.sheets[key] || state.sheets[key].generation !== generation) return;
      var svg = TourkarteMap.sceneToSvg(drawn.scene);
      slot.svg = svg;
      slot.embeddedSvg = svg;
      var fresh = previewNode(key);
      if (fresh) placeSvg(fresh, svg, drawn.scene);
      if (status && !(key === "overview" && state.fillingPlaces)) {
        status.textContent = missing ? "Ein Teil der Karte konnte nicht geladen werden." : "";
      }
      storePicture(key);
    });
  }

  var tileCache = {};

  function embedTiles(tiles) {
    var missing = 0;
    return Promise.all(tiles.map(function (tile) {
      return tileData(tile.url).then(function (href) {
        tile.href = href;
      }).catch(function () {
        missing += 1;
        tile.href = "";
      });
    })).then(function () { return missing; });
  }

  function tileData(url) {
    if (!tileCache[url]) {
      tileCache[url] = fetch(url).then(function (response) {
        if (!response.ok) throw new Error("Kachel");
        return response.blob();
      }).then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(new Error("Kachel")); };
          reader.readAsDataURL(blob);
        });
      });
    }
    return tileCache[url];
  }

  function storePicture(key) {
    var slot = state.sheets[key];
    if (!slot || !slot.scene || !(slot.embeddedSvg || slot.svg)) return;
    slot.pngToken = (slot.pngToken || 0) + 1;
    var token = slot.pngToken;
    var svg = slot.embeddedSvg || slot.svg;
    var scene = slot.scene;
    var photos = photosForExport(key).map(function (photo) {
      return { url: photo.url, name: photo.name };
    });
    slot.pngBlob = null;
    slot.pngSvg = svg;
    svgToPng(svg, scene.width, scene.height).then(function (blob) {
      if (!photos.length) return blob;
      return composeAlbumPng(blob, photos, scene.background);
    }).then(function (blob) {
      if (state.sheets[key] && state.sheets[key].pngToken === token) state.sheets[key].pngBlob = blob;
    }).catch(function () {
      if (state.sheets[key] && state.sheets[key].pngToken === token) state.sheets[key].pngBlob = null;
    });
  }

  function shareSvgFile(button) {
    var key = sheetKeyFrom(button);
    var slot = state.sheets[key];
    var drawn;
    try {
      drawn = key === "overview" ? overviewSvg() : stageSvg(Number(key));
    } catch (error) {
      showBanner(error.message);
      return;
    }
    var svg = (slot && slot.embeddedSvg) || drawn.svg;
    shareBlob(new Blob([svg], { type: "image/svg+xml" }), sheetFilename(key, drawn.scene.title, "svg"), "image/svg+xml");
  }

  function sharePngFile(button) {
    var key = sheetKeyFrom(button);
    var slot = state.sheets[key];
    if (!slot || !slot.pngBlob) {
      showBanner("Das Bild wird noch aufgebaut. Gleich noch einmal teilen.");
      return;
    }
    state.error = "";
    var banner = document.querySelector(".error");
    if (banner) banner.remove();
    shareBlob(slot.pngBlob, sheetFilename(key, slot.scene && slot.scene.title, "png"), "image/png");
  }

  function shareAlbum(button) {
    if (state.albumBusy) return;
    state.albumBusy = true;
    var label = button.textContent;
    button.disabled = true;
    button.textContent = "Seiten werden gespeichert…";
    var keys = sheetKeys();
    var names = TourkarteMap.albumFilenames(keys.map(function (key) {
      return key === "overview" ? "Übersicht" : stageTitle(Number(key));
    }), "jpg");
    var files = [];
    var chain = Promise.resolve();
    keys.forEach(function (key, index) {
      chain = chain.then(function () {
        return sheetJpeg(key).then(function (blob) {
          files.push(new File([blob], names[index], { type: "image/jpeg" }));
        });
      });
    });
    chain.then(function () {
      if (saveOnDesktop()) return saveZip(files);
      return shareJpegSet(files);
    }).catch(function (error) {
      if (error && error.name === "AbortError") return;
      showBanner(error && error.message ? error.message : "Die Seiten konnten nicht gespeichert werden.");
    }).then(function () {
      state.albumBusy = false;
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  function sheetJpeg(key) {
    return whenSheetReady(key).then(function (slot) {
      var svg = slot.embeddedSvg || slot.svg;
      var scene = slot.scene;
      return svgToBlob(svg, scene.width, scene.height, "image/jpeg", 0.92).then(function (blob) {
        var photos = photosForExport(key).map(function (photo) {
          return { url: photo.url, name: photo.name };
        });
        if (!photos.length) return blob;
        return composeAlbumImage(blob, photos, scene.background, "image/jpeg", 0.92);
      });
    });
  }

  function whenSheetReady(key) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function tick() {
        var slot = state.sheets[key];
        if (!slot || !slot.scene || !(slot.svg || slot.embeddedSvg)) {
          if (Date.now() - started > 25000) reject(new Error("Die Seiten sind noch nicht fertig. Gleich noch einmal versuchen."));
          else setTimeout(tick, 80);
          return;
        }
        var wantsTiles = slot.scene.tiles && slot.scene.tiles.length;
        if (wantsTiles && !slot.embeddedSvg) {
          if (Date.now() - started > 25000) reject(new Error("Die Hintergrundkarte ist noch nicht da. Gleich noch einmal versuchen."));
          else setTimeout(tick, 120);
          return;
        }
        resolve(slot);
      })();
    });
  }

  function saveZip(files) {
    return Promise.all(files.map(function (file) {
      return file.arrayBuffer().then(function (buffer) {
        return { name: file.name, data: new Uint8Array(buffer) };
      });
    })).then(function (entries) {
      var bytes = TourkarteMap.zipStored(entries);
      var blob = new Blob([bytes], { type: "application/zip" });
      var name = fileSlug(state.options.title || (state.tour && state.tour.name) || "tourkarte") + "-album.zip";
      shareBlob(blob, name, "application/zip");
    });
  }

  function shareJpegSet(files) {
    try {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: files })) {
        return navigator.share({ files: files, title: "Tourkarte" });
      }
    } catch (error) {
      return saveZip(files);
    }
    return saveZip(files);
  }

  function stageCount() {
    return state.tour && state.tour.stages ? state.tour.stages.length : 0;
  }

  function stageTitle(index) {
    var stage = state.tour && state.tour.stages[index];
    var name = stage && String(stage.name || "").trim();
    return name || ((index + 1) + ". Etappe");
  }

  function includedFlags() {
    return (state.tour.stages || []).map(function (stage) { return stage.included !== false; });
  }

  function resetAlbum() {
    (state.photos || []).forEach(function (list) {
      (list || []).forEach(function (photo) {
        if (photo && photo.url) URL.revokeObjectURL(photo.url);
      });
    });
    state.photos = [];
    state.albumIndex = 0;
    state.sheets = {};
  }

  function sheetKeys() {
    var count = stageCount();
    if (count < 2) return ["overview"];
    var keys = ["overview"];
    for (var index = 0; index < count; index += 1) keys.push(String(index));
    return keys;
  }

  function previewNode(key) {
    if (key === "overview") return document.getElementById("preview");
    return document.getElementById("preview-stage-" + key);
  }

  function placeSvg(node, svg, scene) {
    node.innerHTML = svg;
    var drawn = node.querySelector("svg");
    if (!drawn || !scene) return;
    drawn.style.width = "100%";
    drawn.style.height = "auto";
    drawn.style.aspectRatio = scene.width + " / " + scene.height;
    drawn.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  function ensureSlot(key) {
    if (!state.sheets[key]) state.sheets[key] = { generation: 0, pngToken: 0 };
    return state.sheets[key];
  }

  function sheetStatus(key) {
    if (key === "overview") return document.getElementById("map-status");
    return document.getElementById("stage-status-" + key);
  }

  function sheetKeyFrom(button) {
    if (stageCount() < 2) return "overview";
    var page = button && button.closest ? button.closest("[data-album-page]") : null;
    if (!page) return "overview";
    var id = page.getAttribute("data-album-page");
    return id === "overview" ? "overview" : String(id);
  }

  function sheetFilename(key, title, extension) {
    var name = title || state.options.title || "tourkarte";
    if (key !== "overview") name = stageTitle(Number(key));
    if (key !== "overview" && state.options.title) name = state.options.title + " " + name;
    return fileSlug(name) + "." + extension;
  }

  function photosForExport(key) {
    if (key === "overview") return stageCount() < 2 ? (state.photos[0] || []) : [];
    return state.photos[Number(key)] || [];
  }

  function showBanner(message) {
    state.error = message;
    var banner = document.querySelector(".error");
    if (banner) {
      banner.textContent = message;
      return;
    }
    var anchor = document.querySelector(".album-page") || document.getElementById("preview");
    if (!anchor || !anchor.parentNode) return;
    var node = document.createElement("p");
    node.className = "error";
    node.textContent = message;
    anchor.parentNode.insertBefore(node, anchor);
  }

  function bindStageEditors() {
    document.querySelectorAll("[data-place]").forEach(function (input) {
      input.addEventListener("input", function () {
        var index = Number(input.getAttribute("data-stage"));
        var key = input.getAttribute("data-place");
        if (key !== "start" && key !== "end") return;
        ensurePlaces(stageCount());
        state.options.stagePlaces[index][key] = input.value;
        mirrorValue('[data-stage="' + index + '"][data-place="' + key + '"]', input);
        schedulePreview();
      });
    });
    document.querySelectorAll("[data-stage-name]").forEach(function (input) {
      input.addEventListener("input", function () {
        var index = Number(input.getAttribute("data-stage-name"));
        if (!state.tour.stages[index]) return;
        state.tour.stages[index].name = input.value;
        mirrorValue('[data-stage-name="' + index + '"]', input);
        updateAlbumChrome();
        schedulePreview();
      });
    });
    document.querySelectorAll("[data-stage-on]").forEach(function (input) {
      input.addEventListener("change", function () {
        setIncluded(Number(input.getAttribute("data-stage-on")), input.checked);
      });
    });
  }

  function mirrorValue(selector, source) {
    document.querySelectorAll(selector).forEach(function (other) {
      if (other !== source && other.value !== source.value) other.value = source.value;
    });
  }

  function schedulePreview() {
    clearTimeout(state.summaryTimer);
    state.summaryTimer = setTimeout(refreshPreview, 280);
  }

  function setIncluded(index, on) {
    if (!state.tour || !state.tour.stages[index]) return;
    state.tour.stages[index].included = on;
    document.querySelectorAll('[data-stage-on="' + index + '"]').forEach(function (box) {
      box.checked = on;
    });
    document.querySelectorAll('[data-stage-card="' + index + '"]').forEach(function (card) {
      card.classList.toggle("off", !on);
    });
    document.querySelectorAll('[data-included-note="' + index + '"]').forEach(function (note) {
      note.hidden = on;
    });
    refreshPreview();
  }

  function bindAlbum() {
    var track = document.getElementById("album-track");
    if (!track) return;
    var prev = document.getElementById("album-prev");
    var next = document.getElementById("album-next");
    var home = document.getElementById("album-home");
    if (prev) prev.addEventListener("click", function () { moveAlbum(-1); });
    if (next) next.addEventListener("click", function () { moveAlbum(1); });
    if (home) home.addEventListener("click", function () { scrollAlbum(0); });
    track.addEventListener("scroll", updateAlbumChrome, { passive: true });
    track.addEventListener("pointerdown", function () { state.albumLock = null; });
    track.addEventListener("keydown", function (event) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveAlbum(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveAlbum(-1);
      }
    });
    document.querySelectorAll("[data-open-stage]").forEach(function (button) {
      button.addEventListener("click", function () {
        scrollAlbum(Number(button.getAttribute("data-open-stage")) + 1);
      });
    });
    if (state.albumIndex) scrollAlbum(state.albumIndex, true);
    else updateAlbumChrome();
  }

  function albumCount() {
    var track = document.getElementById("album-track");
    return track ? track.children.length : 1;
  }

  function currentAlbumIndex() {
    var track = document.getElementById("album-track");
    if (!track || !track.clientWidth) return state.albumIndex || 0;
    var index = Math.round(track.scrollLeft / track.clientWidth);
    var last = Math.max(0, albumCount() - 1);
    if (index < 0) return 0;
    return index > last ? last : index;
  }

  function scrollAlbum(index, instant) {
    var track = document.getElementById("album-track");
    if (!track) return;
    var last = Math.max(0, albumCount() - 1);
    if (index < 0) index = 0;
    if (index > last) index = last;
    state.albumIndex = index;
    state.albumLock = index;
    var left = index * track.clientWidth;
    if (instant) track.scrollLeft = left;
    else track.scrollTo({ left: left, behavior: "smooth" });
    paintAlbumChrome(index);
  }

  function moveAlbum(delta) {
    scrollAlbum((state.albumLock != null ? state.albumLock : currentAlbumIndex()) + delta);
  }

  function updateAlbumChrome() {
    var index = currentAlbumIndex();
    if (state.albumLock != null && index !== state.albumLock) return;
    state.albumLock = null;
    paintAlbumChrome(index);
  }

  function paintAlbumChrome(index) {
    var label = document.getElementById("album-pos");
    if (!label) return;
    state.albumIndex = index;
    label.textContent = albumLabel(index);
    var prev = document.getElementById("album-prev");
    var next = document.getElementById("album-next");
    var last = albumCount() - 1;
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= last;
    var home = document.getElementById("album-home-row");
    if (home) home.hidden = index <= 0;
  }

  function albumLabel(index) {
    if (index <= 0) return "Übersicht";
    var stageIndex = index - 1;
    var facts = state.tour ? TourkarteMap.stageFacts(state.tour) : [];
    var fact = facts[stageIndex];
    var parts = ["Etappe " + (stageIndex + 1)];
    if (fact && fact.shortDate) parts.push(fact.shortDate);
    return parts.join(" · ");
  }

  function bindPhotos() {
    document.querySelectorAll("[data-add-photo]").forEach(function (input) {
      input.addEventListener("change", function () {
        addPhotos(Number(input.getAttribute("data-add-photo")), input.files);
        input.value = "";
      });
    });
    bindPhotoRemove();
  }

  function bindPhotoRemove() {
    document.querySelectorAll("[data-remove-photo]").forEach(function (button) {
      if (button.getAttribute("data-bound")) return;
      button.setAttribute("data-bound", "1");
      button.addEventListener("click", function () {
        removePhoto(Number(button.getAttribute("data-remove-photo")), button.getAttribute("data-photo-id"));
      });
    });
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf("image/") === 0) return true;
    return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || "");
  }

  function addPhotos(index, fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(isImageFile);
    if (!files.length) return;
    if (!state.photos[index]) state.photos[index] = [];
    var room = 24 - state.photos[index].length;
    var note = document.querySelector('[data-photo-note="' + index + '"]');
    if (room <= 0) {
      if (note) note.textContent = "Auf dieser Etappe liegen schon 24 Fotos.";
      return;
    }
    files.slice(0, room).forEach(function (file) {
      state.photoSerial += 1;
      state.photos[index].push({
        id: "p" + state.photoSerial,
        name: file.name || "Foto",
        url: URL.createObjectURL(file)
      });
    });
    if (note) note.textContent = files.length > room ? "Es passen 24 Fotos auf die Etappe." : "";
    paintPhotos(index);
    storePicture(stageCount() < 2 ? "overview" : String(index));
  }

  function removePhoto(index, id) {
    var next = [];
    (state.photos[index] || []).forEach(function (photo) {
      if (photo.id === id) {
        if (photo.url) URL.revokeObjectURL(photo.url);
      } else next.push(photo);
    });
    state.photos[index] = next;
    paintPhotos(index);
    storePicture(stageCount() < 2 ? "overview" : String(index));
  }

  function paintPhotos(index) {
    var grid = document.querySelector('[data-photo-grid="' + index + '"]');
    var empty = document.querySelector('[data-photo-empty="' + index + '"]');
    if (!grid) return;
    var photos = state.photos[index] || [];
    grid.classList.toggle("single", photos.length === 1);
    grid.innerHTML = photoFigures(index);
    if (empty) empty.hidden = photos.length > 0;
    bindPhotoRemove();
  }

  function saveOnDesktop() {
    return Boolean(window.showSaveFilePicker) && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function shareBlob(blob, filename, mime) {
    if (saveOnDesktop()) {
      var extension = filename.slice(filename.lastIndexOf("."));
      var types = {};
      types[mime] = [extension];
      window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Tourkarte", accept: types }]
      }).then(function (handle) {
        return handle.createWritable();
      }).then(function (writable) {
        return writable.write(blob).then(function () { return writable.close(); });
      }).catch(function (error) {
        if (error && error.name === "AbortError") return;
        downloadBlob(blob, filename);
      });
      return;
    }
    var file = new File([blob], filename, { type: mime });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Tourkarte" }).catch(function (error) {
        if (error && error.name === "AbortError") return;
        downloadBlob(blob, filename);
      });
      return;
    }
    downloadBlob(blob, filename);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function svgToPng(svg, width, height) {
    return svgToBlob(svg, width, height, "image/png");
  }

  function drawingContext(canvas, opaque) {
    var options = { colorSpace: "srgb" };
    if (opaque) options.alpha = false;
    try {
      return canvas.getContext("2d", options) || canvas.getContext("2d");
    } catch (error) {
      return canvas.getContext("2d");
    }
  }

  function svgToBlob(svg, width, height, mime, quality) {
    return new Promise(function (resolve, reject) {
      var longSide = Math.max(width, height, 1);
      var pixelLong = 2400;
      var pixelW = Math.max(1, Math.round(width / longSide * pixelLong));
      var pixelH = Math.max(1, Math.round(height / longSide * pixelLong));
      var raster = svg
        .replace(/width="[\d.]+mm"/, 'width="' + pixelW + '"')
        .replace(/height="[\d.]+mm"/, 'height="' + pixelH + '"');
      var blob = new Blob([raster], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = pixelW;
        canvas.height = pixelH;
        var context = drawingContext(canvas, mime === "image/jpeg");
        if (mime === "image/jpeg") {
          context.fillStyle = "#f3efe6";
          context.fillRect(0, 0, pixelW, pixelH);
        }
        context.drawImage(image, 0, 0, pixelW, pixelH);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (result) {
          if (result) resolve(result);
          else reject(new Error("bild"));
        }, mime || "image/png", quality);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("bild"));
      };
      image.src = url;
    });
  }

  function composeAlbumPng(mapBlob, photos, paper) {
    return composeAlbumImage(mapBlob, photos, paper, "image/png");
  }

  function composeAlbumImage(mapBlob, photos, paper, mime, quality) {
    var mapUrl = URL.createObjectURL(mapBlob);
    return loadImage(mapUrl).then(function (mapImage) {
      URL.revokeObjectURL(mapUrl);
      return Promise.all(photos.map(function (photo) {
        return loadImage(photo.url).then(function (image) { return image; }, function () { return null; });
      })).then(function (images) {
        images = images.filter(Boolean);
        if (!images.length) return mapBlob;
        var mapW = mapImage.naturalWidth;
        var mapH = mapImage.naturalHeight;
        var pad = Math.max(24, Math.round(mapW * 0.035));
        var columns = images.length === 1 ? 1 : 2;
        var rows = Math.ceil(images.length / columns);
        var cellW = Math.floor((mapW - pad * (columns + 1)) / columns);
        var cellH = Math.round(cellW * 0.75);
        var canvas = document.createElement("canvas");
        canvas.width = mapW;
        canvas.height = mapH + pad + rows * cellH + rows * pad;
        var context = drawingContext(canvas, mime === "image/jpeg");
        context.fillStyle = paper || "#f3efe6";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(mapImage, 0, 0, mapW, mapH);
        images.forEach(function (image, index) {
          var column = index % columns;
          var row = Math.floor(index / columns);
          var x = pad + column * (cellW + pad);
          var y = mapH + pad + row * (cellH + pad);
          drawContain(context, image, x, y, cellW, cellH);
        });
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (result) {
            if (result) resolve(result);
            else reject(new Error("bild"));
          }, mime || "image/png", quality);
        });
      });
    }, function (error) {
      URL.revokeObjectURL(mapUrl);
      throw error;
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("bild")); };
      image.src = src;
    });
  }

  function drawContain(context, image, x, y, width, height) {
    var scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    var drawnW = image.naturalWidth * scale;
    var drawnH = image.naturalHeight * scale;
    context.fillStyle = "#fffaf3";
    context.fillRect(x, y, width, height);
    context.drawImage(image, x + (width - drawnW) / 2, y + (height - drawnH) / 2, drawnW, drawnH);
  }

  function disconnectStrava() {
    state.session = null;
    dropRides("strava");
    localStorage.removeItem(STORAGE);
    sessionStorage.removeItem(STATE_KEY);
    state.error = "";
    state.panel = "home";
    state.mode = "setup";
    render();
  }

  function disconnectKomoot() {
    state.komoot = null;
    dropRides("komoot");
    localStorage.removeItem(KOMOOT_STORAGE);
    state.error = "";
    state.panel = "home";
    state.mode = "setup";
    render();
  }

  function dropRides(source) {
    state.rides = (state.rides || []).filter(function (ride) { return ride.source !== source; });
    Object.keys(state.selected).forEach(function (key) {
      if (key.indexOf(source + ":") === 0) delete state.selected[key];
    });
  }

  function hasStrava() {
    return Boolean(state.session && state.session.accessToken);
  }

  function hasKomoot() {
    return Boolean(state.komoot && state.komoot.token);
  }

  function connectedLine() {
    var parts = [];
    if (hasStrava()) parts.push(state.session.athleteName ? "Strava als " + state.session.athleteName : "Strava verbunden");
    if (hasKomoot()) parts.push(state.komoot.displayName ? "Komoot als " + state.komoot.displayName : "Komoot verbunden");
    return parts.join(" · ");
  }

  function compareRides(a, b) {
    var left = a.when || "9999-99-99";
    var right = b.when || "9999-99-99";
    if (left !== right) return left < right ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""), "de");
  }

  function inRangeDate(when, from, to) {
    if (!when) return true;
    if (from && when < from) return false;
    if (to && when > to) return false;
    return true;
  }

  function dayHeading(iso) {
    if (!iso) return "Ohne Datum";
    var parts = String(iso).slice(0, 10).split("-");
    var day = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return WEEKDAYS[day.getDay()] + ", " + TourkarteMap.formatActivityDate(iso);
  }

  function ensureRange() {
    if (state.range.from && state.range.to) return;
    var today = new Date();
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - 29);
    state.range.from = isoDate(start);
    state.range.to = isoDate(today);
  }

  function skippedText() {
    return "Ohne GPS übersprungen: " + state.skipped.join(", ");
  }

  function setStatus(text) {
    var status = document.getElementById("status");
    if (status) status.textContent = text;
  }

  function valueOf(id) {
    var field = document.getElementById(id);
    return field ? field.value.trim() : "";
  }

  function loadSession() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (!parsed || !parsed.clientId) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(STORAGE, JSON.stringify(session));
  }

  function loadKomoot() {
    try {
      var parsed = JSON.parse(localStorage.getItem(KOMOOT_STORAGE) || "null");
      if (!parsed || !parsed.userId || !parsed.token) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function saveKomoot(session) {
    localStorage.setItem(KOMOOT_STORAGE, JSON.stringify({
      email: session.email || "",
      userId: session.userId,
      token: session.token,
      displayName: session.displayName || ""
    }));
  }

  function canOAuth() {
    return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  }

  function isoDate(date) {
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function fileSlug(title) {
    return TourkarteMap.fileSlug(title);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("./service-worker.js").catch(function () {});
  }
})();
