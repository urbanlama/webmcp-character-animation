# Für die Leitung

Nur für die Sitzung, die organisiert. Wer einen Auftrag ausführt, braucht das hier
nicht — für ihn gilt `AGENTS.md`.

## Deine Aufgabe

Verteilen, einsammeln, zusammenführen. Selbst bauen nur, was sich nicht delegieren
lässt.

Welches Paket startklar ist, welche Dateien es bekommt und woran du es abnimmst, steht
in `docs/umsetzung.md`.

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

Alle drei Kanäle sind am 31. August 2026 an derselben Aufgabe gemessen worden. Alle drei
lösten sie physikalisch korrekt, auf identische Zahlen. Der Unterschied liegt im Aufwand,
nicht in der Richtigkeit.

**Qwen 3.8 Flash über Command Code — das Arbeitspferd.** Beliebig viele parallel.
Kompakteste Ergebnisse, disziplinierter Werkzeugeinsatz, beendet sich selbst mit
brauchbarem Bericht. 143 s, 38 Werkzeugaufrufe, 129 Zeilen.

```bash
cmdc -p "Lies die Datei C:\pfad\auftrag.md vollstaendig und arbeite den darin beschriebenen Auftrag ab." \
     -m "Qwen/Qwen3.8-Flash" --effort xhigh --tools-all --yolo --max-turns 60
```

**GLM 5.3 Flash über Kimi Code — zweite Wahl, HÖCHSTENS DREI GLEICHZEITIG.**
Gleichwertig in der Qualität, etwas schneller (112 s), aber die Zahl ist eine harte
Grenze.

```bash
/c/Users/maxbl/bin/glm53.cmd -p "Lies die Datei <pfad> vollstaendig und arbeite den darin beschriebenen Auftrag ab."
```

**GLM 5.3 über `cmdc` — nur als Notnagel.** Richtig, aber verschwenderisch: 366
Werkzeugaufrufe für dieselbe Aufgabe, bei der Qwen mit 26 auskam, und nach zehn Minuten
noch nicht fertig.

### Die vier Regeln, ohne die kein externer Lauf funktioniert

Jede einzelne davon hat schon einen Lauf gekostet:

1. **Auftrag als Datei, Kommandozeile nur ein Einzeiler.** Mehrzeiliger Text über
   `cmd.exe` kommt nur bis zum ersten Zeilenumbruch an. Ein Agent ohne Auftrag liest
   `AGENTS.md`, findet `LEITUNG.md`, hält sich für die Leitung und verteilt eigene
   Unteraufträge.
2. **Windows-Pfade, niemals Unix-Pfade.** `C:\Users\...`, nicht `/c/Users/...`. Über
   `cmdc` scheitert sonst der erste Werkzeugaufruf und der Lauf stirbt wortlos.
3. **`--tools-all` bei `cmdc`.** Im `-p`-Modus hält Command Code Werkzeuge zurück. `-t`
   ist `--trust` und regelt nur den Berechtigungsdialog, nicht die Werkzeuge.
4. **`--effort` ist je Modell verschieden.** Qwen kennt `low, medium, xhigh`, GLM kennt
   `low, high, max`. Ein falscher Wert bricht sofort ab, ohne den Auftrag zu lesen.

Jeder externe Auftrag beginnt mit einer Rollensperre: kein `LEITUNG.md` lesen, keine
Unteraufträge, keine fremden Dateien, kein `package.json`.

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
