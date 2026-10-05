"""Streckenrechnung und deutsche Beschriftung für die Albumkarte."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

EARTH_RADIUS_M = 6_371_000.0

MONTHS_DE = (
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def sane_elevation(value: float | None) -> float | None:
    if value is None:
        return None
    if not math.isfinite(value) or value < -500 or value > 9000:
        return None
    return value


def usable_point(lat: float, lon: float) -> bool:
    if not math.isfinite(lat) or not math.isfinite(lon):
        return False
    if abs(lat) > 90 or abs(lon) > 180:
        return False
    if lat == 0 and lon == 0:
        return False
    return True


def path_distance_m(points) -> float:
    total = 0.0
    previous = None
    for point in points:
        if previous is not None:
            step = haversine_m(previous.lat, previous.lon, point.lat, point.lon)
            if step <= 500_000:
                total += step
        previous = point
    return total


def elevation_gain_m(points, threshold_m: float = 3.0) -> float | None:
    elevations = [point.ele for point in points if point.ele is not None]
    if len(elevations) < 2:
        return None
    gain = 0.0
    anchor = elevations[0]
    for elevation in elevations[1:]:
        delta = elevation - anchor
        if abs(delta) >= threshold_m:
            if delta > 0:
                gain += delta
            anchor = elevation
    return gain


def clean_points(points, max_speed_m_s: float = 40.0, max_jump_m: float = 30_000.0):
    """Entfernt einzelne GPS-Ausreißer. 40 m/s entsprechen 144 km/h."""
    if len(points) < 3:
        return list(points)
    kept = [points[0]]
    for index in range(1, len(points) - 1):
        previous = kept[-1]
        current = points[index]
        nxt = points[index + 1]
        if _is_spike(previous, current, nxt, max_speed_m_s, max_jump_m):
            continue
        kept.append(current)
    kept.append(points[-1])
    if len(kept) < 2:
        return list(points)
    return kept


def _is_spike(previous, current, nxt, max_speed_m_s: float, max_jump_m: float) -> bool:
    jump = haversine_m(previous.lat, previous.lon, current.lat, current.lon)
    back = haversine_m(current.lat, current.lon, nxt.lat, nxt.lon)
    span = haversine_m(previous.lat, previous.lon, nxt.lat, nxt.lon)
    if jump > 2_000 and back > 2_000 and span < min(jump, back) * 0.35:
        return True
    if current.time is not None and previous.time is not None:
        seconds = (current.time - previous.time).total_seconds()
        if seconds > 0 and jump > 500 and jump / seconds > max_speed_m_s:
            return True
        if seconds <= 0 and jump > max_jump_m:
            return True
    elif jump > max_jump_m:
        return True
    return False


def project(lat: float, lon: float, lat0: float) -> tuple[float, float]:
    """Lokale Plattkarte in Metern. Norden zeigt nach oben."""
    x = math.radians(lon) * math.cos(math.radians(lat0)) * EARTH_RADIUS_M
    y = math.radians(lat) * EARTH_RADIUS_M
    return x, y


def perpendicular_distance(point, start, end) -> float:
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy)
    if length == 0:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length


def douglas_peucker(coords, epsilon: float):
    if len(coords) < 3 or epsilon <= 0:
        return list(coords)
    start = coords[0]
    end = coords[-1]
    worst_index = 0
    worst = -1.0
    for index in range(1, len(coords) - 1):
        distance = perpendicular_distance(coords[index], start, end)
        if distance > worst:
            worst = distance
            worst_index = index
    if worst > epsilon:
        left = douglas_peucker(coords[: worst_index + 1], epsilon)
        right = douglas_peucker(coords[worst_index:], epsilon)
        return left[:-1] + right
    return [start, end]


def format_km(meters: float) -> str:
    kilometers = meters / 1000.0
    if kilometers >= 100:
        return _grouped(round(kilometers)) + " km"
    if kilometers >= 10:
        return f"{kilometers:.0f} km"
    return f"{kilometers:.1f}".replace(".", ",") + " km"


def format_hm(meters: float) -> str:
    return _grouped(round(meters)) + " hm"


def format_scale(meters: float) -> str:
    if meters >= 1000:
        kilometers = meters / 1000.0
        if abs(kilometers - round(kilometers)) < 1e-6:
            return f"{int(round(kilometers))} km"
        return f"{kilometers:.1f}".replace(".", ",") + " km"
    return f"{int(round(meters))} m"


def format_date_range(start: date, end: date) -> str:
    if start == end:
        return f"{start.day}. {MONTHS_DE[start.month - 1]} {start.year}"
    if start.year == end.year and start.month == end.month:
        return f"{start.day}.–{end.day}. {MONTHS_DE[start.month - 1]} {start.year}"
    if start.year == end.year:
        return (
            f"{start.day}. {MONTHS_DE[start.month - 1]}"
            f" – {end.day}. {MONTHS_DE[end.month - 1]} {start.year}"
        )
    return (
        f"{start.day}. {MONTHS_DE[start.month - 1]} {start.year}"
        f" – {end.day}. {MONTHS_DE[end.month - 1]} {end.year}"
    )


def inclusive_epoch_range(after: date, before: date) -> tuple[int, int]:
    """Kalendertage in UTC, beide einschließlich. `before` von Strava ist exklusiv."""
    if before < after:
        raise ValueError("Das Enddatum liegt vor dem Startdatum.")
    start = datetime(after.year, after.month, after.day, tzinfo=timezone.utc)
    end = datetime(before.year, before.month, before.day, tzinfo=timezone.utc) + timedelta(days=1)
    return int(start.timestamp()), int(end.timestamp())


def nice_length_m(target_m: float) -> float:
    if target_m <= 0:
        return 1_000.0
    magnitude = 10 ** math.floor(math.log10(target_m))
    for step in (1, 2, 2.5, 5, 10):
        length = step * magnitude
        if length >= target_m * 0.75:
            return float(length)
    return float(10 * magnitude)


def parse_hex(value: str) -> str:
    text = value.strip()
    if len(text) == 4 and text.startswith("#"):
        text = "#" + "".join(channel * 2 for channel in text[1:])
    if len(text) != 7 or text[0] != "#" or any(char not in "0123456789abcdefABCDEF" for char in text[1:]):
        raise ValueError(f"Farbe {value!r} ist kein Hexwert wie #9c3412.")
    return text.lower()


def _grouped(value: int) -> str:
    return f"{value:,}".replace(",", ".")
