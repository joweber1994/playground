# Tourkarte

Übersichtskarte einer gefahrenen Bikepacking-Tour fürs Fotoalbum. Auf dem iPhone wird Strava verbunden, die Etappen werden ausgewählt, und nur diese Fahrten werden als Seite gezeichnet.

Auf dem iPhone in Safari öffnen: <https://joweber1994.github.io/playground/tourkarte/>

Dann teilen und **Zum Home-Bildschirm**. Das Icon heißt Tourkarte. Die Strava-Anmeldung läuft über diese Adresse. In der Strava-App als **Authorization Callback Domain** eintragen: `joweber1994.github.io`

## Strava auf dem iPhone

1. [strava.com/settings/api](https://www.strava.com/settings/api) öffnen und eine App anlegen.
2. Als **Authorization Callback Domain** den Host der Seite eintragen, ohne `https://` und ohne Pfad. Die App zeigt den Host an.
3. Client-ID und Client-Secret in Tourkarte eintragen. Beides bleibt im Speicher dieses Geräts und steht nicht im Quelltext.
4. **Mit Strava verbinden.** Strava fragt nach der Erlaubnis für die eigenen Aktivitäten.
5. Zeitraum wählen, Fahrrad oder alle Sportarten, dann die Etappen der Tour anklicken.
6. **Karte zeichnen.** GPS wird nur für die angehakten Fahrten geholt.
7. Titel, Start, Ziel und Farbe setzen. **SVG teilen** legt die druckscharfe Datei in die Dateien oder in eine Mail. **Bild teilen** gibt ein PNG fürs Fotoalbum.

Rollentrainer und virtuelle Fahrten bleiben aus, bis „Indoor und virtuell zeigen“ an ist. Eine Privatsphäre-Zone in Strava schneidet Start oder Ziel ab. Dieselbe Lücke steht dann auf der Karte.

Die Anmeldung öffnet Strava und kehrt auf diese Seite zurück. Wenn dabei Safari statt des Home-Bildschirm-Icons aufgeht, die Anmeldung dort zu Ende führen.

Eine GPX-Datei vom iPhone geht auch ohne Strava, über **GPX wählen**.

## Am Rechner

Dieselbe Karte entsteht aus GPX-Dateien:

```bash
python3 -m tourkarte render tourkarte/examples/beispiel.gpx -o uebersicht.svg --title "Beispieltour"
```

`tourkarte/examples/beispiel.svg` ist diese Karte. Das Beispiel ist keine echte Fahrt. `--format square` ist 210 mm im Quadrat, `--format a4` liegt quer, `--seite 280 280` setzt die Millimeter. `--paper`, `--ink` und `--route` nehmen Farben wie `#f3efe6`.

Mit derselben Strava-App holt der Rechner die Fahrten als GPX:

```bash
python3 -m tourkarte strava-auth --client-id ID --client-secret SECRET
python3 -m tourkarte strava-pull --after 2026-06-01 --before 2026-06-14 --out gpx
```

Der Zugang liegt in `~/.config/tourkarte/strava.json`.

## Prüfen

```bash
node tourkarte/map.test.js
node tourkarte/strava.test.js
python3 -m unittest discover -s tourkarte/tests -t .
```
