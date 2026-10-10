# Wochenzettel – UI

Dunkle Fläche, eine goldene Aktion pro Zeile, alles andere ruhig. Maße stehen in `styles.css` als Variablen und gelten auf dem Handy (390 px).

## Maße

| Token | Wert | Verwendung |
| --- | --- | --- |
| `--pad` | 14 px | Seitenrand |
| `--gap` | 6 px | Abstand in Zeilen und Rastern |
| `--control` | 40 px | Eingaben, Tabs, primäre Buttons |
| `--control-sm` | 36 px | Werkzeuge, Mengen-Tasten, Markt-Chips |
| `--chip` | 32 px | Kopf-Pillen, Zutaten-Tags |
| `--qty` | 68 px | Spalte Menge |
| `--btn` | 92 px | Spalte Aktion |
| `--side` | 76 px | Spalte Weglassen / Entfernen |

Eingaben bleiben bei 16 px Schrift, damit das Handy nicht hineinzoomt.

## Zeilen

Drei Formulare schließen rechts bündig ab: Text, Menge, goldener Button.

```
[ Artikel ……………… ] [ Menge ] [ Dazu ]
[ Kaffee …………… ] [ Menge ] [ Merken ]
[ Reis ………………… ] [ Menge ] [ Eintragen ]
```

Ticker und „Ergänzen“ haben keine Menge. Ihr Button ist dieselbe `--btn`-Spalte, die rechte Kante bleibt gleich.

Listen haben eine feste Aktionsspalte. Weglassen und Entfernen sitzen auf derselben rechten Kante.

Werkzeuge: erste Zeile drei gleiche Buttons (Rückgängig, Wiederholen, Leeren), zweite Zeile zwei gleiche (Kopieren, Fertig). Beide Zeilen schließen links und rechts bündig ab.

Im Vorrat ist jede Karte gleich: Name links, darunter nichts. Rechts immer −, Menge, + in derselben Breite, Ändern und Entfernen an derselben rechten Kante.

Bei Gerichten stehen Bearbeiten und der Listen-Button in einer Zeile, gleiche Höhe.

## Farbe

Gold ist die eine Aktion der Zeile (Dazu, Merken, Eintragen, aktiver Tab, gewählter Markt). Türkis markiert Erledigt, Scannen und eine übernommene Liste. Grau ist der Rest.
