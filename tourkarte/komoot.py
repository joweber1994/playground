"""Eigene Komoot-Touren als GPX speichern.

Die Anmeldung tauscht E-Mail und Passwort gegen ein Zugangstoken. Das
Kontopasswort wird nicht gespeichert. Das GPX kommt von der Komoot-Schnittstelle.
"""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .gpx import read_gpx
from .strava import slug

API = "https://api.komoot.de"
DEFAULT_TOKEN_PATH = Path.home() / ".config" / "tourkarte" / "komoot.json"
BIKE_SPORTS = frozenset(
    {
        "touringbicycle",
        "mtb",
        "mtb_easy",
        "racebike",
        "gravel",
        "citybike",
        "bike",
        "bicycle",
        "bikepacking",
        "e_touringbicycle",
        "e_mtb",
        "e_mtb_easy",
        "e_racebike",
        "e_gravel",
        "e_citybike",
        "e_bikepacking",
    }
)
_BIKE_PATTERN = re.compile(r"bike|bicycle|mtb|gravel|bikepack", re.IGNORECASE)


class KomootError(Exception):
    pass


def _owner_only(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except OSError:
        return


@dataclass
class PullItem:
    tour_id: int
    name: str
    when: date | None
    distance_m: float | None
    path: Path | None = None
    skipped: str | None = None


class KomootStore:
    def __init__(self, path: str | Path = DEFAULT_TOKEN_PATH):
        self.path = Path(path)

    def load(self) -> dict:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise KomootError(
                "Noch kein Komoot-Zugang. Zuerst `komoot-auth` ausführen."
            ) from error
        except (OSError, json.JSONDecodeError) as error:
            raise KomootError(f"Die Token-Datei {self.path} lässt sich nicht lesen.") from error
        if not isinstance(payload, dict) or not payload.get("token") or not payload.get("user_id"):
            raise KomootError(f"Die Token-Datei {self.path} ist unvollständig.")
        return payload

    def save(self, payload: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        _owner_only(temporary)
        temporary.replace(self.path)
        _owner_only(self.path)


def basic_auth(user: str, secret: str) -> str:
    token = base64.b64encode(f"{user}:{secret}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def login_path(email: str) -> str:
    return f"/v006/account/email/{urllib.parse.quote(email.strip(), safe='')}/"


def tours_path(user_id: str) -> str:
    query = urllib.parse.urlencode(
        {
            "sort_field": "date",
            "sort_direction": "desc",
            "page": 0,
            "limit": 100,
        }
    )
    return f"/v007/users/{urllib.parse.quote(str(user_id), safe='')}/tours/?{query}"


def urllib_transport(method: str, url: str, headers: dict, body):
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8", "replace")
            return response.status, raw, response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        content_type = error.headers.get("Content-Type", "") if error.headers else ""
        return error.code, raw, content_type
    except urllib.error.URLError as error:
        raise KomootError(f"Keine Verbindung zu Komoot: {error.reason}") from error


class Komoot:
    def __init__(self, store: KomootStore, transport=urllib_transport):
        self.store = store
        self.transport = transport

    def login(self, email: str, password: str) -> dict:
        clean = email.strip()
        if "@" not in clean or not password:
            raise KomootError("E-Mail und Passwort von Komoot fehlen.")
        status, text, _content_type = self.transport(
            "GET",
            f"{API}{login_path(clean)}",
            {
                "Authorization": basic_auth(clean, password),
                "Accept": "application/json",
                "User-Agent": "tourkarte",
            },
            None,
        )
        payload = _parse_json(text)
        if status in (401, 403):
            raise KomootError("E-Mail oder Passwort stimmt nicht.")
        if status >= 400:
            raise KomootError(f"Komoot: {_fault_message(payload)}")
        record = session_from_login(clean, payload)
        self.store.save(record)
        return record

    def list_tours(self, after: date | None = None) -> list[dict]:
        token = self.store.load()
        path = tours_path(token["user_id"])
        tours: list[dict] = []
        pages = 0
        while path and pages < 15:
            pages += 1
            status, text, _content_type = self._request(path, token)
            payload = _parse_json(text)
            _raise_for_status(status, payload)
            batch = tours_from_page(payload)
            tours.extend(batch)
            if page_is_older(batch, after):
                break
            path = next_path(payload)
        return tours

    def gpx(self, tour_id: int) -> str:
        token = self.store.load()
        status, text, _content_type = self._request(f"/v007/tours/{int(tour_id)}.gpx", token)
        if status == 429:
            raise KomootError("Komoot begrenzt die Anfragen. Bitte in ein paar Minuten erneut versuchen.")
        if status in (401, 403):
            raise KomootError("Die Komoot-Anmeldung ist abgelaufen. Bitte `komoot-auth` erneut ausführen.")
        if status >= 400 or not looks_like_gpx(text):
            detail = _fault_message(_parse_json(text)) if status >= 400 else "kein GPX"
            raise KomootError(f"Tour {int(tour_id)}: {detail}")
        return text

    def _request(self, path: str, token: dict):
        headers = {
            "Authorization": basic_auth(str(token["user_id"]), str(token["token"])),
            "Accept": "application/hal+json, application/gpx+xml, application/json",
            "User-Agent": "tourkarte",
        }
        return self.transport("GET", API + normalize_path(path), headers, None)


def session_from_login(email: str, payload: dict) -> dict:
    if not isinstance(payload, dict) or not payload.get("username") or not payload.get("password"):
        raise KomootError("Komoot hat keinen Zugang geliefert.")
    user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
    return {
        "email": email,
        "user_id": str(payload["username"]),
        "token": str(payload["password"]),
        "display_name": str(user.get("displayname") or email),
    }


def tours_from_page(payload) -> list[dict]:
    if not isinstance(payload, dict):
        raise KomootError("Unerwartete Antwort beim Lesen der Touren.")
    embedded = payload.get("_embedded") or {}
    tours = embedded.get("tours") if isinstance(embedded, dict) else None
    if not isinstance(tours, list):
        raise KomootError("Unerwartete Antwort beim Lesen der Touren.")
    return [tour for tour in tours if isinstance(tour, dict) and tour.get("id") is not None]


def next_path(payload) -> str:
    if not isinstance(payload, dict):
        return ""
    links = payload.get("_links") if isinstance(payload.get("_links"), dict) else {}
    nxt = links.get("next") if isinstance(links, dict) else None
    href = nxt.get("href") if isinstance(nxt, dict) else ""
    if not href:
        return ""
    parsed = urllib.parse.urlsplit(str(href))
    if parsed.netloc and parsed.netloc != "api.komoot.de":
        return ""
    try:
        return normalize_path(parsed.path + (("?" + parsed.query) if parsed.query else ""))
    except KomootError:
        return ""


def normalize_path(path: str) -> str:
    parsed = urllib.parse.urlsplit(path.strip())
    if parsed.scheme or parsed.netloc or not parsed.path.startswith(("/v006/", "/v007/")):
        raise KomootError("Der Komoot-Pfad ist ungültig.")
    if ".." in parsed.path.split("/"):
        raise KomootError("Der Komoot-Pfad ist ungültig.")
    if parsed.query:
        return f"{parsed.path}?{parsed.query}"
    return parsed.path


def page_is_older(tours: list[dict], after: date | None) -> bool:
    if after is None or not tours:
        return False
    days = [tour_date(tour) for tour in tours]
    if any(day is None for day in days):
        return False
    return all(day < after for day in days)


def tour_date(tour: dict) -> date | None:
    raw = tour.get("date") or tour.get("start_date") or ""
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def tour_kind(tour: dict) -> str:
    return "planned" if str(tour.get("type") or "") == "tour_planned" else "recorded"


def is_bike(tour: dict) -> bool:
    sport = str(tour.get("sport") or "")
    return sport in BIKE_SPORTS or bool(_BIKE_PATTERN.search(sport))


def is_listed(
    tour: dict,
    *,
    sport: str,
    kind: str,
    after: date | None,
    before: date | None,
) -> bool:
    actual = tour_kind(tour)
    if kind == "planned" and actual != "planned":
        return False
    if kind == "recorded" and actual == "planned":
        return False
    if sport != "all" and not is_bike(tour):
        return False
    day = tour_date(tour)
    if day is None:
        return True
    if after and day < after:
        return False
    if before and day > before:
        return False
    return True


def looks_like_gpx(text: str) -> bool:
    sample = text.lstrip()[:800].lower()
    return "<gpx" in sample and ("trkpt" in text or "rtept" in text)


def gpx_filename(tour_id: int, name: str, when: date | None) -> str:
    prefix = when.isoformat() if when else "tour"
    return f"{prefix}-{slug(name)}-{int(tour_id)}.gpx"


def pull_tours(
    client: Komoot,
    out_dir: str | Path,
    *,
    sport: str = "bike",
    kind: str = "recorded",
    after: date | None = None,
    before: date | None = None,
    tour_ids: list[int] | None = None,
) -> list[PullItem]:
    if after and before and before < after:
        raise ValueError("Das Enddatum liegt vor dem Startdatum.")
    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)
    if tour_ids:
        tours = [{"id": int(tour_id)} for tour_id in tour_ids]
    else:
        if after is None or before is None:
            raise ValueError("Bitte --after und --before angeben oder einzelne --id.")
        tours = [
            tour
            for tour in client.list_tours(after)
            if is_listed(tour, sport=sport, kind=kind, after=after, before=before)
        ]
    return [_write_tour(client, tour, destination) for tour in tours]


def _write_tour(client: Komoot, tour: dict, destination: Path) -> PullItem:
    tour_id = int(tour["id"])
    name = str(tour.get("name") or f"Tour {tour_id}")
    when = tour_date(tour)
    item = PullItem(tour_id, name, when, _distance(tour))
    try:
        text = client.gpx(tour_id)
    except KomootError as error:
        if _fatal(error):
            raise
        item.skipped = str(error)
        return item
    path = destination / gpx_filename(tour_id, name, when)
    path.write_text(text, encoding="utf-8")
    try:
        loaded = read_gpx(path)
    except ValueError as error:
        path.unlink(missing_ok=True)
        item.skipped = str(error)
        return item
    if loaded.name and not tour.get("name"):
        name = loaded.name
        item.name = name
    if when is None and loaded.stages and loaded.stages[0].when:
        when = loaded.stages[0].when
        item.when = when
    final = destination / gpx_filename(tour_id, name, when)
    if final != path:
        path.replace(final)
    item.path = final
    item.skipped = None
    return item


def _distance(tour: dict) -> float | None:
    value = tour.get("distance")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fatal(error: KomootError) -> bool:
    text = str(error)
    return "abgelaufen" in text or "begrenzt" in text


def _raise_for_status(status: int, payload) -> None:
    if status == 429:
        raise KomootError("Komoot begrenzt die Anfragen. Bitte in ein paar Minuten erneut versuchen.")
    if status in (401, 403):
        raise KomootError("Die Komoot-Anmeldung ist abgelaufen. Bitte `komoot-auth` erneut ausführen.")
    if status >= 400:
        raise KomootError(f"Komoot: {_fault_message(payload)}")
    if not isinstance(payload, dict):
        raise KomootError("Unerwartete Antwort von Komoot.")


def _fault_message(payload) -> str:
    if isinstance(payload, dict) and payload.get("message"):
        return str(payload["message"])
    return "die Anfrage wurde abgelehnt."


def _parse_json(raw: str):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"message": raw[:300]}
