# Arbeitsanweisungen

Beitrag zur OpenAI WebMCP Challenge. Eine Web-Oberfläche, in der ein Agent geriggte
3D-Charaktere animiert, ohne blind zu sein.

Vor der ersten Zeile Code lesen: `VISION.md` (das Ziel), `docs/plan.md` (wie es gebaut
wird), `docs/challenge.md` (Fristen und Abgabebedingungen).

---

## Wer ist hier "Agent"

Vier verschiedene Dinge, damit sie nicht verwechselt werden:

| Begriff | Wer | Wo |
|---|---|---|
| **Leiter** | die Claude-Code-Sitzung, die die Arbeit verteilt und zusammenführt | dein Terminal |
| **Bautrupp** | GLM und Qwen, per Befehl aufgerufen | siehe unten |
| **Nutzer-Agent** | der, der später die fertige Seite bedient — bei der Jury im Browser | nicht bei uns |

Der Nutzer-Agent ist der, für den wir bauen. Die anderen bauen.

Der Leiter läuft auf Opus und behält die Übersicht. Er baut nicht selbst, solange er
delegieren kann.

---

## Die drei Regeln

### 1. Körpermaße werden gemessen, Verfahrensparameter werden benannt

Radien, Massen, Kontaktpunkte, Gelenkachsen, Blickrichtung — alles aus dem geladenen
Modell. Wer eine Körpergröße in den Code tippt, weil sie plausibel klingt, baut genau
den Fehler ein, den dieses Projekt beheben soll.

Verfahrensparameter wie Perzentile oder Toleranzen sind unvermeidbar. Sie stehen an
einer Stelle, mit Begründung, und werden im Rig-Bericht ausgegeben.

Belegt: Geschätzte Körpermaße erzeugten 269 Fehlalarme auf einem Clip, in dem eine
Figur ruhig dasteht.

### 2. Kein Test ohne Negativfall

Zu jedem Test gehört ein absichtlich kaputter Fall, der rot werden **muss**. Wird er
nicht rot, ist der Test kaputt, nicht der Code.

### 3. Kalibrierungsdaten und Testdaten sind getrennt

Wer aus Daten lernt, prüft nicht mit denselben Daten.

Belegt: Auf allen fünf Referenzclips kalibriert ergab null Fehlalarme. Auf zwei
kalibriert und gegen die anderen drei geprüft ergab 150, 132 und 183.

**Zusatz:** Zahlen ohne Bild sind unvollständig. Widersprechen sich Zahl und Bild,
gewinnt das Bild.

---

## Weitere Regeln

**Fehlermeldungen enthalten immer eine Zahl.** Nicht "ungültige Eingabe", sondern
"Frame 34 liegt außerhalb der Timeline von 0 bis 60".

**Werkzeugbeschreibungen sind das Handbuch des Nutzer-Agenten.** Jede nennt das
Bezugssystem und die Einheiten ihrer Parameter.

**Wenige, grob geschnittene Werkzeuge.** Ein Aufruf pro Bewegungsphase, nicht einer pro
Knochen. Zielgröße unter zwanzig.

**Jede Prüfung ist phasenabhängig.** Balance gilt nur bei Bodenkontakt, Ballistik nur im
Flug.

**Fehlerfreiheit ist kein Erfolg.** Eine Animation, in der nichts passiert, besteht jede
Fehlerprüfung.

**Der Löser korrigiert, der Validator prüft die Nachbedingung.** Ein Löser kann
scheitern — genau dann muss der Validator etwas melden.

**Alle Toleranzen relativ zur Körperhöhe.** 50 cm bedeuten für eine 60 cm große Figur
etwas anderes als für eine 2,40 m große.

---

## Arbeitsverteilung

# Wenig Zeit heißt viele Agents.

Das ist die wichtigste Regel dieser Datei. Wer einen Auftrag rausgibt und dann wartet,
bis das Ergebnis kommt, verschenkt die Zeit, die wir nicht haben. Aufträge gehen
**gleichzeitig** raus, immer wenn sie nicht voneinander abhängen — und das ist fast
immer der Fall, sobald die Datenformate stehen.

