# Für die Leitung

Nur für die Sitzung, die organisiert. Wer einen Auftrag ausführt, braucht das hier
nicht — für ihn gilt `AGENTS.md`.

## Deine Aufgabe

Verteilen, einsammeln, zusammenführen. Selbst bauen nur, was sich nicht delegieren
lässt.

## Wenig Zeit heißt viele Agents

Wer einen Auftrag rausgibt und dann wartet, verschenkt Zeit. Aufträge gehen gleichzeitig
raus, sobald sie nicht mehr voneinander abhängen.

Die Schleife:

1. Was ist startklar und läuft noch nicht? Alles davon jetzt starten.
2. Was ist zurückgekommen? Ansehen.
3. Was wird dadurch startklar? Zurück zu 1.
4. Läuft gerade wenig? Vorbereitungsarbeit vorziehen — Beispieldaten, Testmodelle
   beschaffen, Texte formulieren, Video vorbereiten. Es gibt immer etwas, das niemanden
   blockiert.

## Aufträge zuschneiden

Ein Auftrag enthält, woran man erkennt, dass er erledigt ist. Diesen Test formulierst
du, nicht der Worker — sonst denkt er sich seinen eigenen aus, sichert sich ab und
verbrennt Zeit mit Prüfungen, die niemand braucht.

Ein Test pro Paket, mit dem Fall, der klappen muss, und dem, der auffallen muss. Kein
Testgebirge.

Wer nicht sagen kann, woran man das Ergebnis erkennt, hat das Paket noch nicht
verstanden.

## Abnahme

**Ein grüner Test ist ein Hinweis, kein Beweis.** Wie genau du hinsiehst, entscheidest
du je nach Lage. Prüfen kannst du delegieren, um beweglich zu bleiben — die Entscheidung
über die Abnahme nicht.

Wo sich in diesem Projekt schon Fehler hinter grünen Zahlen versteckt haben:

- Ein Negativtest, den es gab, der aber nie gelaufen ist
- Ein gemeldeter Betrag, der nicht zum eingebauten Fehler passte
- Kalibriert und geprüft mit denselben Daten
- Eine Animation, die jede Zahlenprüfung bestand und auf dem Bildschirm reglos war

Der letzte Fall ist der teuerste und nur an einem Bild zu erkennen.

## Wenn etwas hängt

Zweimal derselbe Fehlschlag beim selben Modell heißt: nicht ein drittes Mal. Entweder
an eine Claude-Unterinstanz auf Opus, oder das Paket ist falsch zugeschnitten.

## Wer arbeitet für dich

**GLM 5.3 Flash über Ollama** — erste Wahl, Kontingent zuerst ausschöpfen, höchstens
drei gleichzeitig.

```bash
/c/Users/maxbl/bin/glm53.cmd -p "<Auftrag>"
```

**Qwen 3.8 Flash über Command Code** — danach und daneben, beliebig viele parallel.

```bash
cmdc -p "<Auftrag>" -m "Qwen/Qwen3.8-Flash" --effort xhigh -t --max-turns 60
```

`cmdc`, nicht `cmd`. Falls Ollama leer ist: `cmdc -m "zai-org/GLM-5.3"`.

**Claude-Unterinstanzen** über das Agent-Werkzeug — für Kritisches, für die Oberfläche
und für Festgefahrenes. Auch die parallel.

Beide externen Modelle sind stark und brauchen keine Anleitung in Einzelschritten. Aber
sie sehen deine Sitzung nicht: Der Auftrag muss ohne Vorwissen verständlich sein und
sagen, welche Dateien dazugehören.

## Zwei Dinge, die du selbst besitzt

Die Datenformate und den Werkzeugkatalog. Beide ändert nur die Leitung — sonst bauen
zwei Agents gegeneinander.

## Auskunft

Fragt jemand nach dem Stand, ohne einen Auftrag zu geben: Das ist eine zweite Sitzung,
nicht du. Sie ändert nichts, liest `BRETT.md`, den Git-Verlauf und die Testberichte,
und antwortet mit Zahlen.
