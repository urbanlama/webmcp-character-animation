# Abnahmetests — wie sie laufen

Jedes Arbeitspaket ist erst fertig, wenn sein Test bestanden ist. Diese Datei sagt, wie
so ein Test aussieht, wer ihn ausführt und wie man ihn aufruft.

## Zwei Arten von Tests

**Die meisten Tests brauchen keinen Agenten.** Sie laufen deterministisch im Browser und
liefern immer dasselbe Ergebnis. Das ist Absicht: Ein Test, dessen Ergebnis davon
abhängt, wie ein Modell gerade gelaunt ist, ist kein Test.

**Nur wenige Tests brauchen einen Agenten** — nämlich die, die Agentenverhalten prüfen:
Wählt er aus den Werkzeugen das richtige? Erkennt er, was auf einem Bild zu sehen ist?
Diese laufen selten und werden getrennt geführt.

## Warum das ohne Agent geht

Die WebMCP-API hat neben `registerTool` auch `getTools()` und `executeTool()`. Die Seite
kann also ihre eigenen Werkzeuge aufrufen. Ein Testskript macht damit genau das, was ein
Agent täte — nur reproduzierbar.

Gemessen und bestätigt in `spikes/test-a-webmcp/ERGEBNIS.md`:

```js
const tools = await document.modelContext.getTools();
const t = tools.find(x => x.name === 'validate');
const raw = await document.modelContext.executeTool(t, JSON.stringify({}));
const result = JSON.parse(raw).content[0].text;
```

`executeTool` nimmt das Werkzeugobjekt aus `getTools()` und die Argumente als
**JSON-String**. Die Rückgabe ist ein **String**, der das Ergebnisobjekt enthält.

## Aufbau eines Tests

Jeder Test hat zwei Hälften. Fehlt eine, ist es kein Test.

```
Positivfall:  Der saubere Fall wird durchgelassen.
Negativfall:  Der absichtlich kaputte Fall wird mit korrektem Betrag gemeldet.
```

Beispiel Bodenprüfung:

```
Positiv:  Referenzclip -> keine Beanstandung
Negativ:  Figur um 5 cm abgesenkt -> Meldung "5,0 cm im Boden"
          Der Betrag muss stimmen, nicht nur die Tatsache, dass etwas gemeldet wird.
```

Wird der Negativfall nicht rot, ist der Test kaputt und nicht der Code. Belegt: In
diesem Projekt waren am 30. August zwei gemeldete Ergebnisse falsch, weil nur der
Positivfall geprüft wurde.

## Wo Tests liegen

```
test/
  cases/          eine Datei je Arbeitspaket, z. B. ap4-physik.mjs
  fixtures/       Beispieldaten: gültige und absichtlich kaputte
  run.mjs         führt alles aus
  report/         Ergebnisse und Bildstreifen des letzten Laufs
```

## Aufruf

```bash
node test/run.mjs              # alles
node test/run.mjs ap4          # nur ein Paket
node test/run.mjs --keep       # Browser offen lassen, zum Nachschauen
```

`run.mjs` startet Chrome mit dem WebMCP-Flag und einem eigenen Profil, lädt die Seite,
löst die Prüfungen über `executeTool` aus, sammelt die Ergebnisse ein und schließt
wieder. Ausgabe pro Fall eine Zeile:

```
AP4  boden       positiv  ok      Referenzclip, 0 Beanstandungen
AP4  boden       negativ  ok      5,0 cm gemeldet, erwartet 5,0 cm
AP4  balance     negativ  FEHLER  keine Meldung, erwartet 30 cm
```

Ende mit Anzahl bestanden und durchgefallen, Rückgabewert ungleich null bei Fehlern —
damit ein Agent es ohne Interpretation ablesen kann.

Der Chrome-Start braucht:

```
--enable-experimental-web-platform-features
--remote-debugging-port=<frei>
--user-data-dir=<eigenes Profil>
```

Die Seite muss über `http://localhost:<port>` laufen, nicht über `file://` — WebMCP
braucht einen sicheren Kontext.

## Bilder gehören dazu

Jeder Test, der ein Bewegungsergebnis bewertet, schreibt zusätzlich einen Bildstreifen
nach `test/report/`. Widersprechen sich Zahl und Bild, gilt der Test als nicht
bestanden.

Der Grund steht in `AGENTS.md`: Eine Animation kann jede Zahlenprüfung bestehen und auf
dem Bildschirm trotzdem falsch aussehen.

## Tests, die einen Agenten brauchen

Nur für Agentenverhalten. Sie laufen von Hand, nicht bei jedem Bauen.

| Test | Frage | Wer führt aus |
|---|---|---|
| Werkzeugwahl | Findet ein Agent bei fünf Aufgaben jeweils das passende Werkzeug? | GLM 5.3 Flash über `glm53.cmd`, danach Qwen zum Gegenprüfen |
| Bildwahrnehmung | Erkennt ein Agent, was auf dem gelieferten Bild zu sehen ist? | derselbe Weg; das Bild enthält ein zufälliges Wort, das nirgends im Text steht |
| Vertikalschnitt | Schafft ein Agent den ganzen Ablauf von Modell laden bis Export? | ein Opus-Subagent oder eine eigene Claude-Code-Sitzung |

Aufruf über die Wege in `docs/flotte.md`. Der Agent darf dabei den Quellcode nicht
lesen — sonst wird geprüft, ob er sich in fremdem Code zurechtfindet, statt ob die
Werkzeuge ausreichen.

**Diese Tests haben ebenfalls einen Negativfall.** Beim Bildtest: Ein zweites, anderes
Bild muss zu einer anderen Antwort führen. Kommt zweimal dasselbe, hat der Agent nichts
gesehen. So wurde Test A2 geführt, siehe `spikes/test-a2-image/ERGEBNIS.md`.

## Hold-out-Pflicht

Wo aus Daten gelernt wird, wird nicht mit denselben Daten geprüft. Der Testkorpus wird
vorab in Entwicklung und Abnahme geteilt. Wer mit Abnahmedaten entwickelt, macht den
Test wertlos.

Belegt: Auf allen fünf Referenzclips kalibriert ergab null Fehlalarme. Auf zwei
kalibriert und gegen die anderen drei geprüft ergab 150, 132 und 183.
