"""Beispieltour zum Ausprobieren. Das ist keine gefahrene Strava-Aktivität."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .gpx import Point, Stage, Tour, Waypoint, write_gpx
from .render import Options, build_scene, write_svg

DAY_ONE = (
    (47.08, 10.62),
    (47.14, 10.78),
    (47.11, 10.95),
    (47.18, 11.10),
    (47.24, 11.05),
    (47.22, 11.22),
    (47.28, 11.38),
)
DAY_TWO = (
    (47.28, 11.38),
    (47.33, 11.55),
    (47.30, 11.72),
    (47.36, 11.88),
    (47.42, 11.82),
    (47.40, 12.00),
    (47.46, 12.16),
)


def example_tour() -> Tour:
    first = _stage(DAY_ONE, 0, "Tag 1")
    second = _stage(DAY_TWO, 1, "Tag 2")
    highest = max(first.points(), key=lambda point: point.ele or 0)
    camp = first.points()[-1]
    return Tour(
        name="Beispieltour",
        stages=[first, second],
        waypoints=[
            Waypoint(highest.lat, highest.lon, "Joch"),
            Waypoint(camp.lat, camp.lon, "Biwak"),
        ],
    )


def write_example(directory: Path | None = None) -> tuple[Path, Path]:
    root = directory or Path(__file__).resolve().parent / "examples"
    root.mkdir(parents=True, exist_ok=True)
    gpx_path = root / "beispiel.gpx"
    svg_path = root / "beispiel.svg"
    tour = example_tour()
    write_gpx(tour, gpx_path)
    scene = build_scene(tour, Options(start_label="Start", end_label="Ziel"))
    write_svg(scene, svg_path)
    return gpx_path, svg_path


def _stage(controls, day: int, name: str) -> Stage:
    samples = _densify(controls, 32)
    start = datetime(2026, 6, 12 + day, 6, 30, tzinfo=timezone.utc)
    points = []
    for index, (lat, lon, progress) in enumerate(samples):
        taper = math.sin(math.pi * progress) ** 0.9
        lat += 0.010 * math.sin(progress * 26 + day) * taper
        lon += 0.014 * math.sin(progress * 17 + day * 1.4) * taper
        points.append(
            Point(
                lat=lat,
                lon=lon,
                ele=_elevation(day, progress),
                time=start + timedelta(seconds=index * 45),
            )
        )
    return Stage(name=name, segments=[points], when=date(2026, 6, 12 + day))


def _elevation(day: int, progress: float) -> float:
    if day == 0:
        if progress <= 0.72:
            climb = math.sin(progress / 0.72 * math.pi / 2)
            base = 620 + 1280 * climb
        else:
            base = 1900 - 640 * ((progress - 0.72) / 0.28)
    elif progress < 0.48:
        base = 1260 + 620 * math.sin(progress / 0.48 * math.pi / 2)
    else:
        base = 1880 - 1240 * ((progress - 0.48) / 0.52)
    return base + 16 * math.sin(progress * 20)


def _densify(controls, samples_per_span: int):
    spans = len(controls) - 1
    padded = [controls[0], *controls, controls[-1]]
    result = []
    for span in range(spans):
        p0, p1, p2, p3 = padded[span : span + 4]
        for step in range(samples_per_span):
            local = step / samples_per_span
            lat, lon = _catmull(p0, p1, p2, p3, local)
            result.append((lat, lon, (span + local) / spans))
    result.append((controls[-1][0], controls[-1][1], 1.0))
    return result


def _catmull(p0, p1, p2, p3, t: float):
    t2 = t * t
    t3 = t2 * t

    def axis(i):
        return 0.5 * (
            2 * p1[i]
            + (-p0[i] + p2[i]) * t
            + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
            + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
        )

    return axis(0), axis(1)


if __name__ == "__main__":
    gpx_path, svg_path = write_example()
    print(gpx_path)
    print(svg_path)
