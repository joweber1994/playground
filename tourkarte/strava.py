"""Gefahrene Aktivitäten über die Strava-API als GPX speichern.

Strava hat keinen GPX-Download in der API. Die gefahrene Linie steckt in den
Streams `latlng`, `altitude` und `time` und wird hier als GPX 1.1 geschrieben.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .geo import inclusive_epoch_range, sane_elevation, usable_point
from .gpx import Point, Stage, Tour, write_gpx

API = "https://www.strava.com/api/v3"
TOKEN_URL = "https://www.strava.com/oauth/token"
AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
DEFAULT_TOKEN_PATH = Path.home() / ".config" / "tourkarte" / "strava.json"
DEFAULT_REDIRECT = "http://localhost/exchange_token"
RIDE_SPORTS = frozenset(
    {
        "Ride",
        "MountainBikeRide",
        "GravelRide",
        "EBikeRide",
        "EMountainBikeRide",
        "Velomobile",
        "Handcycle",
    }
)


class StravaError(Exception):
    pass


@dataclass
class PullItem:
    activity_id: int
    name: str
    when: date | None
    distance_m: float | None
    path: Path | None = None
    skipped: str | None = None


class TokenStore:
    def __init__(self, path: str | Path = DEFAULT_TOKEN_PATH):
        self.path = Path(path)

    def load(self) -> dict:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise StravaError(
                "Noch kein Strava-Zugang. Zuerst `strava-auth` ausführen."
            ) from error
        except (OSError, json.JSONDecodeError) as error:
            raise StravaError(f"Die Token-Datei {self.path} lässt sich nicht lesen.") from error
        if not isinstance(payload, dict) or "access_token" not in payload:
            raise StravaError(f"Die Token-Datei {self.path} ist unvollständig.")
        return payload

    def save(self, payload: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.path)
        os.chmod(self.path, 0o600)


def authorize_url(client_id: str, redirect_uri: str = DEFAULT_REDIRECT) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "approval_prompt": "auto",
            "scope": "activity:read_all",
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def normalize_code(value: str) -> str:
    text = value.strip()
    if "code=" not in text:
        return text
    parsed = urllib.parse.urlparse(text)
    query = urllib.parse.parse_qs(parsed.query or text.lstrip("?"))
    codes = query.get("code")
    if codes:
        return codes[0].strip()
    return text


def urllib_transport(method: str, url: str, headers: dict, body):
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8", "replace")
            return response.status, _parse_json(raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        return error.code, _parse_json(raw)
    except urllib.error.URLError as error:
        raise StravaError(f"Keine Verbindung zu Strava: {error.reason}") from error


class Strava:
    def __init__(self, store: TokenStore, transport=urllib_transport):
        self.store = store
        self.transport = transport

    def exchange(self, client_id: str, client_secret: str, code: str) -> dict:
        payload = self._post_token(
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "code": normalize_code(code),
                "grant_type": "authorization_code",
            }
        )
        saved = _token_record(client_id, client_secret, payload)
        self.store.save(saved)
        return saved

    def iter_activities(self, after: int | None, before: int | None):
        page = 1
        while page <= 50:
            params = {"page": page, "per_page": 200}
            if after is not None:
                params["after"] = after
            if before is not None:
                params["before"] = before
            batch = self._authorized("GET", f"{API}/athlete/activities?{urllib.parse.urlencode(params)}")
            if not isinstance(batch, list):
                raise StravaError("Unerwartete Antwort beim Lesen der Aktivitäten.")
            yield from batch
            if len(batch) < 200:
                return
            page += 1

    def activity(self, activity_id: int) -> dict:
        payload = self._authorized("GET", f"{API}/activities/{int(activity_id)}")
        if not isinstance(payload, dict) or "id" not in payload:
            raise StravaError(f"Aktivität {activity_id} hat keine lesbare Antwort.")
        return payload

    def streams(self, activity_id: int, resolution: str | None = "high") -> dict:
        params = {
            "keys": "latlng,altitude,time",
            "key_by_type": "true",
        }
        if resolution:
            params["resolution"] = resolution
        payload = self._authorized(
            "GET",
            f"{API}/activities/{int(activity_id)}/streams?{urllib.parse.urlencode(params)}",
        )
        return normalize_streams(payload)

    def _authorized(self, method: str, url: str):
        token = self._fresh_token()
        status, payload = self._call(method, url, token["access_token"])
        if status == 401:
            token = self._refresh(token)
            status, payload = self._call(method, url, token["access_token"])
        return _expect(status, payload)

    def _fresh_token(self) -> dict:
        token = self.store.load()
        expires_at = float(token.get("expires_at") or 0)
        if expires_at < _now() + 120:
            if not token.get("refresh_token"):
                raise StravaError("Das Strava-Token ist abgelaufen. Bitte `strava-auth` erneut ausführen.")
            return self._refresh(token)
        return token

    def _refresh(self, token: dict) -> dict:
        payload = self._post_token(
            {
                "client_id": token["client_id"],
                "client_secret": token["client_secret"],
                "grant_type": "refresh_token",
                "refresh_token": token["refresh_token"],
            }
        )
        saved = _token_record(token["client_id"], token["client_secret"], payload, token)
        self.store.save(saved)
        return saved

    def _post_token(self, form: dict) -> dict:
        body = urllib.parse.urlencode(form).encode("utf-8")
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "tourkarte",
        }
        status, payload = self.transport("POST", TOKEN_URL, headers, body)
        return _expect(status, payload)

    def _call(self, method: str, url: str, access_token: str):
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "User-Agent": "tourkarte",
        }
        return self.transport(method, url, headers, None)


def pull_activities(
    client: Strava,
    out_dir: str | Path,
    *,
    sports: set[str],
    after: date | None = None,
    before: date | None = None,
    activity_ids: list[int] | None = None,
    resolution: str | None = "high",
) -> list[PullItem]:
    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)
    if activity_ids:
        activities = [client.activity(activity_id) for activity_id in activity_ids]
    else:
        if after is None or before is None:
            raise ValueError("Bitte --after und --before angeben oder einzelne --id.")
        start, end = inclusive_epoch_range(after, before)
        activities = [
            activity
            for activity in client.iter_activities(start, end)
            if is_selected(activity, sports)
        ]

    results = []
    for activity in activities:
        item = _write_activity(client, activity, destination, resolution)
        results.append(item)
    return results


def is_selected(activity: dict, sports: set[str]) -> bool:
    if activity.get("trainer"):
        return False
    sport = str(activity.get("sport_type") or activity.get("type") or "")
    if sport.startswith("Virtual"):
        return False
    if sports == {"all"}:
        return True
    return sport in sports


def activity_date(activity: dict) -> date | None:
    raw = activity.get("start_date_local") or activity.get("start_date")
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def points_from_streams(streams: dict, start: datetime | None) -> list[Point]:
    normalized = normalize_streams(streams)
    latlng = _stream_data(normalized, "latlng")
    if not latlng:
        return []
    altitude = _stream_data(normalized, "altitude")
    times = _stream_data(normalized, "time")
    points = []
    for index, pair in enumerate(latlng):
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        try:
            lat = float(pair[0])
            lon = float(pair[1])
        except (TypeError, ValueError):
            continue
        if not usable_point(lat, lon):
            continue
        elevation = None
        if altitude is not None and index < len(altitude):
            try:
                elevation = sane_elevation(float(altitude[index]))
            except (TypeError, ValueError):
                elevation = None
        moment = None
        if start is not None and times is not None and index < len(times):
            try:
                moment = start + timedelta(seconds=float(times[index]))
            except (TypeError, ValueError):
                moment = None
        points.append(Point(lat, lon, elevation, moment))
    return points


def points_from_polyline(encoded: str) -> list[Point]:
    return [Point(lat, lon) for lat, lon in decode_polyline(encoded) if usable_point(lat, lon)]


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points = []
    index = 0
    lat = 0
    lon = 0
    length = len(encoded)
    while index < length:
        lat_change, index = _decode_chunk(encoded, index)
        lon_change, index = _decode_chunk(encoded, index)
        lat += lat_change
        lon += lon_change
        points.append((lat / 1e5, lon / 1e5))
    return points


def normalize_streams(payload) -> dict:
    if isinstance(payload, dict):
        if "latlng" in payload or "altitude" in payload or "time" in payload:
            return payload
    if isinstance(payload, list):
        streams = {}
        for stream in payload:
            if isinstance(stream, dict) and stream.get("type"):
                streams[stream["type"]] = stream
        return streams
    raise StravaError("Die GPS-Streams haben ein unbekanntes Format.")


def gpx_filename(activity: dict) -> str:
    when = activity_date(activity)
    prefix = when.isoformat() if when else "aktivitaet"
    name = slug(str(activity.get("name") or "fahrt"))
    return f"{prefix}-{name}-{int(activity['id'])}.gpx"


def slug(value: str) -> str:
    text = value.replace("ß", "ss").replace("ẞ", "SS")
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return text[:60] or "fahrt"


def _write_activity(client: Strava, activity: dict, destination: Path, resolution: str | None) -> PullItem:
    activity_id = int(activity["id"])
    name = str(activity.get("name") or f"Aktivität {activity_id}")
    when = activity_date(activity)
    distance = activity.get("distance")
    try:
        distance_m = float(distance) if distance is not None else None
    except (TypeError, ValueError):
        distance_m = None
    item = PullItem(activity_id, name, when, distance_m)
    try:
        streams = client.streams(activity_id, resolution=resolution)
        start = _parse_start(activity.get("start_date"))
        points = points_from_streams(streams, start)
    except StravaError as error:
        if _fatal(error):
            raise
        points = []
        item.skipped = str(error)
    if len(points) < 2:
        map_info = activity.get("map") or {}
        polyline = map_info.get("polyline") or map_info.get("summary_polyline") or ""
        if not polyline:
            try:
                detail = client.activity(activity_id)
                detail_map = detail.get("map") or {}
                polyline = detail_map.get("polyline") or detail_map.get("summary_polyline") or ""
                if item.distance_m is None and detail.get("distance") is not None:
                    item.distance_m = float(detail["distance"])
            except StravaError as error:
                if _fatal(error):
                    raise
                polyline = ""
        if polyline:
            points = points_from_polyline(polyline)
    if len(points) < 2:
        item.skipped = item.skipped or "ohne GPS"
        return item
    stage = Stage(name=name, segments=[points], when=when)
    tour = Tour(name=name, stages=[stage])
    path = destination / gpx_filename(activity)
    write_gpx(tour, path)
    item.path = path
    item.skipped = None
    return item


def _stream_data(streams: dict, name: str):
    stream = streams.get(name)
    if isinstance(stream, dict):
        return stream.get("data")
    return None


def _parse_start(value) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _decode_chunk(encoded: str, index: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if index >= len(encoded):
            raise StravaError("Die Polylinie von Strava ist unvollständig.")
        byte = ord(encoded[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break
    delta = ~(result >> 1) if result & 1 else result >> 1
    return delta, index


def _token_record(client_id: str, client_secret: str, payload: dict, previous: dict | None = None) -> dict:
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise StravaError("Strava hat kein Zugangstoken geliefert.")
    refresh = payload.get("refresh_token")
    if not refresh and previous:
        refresh = previous.get("refresh_token")
    expires_at = payload.get("expires_at")
    if expires_at is None and payload.get("expires_in") is not None:
        expires_at = int(_now() + float(payload["expires_in"]))
    return {
        "client_id": str(client_id),
        "client_secret": str(client_secret),
        "access_token": payload["access_token"],
        "refresh_token": refresh,
        "expires_at": int(expires_at or 0),
    }


def _fatal(error: StravaError) -> bool:
    text = str(error)
    return any(piece in text for piece in ("begrenzt", "Authorization", "access_token", "abgelaufen"))


def _expect(status: int, payload):
    if status == 429:
        raise StravaError("Strava begrenzt die Anfragen. Bitte in ein paar Minuten erneut versuchen.")
    if status >= 400:
        raise StravaError(f"Strava: {_fault_message(payload)}")
    return payload


def _fault_message(payload) -> str:
    if isinstance(payload, dict):
        message = payload.get("message")
        errors = payload.get("errors")
        if isinstance(errors, list) and errors:
            bits = []
            for item in errors:
                if isinstance(item, dict):
                    bits.append(str(item.get("field") or item.get("code") or ""))
            bits = [bit for bit in bits if bit]
            if message and bits:
                return f"{message} ({', '.join(bits)})"
        if message:
            return str(message)
    return "die Anfrage wurde abgelehnt."


def _parse_json(raw: str):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"message": raw[:300]}


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()
