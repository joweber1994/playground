# Tourkarte

Übersichtskarte einer gefahrenen Bikepacking-Tour fürs Fotoalbum. Auf dem iPhone wird Strava oder Komoot verbunden, die Etappen werden ausgewählt, und nur diese Touren werden als Seite gezeichnet.

Auf dem iPhone in Safari öffnen: <https://joweber1994.github.io/playground/tourkarte/>

Dann teilen und **Zum Home-Bildschirm**. Das Icon heißt Tourkarte. Die Strava-Anmeldung läuft über diese Adresse. In der Strava-App als **Authorization Callback Domain** eintragen: `joweber1994.github.io`

## Strava auf dem iPhone

1. [strava.com/settings/api](https://www.strava.com/settings/api) öffnen und eine App anlegen.
2. Als **Authorization Callback Domain** den Host der Seite eintragen, ohne `https://` und ohne Pfad. Die App zeigt den Host an.
3. Client-ID und Client-Secret in Tourkarte eintragen. Beides bleibt im Speicher dieses Geräts und steht nicht im Quelltext.
4. **Mit Strava verbinden.** Strava fragt nach der Erlaubnis für die eigenen Aktivitäten.
5. Zeitraum wählen, Fahrrad oder alle Sportarten, dann die Etappen der Tour anklicken.
6. **Karte zeichnen.** GPS wird nur für die angehakten Fahrten geholt.
7. Titel, Start, Ziel und Farbe setzen. Unter **Etappen** stehen je Tag Kilometer und Höhenmeter. Start und Ziel werden mit dem nächsten größeren Ort gefüllt und lassen sich danach ändern. Die Namen erscheinen auf der Karte. **Karte im Hintergrund** legt OpenStreetMap unter die Linie, mit Küste, Orten und Wegen. **SVG speichern** und **Bild speichern** legen die Datei auf dem Laptop ab. Im Fenster den Ordner Desktop wählen. **SVG teilen** und **Bild teilen** auf dem iPhone geben die Datei in die Dateien oder in eine Mail. Die Karte nennt OpenStreetMap als Quelle.

Rollentrainer und virtuelle Fahrten bleiben aus, bis „Indoor und virtuell zeigen“ an ist. Eine Privatsphäre-Zone in Strava schneidet Start oder Ziel ab. Dieselbe Lücke steht dann auf der Karte.

Die Anmeldung öffnet Strava und kehrt auf diese Seite zurück. Wenn dabei Safari statt des Home-Bildschirm-Icons aufgeht, die Anmeldung dort zu Ende führen.

Eine GPX-Datei vom iPhone geht auch ohne Strava und ohne Komoot, über **GPX wählen**.

## Komoot

1. Auf der Startseite **Komoot** und **Verbinden** wählen.
2. E-Mail und Passwort der Komoot-Anmeldung eintragen. Das Passwort wird nicht gespeichert. Auf dem Gerät bleibt der Zugang zu den eigenen Touren.
3. Zeitraum wählen. **Aufgezeichnet** sind die gefahrenen Touren, **Geplant** die Routen aus dem Planer. **Fahrrad** lässt Wanderungen und Läufe weg.
4. Sind Strava und Komoot verbunden, stehen beide in einer Liste, nach Tag sortiert. Jede Zeile nennt Quelle, Kilometer und Höhenmeter.
5. Touren anhaken und **Karte zeichnen**. Für jede Komoot-Tour wird das GPX geholt.

Im Terminal, mit der Anmeldung dieses Rechners:

```bash
python -m tourkarte komoot-auth --email name@example.com
python -m tourkarte komoot-pull --after 2026-06-01 --before 2026-06-14 --out tourkarte/out
```

Unter Windows `py -3 -m tourkarte` am Anfang, wenn `python` fehlt. Das Passwort wird abgefragt und nicht mitgeschrieben. `--kind planned` holt geplante Touren, `--sport all` auch Wanderungen. Der Zugang liegt in `~/.config/tourkarte/komoot.json`. Unter Windows ist das `C:\Users\<Name>\.config\tourkarte\komoot.json`.

## Auf dem Laptop in Cursor

Den Ordner `playground` in Cursor öffnen. Über die Befehlspalette **Tasks: Run Task** und dann **Tourkarte öffnen** wählen. Der Browser öffnet

<http://127.0.0.1:8765/tourkarte/>

Dieselbe Seite wie auf dem iPhone: Strava oder Komoot verbinden, Touren anhaken, Karte zeichnen. **SVG teilen** speichert die Datei auf dem Laptop. In Strava als **Authorization Callback Domain** für diesen Rechner `127.0.0.1` eintragen. Eine Strava-App hat eine solche Domain. Für das iPhone bleibt `joweber1994.github.io`, für den Laptop legt man eine zweite App an oder stellt die Domain um.

Im Terminal von Cursor geht derselbe Start. Unter Windows, wenn `python` fehlt:

```powershell
py -3 -m tourkarte serve
```

Sonst:

```bash
python -m tourkarte serve
```

Beenden mit Strg+C.

Eine GPX-Datei wird direkt zur Albumkarte. Die Datei liegt danach im Projekt, unter `tourkarte/out/`:

```bash
python -m tourkarte render tourkarte/examples/beispiel.gpx -o tourkarte/out/beispiel.svg --title "Beispieltour"
```

Unter Windows dasselbe mit `py -3 -m tourkarte` am Anfang. **Beispielkarte erzeugen** in den Tasks schreibt diese Datei. `tourkarte/examples/beispiel.svg` ist die mitgelieferte Karte. Das Beispiel ist keine echte Fahrt. `--format square` ist 210 mm im Quadrat, `--format a4` liegt quer, `--seite 280 280` setzt die Millimeter. `--paper`, `--ink` und `--route` nehmen Farben wie `#f3efe6`. Ein PNG aus dem Terminal braucht zusätzlich Pillow: `python -m pip install pillow`. Die Seite im Browser erzeugt das PNG ohne Pillow.

Mit der Strava-App des Laptops holt das Terminal die Fahrten als GPX und zeichnet danach die Karte:

```bash
python -m tourkarte strava-auth --client-id ID --client-secret SECRET
python -m tourkarte strava-pull --after 2026-06-01 --before 2026-06-14 --out tourkarte/out
python -m tourkarte render tourkarte/out/2026-06-12-etappe.gpx -o tourkarte/out/karte.svg --title "Tour" --color-by-day
```

Mehrere Etappen werden hinter `render` nacheinander genannt.

Der Zugang liegt in `~/.config/tourkarte/strava.json`. Unter Windows ist das `C:\Users\<Name>\.config\tourkarte\strava.json`.

## Prüfen

```bash
node tourkarte/map.test.js
node tourkarte/strava.test.js
node tourkarte/komoot.test.js
python -m unittest discover -s tourkarte/tests -t .
```

Unter Windows `py -3` statt `python`, wenn der Befehl `python` fehlt.
