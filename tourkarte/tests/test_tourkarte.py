import io
import json
import os
import tempfile
import threading
import unittest
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from tourkarte.cli import main
from tourkarte.geo import (
    clean_points,
    elevation_gain_m,
    format_date_range,
    format_hm,
    format_km,
    haversine_m,
    inclusive_epoch_range,
    parse_hex,
    path_distance_m,
)
from tourkarte.gpx import Point, Stage, Tour, Waypoint, load_paths, read_gpx, write_gpx
from tourkarte.komoot import (
    Komoot,
    KomootError,
    KomootStore,
    basic_auth,
    gpx_filename as komoot_gpx_filename,
    is_bike,
    is_listed,
    login_path,
    next_path,
    pull_tours,
)
from tourkarte.render import Options, build_scene, day_color, write_svg
from tourkarte.sample import example_tour
from tourkarte.strava import (
    TOKEN_URL,
    Strava,
    TokenStore,
    activity_date,
    decode_polyline,
    gpx_filename,
    is_selected,
    normalize_code,
    points_from_streams,
    pull_activities,
    slug,
)


class GeoTest(unittest.TestCase):
    def test_haversine_one_degree_longitude_at_equator(self):
        distance = haversine_m(0, 0, 0, 1)
        self.assertAlmostEqual(distance, 111_195, delta=200)

    def test_distance_skips_absurd_jumps(self):
        points = [Point(0, 0), Point(0, 1), Point(40, 80)]
        self.assertAlmostEqual(path_distance_m(points), haversine_m(0, 0, 0, 1), delta=1)

    def test_elevation_gain_ignores_small_jitter(self):
        points = [Point(0, 0, ele) for ele in (10, 12, 13, 20, 18, 30)]
        self.assertAlmostEqual(elevation_gain_m(points), 20)

    def test_spike_is_removed(self):
        start = datetime(2026, 6, 1, tzinfo=timezone.utc)
        points = [
            Point(47.0, 11.0, time=start),
            Point(47.0, 11.01, time=start + timedelta(seconds=30)),
            Point(48.2, 12.4, time=start + timedelta(seconds=31)),
            Point(47.0, 11.02, time=start + timedelta(seconds=60)),
            Point(47.0, 11.03, time=start + timedelta(seconds=90)),
        ]
        cleaned = clean_points(points)
        self.assertEqual([point.lat for point in cleaned], [47.0, 47.0, 47.0, 47.0])

    def test_german_formats(self):
        self.assertEqual(format_km(842_400), "842 km")
        self.assertEqual(format_km(1_234_000), "1.234 km")
        self.assertEqual(format_km(8_400), "8,4 km")
        self.assertEqual(format_hm(9400), "9.400 hm")
        self.assertEqual(format_date_range(date(2026, 5, 12), date(2026, 5, 19)), "12.–19. Mai 2026")
        self.assertEqual(
            format_date_range(date(2026, 4, 28), date(2026, 5, 6)),
            "28. April – 6. Mai 2026",
        )

    def test_inclusive_dates_cover_the_last_day(self):
        start, end = inclusive_epoch_range(date(2026, 5, 20), date(2026, 5, 20))
        self.assertEqual(end - start, 24 * 60 * 60)
        self.assertLess(start, end)

    def test_hex_expands_short_form(self):
        self.assertEqual(parse_hex("#ABC"), "#aabbcc")
        with self.assertRaises(ValueError):
            parse_hex("rot")


