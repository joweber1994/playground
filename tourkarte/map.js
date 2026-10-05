/* Tourkarte – GPX, Strecke und Album-SVG.
   Reine Funktionen, ohne DOM. Im Browser als TourkarteMap, unter Node als Modul. */

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TourkarteMap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var EARTH = 6371000;
  var PAPER = "#f3efe6";
  var INK = "#1c1916";
  var MUTED = "#6f675c";
  var RULE = "#d4cdc2";
  var ROUTE = "#9c3412";
  var DAY_COLORS = ["#9c3412", "#1e4d5c", "#a56b12", "#3e5340", "#6e3a45", "#2f4f78", "#6a5340", "#2a6158"];
  var SERIF = "Palatino, 'Iowan Old Style', Georgia, 'Liberation Serif', serif";
  var SANS = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Inter, 'Liberation Sans', Arial, sans-serif";
  var SEPARATOR = "\u2003·\u2003";
  var MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  var FORMATS = { square: [210, 210], a4: [297, 210], "a4-hoch": [210, 297] };

  function haversineM(lat1, lon1, lat2, lon2) {
    var p1 = radians(lat1);
    var p2 = radians(lat2);
    var dphi = radians(lat2 - lat1);
    var dl = radians(lon2 - lon1);
    var a = Math.sin(dphi / 2) * Math.sin(dphi / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function pathDistanceM(points) {
    var total = 0;
    var previous = null;
    points.forEach(function (point) {
      if (previous) {
        var step = haversineM(previous.lat, previous.lon, point.lat, point.lon);
        if (step <= 500000) total += step;
      }
      previous = point;
    });
    return total;
  }

  function elevationGainM(points) {
    var elevations = points.filter(function (point) { return point.ele != null; }).map(function (point) { return point.ele; });
    if (elevations.length < 2) return null;
    var gain = 0;
    var anchor = elevations[0];
    elevations.slice(1).forEach(function (elevation) {
      var delta = elevation - anchor;
      if (Math.abs(delta) >= 3) {
        if (delta > 0) gain += delta;
        anchor = elevation;
      }
    });
    return gain;
  }

  function cleanPoints(points) {
    if (points.length < 3) return points.slice();
    var kept = [points[0]];
    for (var i = 1; i < points.length - 1; i += 1) {
      if (!isSpike(kept[kept.length - 1], points[i], points[i + 1])) kept.push(points[i]);
    }
    kept.push(points[points.length - 1]);
    return kept.length < 2 ? points.slice() : kept;
  }

  function isSpike(previous, current, next) {
    var jump = haversineM(previous.lat, previous.lon, current.lat, current.lon);
    var back = haversineM(current.lat, current.lon, next.lat, next.lon);
    var span = haversineM(previous.lat, previous.lon, next.lat, next.lon);
    if (jump > 2000 && back > 2000 && span < Math.min(jump, back) * 0.35) return true;
    var prevMs = timeMs(previous.time);
    var curMs = timeMs(current.time);
    if (prevMs != null && curMs != null) {
      var seconds = (curMs - prevMs) / 1000;
      if (seconds > 0 && jump > 500 && jump / seconds > 40) return true;
      if (seconds <= 0 && jump > 30000) return true;
    } else if (jump > 30000) return true;
    return false;
  }

  function project(lat, lon, lat0) {
    return [
      radians(lon) * Math.cos(radians(lat0)) * EARTH,
      radians(lat) * EARTH
    ];
  }

  function perpendicularDistance(point, start, end) {
    var dx = end[0] - start[0];
    var dy = end[1] - start[1];
    var length = Math.hypot(dx, dy);
    if (length === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
    return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / length;
  }

  function douglasPeucker(coords, epsilon) {
    var count = coords.length;
    if (count < 3 || epsilon <= 0) return coords.slice();
    var keep = new Array(count);
    keep[0] = true;
    keep[count - 1] = true;
    var stack = [[0, count - 1]];
    while (stack.length) {
      var range = stack.pop();
      var worst = -1;
      var worstIndex = -1;
      for (var i = range[0] + 1; i < range[1]; i += 1) {
        var distance = perpendicularDistance(coords[i], coords[range[0]], coords[range[1]]);
        if (distance > worst) {
          worst = distance;
          worstIndex = i;
        }
      }
      if (worst > epsilon && worstIndex !== -1) {
        keep[worstIndex] = true;
        stack.push([range[0], worstIndex]);
        stack.push([worstIndex, range[1]]);
      }
    }
    return coords.filter(function (_, index) { return keep[index]; });
  }

  function formatKm(meters) {
    var kilometers = meters / 1000;
    if (kilometers >= 100) return grouped(Math.round(kilometers)) + " km";
    if (kilometers >= 10) return Math.round(kilometers) + " km";
    return kilometers.toFixed(1).replace(".", ",") + " km";
  }

  function formatHm(meters) {
    return grouped(Math.round(meters)) + " hm";
  }

  function formatScale(meters) {
    if (meters >= 1000) {
      var kilometers = meters / 1000;
      if (Math.abs(kilometers - Math.round(kilometers)) < 1e-6) return Math.round(kilometers) + " km";
      return kilometers.toFixed(1).replace(".", ",") + " km";
    }
    return Math.round(meters) + " m";
  }

  function formatDateRange(start, end) {
    var a = asDate(start);
    var b = asDate(end);
    if (a.y === b.y && a.m === b.m && a.d === b.d) return a.d + ". " + MONTHS[a.m - 1] + " " + a.y;
    if (a.y === b.y && a.m === b.m) return a.d + ".–" + b.d + ". " + MONTHS[a.m - 1] + " " + a.y;
    if (a.y === b.y) return a.d + ". " + MONTHS[a.m - 1] + " – " + b.d + ". " + MONTHS[b.m - 1] + " " + a.y;
    return a.d + ". " + MONTHS[a.m - 1] + " " + a.y + " – " + b.d + ". " + MONTHS[b.m - 1] + " " + b.y;
  }

  function formatActivityDate(value) {
    if (!value) return "";
    var day = asDate(String(value).slice(0, 10));
    return day.d + ". " + MONTHS[day.m - 1] + " " + day.y;
  }

  function parseGpx(text, fallbackName) {
    var name = tagText(block(text, "metadata") || "", "name");
    var stages = [];
    blocks(text, "trk").forEach(function (track, index) {
      var segments = blocks(track, "trkseg").map(readPoints).filter(function (points) { return points.length; });
      if (!segments.length) {
        var loose = readPoints(track);
        if (loose.length) segments = [loose];
      }
      if (!segments.length) return;
      stages.push({
        name: tagText(track, "name") || ((fallbackName || "Etappe") + " " + (index + 1)),
        when: tagText(track, "start_local"),
        segments: segments
      });
    });
    if (!stages.length) {
      blocks(text, "rte").forEach(function (route, index) {
        var points = readPoints(route, "rtept");
        if (points.length >= 2) {
          stages.push({
            name: tagText(route, "name") || ((fallbackName || "Etappe") + " " + (index + 1)),
            when: tagText(route, "start_local"),
            segments: [points]
          });
        }
      });
    }
    var waypoints = collectWaypoints(text);
    if (!stages.length) throw new Error("In der GPX-Datei liegt keine gefahrene Linie.");
    return { name: name || fallbackName || null, stages: sortStages(stages), waypoints: waypoints };
  }

  function mergeTours(tours) {
    var stages = [];
    var waypoints = [];
    var name = null;
    tours.forEach(function (tour) {
      if (!name && tour.name) name = tour.name;
      stages = stages.concat(tour.stages || []);
      waypoints = waypoints.concat(tour.waypoints || []);
    });
    stages = sortStages(stages);
    if (!stages.some(function (stage) {
      return stage.segments.some(function (segment) { return segment.length >= 2; });
    })) throw new Error("In den GPX-Dateien liegt keine gefahrene Linie.");
    return { name: name, stages: stages, waypoints: waypoints };
  }

  function buildScene(tour, options) {
    options = normalizeOptions(options || {});
    var prepared = prepare(tour);
    if (!prepared.stages.length) throw new Error("In den GPX-Dateien liegt keine gefahrene Linie.");
    var page = pageMm(options, prepared.coords);
    var width = page[0] * 10;
    var height = page[1] * 10;
    var title = (options.title || tour.name || "Bikepacking").trim() || "Bikepacking";
    var dates = dateLine(tour);
    var distance = prepared.distancePoints.reduce(function (sum, points) { return sum + pathDistanceM(points); }, 0);
    var gains = prepared.distancePoints.map(elevationGainM);
    var gain = gains.every(function (value) { return value == null; }) ? null : gains.reduce(function (sum, value) { return sum + (value || 0); }, 0);
    var colors = stageColors(prepared.stages, options);
    var legend = options.colorByDay && prepared.stages.length > 1 ? legendEntries(prepared.stages, colors) : [];
    var frame = layout(width, height, title, dates, statsLine(distance, gain, prepared.stages.length), legend, options);
    var fitted = fit(prepared.coords, frame.map, frame.inset);
    var stroke = clamp(Math.min(frame.map[2], frame.map[3]) * 0.0048, 5.2, 10.5);
    var epsilon = fitted.scale ? Math.max(8, 2.4 / fitted.scale) : 20;
    var items = [{ op: "rect", x: 0, y: 0, w: width, h: height, fill: options.paper }];
    items.push({ op: "rect", x: frame.map[0], y: frame.map[1], w: frame.map[2], h: frame.map[3], fill: null, stroke: RULE, strokeWidth: 1.4 });
    var pagePaths = [];
    prepared.stages.forEach(function (stage, index) {
      var paths = [];
      stage.segments.forEach(function (segment) {
        var simplified = douglasPeucker(segment, epsilon);
        if (simplified.length >= 2) paths.push(simplified.map(function (point) { return fitted.transform(point[0], point[1]); }));
      });
      if (!paths.length) return;
      pagePaths.push(paths);
      items.push({ op: "polyline", paths: paths, stroke: colors[index], strokeWidth: stroke, halo: options.paper, haloWidth: stroke * 2.15 });
    });
    prepared.waypoints.forEach(function (waypoint) {
      var spot = fitted.transform(waypoint.xy[0], waypoint.xy[1]);
      items.push({ op: "circle", cx: spot[0], cy: spot[1], r: Math.max(5.4, stroke * 0.7), fill: options.paper, stroke: options.ink, strokeWidth: 1.6 });
      placeLabel(items, waypoint.name, spot[0], spot[1] - stroke - 8, frame.map, options, Math.max(18, stroke * 2.1));
    });
    if (pagePaths.length) {
      var start = pagePaths[0][0][0];
      var startAway = pagePaths[0][0][Math.min(1, pagePaths[0][0].length - 1)];
      var lastPath = pagePaths[pagePaths.length - 1];
      var end = lastPath[lastPath.length - 1][lastPath[lastPath.length - 1].length - 1];
      var endLine = lastPath[lastPath.length - 1];
      var endAway = endLine[Math.max(0, endLine.length - 2)];
      marker(items, start, stroke, options.paper, options.ink, true);
      marker(items, end, stroke, options.paper, options.route, false);
      if (options.startLabel) endpointLabel(items, options.startLabel, start, startAway, stroke, frame.map, options);
      if (options.endLabel) endpointLabel(items, options.endLabel, end, endAway, stroke, frame.map, options);
    }
    northArrow(items, frame.map, options.muted);
    items = items.concat(frame.caption);
    scaleBar(items, frame, fitted.scale, fitted.shown, options);
    return {
      width: width,
      height: height,
      widthMm: page[0],
      heightMm: page[1],
      background: options.paper,
      title: title,
      mapRect: frame.map,
      items: items
    };
  }

  function sceneToSvg(scene) {
    var lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" xml:lang="de" width="' + num(scene.widthMm) + 'mm" height="' + num(scene.heightMm) + 'mm" viewBox="0 0 ' + num(scene.width) + " " + num(scene.height) + '" role="img">',
      "<title>" + xml(scene.title) + "</title>",
      "<desc>Übersichtskarte fürs Fotoalbum</desc>"
    ];
    scene.items.forEach(function (item) { lines.push(svgItem(item)); });
    lines.push("</svg>");
    return lines.join("\n") + "\n";
  }

  function prepare(tour) {
    var lats = [];
    (tour.stages || []).forEach(function (stage) {
      stage.segments.forEach(function (segment) {
        segment.forEach(function (point) { lats.push(point.lat); });
      });
    });
    (tour.waypoints || []).forEach(function (waypoint) { lats.push(waypoint.lat); });
    if (!lats.length) return { coords: [], stages: [], waypoints: [], distancePoints: [] };
    var lat0 = lats.reduce(function (sum, lat) { return sum + lat; }, 0) / lats.length;
    var stages = [];
    var distancePoints = [];
    var coords = [];
    (tour.stages || []).forEach(function (stage) {
      var segments = [];
      var flat = [];
      stage.segments.forEach(function (segment) {
        var cleaned = cleanPoints(segment);
        if (cleaned.length < 2) return;
        var projected = cleaned.map(function (point) { return project(point.lat, point.lon, lat0); });
        segments.push(projected);
        flat = flat.concat(cleaned);
        coords = coords.concat(projected);
      });
      if (segments.length) {
        stages.push({ name: stage.name, when: stage.when, segments: segments });
        distancePoints.push(flat);
      }
    });
    var waypoints = [];
    (tour.waypoints || []).forEach(function (waypoint) {
      if (!waypoint.name) return;
      var xy = project(waypoint.lat, waypoint.lon, lat0);
      waypoints.push({ name: waypoint.name, xy: xy });
      coords.push(xy);
    });
    return { coords: coords, stages: stages, waypoints: waypoints, distancePoints: distancePoints };
  }

  function pageMm(options, coords) {
    if (options.fmt === "auto") {
      var xs = coords.map(function (point) { return point[0]; });
      var ys = coords.map(function (point) { return point[1]; });
      var spanX = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), 1);
      var spanY = Math.max(Math.max.apply(null, ys) - Math.min.apply(null, ys), 1);
      if (spanX / spanY >= 1.35) return FORMATS.a4;
      if (spanY / spanX >= 1.35) return FORMATS["a4-hoch"];
      return FORMATS.square;
    }
    if (!FORMATS[options.fmt]) throw new Error("Das Format ist square, a4, a4-hoch oder auto.");
    return FORMATS[options.fmt];
  }

  function layout(width, height, title, dates, stats, legend, options) {
    var short = Math.min(width, height);
    var margin = Math.max(90, Math.round(short * 0.068));
    var titleSize = fitText(title, Math.max(40, Math.round(short * 0.033)), width - 2 * margin, 0.5, 28);
    var dateSize = Math.round(titleSize * 0.46);
    var statsSize = Math.round(titleSize * 0.4);
    var legendSize = Math.round(titleSize * 0.34);
    var gap = Math.round(titleSize * 0.36);
    var mapW = width - 2 * margin;
    var legendRows = legend.length ? wrapLegend(legend, legendSize, mapW) : [];
    var rowH = legendSize + 12;
    var legendBlock = legendRows.length * rowH + (legendRows.length ? gap * 0.45 : 0);
    var statsBaseline = height - margin - legendBlock;
    var dateBaseline = null;
    var titleBaseline;
    if (dates) {
      dateBaseline = statsBaseline - (dateSize + gap * 0.85);
      titleBaseline = dateBaseline - (titleSize * 0.72 + gap * 0.55);
    } else titleBaseline = statsBaseline - (titleSize * 0.72 + gap * 0.7);
    var mapBottom = titleBaseline - (titleSize * 0.92 + gap);
    var mapH = mapBottom - margin;
    if (mapH < 280) throw new Error("Die Seite ist für Karte und Beschriftung zu klein.");
    var mapRect = [margin, margin, mapW, mapH];
    var caption = [
      { op: "line", x1: margin, y1: mapBottom + gap * 0.55, x2: margin + mapW, y2: mapBottom + gap * 0.55, stroke: RULE, strokeWidth: 1.2 },
      textItem(margin, titleBaseline, title, titleSize, options.ink, "serif", "regular", "start")
    ];
    if (dates && dateBaseline != null) caption.push(textItem(margin, dateBaseline, dates, dateSize, options.muted, "serif", "italic", "start"));
    caption.push(textItem(margin, statsBaseline, stats, statsSize, options.ink, "sans", "medium", "start"));
    var legendTop = statsBaseline + gap * 0.85;
    legendRows.forEach(function (row, rowIndex) {
      caption = caption.concat(legendItems(row, margin, legendTop + legendSize + rowIndex * rowH, legendSize, options.ink));
    });
    return {
      map: mapRect,
      inset: 36,
      caption: caption,
      stats: stats,
      statsBaseline: statsBaseline,
      statsSize: statsSize,
      margin: margin
    };
  }

  function fit(coords, mapRect, inset) {
    var xs = coords.map(function (point) { return point[0]; });
    var ys = coords.map(function (point) { return point[1]; });
    var centerX = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    var centerY = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var windowX = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), 1500);
    var windowY = Math.max(Math.max.apply(null, ys) - Math.min.apply(null, ys), 1500);
    var minX = centerX - windowX / 2 - windowX * 0.1;
    var maxX = centerX + windowX / 2 + windowX * 0.1;
    var minY = centerY - windowY / 2 - windowY * 0.1;
    var maxY = centerY + windowY / 2 + windowY * 0.1;
    var innerX = mapRect[0] + inset;
    var innerY = mapRect[1] + inset;
    var innerW = mapRect[2] - 2 * inset;
    var innerH = mapRect[3] - 2 * inset;
    var scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
    var usedW = (maxX - minX) * scale;
    var usedH = (maxY - minY) * scale;
    var originX = innerX + (innerW - usedW) / 2;
    var originY = innerY + (innerH - usedH) / 2;
    return {
      scale: scale,
      shown: maxX - minX,
      transform: function (x, y) {
        return [originX + (x - minX) * scale, originY + usedH - (y - minY) * scale];
      }
    };
  }

  function marker(items, center, stroke, paper, color, filled) {
    if (filled) {
      var radius = stroke * 1.2;
      items.push({ op: "circle", cx: center[0], cy: center[1], r: radius + 2.4, fill: paper });
      items.push({ op: "circle", cx: center[0], cy: center[1], r: radius, fill: color });
      return;
    }
    var ring = stroke * 1.55;
    items.push({ op: "circle", cx: center[0], cy: center[1], r: ring + 2.2, fill: paper });
    items.push({ op: "circle", cx: center[0], cy: center[1], r: ring, fill: paper, stroke: color, strokeWidth: Math.max(1.8, stroke * 0.42) });
  }

  function endpointLabel(items, label, point, neighbor, stroke, mapRect, options) {
    var size = Math.max(20, stroke * 2.15);
    var vx = point[0] - neighbor[0];
    var vy = point[1] - neighbor[1];
    var norm = Math.hypot(vx, vy) || 1;
    var ux = vx / norm;
    var uy = vy / norm;
    var px = -uy;
    var py = ux;
    var gap = stroke * 2.6 + size * 0.95;
    [[ux, uy], [px, py], [-px, -py], [ux + px, uy + py], [ux - px, uy - py]].some(function (direction) {
      var length = Math.hypot(direction[0], direction[1]) || 1;
      var ax = point[0] + direction[0] / length * gap;
      var ay = point[1] + direction[1] / length * gap;
      var anchor = "middle";
      if (Math.abs(direction[0]) > Math.abs(direction[1]) * 0.85) anchor = direction[0] > 0 ? "start" : "end";
      else ay += direction[1] > 0 ? size * 0.2 : -size * 0.25;
      var box = textBox(ax, ay, estimate(label, size, 0.56), size, anchor);
      if (box[0] < mapRect[0] + 12 || box[1] < mapRect[1] + 12 || box[0] + box[2] > mapRect[0] + mapRect[2] - 12 || box[1] + box[3] > mapRect[1] + mapRect[3] - 12) return false;
      items.push(textItem(ax, ay, label, size, options.ink, "sans", "regular", anchor, true, options.paper));
      return true;
    });
  }

  function placeLabel(items, label, x, y, mapRect, options, size) {
    if (!label) return;
    var width = estimate(label, size, 0.54);
    [[x + 12, y - 4, "start"], [x - 12, y - 4, "end"], [x, y - size - 6, "middle"], [x, y + size + 8, "middle"]].some(function (candidate) {
      var box = textBox(candidate[0], candidate[1], width, size, candidate[2]);
      if (box[0] < mapRect[0] + 8 || box[1] < mapRect[1] + 8 || box[0] + box[2] > mapRect[0] + mapRect[2] - 8 || box[1] + box[3] > mapRect[1] + mapRect[3] - 8) return false;
      items.push(textItem(candidate[0], candidate[1], label, size, options.ink, "sans", "regular", candidate[2], true, options.paper));
      return true;
    });
  }

  function northArrow(items, mapRect, color) {
    var cx = mapRect[0] + mapRect[2] - 52;
    var tipY = mapRect[1] + 36;
    items.push({ op: "polygon", points: [[cx, tipY], [cx - 6.5, tipY + 16], [cx + 6.5, tipY + 16]], fill: color });
    items.push({ op: "line", x1: cx, y1: tipY + 16, x2: cx, y2: tipY + 34, stroke: color, strokeWidth: 1.4 });
    items.push(textItem(cx, tipY - 8, "N", 16, color, "sans", "medium", "middle"));
  }

  function scaleBar(items, frame, scale, shown, options) {
    if (!scale) return;
    var mapX = frame.map[0];
    var mapW = frame.map[2];
    var lengthM = niceLength(shown * 0.22);
    var barW = lengthM * scale;
    if (barW > mapW * 0.46) {
      lengthM = niceLength(shown * 0.14);
      barW = lengthM * scale;
    }
    var label = formatScale(lengthM);
    var size = frame.statsSize;
    var labelW = estimate(label, size, 0.56);
    var statsW = estimate(frame.stats, size, 0.56);
    var barH = Math.max(6, size * 0.28);
    var right = mapX + mapW;
    var barRight = right - labelW - 14;
    var barLeft = barRight - barW;
    if (barLeft < mapX + statsW + 28) return;
    var barY = frame.statsBaseline - size * 0.62;
    items.push({ op: "rect", x: barLeft, y: barY, w: barW / 2, h: barH, fill: options.ink, stroke: options.ink, strokeWidth: 1 });
    items.push({ op: "rect", x: barLeft + barW / 2, y: barY, w: barW / 2, h: barH, fill: options.paper, stroke: options.ink, strokeWidth: 1.1 });
    items.push(textItem(right, frame.statsBaseline, label, size, options.ink, "sans", "medium", "end"));
  }

  function statsLine(distance, gain, count) {
    var parts = [formatKm(distance)];
    if (gain != null) parts.push(formatHm(gain));
    if (count > 1) parts.push(count + " Etappen");
    return parts.join(SEPARATOR);
  }

  function dateLine(tour) {
    var found = [];
    (tour.stages || []).forEach(function (stage) { found = found.concat(stageDates(stage)); });
    if (!found.length) return null;
    found.sort();
    return formatDateRange(found[0], found[found.length - 1]);
  }

  function stageDates(stage) {
    var found = [];
    if (stage.when) found.push(String(stage.when).slice(0, 10));
    var first = firstTime(stage);
    if (first) found.push(first.slice(0, 10));
    var last = null;
    stage.segments.forEach(function (segment) {
      segment.forEach(function (point) { if (point.time) last = point.time; });
    });
    if (last) found.push(String(last).slice(0, 10));
    return found;
  }

  function stageColors(stages, options) {
    if (!options.colorByDay || stages.length < 2) return stages.map(function () { return options.route; });
    return stages.map(function (_, index) { return DAY_COLORS[index % DAY_COLORS.length]; });
  }

  function legendEntries(stages, colors) {
    return stages.map(function (stage, index) {
      var label = stage.when ? (index + 1) + "  " + Number(String(stage.when).slice(8, 10)) + "." + Number(String(stage.when).slice(5, 7)) + "." : (index + 1) + "  " + short(stage.name, 24);
      return [colors[index], label];
    });
  }

  function wrapLegend(entries, size, width) {
    var rows = [];
    var current = [];
    var used = 0;
    entries.forEach(function (entry) {
      var entryW = 16 + size + estimate(entry[1], size, 0.56) + 28;
      if (current.length && used + entryW > width) {
        rows.push(current);
        current = [];
        used = 0;
      }
      current.push(entry);
      used += entryW;
    });
    if (current.length) rows.push(current);
    return rows;
  }

  function legendItems(row, x, baseline, size, ink) {
    var items = [];
    var cursor = x;
    row.forEach(function (entry) {
      var square = size * 0.62;
      items.push({ op: "rect", x: cursor, y: baseline - square * 0.82, w: square, h: square, fill: entry[0] });
      cursor += square + 8;
      items.push(textItem(cursor, baseline, entry[1], size, ink, "sans", "regular", "start"));
      cursor += estimate(entry[1], size, 0.56) + 26;
    });
    return items;
  }

  function svgItem(item) {
    if (item.op === "rect") {
      var extra = item.stroke ? ' stroke="' + item.stroke + '" stroke-width="' + num(item.strokeWidth || 1) + '"' : "";
      return '<rect x="' + num(item.x) + '" y="' + num(item.y) + '" width="' + num(item.w) + '" height="' + num(item.h) + '" fill="' + (item.fill || "none") + '"' + extra + "/>";
    }
    if (item.op === "line") {
      return '<line x1="' + num(item.x1) + '" y1="' + num(item.y1) + '" x2="' + num(item.x2) + '" y2="' + num(item.y2) + '" stroke="' + item.stroke + '" stroke-width="' + num(item.strokeWidth) + '" stroke-linecap="round"/>';
    }
    if (item.op === "polyline") {
      var path = pathData(item.paths);
      var common = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
      return '<path d="' + path + '" ' + common + ' stroke="' + item.halo + '" stroke-width="' + num(item.haloWidth) + '"/><path d="' + path + '" ' + common + ' stroke="' + item.stroke + '" stroke-width="' + num(item.strokeWidth) + '"/>';
    }
    if (item.op === "circle") {
      var stroke = item.stroke ? ' stroke="' + item.stroke + '" stroke-width="' + num(item.strokeWidth || 1) + '"' : "";
      return '<circle cx="' + num(item.cx) + '" cy="' + num(item.cy) + '" r="' + num(item.r) + '" fill="' + (item.fill || "none") + '"' + stroke + "/>";
    }
    if (item.op === "polygon") {
      return '<polygon points="' + item.points.map(function (point) { return num(point[0]) + "," + num(point[1]); }).join(" ") + '" fill="' + (item.fill || "none") + '"/>';
    }
    if (item.op === "text") {
      var family = item.font === "serif" ? SERIF : SANS;
      var italic = item.style === "italic" ? ' font-style="italic"' : "";
      var weight = item.style === "medium" ? ' font-weight="500"' : "";
      var halo = item.halo ? ' stroke="' + (item.paper || PAPER) + '" stroke-width="8" paint-order="stroke fill" stroke-linejoin="round"' : "";
      return '<text x="' + num(item.x) + '" y="' + num(item.y) + '" fill="' + item.fill + '" font-family="' + family + '" font-size="' + num(item.size) + '" text-anchor="' + item.anchor + '" xml:space="preserve"' + italic + weight + halo + ">" + xml(item.text) + "</text>";
    }
    return "";
  }

  function readPoints(source, tag) {
    return blocks(source, tag || "trkpt").map(function (body) {
      var lat = attr(body, "lat");
      var lon = attr(body, "lon");
      if (lat == null || lon == null || !usable(lat, lon)) return null;
      return { lat: lat, lon: lon, ele: saneElevation(numOrNull(tagText(body, "ele"))), time: tagText(body, "time") };
    }).filter(Boolean);
  }

  function collectWaypoints(text) {
    var waypoints = [];
    var re = /<(?:[\w.-]+:)?wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?wpt>)/gi;
    var match;
    while ((match = re.exec(text))) {
      var lat = attr(match[1], "lat");
      var lon = attr(match[1], "lon");
      if (lat == null || lon == null || !usable(lat, lon)) continue;
      waypoints.push({ lat: lat, lon: lon, name: tagText(match[2] || "", "name") || "" });
    }
    return waypoints;
  }

  function sortStages(stages) {
    return stages.map(function (stage, index) { return [stage, index]; }).sort(function (a, b) {
      return stageSortKey(a[0], a[1]) < stageSortKey(b[0], b[1]) ? -1 : 1;
    }).map(function (item) { return item[0]; });
  }

  function stageSortKey(stage, index) {
    if (stage.when) return "0-" + String(stage.when).slice(0, 10) + "-" + index;
    var time = firstTime(stage);
    if (time) return "0-" + time + "-" + index;
    return "1-" + index;
  }

  function firstTime(stage) {
    for (var s = 0; s < stage.segments.length; s += 1) {
      for (var p = 0; p < stage.segments[s].length; p += 1) {
        if (stage.segments[s][p].time) return stage.segments[s][p].time;
      }
    }
    return null;
  }

  function blocks(text, tag) {
    var re = new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?" + tag + ">)", "gi");
    var match;
    var found = [];
    while ((match = re.exec(text))) found.push((match[1] || "") + ">" + (match[2] || ""));
    return found;
  }

  function block(text, tag) {
    var found = blocks(text, tag);
    return found.length ? found[0] : null;
  }

  function tagText(source, tag) {
    var match = new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?" + tag + ">", "i").exec(source || "");
    return match ? decode(match[1].trim()) : null;
  }

  function attr(source, name) {
    var match = new RegExp("\\b" + name + "\\s*=\\s*\"([^\"]*)\"", "i").exec(source || "") || new RegExp("\\b" + name + "\\s*=\\s*'([^']*)'", "i").exec(source || "");
    if (!match) return null;
    var value = Number(decode(match[1]));
    return isFinite(value) ? value : null;
  }

  function normalizeOptions(options) {
    return {
      title: options.title || null,
      startLabel: options.startLabel || options.start || null,
      endLabel: options.endLabel || options.ziel || null,
      fmt: options.fmt || options.format || "square",
      paper: parseHex(options.paper || PAPER),
      ink: parseHex(options.ink || INK),
      muted: parseHex(options.muted || MUTED),
      route: parseHex(options.route || ROUTE),
      colorByDay: Boolean(options.colorByDay)
    };
  }

  function parseHex(value) {
    var text = String(value || "").trim();
    if (text.length === 4 && text.charAt(0) === "#") text = "#" + text.slice(1).split("").map(function (channel) { return channel + channel; }).join("");
    if (!/^#[0-9a-fA-F]{6}$/.test(text)) throw new Error("Farbe " + value + " ist kein Hexwert wie #9c3412.");
    return text.toLowerCase();
  }

  function textItem(x, y, value, size, fill, font, style, anchor, halo, paper) {
    return { op: "text", x: x, y: y, text: value, size: size, fill: fill, font: font, style: style, anchor: anchor, halo: Boolean(halo), paper: paper || PAPER };
  }

  function pathData(paths) {
    var commands = [];
    paths.forEach(function (path) {
      path.forEach(function (point, index) {
        commands.push((index === 0 ? "M" : "L") + num(point[0]) + " " + num(point[1]));
      });
    });
    return commands.join(" ");
  }

  function niceLength(target) {
    if (target <= 0) return 1000;
    var magnitude = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i += 1) {
      var length = steps[i] * magnitude;
      if (length >= target * 0.75) return length;
    }
    return 10 * magnitude;
  }

  function usable(lat, lon) {
    return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  }

  function saneElevation(value) {
    if (value == null || !isFinite(value) || value < -500 || value > 9000) return null;
    return value;
  }

  function timeMs(value) {
    if (!value) return null;
    var parsed = Date.parse(value);
    return isNaN(parsed) ? null : parsed;
  }

  function asDate(value) {
    var parts = String(value).slice(0, 10).split("-");
    return { y: Number(parts[0]), m: Number(parts[1]), d: Number(parts[2]) };
  }

  function grouped(value) {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function estimate(text, size, factor) {
    return String(text).length * size * factor;
  }

  function fitText(text, size, width, factor, minimum) {
    while (size > minimum && estimate(text, size, factor) > width) size -= 1;
    return size;
  }

  function textBox(x, y, width, size, anchor) {
    var left = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
    return [left, y - size * 0.82, width, size];
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function num(value) {
    return String(Math.round(value * 100) / 100);
  }

  function numOrNull(value) {
    if (value == null || value === "") return null;
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : null;
  }

  function xml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function decode(value) {
    return String(value).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  function radians(value) { return value * Math.PI / 180; }

  function short(text, limit) {
    text = text || "";
    return text.length <= limit ? text : text.slice(0, limit - 1).trim() + "…";
  }

  return {
    PAPER: PAPER,
    INK: INK,
    MUTED: MUTED,
    ROUTE: ROUTE,
    DAY_COLORS: DAY_COLORS,
    haversineM: haversineM,
    pathDistanceM: pathDistanceM,
    elevationGainM: elevationGainM,
    cleanPoints: cleanPoints,
    formatKm: formatKm,
    formatHm: formatHm,
    formatDateRange: formatDateRange,
    formatActivityDate: formatActivityDate,
    parseGpx: parseGpx,
    mergeTours: mergeTours,
    buildScene: buildScene,
    sceneToSvg: sceneToSvg,
    parseHex: parseHex
  };
});