Der Leiter bleibt bei Opus, verteilt, prüft und führt zusammen. Er baut nur selbst, was
sich nicht delegieren lässt.

Praktisch: mehrere Aufrufe in einem Rutsch starten, im Hintergrund laufen lassen,
danach einsammeln. Nicht einer nach dem anderen.

**GLM 5.3 Flash über Ollama** — erste Wahl für die Bauarbeit. Kontingent zuerst
ausschöpfen, es verfällt sonst. Höchstens drei gleichzeitig.

```bash
/c/Users/maxbl/bin/glm53.cmd -p "<Auftrag>"
```

**Qwen 3.8 Flash über Command Code** — danach und daneben, beliebig viele parallel.

```bash
cmdc -p "<Auftrag>" -m "Qwen/Qwen3.8-Flash" --effort xhigh -t --max-turns 60
```

`cmdc`, nicht `cmd` — `cmd` ist Windows' eigene Eingabeaufforderung.
Falls Ollama leerläuft: `cmdc -m "zai-org/GLM-5.3"`.

**Claude-Unterinstanzen** — für Kritisches, für die Oberfläche und für alles, was
zweimal fehlgeschlagen ist. Über das Agent-Werkzeug. Auch die laufen parallel.

Beide externen Modelle sind stark. Sie brauchen eine klare Aufgabe, keine Anleitung in
Einzelschritten — aber sie sehen die Sitzung des Leiters nicht. Ein Auftrag muss ohne
Vorwissen verständlich sein und sagen, welche Dateien dazugehören und woran man
erkennt, dass es fertig ist.

**Zwei Agents bearbeiten nie gleichzeitig dieselbe Datei.** Gemeinsame Dateien —
Schemata, Werkzeugkatalog — gehören dem Leiter.

## Abnahme — nur für die Leitung

*Worker können diesen Abschnitt überspringen.*

**Ein grüner Test ist ein Hinweis, kein Beweis.** Was und wie geprüft wird, entscheidet
die Leitung von Fall zu Fall. Prüfen darf sie delegieren, um beweglich zu bleiben — die
Entscheidung über die Abnahme nicht.

Wo sich in diesem Projekt bereits Fehler hinter grünen Zahlen versteckt haben:

- Ein Negativtest, den es gab, der aber nie gelaufen ist
- Ein gemeldeter Betrag, der nicht zum eingebauten Fehler passte
- Kalibriert und geprüft mit denselben Daten
- Eine Animation, die jede Zahlenprüfung bestand und auf dem Bildschirm reglos war

Der letzte Fall ist der teuerste, und er lässt sich nur an einem Bild erkennen.

## Schwarzes Brett

`BRETT.md` ist die gemeinsame Pinnwand. Dort steht, was andere wissen müssen: geänderte
Formate, widerlegte Annahmen, Sackgassen, belegte Dateien, fertige Teile.

Jeder Auftrag endet mit einem Blick aufs Brett und, falls es etwas zu melden gibt, mit
einem Eintrag. Form und Regeln stehen in der Datei.

Nicht hineinschreiben, was nur einen selbst betrifft. Ein Brett, auf dem alles steht,
liest niemand.

---

## Abnahmetests

**Die meisten Tests brauchen keinen Agenten.** Die WebMCP-API hat neben `registerTool`
auch `getTools()` und `executeTool()` — die Seite kann ihre eigenen Werkzeuge aufrufen.
Ein Testskript macht damit, was ein Agent täte, nur reproduzierbar.

```js
const tools = await document.modelContext.getTools();
const t = tools.find(x => x.name === 'validate');
const raw = await document.modelContext.executeTool(t, JSON.stringify({}));
const result = JSON.parse(raw).content[0].text;
```

`executeTool` nimmt das Werkzeugobjekt und die Argumente als **JSON-String**. Die
Rückgabe ist ein **String**.

### Aufbau

```
test/
  cases/     eine Datei je Arbeitspaket
  fixtures/  Beispieldaten, gültige und absichtlich kaputte
  run.mjs    führt alles aus
  report/    Ergebnisse und Bildstreifen des letzten Laufs
```

```bash
node test/run.mjs            # alles
node test/run.mjs ap4        # ein Paket
```

