/* Tourkarte auf dem iPhone: Strava verbinden, Fahrten wählen, Albumseite teilen. */

(function () {
  var STORAGE = "tourkarte-strava-v1";
  var STATE_KEY = "tourkarte-oauth-state";
  var ROUTES = ["#9c3412", "#1c1916", "#1e4d5c", "#3e5340"];

  var state = {
    mode: "setup",
    session: null,
    activities: [],
    selected: {},
    range: { from: "", to: "" },
    sport: "bike",
    showIndoor: false,
    query: "",
    tour: null,
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
    cancel: false
  };

  var screen;

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    screen = document.getElementById("screen");
    state.session = loadSession();
    var callback = TourkarteStrava.parseCallback(location.href);
    if (callback) {
      var expected = sessionStorage.getItem(STATE_KEY);
      history.replaceState(null, "", location.pathname);
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
        render();
        finishExchange(callback.code);
        registerWorker();
        return;
      } else {
        state.pendingCode = callback.code;
        if (callback.clientId) state.session = { clientId: callback.clientId, clientSecret: "" };
        state.mode = "finish";
      }
    } else if (state.session && state.session.accessToken) {
      state.mode = "pick";
      ensureRange();
    } else {
      state.mode = "setup";
    }
    render();
    if (state.mode === "pick") loadActivities();
    registerWorker();
  }

  function render() {
    if (state.mode === "setup") screen.innerHTML = setupHtml();
    else if (state.mode === "finish") screen.innerHTML = finishHtml();
    else if (state.mode === "pick") screen.innerHTML = pickHtml();
    else if (state.mode === "working") screen.innerHTML = workingHtml();
    else if (state.mode === "map") screen.innerHTML = mapHtml();
    bind();
    if (state.mode === "pick") paintRides();
    if (state.mode === "map") refreshPreview();
  }

  function bind() {
    var connect = document.getElementById("connect");
    if (connect) connect.addEventListener("click", startAuth);
    var gpx = document.getElementById("gpx");
    if (gpx) gpx.addEventListener("change", function () { readGpxFiles(gpx.files); });
    var example = document.getElementById("example");
    if (example) example.addEventListener("click", loadExample);
    var complete = document.getElementById("complete");
    if (complete) complete.addEventListener("click", completeAuth);
    var load = document.getElementById("load");
    if (load) load.addEventListener("click", loadActivities);
    var disconnect = document.getElementById("disconnect");
    if (disconnect) disconnect.addEventListener("click", disconnectStrava);
    var draw = document.getElementById("draw");
    if (draw) draw.addEventListener("click", drawSelected);
    var cancel = document.getElementById("cancel");
    if (cancel) cancel.addEventListener("click", function () { state.cancel = true; });
    var back = document.getElementById("back");
    if (back) back.addEventListener("click", function () {
      state.mode = state.source === "gpx" ? "setup" : "pick";
      render();
    });
    bindChips("sport", function (value) {
      state.sport = value;
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
    var shareSvg = document.getElementById("share-svg");
    if (shareSvg) shareSvg.addEventListener("click", shareSvgFile);
    var sharePng = document.getElementById("share-png");
    if (sharePng) sharePng.addEventListener("click", sharePngFile);
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
      refreshPreview();
    });
    var basemap = document.getElementById("basemap");
    if (basemap) basemap.addEventListener("change", function () {
      state.options.basemap = basemap.checked;
      refreshPreview();
    });
    document.querySelectorAll("[data-route]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.options.route = button.getAttribute("data-route");
        document.querySelectorAll("[data-route]").forEach(function (item) {
          item.classList.toggle("on", item === button);
        });
        refreshPreview();
      });
    });
  }

  function setupHtml() {
    var host = location.hostname || "diese Domain";
    var oauthNote = canOAuth()
      ? ""
      : '<p class="error">Die Strava-Anmeldung braucht die Seite über https. Auf dem iPhone die gehostete Adresse öffnen, nicht die Datei selbst.</p>';
    return [
      '<header class="top">',
      '<p class="eyebrow">Fotoalbum</p>',
      "<h1>Tourkarte</h1>",
      '<p class="lead">Die gefahrenen Etappen aus Strava auswählen. Daraus wird die Übersicht fürs Album.</p>',
      "</header>",
      errorHtml(),
      oauthNote,
      "<details class=\"steps\">",
      "<summary>Strava einmal einrichten</summary>",
      "<ol>",
      '<li><a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> öffnen und eine App anlegen.</li>',
      "<li>Als Authorization Callback Domain eintragen: <strong>" + esc(host) + "</strong></li>",
      "<li>Client-ID und Client-Secret hier einfügen. Beides bleibt nur auf diesem iPhone.</li>",
      "</ol>",
      "</details>",
      '<label>Client-ID<input id="client-id" inputmode="numeric" autocomplete="off" value="' + esc(state.session && state.session.clientId || "") + '"></label>',
      '<label>Client-Secret<input id="client-secret" type="password" autocomplete="off"></label>',
      '<button type="button" id="connect" class="primary">Mit Strava verbinden</button>',
      '<p class="or">oder eine GPX-Datei vom iPhone</p>',
      '<label class="secondary file-button">GPX wählen<input id="gpx" type="file" accept=".gpx,application/gpx+xml,text/xml" multiple hidden></label>',
      '<button type="button" id="example" class="text-button">Beispiel ansehen</button>'
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
    var name = state.session && state.session.athleteName ? "Verbunden als " + state.session.athleteName + "." : "Mit Strava verbunden.";
    return [
      '<header class="top split">',
      "<div><p class=\"eyebrow\">Strava</p><h1>Fahrten wählen</h1></div>",
      '<button type="button" id="disconnect" class="text-button">Trennen</button>',
      "</header>",
      '<p class="who">' + esc(name) + "</p>",
      errorHtml(),
      '<div class="dates">',
      '<label>Von<input id="from" type="date" value="' + esc(state.range.from) + '"></label>',
      '<label>Bis<input id="to" type="date" value="' + esc(state.range.to) + '"></label>',
      "</div>",
      '<div class="chips" id="sport">',
      chip("sport", "bike", "Fahrrad"),
      chip("sport", "all", "Alle"),
      "</div>",
      '<label class="checkline"><input id="indoor" type="checkbox"' + (state.showIndoor ? " checked" : "") + "> Indoor und virtuell zeigen</label>",
      '<label class="search">Suche<input id="query" type="search" value="' + esc(state.query) + '" placeholder="Name der Fahrt"></label>',
      '<button type="button" id="load" class="secondary">Fahrten laden</button>',
      '<p id="status" class="status" aria-live="polite">' + esc(state.status) + "</p>",
      '<div class="list-tools"><button type="button" id="all" class="text-button">Sichtbare an- oder abwählen</button></div>',
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
      '<p class="eyebrow">Strava</p>',
      '<p id="progress" class="status-big" aria-live="polite">' + esc(state.status || "Die Fahrten werden geholt…") + "</p>",
      '<button type="button" id="cancel" class="secondary">Abbrechen</button>',
      "</div>"
    ].join("");
  }

  function mapHtml() {
    var stages = state.tour && state.tour.stages ? state.tour.stages.length : 0;
    return [
      '<header class="top split">',
      '<button type="button" id="back" class="text-button">Zurück</button>',
      "<h1>Albumseite</h1>",
      "</header>",
      errorHtml(),
      state.skipped.length ? '<p class="status">' + esc(skippedText()) + "</p>" : "",
      '<div id="preview" class="preview"></div>',
      '<label>Titel<input id="title" value="' + esc(state.options.title) + '" placeholder="Titel der Tour"></label>',
      '<div class="dates">',
      '<label>Start<input id="start-label" value="' + esc(state.options.startLabel) + '" placeholder="Ort"></label>',
      '<label>Ziel<input id="end-label" value="' + esc(state.options.endLabel) + '" placeholder="Ort"></label>',
      "</div>",
      '<div class="chips" id="format">',
      chip("format", "square", "Quadrat"),
      chip("format", "a4", "A4 quer"),
      chip("format", "a4-hoch", "A4 hoch"),
      "</div>",
      '<div class="swatches">' + ROUTES.map(function (color) {
        return '<button type="button" class="swatch' + (color === state.options.route ? " on" : "") + '" data-route="' + color + '" style="background:' + color + '" aria-label="Linienfarbe ' + color + '"></button>';
      }).join("") + "</div>",
      '<label class="checkline"><input id="basemap" type="checkbox"' + (state.options.basemap ? " checked" : "") + "> Karte im Hintergrund</label>",
      stages > 1 ? '<label class="checkline"><input id="by-day" type="checkbox"' + (state.options.colorByDay ? " checked" : "") + "> Etappen farblich</label>" : "",
      '<p id="map-status" class="status"></p>',
      '<button type="button" id="share-svg" class="primary">SVG teilen</button>',
      '<button type="button" id="share-png" class="secondary">Bild teilen</button>'
    ].join("");
  }

  function errorHtml() {
    return state.error ? '<p class="error">' + esc(state.error) + "</p>" : "";
  }

  function chip(group, value, label) {
    var current = group === "sport" ? state.sport : state.options.fmt;
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
    state.status = "Strava wird verbunden…";
    render();
    finishExchange(state.pendingCode);
  }

  function finishExchange(code) {
    TourkarteStrava.exchangeCode(state.session, code, fetch).then(function (session) {
      state.session = session;
      state.pendingCode = "";
      saveSession(session);
      state.error = "";
      state.mode = "pick";
      ensureRange();
      render();
      loadActivities();
    }).catch(function (error) {
      state.error = error.message || "Die Anmeldung ist fehlgeschlagen.";
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
    state.error = "";
    state.status = "Fahrten werden gelesen…";
    setStatus(state.status);
    var button = document.getElementById("load");
    if (button) button.disabled = true;
    var range;
    try {
      range = TourkarteStrava.localRangeEpoch(state.range.from, state.range.to);
    } catch (error) {
      state.error = error.message;
      state.status = "";
      render();
      return;
    }
    TourkarteStrava.ensureFresh(state.session, fetch).then(function (session) {
      state.session = session;
      saveSession(session);
      return TourkarteStrava.listActivities(session, range[0], range[1], fetch);
    }).then(function (activities) {
      state.activities = activities.slice().sort(function (a, b) {
        return String(a.start_date_local || a.start_date || "").localeCompare(String(b.start_date_local || b.start_date || ""));
      });
      var keep = {};
      state.activities.forEach(function (activity) {
        if (state.selected[activity.id]) keep[activity.id] = true;
      });
      state.selected = keep;
      state.status = state.activities.length ? "" : "In diesem Zeitraum liegen keine Aktivitäten.";
      setStatus(state.status);
      if (button) button.disabled = false;
      paintRides();
    }).catch(function (error) {
      state.status = "";
      state.error = error.message || "Die Fahrten konnten nicht gelesen werden.";
      if (button) button.disabled = false;
      var banner = document.querySelector(".error");
      if (!banner) render();
      else banner.textContent = state.error;
    });
  }

  function paintRides() {
    var list = document.getElementById("rides");
    if (!list) return;
    var rides = visibleActivities();
    if (!state.activities.length) {
      list.innerHTML = "";
      updateDraw();
      return;
    }
    if (!rides.length) {
      list.innerHTML = '<p class="status">Nichts passt zum Filter. „Alle“ zeigt auch Wanderungen und Läufe.</p>';
      updateDraw();
      return;
    }
    list.innerHTML = rides.map(function (activity) {
      var checked = state.selected[activity.id] ? " checked" : "";
      var distance = activity.distance ? TourkarteMap.formatKm(Number(activity.distance)) : "ohne Distanz";
      var gain = activity.total_elevation_gain != null ? TourkarteMap.formatHm(Number(activity.total_elevation_gain)) : "";
      var meta = [TourkarteMap.formatActivityDate(TourkarteStrava.localDate(activity)), distance, gain, TourkarteStrava.sportLabel(activity)].filter(Boolean).join(" · ");
      return '<label class="ride"><input type="checkbox" data-id="' + Number(activity.id) + '"' + checked + '><span><strong>' + esc(activity.name || "Fahrt") + '</strong><small>' + esc(meta) + "</small></span></label>";
    }).join("");
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

  function visibleActivities() {
    var query = state.query.trim().toLowerCase();
    return state.activities.filter(function (activity) {
      if (!TourkarteStrava.isSelected(activity, state.sport, state.showIndoor)) return false;
      if (!query) return true;
      return String(activity.name || "").toLowerCase().indexOf(query) !== -1;
    });
  }

  function toggleVisible() {
    var rides = visibleActivities();
    var allOn = rides.length && rides.every(function (activity) { return state.selected[activity.id]; });
    rides.forEach(function (activity) {
      if (allOn) delete state.selected[activity.id];
      else state.selected[activity.id] = true;
    });
    paintRides();
  }

  function updateDraw() {
    var button = document.getElementById("draw");
    if (!button) return;
    var count = Object.keys(state.selected).length;
    button.disabled = count === 0;
    button.textContent = count ? "Karte aus " + count + (count === 1 ? " Fahrt" : " Fahrten") : "Fahrten auswählen";
  }

  function drawSelected() {
    var chosen = state.activities.filter(function (activity) { return state.selected[activity.id]; });
    if (!chosen.length) return;
    state.cancel = false;
    state.skipped = [];
    state.mode = "working";
    state.status = "GPS wird geholt, 0 von " + chosen.length;
    render();
    var stages = [];
    var index = 0;
    function step() {
      if (state.cancel) {
        state.mode = "pick";
        state.status = "Abgebrochen.";
        render();
        return;
      }
      if (index >= chosen.length) {
        if (!stages.length) {
          state.error = "In den gewählten Fahrten liegt keine GPS-Linie.";
          state.mode = "pick";
          render();
          return;
        }
        state.tour = { name: null, stages: stages, waypoints: [] };
        state.source = "strava";
        if (!state.options.title && stages.length === 1) state.options.title = stages[0].name;
        state.mode = "map";
        state.error = "";
        render();
        return;
      }
      var activity = chosen[index];
      index += 1;
      state.status = "GPS wird geholt, " + index + " von " + chosen.length;
      var progress = document.getElementById("progress");
      if (progress) progress.textContent = state.status;
      TourkarteStrava.ensureFresh(state.session, fetch).then(function (session) {
        state.session = session;
        saveSession(session);
        return TourkarteStrava.activityStreams(session, activity.id, fetch);
      }).then(function (streams) {
        var points = TourkarteStrava.pointsFromStreams(streams, activity.start_date);
        if (points.length < 2) {
          var encoded = activity.map && (activity.map.polyline || activity.map.summary_polyline);
          if (encoded) points = TourkarteStrava.pointsFromPolyline(encoded);
        }
        if (points.length < 2) state.skipped.push(activity.name || ("Fahrt " + activity.id));
        else {
          stages.push({
            name: activity.name || ("Fahrt " + activity.id),
            when: TourkarteStrava.localDate(activity),
            segments: [points]
          });
        }
        step();
      }).catch(function (error) {
        if (/begrenzt|Authorization|abgelaufen/i.test(error.message || "")) {
          state.error = error.message;
          state.mode = "pick";
          render();
          return;
        }
        state.skipped.push((activity.name || "Fahrt") + ": " + error.message);
        step();
      });
    }
    step();
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
      state.skipped = [];
      state.options.title = state.tour.name || "";
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
      state.skipped = [];
      state.options.title = state.tour.name || "Beispieltour";
      state.mode = "map";
      render();
    }).catch(function (error) {
      state.error = error.message;
      render();
    });
  }

  function currentSvg() {
    var scene = TourkarteMap.buildScene(state.tour, {
      title: state.options.title,
      startLabel: state.options.startLabel,
      endLabel: state.options.endLabel,
      fmt: state.options.fmt,
      route: state.options.route,
      colorByDay: state.options.colorByDay,
      basemap: state.options.basemap
    });
    return { scene: scene, svg: TourkarteMap.sceneToSvg(scene) };
  }

  function refreshPreview() {
    var preview = document.getElementById("preview");
    if (!preview || !state.tour) return;
    var drawn;
    try {
      drawn = currentSvg();
    } catch (error) {
      preview.innerHTML = '<p class="error">' + esc(error.message) + "</p>";
      return;
    }
    state.mapGeneration += 1;
    var generation = state.mapGeneration;
    state.embeddedSvg = "";
    state.pngBlob = null;
    state.pngSvg = "";
    preview.innerHTML = drawn.svg;
    var status = document.getElementById("map-status");
    if (!drawn.scene.tiles || !drawn.scene.tiles.length) {
      if (status) status.textContent = "";
      rememberPicture(drawn.svg, drawn.scene, generation);
      return;
    }
    if (status) status.textContent = "Hintergrundkarte wird geladen…";
    embedTiles(drawn.scene.tiles).then(function (missing) {
      if (generation !== state.mapGeneration) return;
      var svg = TourkarteMap.sceneToSvg(drawn.scene);
      var node = document.getElementById("preview");
      if (node) node.innerHTML = svg;
      state.embeddedSvg = svg;
      if (status) status.textContent = missing ? "Ein Teil der Karte konnte nicht geladen werden." : "";
      rememberPicture(svg, drawn.scene, generation);
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

  function rememberPicture(svg, scene, generation) {
    state.pngSvg = svg;
    svgToPng(svg, scene.width, scene.height).then(function (blob) {
      if (generation === state.mapGeneration && state.pngSvg === svg) state.pngBlob = blob;
    }).catch(function () {
      if (generation === state.mapGeneration) state.pngBlob = null;
    });
  }

  function shareSvgFile() {
    var drawn = currentSvg();
    var svg = state.embeddedSvg || drawn.svg;
    var name = fileSlug(state.options.title || drawn.scene.title) + ".svg";
    shareBlob(new Blob([svg], { type: "image/svg+xml" }), name, "image/svg+xml");
  }

  function sharePngFile() {
    if (!state.pngBlob) {
      state.error = "Das Bild wird noch aufgebaut. Gleich noch einmal teilen.";
      var banner = document.querySelector(".error");
      if (banner) banner.textContent = state.error;
      else render();
      return;
    }
    state.error = "";
    var banner = document.querySelector(".error");
    if (banner) banner.remove();
    var drawn = currentSvg();
    shareBlob(state.pngBlob, fileSlug(state.options.title || drawn.scene.title) + ".png", "image/png");
  }

  function shareBlob(blob, filename, mime) {
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
        canvas.getContext("2d").drawImage(image, 0, 0, pixelW, pixelH);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (png) {
          if (png) resolve(png);
          else reject(new Error("png"));
        }, "image/png");
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("png"));
      };
      image.src = url;
    });
  }

  function disconnectStrava() {
    state.session = null;
    state.activities = [];
    state.selected = {};
    state.tour = null;
    localStorage.removeItem(STORAGE);
    sessionStorage.removeItem(STATE_KEY);
    state.mode = "setup";
    state.error = "";
    render();
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

  function canOAuth() {
    return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  }

  function isoDate(date) {
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function fileSlug(title) {
    var text = String(title || "tourkarte").toLowerCase();
    text = text.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
    if (text.normalize) text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    text = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return (text || "tourkarte").slice(0, 40);
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
