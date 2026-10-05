"""Tourkarte auf diesem Rechner im Browser öffnen.

Der Ordner playground wird unter http://127.0.0.1 ausgeliefert. Das funktioniert
in Cursor unter Windows genauso wie auf dem iPhone-Weg über localhost.
"""

from __future__ import annotations

import functools
import http.server
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 8765


def page_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/tourkarte/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


def start_server(port: int = DEFAULT_PORT) -> http.server.ThreadingHTTPServer:
    handler = functools.partial(Handler, directory=str(ROOT))
    if port == 0:
        return http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    last = None
    for candidate in range(port, port + 20):
        try:
            return http.server.ThreadingHTTPServer(("127.0.0.1", candidate), handler)
        except OSError as error:
            last = error
    raise OSError(f"Kein freier Port ab {port}.") from last


def serve(port: int = DEFAULT_PORT, open_browser: bool = True) -> int:
    server = start_server(port)
    bound = server.server_address[1]
    url = page_url(bound)
    print(f"Tourkarte: {url}", flush=True)
    print("Beenden mit Strg+C.", flush=True)
    print("In Strava als Authorization Callback Domain eintragen: 127.0.0.1", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(flush=True)
    finally:
        server.server_close()
    return 0
