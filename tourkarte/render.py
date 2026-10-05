"""Linienkarte im Satz eines Fotoalbums. Ausgabe als SVG, optional PNG."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .geo import (
    clean_points,
    douglas_peucker,
    elevation_gain_m,
    format_date_range,
    format_hm,
    format_km,
    format_scale,
    nice_length_m,
    parse_hex,
    path_distance_m,
    project,
)
from .gpx import Tour, stage_dates

PAPER = "#f3efe6"
INK = "#1c1916"
MUTED = "#6f675c"
RULE = "#d4cdc2"
ROUTE = "#9c3412"
DAY_COLORS = (
    "#9c3412",
    "#1e4d5c",
    "#a56b12",
    "#3e5340",
    "#6e3a45",
    "#2f4f78",
    "#6a5340",
    "#2a6158",
)
SERIF = "'Liberation Serif', Palatino, 'Palatino Linotype', Georgia, serif"
SANS = "Inter, 'Liberation Sans', 'Helvetica Neue', Arial, sans-serif"
SEPARATOR = "\u2003·\u2003"

FORMATS = {
    "square": (210.0, 210.0),
    "a4": (297.0, 210.0),
    "a4-hoch": (210.0, 297.0),
}


@dataclass
class Options:
    title: str | None = None
    start_label: str | None = None
    end_label: str | None = None
    fmt: str = "square"
    page_mm: tuple[float, float] | None = None
    paper: str = PAPER
    ink: str = INK
    muted: str = MUTED
    route: str = ROUTE
    color_by_day: bool = False

    def normalized(self) -> "Options":
        return Options(
            title=self.title,
            start_label=self.start_label,
            end_label=self.end_label,
            fmt=self.fmt,
            page_mm=self.page_mm,
            paper=parse_hex(self.paper),
            ink=parse_hex(self.ink),
            muted=parse_hex(self.muted),
            route=parse_hex(self.route),
            color_by_day=self.color_by_day,
        )


@dataclass
class Scene:
    width: float
    height: float
    width_mm: float
    height_mm: float
    background: str
    title: str
    map_rect: tuple[float, float, float, float]
    items: list


def build_scene(tour: Tour, options: Options | None = None) -> Scene:
    options = (options or Options()).normalized()
    prepared = _prepare(tour)
    if not prepared["stages"]:
        raise ValueError("In den GPX-Dateien liegt keine gefahrene Linie.")
    width_mm, height_mm = _page_mm(options, prepared["coords"])
    width = width_mm * 10
    height = height_mm * 10
    title = (options.title or tour.name or "Bikepacking").strip() or "Bikepacking"
    dates = _date_line(tour)
    distance = sum(path_distance_m(points) for points in prepared["distance_points"])
    gain_values = [elevation_gain_m(points) for points in prepared["distance_points"]]
    gain = None if all(value is None for value in gain_values) else sum(value or 0 for value in gain_values)
    stage_count = len(prepared["stages"])
    stats = _stats_line(distance, gain, stage_count)
    colors = _stage_colors(prepared["stages"], options)
    legend = _legend(prepared["stages"], colors) if options.color_by_day and stage_count > 1 else []

    frame = _layout(width, height, title, dates, stats, legend, options)
    transform, scale, shown_m = _fit(prepared["coords"], frame["map"], inset=frame["inset"])
    stroke = _clamp(min(frame["map"][2], frame["map"][3]) * 0.0048, 5.2, 10.5)
    epsilon = max(8.0, 2.4 / scale) if scale else 20.0

    items = [{"op": "rect", "x": 0, "y": 0, "w": width, "h": height, "fill": options.paper}]
    map_x, map_y, map_w, map_h = frame["map"]
    items.append(
        {
            "op": "rect",
            "x": map_x,
            "y": map_y,
            "w": map_w,
            "h": map_h,
            "fill": None,
            "stroke": RULE,
            "stroke_width": 1.4,
        }
    )

    page_paths = []
    for stage, color in zip(prepared["stages"], colors):
        paths = []
        for segment in stage["segments"]:
            simplified = douglas_peucker(segment, epsilon)
            if len(simplified) >= 2:
                paths.append([transform(x, y) for x, y in simplified])
        if not paths:
            continue
        page_paths.append(paths)
        items.append(
            {
                "op": "polyline",
                "paths": paths,
                "stroke": color,
                "stroke_width": stroke,
                "halo": options.paper,
                "halo_width": stroke * 2.15,
            }
        )

    for waypoint in prepared["waypoints"]:
        sx, sy = transform(*waypoint["xy"])
        items.append(
            {
                "op": "circle",
                "cx": sx,
                "cy": sy,
                "r": max(5.4, stroke * 0.7),
                "fill": options.paper,
                "stroke": options.ink,
                "stroke_width": 1.6,
            }
        )
        _place_label(
            items,
            waypoint["name"],
            sx,
            sy - stroke - 8,
            frame["map"],
            options,
            size=max(18, stroke * 2.1),
        )

    if page_paths:
        start = page_paths[0][0][0]
        start_away = page_paths[0][0][min(1, len(page_paths[0][0]) - 1)]
        end = page_paths[-1][-1][-1]
        end_away = page_paths[-1][-1][max(0, len(page_paths[-1][-1]) - 2)]
        _marker(items, start, stroke, options.paper, options.ink, filled=True)
        _marker(items, end, stroke, options.paper, options.route, filled=False)
        if options.start_label:
            _endpoint_label(items, options.start_label, start, start_away, stroke, frame["map"], options)
        if options.end_label:
            _endpoint_label(items, options.end_label, end, end_away, stroke, frame["map"], options)

    _north_arrow(items, frame["map"], options.muted)
    items.extend(frame["caption"])
    _scale_bar(items, frame, scale, shown_m, options)
    return Scene(width, height, width_mm, height_mm, options.paper, title, frame["map"], items)


def write_svg(scene: Scene, path) -> None:
    from pathlib import Path

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" xml:lang="de" '
            f'width="{_num(scene.width_mm)}mm" height="{_num(scene.height_mm)}mm" '
            f'viewBox="0 0 {_num(scene.width)} {_num(scene.height)}" role="img">'
        ),
        f"<title>{_xml(scene.title)}</title>",
        "<desc>Übersichtskarte fürs Fotoalbum</desc>",
    ]
    for item in scene.items:
        lines.append(_svg_item(item))
    lines.append("</svg>")
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_png(scene: Scene, path) -> None:
    from pathlib import Path

    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        raise ValueError("Für PNG fehlt Pillow. Die SVG-Datei braucht es nicht.") from error

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (int(round(scene.width)), int(round(scene.height))), scene.background)
    draw = ImageDraw.Draw(image)
    fonts = _font_cache()
    for item in scene.items:
        _png_item(draw, item, fonts, scene.background, ImageFont)
    image.save(destination, "PNG")


def _prepare(tour: Tour) -> dict:
    lats = []
    for stage in tour.stages:
        for segment in stage.segments:
            lats.extend(point.lat for point in segment)
    for waypoint in tour.waypoints:
        lats.append(waypoint.lat)
    if not lats:
        return {"coords": [], "stages": [], "waypoints": [], "distance_points": []}
    lat0 = sum(lats) / len(lats)
    stages = []
    distance_points = []
    coords = []
    for stage in tour.stages:
        segments = []
        flat = []
        for segment in stage.segments:
            cleaned = clean_points(segment)
            if len(cleaned) < 2:
                continue
            projected = [project(point.lat, point.lon, lat0) for point in cleaned]
            segments.append(projected)
            flat.extend(cleaned)
            coords.extend(projected)
        if segments:
            stages.append({"name": stage.name, "when": stage.when, "segments": segments, "stage": stage})
            distance_points.append(flat)
    waypoints = []
    for waypoint in tour.waypoints:
        if not waypoint.name:
            continue
        waypoints.append({"name": waypoint.name, "xy": project(waypoint.lat, waypoint.lon, lat0)})
        coords.append(waypoints[-1]["xy"])
    return {"coords": coords, "stages": stages, "waypoints": waypoints, "distance_points": distance_points}


def _page_mm(options: Options, coords) -> tuple[float, float]:
    if options.page_mm is not None:
        width, height = options.page_mm
        if width < 40 or height < 40:
            raise ValueError("Die Seite muss mindestens 40 mm × 40 mm groß sein.")
        return float(width), float(height)
    if options.fmt == "auto":
        xs = [point[0] for point in coords]
        ys = [point[1] for point in coords]
        span_x = max(max(xs) - min(xs), 1.0)
        span_y = max(max(ys) - min(ys), 1.0)
        if span_x / span_y >= 1.35:
            return FORMATS["a4"]
        if span_y / span_x >= 1.35:
            return FORMATS["a4-hoch"]
        return FORMATS["square"]
    try:
        return FORMATS[options.fmt]
    except KeyError as error:
        raise ValueError("Das Format ist square, a4, a4-hoch oder auto.") from error


def _layout(width, height, title, dates, stats, legend, options: Options) -> dict:
    short = min(width, height)
    margin = max(90.0, round(short * 0.068))
    title_size = max(40.0, round(short * 0.033))
    title_size = _fit_text(title, title_size, width - 2 * margin, 0.50, minimum=28)
    date_size = round(title_size * 0.46)
    stats_size = round(title_size * 0.40)
    legend_size = round(title_size * 0.34)
    gap = round(title_size * 0.36)
    map_w = width - 2 * margin
    legend_rows = _wrap_legend(legend, legend_size, map_w) if legend else []
    row_h = legend_size + 12
    legend_block = len(legend_rows) * row_h + (gap * 0.45 if legend_rows else 0)
    stats_baseline = height - margin - legend_block
    if dates:
        date_baseline = stats_baseline - (date_size + gap * 0.85)
        title_baseline = date_baseline - (title_size * 0.72 + gap * 0.55)
    else:
        date_baseline = None
        title_baseline = stats_baseline - (title_size * 0.72 + gap * 0.7)
    map_bottom = title_baseline - (title_size * 0.92 + gap)
    map_top = margin
    map_h = map_bottom - map_top
    if map_h < 280:
        raise ValueError("Die Seite ist für Karte und Beschriftung zu klein.")
    map_rect = (margin, map_top, map_w, map_h)
    caption = [
        {
            "op": "line",
            "x1": margin,
            "y1": map_bottom + gap * 0.55,
            "x2": margin + map_w,
            "y2": map_bottom + gap * 0.55,
            "stroke": RULE,
            "stroke_width": 1.2,
        },
        _text(margin, title_baseline, title, title_size, options.ink, "serif", "regular", "start"),
    ]
    if dates and date_baseline is not None:
        caption.append(_text(margin, date_baseline, dates, date_size, options.muted, "serif", "italic", "start"))
    caption.append(_text(margin, stats_baseline, stats, stats_size, options.ink, "sans", "medium", "start"))
    legend_top = stats_baseline + gap * 0.85
    for row_index, row in enumerate(legend_rows):
        baseline = legend_top + legend_size + row_index * row_h
        caption.extend(_legend_items(row, margin, baseline, legend_size, options.ink))
    return {
        "map": map_rect,
        "inset": max(34.0, stroke_guess(map_rect)),
        "caption": caption,
        "stats": stats,
        "stats_baseline": stats_baseline,
        "stats_size": stats_size,
        "margin": margin,
    }


def stroke_guess(map_rect) -> float:
    return _clamp(min(map_rect[2], map_rect[3]) * 0.0048, 5.2, 10.5)


def _fit(coords, map_rect, inset: float):
    xs = [point[0] for point in coords]
    ys = [point[1] for point in coords]
    center_x = (min(xs) + max(xs)) / 2
    center_y = (min(ys) + max(ys)) / 2
    window_x = max(max(xs) - min(xs), 1_500.0)
    window_y = max(max(ys) - min(ys), 1_500.0)
    pad_x = window_x * 0.10
    pad_y = window_y * 0.10
    min_x = center_x - window_x / 2 - pad_x
    max_x = center_x + window_x / 2 + pad_x
    min_y = center_y - window_y / 2 - pad_y
    max_y = center_y + window_y / 2 + pad_y
    map_x, map_y, map_w, map_h = map_rect
    inner_x = map_x + inset
    inner_y = map_y + inset
    inner_w = map_w - 2 * inset
    inner_h = map_h - 2 * inset
    scale = min(inner_w / (max_x - min_x), inner_h / (max_y - min_y))
    used_w = (max_x - min_x) * scale
    used_h = (max_y - min_y) * scale
    origin_x = inner_x + (inner_w - used_w) / 2
    origin_y = inner_y + (inner_h - used_h) / 2

    def transform(x, y):
        return origin_x + (x - min_x) * scale, origin_y + used_h - (y - min_y) * scale

    return transform, scale, max_x - min_x


def _marker(items, center, stroke, paper, color, filled: bool) -> None:
    cx, cy = center
    if filled:
        radius = stroke * 1.2
        items.append({"op": "circle", "cx": cx, "cy": cy, "r": radius + 2.4, "fill": paper, "stroke": None, "stroke_width": 0})
        items.append({"op": "circle", "cx": cx, "cy": cy, "r": radius, "fill": color, "stroke": None, "stroke_width": 0})
        return
    radius = stroke * 1.55
    items.append({"op": "circle", "cx": cx, "cy": cy, "r": radius + 2.2, "fill": paper, "stroke": None, "stroke_width": 0})
    items.append(
        {
            "op": "circle",
            "cx": cx,
            "cy": cy,
            "r": radius,
            "fill": paper,
            "stroke": color,
            "stroke_width": max(1.8, stroke * 0.42),
        }
    )


def _endpoint_label(items, text, point, neighbor, stroke, map_rect, options: Options) -> None:
    if not text:
        return
    size = max(20.0, stroke * 2.15)
    vx = point[0] - neighbor[0]
    vy = point[1] - neighbor[1]
    norm = math.hypot(vx, vy) or 1.0
    ux, uy = vx / norm, vy / norm
    px, py = -uy, ux
    gap = stroke * 2.6 + size * 0.95
    directions = (
        (ux, uy),
        (px, py),
        (-px, -py),
        (ux + px, uy + py),
        (ux - px, uy - py),
    )
    map_x, map_y, map_w, map_h = map_rect
    width = _estimate(text, size, 0.56)
    for ox, oy in directions:
        length = math.hypot(ox, oy) or 1.0
        ax = point[0] + ox / length * gap
        ay = point[1] + oy / length * gap
        if abs(ox) > abs(oy) * 0.85:
            anchor = "start" if ox > 0 else "end"
        else:
            anchor = "middle"
            ay += size * 0.2 if oy > 0 else -size * 0.25
        left, top, box_w, box_h = _text_box(ax, ay, width, size, anchor)
        if left < map_x + 12 or top < map_y + 12 or left + box_w > map_x + map_w - 12 or top + box_h > map_y + map_h - 12:
            continue
        items.append(
            _text(ax, ay, text, size, options.ink, "sans", "regular", anchor, halo=True, paper=options.paper)
        )
        return


def _place_label(items, text, x, y, map_rect, options: Options, size: float, avoid=None) -> None:
    if not text:
        return
    map_x, map_y, map_w, map_h = map_rect
    width = _estimate(text, size, 0.54)
    candidates = [(x + 12, y - 4, "start"), (x - 12, y - 4, "end"), (x, y - size - 6, "middle"), (x, y + size + 8, "middle")]
    if avoid is not None:
        candidates.sort(key=lambda item: abs(item[0] - avoid[0]) + abs(item[1] - avoid[1]), reverse=True)
    for anchor_x, anchor_y, anchor in candidates:
        left, top, box_w, box_h = _text_box(anchor_x, anchor_y, width, size, anchor)
        if left < map_x + 8 or top < map_y + 8 or left + box_w > map_x + map_w - 8 or top + box_h > map_y + map_h - 8:
            continue
        items.append(
            _text(anchor_x, anchor_y, text, size, options.ink, "sans", "regular", anchor, halo=True, paper=options.paper)
        )
        return


def _north_arrow(items, map_rect, color: str) -> None:
    map_x, map_y, map_w, _map_h = map_rect
    cx = map_x + map_w - 52
    tip_y = map_y + 36
    items.append(
        {
            "op": "polygon",
            "points": [(cx, tip_y), (cx - 6.5, tip_y + 16), (cx + 6.5, tip_y + 16)],
            "fill": color,
            "stroke": None,
            "stroke_width": 0,
        }
    )
    items.append(
        {
            "op": "line",
            "x1": cx,
            "y1": tip_y + 16,
            "x2": cx,
            "y2": tip_y + 34,
            "stroke": color,
            "stroke_width": 1.4,
        }
    )
    items.append(_text(cx, tip_y - 8, "N", 16, color, "sans", "medium", "middle"))


def _scale_bar(items, frame, scale, shown_m, options: Options) -> None:
    if scale <= 0:
        return
    map_x, _map_y, map_w, _map_h = frame["map"]
    target = shown_m * 0.22
    length_m = nice_length_m(target)
    bar_w = length_m * scale
    if bar_w > map_w * 0.46:
        length_m = nice_length_m(shown_m * 0.14)
        bar_w = length_m * scale
    label = format_scale(length_m)
    size = frame["stats_size"]
    label_w = _estimate(label, size, 0.56)
    stats_w = _estimate(frame["stats"], size, 0.56)
    bar_h = max(6.0, size * 0.28)
    baseline = frame["stats_baseline"]
    right = map_x + map_w
    label_x = right
    bar_right = label_x - label_w - 14
    bar_left = bar_right - bar_w
    bar_y = baseline - size * 0.62
    if bar_left < map_x + stats_w + 28:
        return
    items.append(
        {
            "op": "rect",
            "x": bar_left,
            "y": bar_y,
            "w": bar_w / 2,
            "h": bar_h,
            "fill": options.ink,
            "stroke": options.ink,
            "stroke_width": 1,
        }
    )
    items.append(
        {
            "op": "rect",
            "x": bar_left + bar_w / 2,
            "y": bar_y,
            "w": bar_w / 2,
            "h": bar_h,
            "fill": options.paper,
            "stroke": options.ink,
            "stroke_width": 1.1,
        }
    )
    items.append(_text(label_x, baseline, label, size, options.ink, "sans", "medium", "end"))


def _stats_line(distance: float, gain: float | None, stage_count: int) -> str:
    parts = [format_km(distance)]
    if gain is not None:
        parts.append(format_hm(gain))
    if stage_count > 1:
        word = "Etappe" if stage_count == 1 else "Etappen"
        parts.append(f"{stage_count} {word}")
    return SEPARATOR.join(parts)


def _date_line(tour: Tour) -> str | None:
    found = []
    for stage in tour.stages:
        found.extend(stage_dates(stage))
    if not found:
        return None
    return format_date_range(min(found), max(found))


def _stage_colors(stages, options: Options) -> list[str]:
    if not options.color_by_day or len(stages) < 2:
        return [options.route for _stage in stages]
    return [DAY_COLORS[index % len(DAY_COLORS)] for index in range(len(stages))]


def _legend(stages, colors) -> list[tuple[str, str]]:
    entries = []
    for index, (stage, color) in enumerate(zip(stages, colors)):
        if stage["when"] is not None:
            label = f"{index + 1}  {stage['when'].day}.{stage['when'].month}."
        else:
            label = f"{index + 1}  {_short(stage['name'], 24)}"
        entries.append((color, label))
    return entries


def _wrap_legend(entries, size, width) -> list[list[tuple[str, str]]]:
    rows = []
    current = []
    used = 0.0
    for entry in entries:
        entry_w = 16 + size + _estimate(entry[1], size, 0.56) + 28
        if current and used + entry_w > width:
            rows.append(current)
            current = []
            used = 0.0
        current.append(entry)
        used += entry_w
    if current:
        rows.append(current)
    return rows


def _legend_items(row, x, baseline, size, ink: str) -> list[dict]:
    items = []
    cursor = x
    for color, label in row:
        square = size * 0.62
        items.append(
            {
                "op": "rect",
                "x": cursor,
                "y": baseline - square * 0.82,
                "w": square,
                "h": square,
                "fill": color,
            }
        )
        cursor += square + 8
        items.append(_text(cursor, baseline, label, size, ink, "sans", "regular", "start"))
        cursor += _estimate(label, size, 0.56) + 26
    return items


def _text(x, y, text, size, fill, font, style, anchor, halo=False, paper=PAPER) -> dict:
    return {
        "op": "text",
        "x": x,
        "y": y,
        "text": text,
        "size": size,
        "fill": fill,
        "font": font,
        "style": style,
        "anchor": anchor,
        "halo": halo,
        "paper": paper,
    }


def _svg_item(item) -> str:
    kind = item["op"]
    if kind == "rect":
        fill = item.get("fill") or "none"
        stroke = item.get("stroke")
        extra = f' stroke="{stroke}" stroke-width="{_num(item.get("stroke_width") or 1)}"' if stroke else ""
        return (
            f'<rect x="{_num(item["x"])}" y="{_num(item["y"])}" '
            f'width="{_num(item["w"])}" height="{_num(item["h"])}" fill="{fill}"{extra}/>'
        )
    if kind == "line":
        return (
            f'<line x1="{_num(item["x1"])}" y1="{_num(item["y1"])}" '
            f'x2="{_num(item["x2"])}" y2="{_num(item["y2"])}" '
            f'stroke="{item["stroke"]}" stroke-width="{_num(item["stroke_width"])}" stroke-linecap="round"/>'
        )
    if kind == "polyline":
        path = _path_data(item["paths"])
        common = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
        halo = (
            f'<path d="{path}" {common} stroke="{item["halo"]}" '
            f'stroke-width="{_num(item["halo_width"])}"/>'
        )
        stroke = (
            f'<path d="{path}" {common} stroke="{item["stroke"]}" '
            f'stroke-width="{_num(item["stroke_width"])}"/>'
        )
        return halo + stroke
    if kind == "circle":
        stroke = item.get("stroke")
        extra = f' stroke="{stroke}" stroke-width="{_num(item.get("stroke_width") or 1)}"' if stroke else ""
        fill = item.get("fill") or "none"
        return f'<circle cx="{_num(item["cx"])}" cy="{_num(item["cy"])}" r="{_num(item["r"])}" fill="{fill}"{extra}/>'
    if kind == "polygon":
        points = " ".join(f"{_num(x)},{_num(y)}" for x, y in item["points"])
        fill = item.get("fill") or "none"
        return f'<polygon points="{points}" fill="{fill}"/>'
    if kind == "text":
        family = SERIF if item["font"] == "serif" else SANS
        italic = ' font-style="italic"' if item["style"] == "italic" else ""
        weight = ' font-weight="500"' if item["style"] == "medium" else ""
        halo = ""
        if item.get("halo"):
            halo = (
                f' stroke="{item.get("paper", PAPER)}" stroke-width="8" '
                'paint-order="stroke fill" stroke-linejoin="round"'
            )
        return (
            f'<text x="{_num(item["x"])}" y="{_num(item["y"])}" fill="{item["fill"]}" '
            f'font-family="{family}" font-size="{_num(item["size"])}" '
            f'text-anchor="{item["anchor"]}" xml:space="preserve"{italic}{weight}{halo}>'
            f"{_xml(item['text'])}</text>"
        )
    return ""


def _png_item(draw, item, fonts, paper, image_font) -> None:
    kind = item["op"]
    if kind == "rect":
        box = [item["x"], item["y"], item["x"] + item["w"], item["y"] + item["h"]]
        if item.get("fill"):
            draw.rectangle(box, fill=item["fill"])
        if item.get("stroke"):
            width = max(1, int(round(item.get("stroke_width") or 1)))
            draw.rectangle(box, outline=item["stroke"], width=width)
        return
    if kind == "line":
        draw.line(
            [(item["x1"], item["y1"]), (item["x2"], item["y2"])],
            fill=item["stroke"],
            width=max(1, int(round(item["stroke_width"]))),
        )
        return
    if kind == "polyline":
        for path in item["paths"]:
            if len(path) < 2:
                continue
            draw.line(path, fill=item["halo"], width=max(1, int(round(item["halo_width"]))), joint="curve")
            draw.line(path, fill=item["stroke"], width=max(1, int(round(item["stroke_width"]))), joint="curve")
        return
    if kind == "circle":
        radius = item["r"]
        box = [item["cx"] - radius, item["cy"] - radius, item["cx"] + radius, item["cy"] + radius]
        width = max(1, int(round(item.get("stroke_width") or 1))) if item.get("stroke") else 0
        draw.ellipse(box, fill=item.get("fill"), outline=item.get("stroke"), width=width)
        return
    if kind == "polygon":
        draw.polygon(item["points"], fill=item.get("fill"))
        return
    if kind == "text":
        font = _load_font(image_font, fonts, item["font"], item["style"], item["size"])
        anchor = {"start": "ls", "middle": "ms", "end": "rs"}[item["anchor"]]
        if item.get("halo"):
            for dx in (-4, 0, 4):
                for dy in (-4, 0, 4):
                    if dx == 0 and dy == 0:
                        continue
                    draw.text((item["x"] + dx, item["y"] + dy), item["text"], font=font, fill=paper, anchor=anchor)
        draw.text((item["x"], item["y"]), item["text"], font=font, fill=item["fill"], anchor=anchor)


def _font_cache():
    return {}


def _load_font(image_font, cache, family, style, size):
    key = (family, style, round(size))
    if key in cache:
        return cache[key]
    paths = {
        ("serif", "regular"): "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        ("serif", "italic"): "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
        ("serif", "medium"): "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        ("sans", "regular"): "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ("sans", "medium"): "/usr/share/fonts/truetype/macos/Inter-Medium.ttf",
        ("sans", "italic"): "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
    }
    path = paths.get((family, style)) or paths[(family, "regular")]
    try:
        font = image_font.truetype(path, key[2])
    except OSError:
        font = image_font.load_default()
    cache[key] = font
    return font


def _path_data(paths) -> str:
    commands = []
    for path in paths:
        for index, (x, y) in enumerate(path):
            command = "M" if index == 0 else "L"
            commands.append(f"{command}{_num(x)} {_num(y)}")
    return " ".join(commands)


def _short(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _estimate(text: str, size: float, factor: float) -> float:
    return len(text) * size * factor


def _fit_text(text: str, size: float, width: float, factor: float, minimum: float) -> float:
    while size > minimum and _estimate(text, size, factor) > width:
        size -= 1
    return size


def _text_box(x, y, width, size, anchor):
    if anchor == "end":
        left = x - width
    elif anchor == "middle":
        left = x - width / 2
    else:
        left = x
    top = y - size * 0.82
    return left, top, width, size


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _num(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
