"""GPX lesen und schreiben. Strava-Exporte und eigene Dateien."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from .geo import sane_elevation, usable_point

GPX_NS = "http://www.topografix.com/GPX/1/1"
TOUR_NS = "urn:tourkarte"


@dataclass(frozen=True)
class Point:
    lat: float
    lon: float
    ele: float | None = None
    time: datetime | None = None


@dataclass(frozen=True)
class Waypoint:
    lat: float
    lon: float
    name: str = ""


@dataclass
class Stage:
    name: str
    segments: list[list[Point]] = field(default_factory=list)
    when: date | None = None

    def points(self) -> list[Point]:
        return [point for segment in self.segments for point in segment]


@dataclass
class Tour:
    name: str | None
    stages: list[Stage] = field(default_factory=list)
    waypoints: list[Waypoint] = field(default_factory=list)


def read_gpx(path: str | Path) -> Tour:
    file_path = Path(path)
    try:
        text = file_path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise ValueError(f"{file_path} lässt sich nicht lesen: {error.strerror}") from error
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise ValueError(f"{file_path} ist kein gültiges GPX: {error}") from error
    if _local(root.tag) != "gpx":
        raise ValueError(f"{file_path} ist kein GPX.")

    metadata_name = _child_text(root, "metadata", "name")
    stages: list[Stage] = []
    for track in _children(root, "trk"):
        stage = _read_track(track, file_path.stem, len(stages) + 1)
        if stage.segments:
            stages.append(stage)
    if not stages:
        for route in _children(root, "rte"):
            stage = _read_route(route, file_path.stem, len(stages) + 1)
            if stage.segments:
                stages.append(stage)

    waypoints = []
    for element in _children(root, "wpt"):
        point = _read_latlon(element)
        if point is None:
            continue
        lat, lon = point
        waypoints.append(Waypoint(lat, lon, _child_text(element, "name") or ""))
    return Tour(name=metadata_name, stages=stages, waypoints=waypoints)


def load_paths(paths) -> Tour:
    stages: list[Stage] = []
    waypoints: list[Waypoint] = []
    name = None
    files = [Path(path) for path in paths]
    if not files:
        raise ValueError("Es ist keine GPX-Datei angegeben.")
    for file_path in files:
        tour = read_gpx(file_path)
        if name is None and tour.name:
            name = tour.name
        for stage in tour.stages:
            if not stage.name:
                stage.name = file_path.stem
            stages.append(stage)
        waypoints.extend(tour.waypoints)
    stages = sort_stages(stages)
    if not any(len(segment) >= 2 for stage in stages for segment in stage.segments):
        raise ValueError("In den GPX-Dateien liegt keine gefahrene Linie.")
    return Tour(name=name, stages=stages, waypoints=waypoints)


def sort_stages(stages: list[Stage]) -> list[Stage]:
    def key(item):
        index, stage = item
        if stage.when is not None:
            return (0, stage.when.toordinal(), index)
        moment = first_time(stage)
        if moment is not None:
            return (0, moment.timestamp(), index)
        return (1, index)

    ordered = sorted(enumerate(stages), key=key)
    return [stage for _, stage in ordered]


def first_time(stage: Stage) -> datetime | None:
    for segment in stage.segments:
        for point in segment:
            if point.time is not None:
                return point.time
    return None


def stage_dates(stage: Stage) -> list[date]:
    found = []
    if stage.when is not None:
        found.append(stage.when)
    for segment in stage.segments:
        for point in segment:
            if point.time is not None:
                found.append(point.time.date())
                break
        if found:
            break
    last = None
    for segment in stage.segments:
        for point in segment:
            if point.time is not None:
                last = point.time.date()
    if last is not None:
        found.append(last)
    return found


def write_gpx(tour: Tour, path: str | Path) -> None:
    destination = Path(path)
    ET.register_namespace("", GPX_NS)
    ET.register_namespace("tourkarte", TOUR_NS)
    gpx = ET.Element(f"{{{GPX_NS}}}gpx", {"version": "1.1", "creator": "tourkarte"})
    metadata = ET.SubElement(gpx, f"{{{GPX_NS}}}metadata")
    if tour.name:
        ET.SubElement(metadata, f"{{{GPX_NS}}}name").text = tour.name
    moments = [
        point.time
        for stage in tour.stages
        for segment in stage.segments
        for point in segment
        if point.time is not None
    ]
    if moments:
        earliest = min(moments).astimezone(timezone.utc)
        ET.SubElement(metadata, f"{{{GPX_NS}}}time").text = _format_time(earliest)

    for stage in tour.stages:
        track = ET.SubElement(gpx, f"{{{GPX_NS}}}trk")
        ET.SubElement(track, f"{{{GPX_NS}}}name").text = stage.name or "Etappe"
        if stage.when is not None:
            extensions = ET.SubElement(track, f"{{{GPX_NS}}}extensions")
            ET.SubElement(extensions, f"{{{TOUR_NS}}}start_local").text = stage.when.isoformat()
        for segment in stage.segments:
            track_segment = ET.SubElement(track, f"{{{GPX_NS}}}trkseg")
            for point in segment:
                attributes = {"lat": f"{point.lat:.7f}", "lon": f"{point.lon:.7f}"}
                track_point = ET.SubElement(track_segment, f"{{{GPX_NS}}}trkpt", attributes)
                if point.ele is not None:
                    ET.SubElement(track_point, f"{{{GPX_NS}}}ele").text = f"{point.ele:.1f}"
                if point.time is not None:
                    stamp = point.time.astimezone(timezone.utc)
                    ET.SubElement(track_point, f"{{{GPX_NS}}}time").text = _format_time(stamp)

    for waypoint in tour.waypoints:
        attributes = {"lat": f"{waypoint.lat:.7f}", "lon": f"{waypoint.lon:.7f}"}
        element = ET.SubElement(gpx, f"{{{GPX_NS}}}wpt", attributes)
        if waypoint.name:
            ET.SubElement(element, f"{{{GPX_NS}}}name").text = waypoint.name

    tree = ET.ElementTree(gpx)
    ET.indent(tree, space="  ")
    destination.parent.mkdir(parents=True, exist_ok=True)
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def _read_track(track, stem: str, number: int) -> Stage:
    name = _direct_text(track, "name") or f"{stem} {number}"
    when = _start_local(track)
    segments = []
    for element in _children(track, "trkseg"):
        points = _read_points(element, "trkpt")
        if points:
            segments.append(points)
    loose = _read_points(track, "trkpt")
    if loose and not segments:
        segments.append(loose)
    return Stage(name=name, segments=segments, when=when)


def _read_route(route, stem: str, number: int) -> Stage:
    name = _direct_text(route, "name") or f"{stem} {number}"
    points = _read_points(route, "rtept")
    segments = [points] if len(points) >= 2 else []
    return Stage(name=name, segments=segments, when=_start_local(route))


def _read_points(parent, tag_name: str) -> list[Point]:
    points = []
    for element in _children(parent, tag_name):
        position = _read_latlon(element)
        if position is None:
            continue
        lat, lon = position
        elevation = sane_elevation(_float_text(_direct_text(element, "ele")))
        moment = _parse_time(_direct_text(element, "time"))
        points.append(Point(lat, lon, elevation, moment))
    return points


def _read_latlon(element) -> tuple[float, float] | None:
    try:
        lat = float(element.attrib["lat"])
        lon = float(element.attrib["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not usable_point(lat, lon):
        return None
    return lat, lon


def _start_local(element) -> date | None:
    for extensions in _children(element, "extensions"):
        for child in extensions.iter():
            if _local(child.tag) == "start_local" and child.text:
                try:
                    return date.fromisoformat(child.text.strip()[:10])
                except ValueError:
                    return None
    return None


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _format_time(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _float_text(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _child_text(parent, *names: str) -> str | None:
    element = parent
    for name in names:
        found = None
        for child in list(element):
            if _local(child.tag) == name:
                found = child
                break
        if found is None:
            return None
        element = found
    if element.text is None:
        return None
    text = element.text.strip()
    return text or None


def _direct_text(parent, name: str) -> str | None:
    for child in list(parent):
        if _local(child.tag) == name and child.text:
            text = child.text.strip()
            if text:
                return text
    return None


def _children(parent, name: str):
    return [child for child in list(parent) if _local(child.tag) == name]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