Ausgabe je Fall eine Zeile, Rückgabewert ungleich null bei Fehlern:

```
AP4  boden    positiv  ok      Referenzclip, 0 Beanstandungen
AP4  boden    negativ  ok      5,0 cm gemeldet, erwartet 5,0 cm
AP4  balance  negativ  FEHLER  keine Meldung, erwartet 30 cm
```

Chrome braucht `--enable-experimental-web-platform-features`, ein eigenes
`--user-data-dir` und einen freien `--remote-debugging-port`. Die Seite muss über
`http://localhost:<port>` laufen, nicht über `file://`.

Jeder Test, der Bewegung bewertet, schreibt zusätzlich einen Bildstreifen nach
`test/report/`.

### Die drei Tests, die einen Agenten brauchen

Nur für Agentenverhalten, laufen von Hand:

| Test | Frage | Wer |
|---|---|---|
| Werkzeugwahl | findet er bei fünf Aufgaben das passende Werkzeug? | GLM, gegengeprüft mit Qwen |
| Bildwahrnehmung | erkennt er, was auf dem Bild zu sehen ist? | derselbe Weg |
| Vertikalschnitt | schafft er den Ablauf von Modell laden bis Export? | eine Claude-Unterinstanz |

Der Agent darf dabei den Quellcode nicht lesen. Auch diese Tests haben einen
Negativfall: Beim Bildtest muss ein zweites, anderes Bild zu einer anderen Antwort
führen.

---

## Auskunft ohne den Leiter zu stören

Der Leiter läuft oft lange und soll nicht unterbrochen werden. Für Zwischenfragen gibt
es eine zweite, getrennte Sitzung im selben Ordner.

Wer als Auskunft gestartet wird — erkennbar daran, dass die Frage nach dem Stand des
Projekts kommt und kein Auftrag vorliegt — hält sich an drei Punkte:

**Nichts ändern.** Keine Datei schreiben, keinen Agenten starten, nichts committen.
Auskunft heißt lesen und berichten. Sonst kollidiert man mit dem Leiter.

**Quellen in dieser Reihenfolge:** `BRETT.md` für das Aktuelle, `git log --oneline` für
den Verlauf, `test/report/` für den Zustand der Prüfungen, `docs/plan.md` für den
Sollzustand. Wenn Hintergrundprozesse laufen, deren Ausgabedateien.

**Antworten mit Zahlen.** Nicht "läuft gut", sondern: welche Pakete fertig sind, welche
Tests grün sind, was zuletzt im Brett stand, was gerade offen ist.

## Aufbau des Repos

```
README.md              was das Projekt ist, für Menschen
VISION.md              das Ziel in kurz
AGENTS.md              diese Datei
BRETT.md               gemeinsame Pinnwand, alle schreiben rein
CLAUDE.md              Verweis hierher
docs/plan.md           der Design-Plan mit Arbeitspaketen
docs/challenge.md      offizielle Wettbewerbsfakten
spikes/                Wegwerfcode aus Vorabtests, nicht Teil des Produkts
```

Alles unter `spikes/` ist Wegwerfcode. Die Ergebnisse daraus stehen in `docs/plan.md`.

---

## WebMCP, gemessene Fakten

```js
await document.modelContext.registerTool({
  name: 'beispiel',
  description: 'Was das Werkzeug tut, in ganzen Sätzen.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(args) {
    return { content: [{ type: 'text', text: 'Antwort' }] };
  }
});
```

- Nachträgliches Registrieren funktioniert — Werkzeuge dürfen nach dem Upload entstehen
- Antworten bis 512 KB kommen vollständig durch, in 5 ms
- `{ type: 'image', data, mimeType }` funktioniert; Text und Bild gehen in dieselbe
  Antwort
- Ein Werkzeug darf auf einen Klick des Menschen warten; die Antwort kommt im selben
  Aufruf zurück

---

## Was nicht gebaut wird

Vierbeiner und Fabelwesen, Text-to-Motion-Modelle im Browser, Ragdoll-Simulation,
mehrere Figuren, Kleidung, Gesichtsanimation. Begründungen in `docs/plan.md`.
