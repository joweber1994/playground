# tf_modeling

Offline-Software für lineare Schaltungen. Bauteile werden auf eine Fläche gezogen, verbunden und symbolisch gelöst. Der Rechenkern ist eine eigene Knotenanalyse in JavaScript. Es gibt keinen Bezug zu SymAC, keinen fremden Solver und keinen Server. Nach dem ersten Laden rechnet das Gerät selbst, auch ohne Netz.

Drähte verbinden sich, wenn ein Eckpunkt auf einem anderen Draht liegt. Ein bloßes Überkreuzen verbindet nicht. Alle Massesymbole sind dasselbe Netz.

Enthalten sind Widerstand, Kondensator, Spule, Spannungs- und Stromquelle, spannungsgesteuerte Stromquelle, idealer Operationsverstärker und Masse. `s` ist die komplexe Frequenz.

## Auf dem iPhone, nur mit dem Telefon

`tf_modeling.html` enthält die ganze App in einer Datei.

1. In Safari, bei GitHub angemeldet, diese Adresse öffnen. Die Datei wird geladen: `https://github.com/joweber1994/playground/blob/main/tf_modeling/tf_modeling.html`
2. [tiiny.host](https://tiiny.host) öffnen, diese eine Datei hochladen, einen Namen vergeben und starten.
3. Den neuen Link in Safari öffnen. **Teiler** antippen, dann **Lösen**.
4. **Teilen**, dann **Zum Home-Bildschirm**.

Die Formel entsteht auf dem iPhone. Die Seite merkt sich die letzte Zeichnung. Nach dem Schließen öffnet derselbe Link die App wieder, sobald einmal Netz da war.

## Am Rechner

Im Ordner einen lokalen Webserver starten und `index.html` öffnen. Die Datei direkt von der Festplatte zu öffnen geht ebenfalls, der Home-Bildschirm-Cache braucht dagegen `http://` oder `https://`.

```bash
node solver.test.js
```

Die Prüfungen vergleichen Spannungsteiler, Tiefpass, Hochpass, RL-Glied, gesteuerte Quelle, Operationsverstärker und die mitgelieferten Zeichnungen mit bekannten Werten.
