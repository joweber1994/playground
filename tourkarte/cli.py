"""Kommandozeile: GPX zeichnen und Strava-Fahrten holen."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

from .geo import format_km
from .gpx import load_paths
from .render import Options, build_scene, write_png, write_svg
from .strava import (
    DEFAULT_REDIRECT,
    DEFAULT_TOKEN_PATH,
    RIDE_SPORTS,
    Strava,
    StravaError,
    TokenStore,
    authorize_url,
    pull_activities,
)


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "render":
            return cmd_render(args)
        if args.command == "strava-auth":
            return cmd_auth(args)
        if args.command == "strava-pull":
            return cmd_pull(args)
    except (ValueError, StravaError, OSError) as error:
        print(f"tourkarte: {error}", file=sys.stderr)
        return 1
    print("tourkarte: unbekannter Befehl.", file=sys.stderr)
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tourkarte",
        description="Übersichtskarte einer gefahrenen Bikepacking-Tour fürs Fotoalbum.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    render = commands.add_parser("render", help="GPX-Dateien als Albumkarte zeichnen")
    render.add_argument("gpx", nargs="+", help="eine oder mehrere GPX-Dateien, eine Datei pro Etappe")
    render.add_argument("-o", "--output", required=True, help="Zieldatei, .svg oder .png")
    render.add_argument("--png", help="zusätzlich eine PNG-Vorschau schreiben")
    render.add_argument("--title", help="Titel unter der Karte")
    render.add_argument("--start", help="Beschriftung am Start")
    render.add_argument("--ziel", help="Beschriftung am Ziel")
    render.add_argument("--format", default="square", choices=("square", "a4", "a4-hoch", "auto"))
    render.add_argument("--seite", nargs=2, type=float, metavar=("BREITE_MM", "HOEHE_MM"))
    render.add_argument("--paper", help="Papierfarbe, zum Beispiel #f3efe6")
    render.add_argument("--ink", help="Farbe für Text und Rahmen")
    render.add_argument("--route", help="Farbe der Fahrlinie")
    render.add_argument("--muted", help="Farbe für das Datum")
    render.add_argument("--color-by-day", action="store_true", help="jede Etappe in eigener Farbe")

    auth = commands.add_parser("strava-auth", help="Strava-Zugang auf diesem Rechner speichern")
    auth.add_argument("--client-id", default=os.environ.get("STRAVA_CLIENT_ID"))
    auth.add_argument("--client-secret", default=os.environ.get("STRAVA_CLIENT_SECRET"))
    auth.add_argument("--code", help="Code aus der Rückleitungsadresse, oder die ganze Adresse")
    auth.add_argument("--redirect-uri", default=DEFAULT_REDIRECT)
    auth.add_argument("--token-file", default=str(DEFAULT_TOKEN_PATH))

    pull = commands.add_parser("strava-pull", help="gefahrene Aktivitäten als GPX speichern")
    pull.add_argument("--after", help="erster Tag, einschließlich, JJJJ-MM-TT")
    pull.add_argument("--before", help="letzter Tag, einschließlich, JJJJ-MM-TT")
    pull.add_argument("--id", action="append", type=int, dest="ids", help="eine Aktivitätsnummer, mehrfach erlaubt")
    pull.add_argument(
        "--sport",
        default=",".join(sorted(RIDE_SPORTS)),
        help="kommagetrennte sport_type-Werte, oder all",
    )
    pull.add_argument("--out", default="gpx", help="Ordner für die GPX-Dateien")
    pull.add_argument("--full", action="store_true", help="alle GPS-Punkte statt der hohen Auflösung")
    pull.add_argument("--token-file", default=str(DEFAULT_TOKEN_PATH))
    return parser


def cmd_render(args) -> int:
    tour = load_paths(args.gpx)
    fields = {}
    if args.title is not None:
        fields["title"] = args.title
    if args.paper:
        fields["paper"] = args.paper
    if args.ink:
        fields["ink"] = args.ink
    if args.route:
        fields["route"] = args.route
    if args.muted:
        fields["muted"] = args.muted
    options = Options(
        start_label=args.start,
        end_label=args.ziel,
        fmt=args.format,
        page_mm=tuple(args.seite) if args.seite else None,
        color_by_day=args.color_by_day,
        **fields,
    )
    scene = build_scene(tour, options)
    output = Path(args.output)
    if output.suffix.lower() == ".png":
        write_png(scene, output)
    else:
        write_svg(scene, output)
    if args.png:
        write_png(scene, args.png)
    print(output)
    return 0


def cmd_auth(args) -> int:
    if not args.client_id or not args.client_secret:
        raise ValueError("Client-ID und Client-Secret fehlen. Beides kommt aus den Strava-API-Einstellungen.")
    url = authorize_url(args.client_id, args.redirect_uri)
    code = args.code
    if not code:
        print("Diese Adresse im Browser öffnen und den Zugriff erlauben.")
        print("Als Callback-Domain in der Strava-App muss localhost eingetragen sein.")
        print(url)
        print("Der Browser landet auf einer leeren Seite. Aus der Adresszeile den Wert von code= kopieren.")
        if not sys.stdin.isatty():
            raise ValueError("Code fehlt. Den Befehl mit --code erneut ausführen.")
        code = input("Code: ")
    store = TokenStore(args.token_file)
    Strava(store).exchange(args.client_id, args.client_secret, code)
    print(f"Zugang gespeichert: {store.path}")
    return 0


def cmd_pull(args) -> int:
    sports = {part.strip() for part in args.sport.split(",") if part.strip()}
    if not sports:
        raise ValueError("Keine Sportart angegeben.")
    after = _date(args.after) if args.after else None
    before = _date(args.before) if args.before else None
    client = Strava(TokenStore(args.token_file))
    results = pull_activities(
        client,
        args.out,
        sports=sports,
        after=after,
        before=before,
        activity_ids=args.ids,
        resolution=None if args.full else "high",
    )
    written = [item for item in results if item.path]
    for item in results:
        if item.path:
            when = item.when.strftime("%d.%m.%Y") if item.when else "ohne Datum"
            distance = format_km(item.distance_m) if item.distance_m else "ohne Distanz"
            print(f"{when}  {item.name}  {distance}  {item.path}")
        else:
            print(f"übersprungen  {item.name}: {item.skipped}", file=sys.stderr)
    if not written:
        raise ValueError("Keine GPX-Datei geschrieben.")
    noun = "GPX-Datei" if len(written) == 1 else "GPX-Dateien"
    print(f"{len(written)} {noun} in {args.out}")
    return 0


def _date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"Datum {value!r} bitte als JJJJ-MM-TT angeben.") from error
