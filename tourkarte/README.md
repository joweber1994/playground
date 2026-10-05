# Tourkarte

Übersichtskarte einer gefahrenen Bikepacking-Tour fürs Fotoalbum. Aus einer oder mehreren GPX-Dateien wird eine Linienkarte auf Papierfarbe. Die Ausgabe ist SVG, damit die Seite im Buch scharf bleibt. Farben, Seitenmaß und Titel lassen sich an das Album anpassen.

Die Befehle laufen im Wurzelordner von playground.

```bash
python3 -m tourkarte render tourkarte/examples/beispiel.gpx -o uebersicht.svg --title "Beispieltour"
```

`tourkarte/examples/beispiel.svg` ist diese Karte. Das Beispiel ist keine echte Fahrt.

Für ein Fotoalbum im Quadrat bleibt `--format square` (210 mm). `--format a4` legt die Karte quer, `--format a4-hoch` hochkant, `--format auto` folgt der Form der Strecke. `--seite 280 280` setzt Breite und Höhe in Millimetern. `--paper`, `--ink` und `--route` nehmen Farben wie `#f3efe6`. `--color-by-day` gibt jeder Etappe eine eigene Farbe. `--start` und `--ziel` beschriften die Enden.

Eine PNG-Vorschau braucht Pillow (`pip install pillow`) und entsteht mit `-o karte.png` oder zusätzlich über `--png karte.png`.

Mehrere Etappen sind mehrere Dateien. Sie werden nach dem Datum sortiert:

```bash
python3 -m tourkarte render tag1.gpx tag2.gpx tag3.gpx \
  -o album.svg \
  --title "Durchs Inntal" \
  --start "Landeck" \
  --ziel "Innsbruck" \
  --route "#9c3412"
```

Die Strecke rechnet aus den GPX-Punkten. `hm` sind die Höhenmeter. Liegt eine Etappe in der Datei ohne Zeitstempel, bleibt ihre Reihenfolge die Reihenfolge der Dateien.

## GPX der gefahrenen Tour

Strava gibt die gefahrene Linie nur an das eigene Konto heraus. Von hier aus lässt sich kein Zugang öffnen. Zwei Wege führen zur GPX-Datei.

### Export aus Strava

Eine Aktivität: auf strava.com die Fahrt öffnen, das Menü mit den drei Punkten, dann **Export GPX**.

Alle Fahrten: **Einstellungen → Mein Konto → Deine Daten herunterladen oder exportieren**. Strava schickt ein Archiv. Darin liegen die Aktivitäten als GPX. Diesen Weg braucht man, wenn die Tour schon gefahren ist und nur die Albumseite entstehen soll.

Eine Privatsphäre-Zone schneidet Start oder Ziel ab. Dieselbe Lücke steht in der GPX-Datei, im Export und in der API.

### Über die Strava-API

Dafür legt man unter <https://www.strava.com/settings/api> eine eigene Anwendung an. Als **Authorization Callback Domain** trägt man `localhost` ein. Client-ID und Client-Secret bleiben auf dem Rechner.

```bash
python3 -m tourkarte strava-auth --client-id ID --client-secret SECRET
python3 -m tourkarte strava-pull --after 2026-06-01 --before 2026-06-14 --out gpx
python3 -m tourkarte render gpx/*.gpx -o album.svg --title "Bikepacking"
```

Der erste Befehl zeigt eine Adresse. Nach dem Erlauben landet der Browser auf einer leeren Seite; aus der Adresszeile kommt der Wert von `code=`. Der Zugang liegt in `~/.config/tourkarte/strava.json` und ist nur für den eigenen Benutzer lesbar. Beide Tage sind einschließlich, als UTC-Kalender.

Ohne `--id` holt der Abruf Fahrradfahrten: Ride, MountainBikeRide, GravelRide, EBikeRide, EMountainBikeRide, Velomobile, Handcycle. Rollentrainer und virtuelle Fahrten bleiben draußen. `--sport all` nimmt jede Aktivität mit GPS, `--sport Hike` nur Wanderungen. `--id 1234567890` holt eine einzelne Aktivität, auch wenn die Sportart sonst nicht dabei wäre. `--full` schreibt jeden GPS-Punkt; sonst reicht die hohe Strava-Auflösung für die Albumseite.

Strava erlaubt wenige hundert Anfragen pro Viertelstunde. Eine Tour mit einem Abruf und einem Stream pro Fahrt bleibt darunter.

## Prüfen

```bash
python3 -m unittest discover -s tourkarte/tests -t .
```
