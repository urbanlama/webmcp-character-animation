# Test A2 — Kommt ein Bild in einer Werkzeugantwort an?

Chrome 151, `--enable-experimental-web-platform-features`, Seite über `http://localhost:8779`.

## Frage

Der Plan sieht vor, dass an jedem Validierungsbericht automatisch ein Bildstreifen
hängt — als Gegenmittel gegen den in Test B gemessenen Befund, dass ein Agent von
selbst nicht hinschaut. Zwei unabhängige Prüfer haben das als ungeprüfte Annahme
markiert: Die dokumentierte Rückgabe von `execute` ist `{content:[{type:'text',text}]}`.
Base64 in einem Textfeld ist kein gesehenes Bild.

## Aufbau

Drei Werkzeuge, die dasselbe Bild in unterschiedlicher Form zurückgeben:

| Werkzeug | Rückgabeform |
|---|---|
| `bild_als_image` | `{content:[{type:'image', data, mimeType}]}` |
| `bild_als_dataurl` | `{content:[{type:'text', text:'data:image/png;base64,…'}]}` |
| `bild_mit_text` | Text **und** Bild in einer Antwort |

Auf jedem Bild steht ein Wort, das nirgends im Text vorkommt. Die Wörter werden beim
Laden zufällig aus zwölf gewählt — auch der Testende kennt sie vorher nicht.

**Negativfall:** Zwei verschiedene Bilder. Wird beide Male dasselbe Wort genannt, ist
das Bild nicht angekommen und der Test gilt als nicht bestanden.

## Ergebnis

| Prüfung | Ergebnis |
|---|---|
| `type: 'image'` wird bei der Registrierung akzeptiert | ja, kein Fehler |
| Bild kommt vollständig zurück | ja, 4447 Zeichen Base64, 3,3 KB PNG |
| Text und Bild in einer Antwort | ja, beide Teile intakt |
| Wort auf Bild 1 gelesen | SEEIGEL |
| Wort auf Bild 2 gelesen | NUDELHOLZ |
| Negativfall | bestanden, zwei verschiedene Antworten |

## Bedeutung

Schicht 6.8 des Plans steht nicht mehr auf einer Annahme. Ein Validierungsbericht darf
Messwerte und Bild in derselben Antwort liefern.

## Grenze dieser Messung

Die Bilddaten wurden über `executeTool` geholt und selbst als Datei abgelegt. Ein
Agent, der im Browser sitzt, bekommt sie vom Browser zugestellt. Ob dieser Zwischenweg
sauber ist, hängt am jeweiligen Agenten-Harness, nicht an dieser Seite.

Der Teil, den wir bauen, funktioniert nachweislich.