class GpxTest(unittest.TestCase):
    def test_roundtrip_keeps_track_time_elevation_and_local_day(self):
        moment = datetime(2026, 6, 12, 6, 30, tzinfo=timezone.utc)
        tour = Tour(
            name="Alpen & Tal",
            stages=[
                Stage(
                    "Tag 1",
                    [[Point(47.1, 11.2, 812.4, moment), Point(47.2, 11.3, 900, moment + timedelta(hours=2))]],
                    when=date(2026, 6, 12),
                )
            ],
            waypoints=[Waypoint(47.15, 11.25, "Joch")],
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tour.gpx"
            write_gpx(tour, path)
            loaded = read_gpx(path)
        self.assertEqual(loaded.name, "Alpen & Tal")
        self.assertEqual(loaded.stages[0].name, "Tag 1")
        self.assertEqual(loaded.stages[0].when, date(2026, 6, 12))
        self.assertEqual(len(loaded.stages[0].segments[0]), 2)
        self.assertAlmostEqual(loaded.stages[0].segments[0][0].ele, 812.4)
        self.assertEqual(loaded.stages[0].segments[0][0].time, moment)
        self.assertEqual(loaded.waypoints[0].name, "Joch")

    def test_reads_gpx_without_namespace(self):
        text = """<?xml version="1.0"?>
        <gpx version="1.1">
          <trk><name>Freitag</name><trkseg>
            <trkpt lat="47.0" lon="11.0"><ele>10</ele></trkpt>
            <trkpt lat="47.1" lon="11.1"></trkpt>
          </trkseg></trk>
        </gpx>"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "plain.gpx"
            path.write_text(text, encoding="utf-8")
            tour = read_gpx(path)
        self.assertEqual(tour.stages[0].name, "Freitag")
        self.assertEqual(len(tour.stages[0].segments[0]), 2)

    def test_two_files_follow_the_ride_dates(self):
        early = Tour(None, [Stage("später", [[Point(47, 11, time=datetime(2026, 6, 2, tzinfo=timezone.utc)), Point(47.1, 11.1)]])])
        late = Tour(None, [Stage("früher", [[Point(47, 11, time=datetime(2026, 6, 1, tzinfo=timezone.utc)), Point(47.2, 11.2)]])])
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "a.gpx"
            second = Path(tmp) / "b.gpx"
            write_gpx(early, first)
            write_gpx(late, second)
            tour = load_paths([first, second])
        self.assertEqual([stage.name for stage in tour.stages], ["früher", "später"])

    def test_empty_track_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "leer.gpx"
            path.write_text("<gpx><trk><trkseg></trkseg></trk></gpx>", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_paths([path])


class RenderTest(unittest.TestCase):
    def test_north_is_up_and_page_is_square(self):
        tour = Tour(
            "Nord",
            [Stage("A", [[Point(47.0, 11.0), Point(47.2, 11.0)]], when=date(2026, 6, 1))],
        )
        scene = build_scene(tour, Options(title="Nord"))
        self.assertEqual(scene.width_mm, 210)
        self.assertEqual(scene.height_mm, 210)
        points = scene.items[2]["paths"][0]
        self.assertLess(points[-1][1], points[0][1])
        map_x, map_y, map_w, map_h = scene.map_rect
        for x, y in points:
            self.assertGreaterEqual(x, map_x)
            self.assertLessEqual(x, map_x + map_w)
            self.assertGreaterEqual(y, map_y)
            self.assertLessEqual(y, map_y + map_h)

    def test_svg_uses_album_colors_title_and_dates(self):
        tour = example_tour()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "album.svg"
            scene = build_scene(
                tour,
                Options(title="Album & Tal", route="#123456", paper="#abcdef", color_by_day=True),
            )
            write_svg(scene, path)
            text = path.read_text(encoding="utf-8")
        self.assertIn("Album &amp; Tal", text)
        self.assertIn("#123456", text)
        self.assertIn("#abcdef", text)
        self.assertIn(day_color(1, 2), text)
        self.assertIn("12.–13. Juni 2026", text)
        self.assertIn("2 Etappen", text)
        self.assertIn("km", text)
        self.assertIn("hm", text)
        self.assertIn('width="210mm"', text)
        self.assertIn("Joch", text)

    def test_each_stage_gets_its_own_color(self):
        colors = [day_color(index, 17) for index in range(17)]
        self.assertEqual(len(set(colors)), 17)
        self.assertNotEqual(colors[0], colors[1])

    def test_custom_page_size(self):
        scene = build_scene(example_tour(), Options(page_mm=(280, 280)))
        self.assertEqual(scene.width_mm, 280)
        self.assertEqual(scene.height_mm, 280)

    def test_cli_writes_svg(self):
        with tempfile.TemporaryDirectory() as tmp:
            gpx = Path(tmp) / "tour.gpx"
            svg = Path(tmp) / "album.svg"
            write_gpx(example_tour(), gpx)
            with mock.patch("sys.stdout", io.StringIO()):
                code = main(["render", str(gpx), "-o", str(svg), "--title", "CLI", "--format", "a4"])
            self.assertEqual(code, 0)
            text = svg.read_text(encoding="utf-8")
        self.assertIn("CLI", text)
        self.assertIn('width="297mm"', text)

    def test_cli_rejects_missing_file(self):
        with mock.patch("sys.stderr", io.StringIO()):
            code = main(["render", "fehlt-sicher.gpx", "-o", "raus.svg"])
        self.assertEqual(code, 1)


class StravaTest(unittest.TestCase):
    def test_polyline_reference_track(self):
        points = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
        self.assertEqual(len(points), 3)
        self.assertAlmostEqual(points[0][0], 38.5, places=4)
        self.assertAlmostEqual(points[0][1], -120.2, places=4)
        self.assertAlmostEqual(points[2][0], 43.252, places=3)
        self.assertAlmostEqual(points[2][1], -126.453, places=3)

    def test_streams_become_timed_points(self):
        start = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        points = points_from_streams(
            {
                "latlng": {"data": [[47.1, 11.2], [47.2, 11.3]]},
                "altitude": {"data": [500, 800]},
                "time": {"data": [0, 60]},
            },
            start,
        )
        self.assertEqual(points[1].time, start + timedelta(seconds=60))
        self.assertEqual(points[0].ele, 500)
        listed = points_from_streams(
            [{"type": "latlng", "data": [[47.1, 11.2], [47.2, 11.3]]}],
            None,
        )
        self.assertEqual(len(listed), 2)

    def test_ride_filter(self):
        sports = {"Ride", "GravelRide"}
        self.assertTrue(is_selected({"sport_type": "GravelRide"}, sports))
        self.assertFalse(is_selected({"sport_type": "Run"}, sports))
        self.assertFalse(is_selected({"sport_type": "VirtualRide"}, {"all"}))
        self.assertFalse(is_selected({"sport_type": "Ride", "trainer": True}, sports))
        self.assertTrue(is_selected({"type": "Hike"}, {"all"}))

    def test_names_and_code_cleanup(self):
        self.assertEqual(slug("Über den Paß"), "uber-den-pass")
        self.assertEqual(slug("Straße"), "strasse")
        activity = {"id": 99, "name": "Über den Pass", "start_date_local": "2026-06-12T08:00:00Z"}
        self.assertEqual(activity_date(activity), date(2026, 6, 12))
        self.assertEqual(gpx_filename(activity), "2026-06-12-uber-den-pass-99.gpx")
        self.assertEqual(
            normalize_code("http://localhost/exchange_token?state=&code=abc123&scope=read"),
            "abc123",
        )

    def test_pull_writes_gpx_and_skips_runs(self):
        transport = FakeStrava()
        with tempfile.TemporaryDirectory() as tmp:
            store = TokenStore(Path(tmp) / "token.json")
            store.save(
                {
                    "client_id": "1",
                    "client_secret": "geheim",
                    "access_token": "alt",
                    "refresh_token": "refresh",
                    "expires_at": 0,
                }
            )
            results = pull_activities(
                Strava(store, transport),
                Path(tmp) / "gpx",
                sports={"Ride"},
                after=date(2026, 6, 12),
                before=date(2026, 6, 12),
            )
            saved = store.load()
            written = [item for item in results if item.path]
            self.assertEqual(len(written), 1)
            self.assertTrue(written[0].path.exists())
            text = written[0].path.read_text(encoding="utf-8")
            self.assertIn("47.1", text)
            self.assertIn("2026-06-12", text)
            self.assertEqual(saved["access_token"], "neu")
            self.assertEqual(saved["client_secret"], "geheim")
            if os.name != "nt":
                self.assertEqual(oct(os.stat(store.path).st_mode & 0o777), oct(0o600))
            auth_headers = [
                headers.get("Authorization")
                for method, url, headers, _body in transport.calls
                if method == "GET"
            ]
            self.assertIn("Bearer neu", auth_headers)
            self.assertTrue(any(item.skipped for item in results))

    def test_cli_auth_missing_code_does_not_print_secret(self):
        stdin = mock.Mock()
        stdin.isatty.return_value = False
        with (
            mock.patch("sys.stdin", stdin),
            mock.patch("sys.stdout", io.StringIO()) as output,
            mock.patch("sys.stderr", io.StringIO()),
        ):
            code = main(["strava-auth", "--client-id", "7", "--client-secret", "nicht-zeigen"])
        self.assertEqual(code, 1)
        self.assertNotIn("nicht-zeigen", output.getvalue())
        self.assertIn("localhost", output.getvalue())

    def test_serve_opens_the_local_page(self):
        from tourkarte.serve import page_url, start_server

        self.assertEqual(page_url(8765), "http://127.0.0.1:8765/tourkarte/")
        server = start_server(0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        try:
            with urllib.request.urlopen(page_url(port) + "index.html", timeout=5) as response:
                body = response.read().decode("utf-8")
                status = response.status
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(status, 200)
        self.assertIn("Tourkarte", body)
        self.assertIn("app.js", body)
        self.assertIn("komoot.js", body)


class FakeStrava:
    def __init__(self):
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        if url == TOKEN_URL:
            return 200, {
                "access_token": "neu",
                "refresh_token": "refresh-2",
                "expires_at": 9_999_999_999,
            }
        if "/streams" in url:
            if "/activities/8/" in url:
                return 200, {"latlng": {"data": []}, "altitude": {"data": []}, "time": {"data": []}}
            return 200, {
                "latlng": {"data": [[47.1, 11.2], [47.11, 11.21], [47.12, 11.22]]},
                "altitude": {"data": [600, 900, 700]},
                "time": {"data": [0, 100, 200]},
            }
        if url.startswith("https://www.strava.com/api/v3/athlete/activities"):
            return 200, [
                {
                    "id": 5,
                    "name": "Über den Pass",
                    "sport_type": "Ride",
                    "start_date": "2026-06-12T06:00:00Z",
                    "start_date_local": "2026-06-12T08:00:00Z",
                    "distance": 42000,
                    "map": {},
                },
                {"id": 6, "name": "Lauf", "sport_type": "Run", "distance": 5000},
                {"id": 7, "name": "Rolle", "sport_type": "VirtualRide", "distance": 1000},
                {
                    "id": 8,
                    "name": "Innen",
                    "sport_type": "Ride",
                    "start_date_local": "2026-06-12T18:00:00Z",
                    "distance": 0,
                    "map": {},
                },
            ]
        if "/activities/" in url and "/streams" not in url:
            return 200, {"id": 8, "name": "Innen", "map": {}}
        return 500, {"message": url}


GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><name>Alpen</name><trkseg>
<trkpt lat="47.1" lon="11.2"><ele>500</ele></trkpt>
<trkpt lat="47.2" lon="11.3"><ele>800</ele></trkpt>
</trkseg></trk></gpx>
"""


class KomootTest(unittest.TestCase):
    def test_login_stores_token_not_password(self):
        transport = FakeKomoot()
        with tempfile.TemporaryDirectory() as tmp:
            store = KomootStore(Path(tmp) / "komoot.json")
            record = Komoot(store, transport).login("ada@example.com", "geheim")
            saved = json.loads(store.path.read_text(encoding="utf-8"))
            self.assertEqual(record["user_id"], "42")
            self.assertEqual(record["token"], "api-token")
            self.assertEqual(record["display_name"], "Ada Ride")
            self.assertEqual(saved["token"], "api-token")
            self.assertNotIn("geheim", store.path.read_text(encoding="utf-8"))
            if os.name != "nt":
                self.assertEqual(oct(os.stat(store.path).st_mode & 0o777), oct(0o600))
        self.assertIn("ada%40example.com", transport.calls[0][1])
        self.assertEqual(transport.calls[0][2]["Authorization"], basic_auth("ada@example.com", "geheim"))

    def test_wrong_password_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = KomootStore(Path(tmp) / "komoot.json")
            with self.assertRaises(KomootError) as caught:
                Komoot(store, FakeKomoot()).login("ada@example.com", "falsch")
            self.assertIn("Passwort", str(caught.exception))
            self.assertFalse(store.path.exists())

    def test_pull_writes_recorded_rides_and_follows_pages(self):
        transport = FakeKomoot()
        with tempfile.TemporaryDirectory() as tmp:
            store = KomootStore(Path(tmp) / "komoot.json")
            store.save(
                {
                    "email": "ada@example.com",
                    "user_id": "42",
                    "token": "api-token",
                    "display_name": "Ada Ride",
                }
            )
            results = pull_tours(
                Komoot(store, transport),
                Path(tmp) / "gpx",
                sport="bike",
                kind="recorded",
                after=date(2026, 6, 1),
                before=date(2026, 6, 30),
            )
            written = [item for item in results if item.path]
            self.assertEqual(len(written), 1)
            self.assertEqual(written[0].name, "Über den Pass")
            self.assertIn("47.1", written[0].path.read_text(encoding="utf-8"))
            self.assertEqual(komoot_gpx_filename(9, "Über den Pass", date(2026, 6, 12)), written[0].path.name)
            self.assertFalse(any(item.skipped for item in results))
        self.assertTrue(any("page=1" in call[1] for call in transport.calls))
        listed = [call for call in transport.calls if "/tours/?" in call[1]]
        self.assertIn(basic_auth("42", "api-token"), [call[2]["Authorization"] for call in listed])

    def test_filters_and_foreign_next_link(self):
        recorded = {"type": "tour_recorded", "sport": "gravel", "date": "2026-06-12T08:00:00.000Z"}
        planned = {"type": "tour_planned", "sport": "hike", "date": "2026-06-13T08:00:00.000Z"}
        self.assertTrue(is_bike(recorded))
        self.assertFalse(is_bike(planned))
        self.assertTrue(is_listed(recorded, sport="bike", kind="recorded", after=date(2026, 6, 1), before=date(2026, 6, 30)))
        self.assertFalse(is_listed(planned, sport="bike", kind="recorded", after=date(2026, 6, 1), before=date(2026, 6, 30)))
        self.assertTrue(is_listed(planned, sport="all", kind="planned", after=date(2026, 6, 1), before=date(2026, 6, 30)))
        self.assertEqual(login_path("ada@example.com"), "/v006/account/email/ada%40example.com/")
        self.assertEqual(next_path({"_links": {"next": {"href": "https://evil.example/v007/x"}}}), "")

    def test_cli_auth_does_not_print_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_file = str(Path(tmp) / "komoot.json")
            with (
                mock.patch("tourkarte.cli.getpass.getpass", return_value="nicht-zeigen"),
                mock.patch("tourkarte.cli.sys.stdin.isatty", return_value=True),
                mock.patch("tourkarte.cli.Komoot.login", return_value={"display_name": "Ada Ride"}) as login,
                mock.patch("sys.stdout", io.StringIO()) as output,
                mock.patch("sys.stderr", io.StringIO()),
            ):
                code = main(["komoot-auth", "--email", "ada@example.com", "--token-file", token_file])
        self.assertEqual(code, 0)
        self.assertNotIn("nicht-zeigen", output.getvalue())
        self.assertIn("Ada Ride", output.getvalue())
        login.assert_called_once()
        self.assertEqual(login.call_args.args, ("ada@example.com", "nicht-zeigen"))


class FakeKomoot:
    def __init__(self):
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        if "/account/email/" in url:
            if headers.get("Authorization") != basic_auth("ada@example.com", "geheim"):
                return 403, '{"error":"BadCredentials","message":"Unknown user or wrong credentials."}', "application/json"
            return 200, json.dumps({
                "username": "42",
                "password": "api-token",
                "user": {"displayname": "Ada Ride"},
            }), "application/json"
        if "/tours/?" in url:
            if "page=1" in url:
                return 200, json.dumps({
                    "_embedded": {"tours": [{
                        "id": 8,
                        "name": "Leer",
                        "type": "tour_recorded",
                        "sport": "touringbicycle",
                        "date": "2026-05-02T08:00:00.000Z",
                        "distance": 1000,
                    }]},
                    "_links": {},
                }), "application/hal+json"
            return 200, json.dumps({
                "_embedded": {"tours": [
                    {
                        "id": 9,
                        "name": "Über den Pass",
                        "type": "tour_recorded",
                        "sport": "touringbicycle",
                        "date": "2026-06-12T08:00:00.000Z",
                        "distance": 42000,
                        "elevation_up": 800,
                    },
                    {
                        "id": 10,
                        "name": "Plan",
                        "type": "tour_planned",
                        "sport": "hike",
                        "date": "2026-06-13T08:00:00.000Z",
                        "distance": 12000,
                    },
                    {
                        "id": 3,
                        "name": "Alt",
                        "type": "tour_recorded",
                        "sport": "touringbicycle",
                        "date": "2026-05-01T08:00:00.000Z",
                        "distance": 5000,
                    },
                ]},
                "_links": {"next": {"href": "https://api.komoot.de/v007/users/42/tours/?page=1&limit=100"}},
            }), "application/hal+json"
        if url.endswith(".gpx"):
            if url.endswith("/8.gpx"):
                return 200, "<gpx></gpx>", "application/gpx+xml"
            return 200, GPX, "application/gpx+xml"
        return 500, '{"message":"unerwartet"}', "application/json"


if __name__ == "__main__":
    unittest.main()
