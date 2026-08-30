# Arbeitsanweisungen für Agents

Beitrag zur OpenAI WebMCP Challenge. Eine Web-Oberfläche, in der ein Agent geriggte
3D-Charaktere animiert, ohne blind zu sein.

Vor der ersten Zeile Code lesen:

- `VISION.md` — was gebaut wird und warum
- `docs/challenge.md` — Fristen, Abgabeanforderungen, Bewertungskriterien
- `docs/superpowers/specs/` — der Design-Plan
- `docs/flotte.md` — wer welche Aufgabe bekommt und wie man ihn beauftragt

## Die drei Regeln

### 1. Körpermaße werden gemessen, Verfahrensparameter werden benannt

Radien, Massen, Kontaktpunkte, Gelenkachsen, Blickrichtung — alles aus dem geladenen
Modell. Wer eine Körpergröße in den Code tippt, weil sie plausibel klingt, baut genau
den Fehler ein, den dieses Projekt beheben soll.

Verfahrensparameter wie Perzentile oder Toleranzen sind unvermeidbar. Sie stehen an
einer Stelle im Code, mit Begründung, und werden im Rig-Bericht ausgegeben. Unsichtbar
im Code verstreut sind sie verboten.

Belegt: Geschätzte Körpermaße erzeugten 269 Fehlalarme auf einem Clip, in dem eine Figur
ruhig dasteht.

### 2. Kein Test ohne Negativfall

Ein Test, der nur bestätigt, dass etwas grün ist, ist wertlos. Zu jedem Test gehört ein
absichtlich kaputter Fall, der rot werden **muss**. Wird er nicht rot, ist der Test
kaputt, nicht der Code.

### 3. Kalibrierungsdaten und Testdaten sind getrennt

Wer aus Daten lernt, darf nicht mit denselben Daten prüfen.

Belegt: Auf allen fünf Referenzclips kalibriert ergab null Fehlalarme. Auf zwei
kalibriert und gegen die anderen drei geprüft ergab 150, 132 und 183. Der Erfolg war
Überanpassung.

Zusatz: **Zahlen ohne Bild sind unvollständig.** Widersprechen sich Zahl und Bild,
gewinnt das Bild und der Test gilt als nicht bestanden.

## Weitere Regeln

**Fehlermeldungen sind die Benutzeroberfläche für den Agenten.** Nicht "ungültige
Eingabe", sondern "Frame 34 liegt außerhalb der Timeline von 0 bis 60". Eine schlechte
Fehlermeldung kostet drei Runden.

**Werkzeugbeschreibungen sind ein eigenes Arbeitspaket.** Sie sind das gesamte Handbuch,
das der Agent zu sehen bekommt. Kein Beiwerk, kein Nachgedanke.

**Wenige, grob geschnittene Werkzeuge.** Ein Aufruf pro Bewegungsphase, nicht einer pro
Knochen. Zielgröße unter zwanzig.

**Jede Prüfung ist phasenabhängig.** Balance gilt nur bei Bodenkontakt, Ballistik nur in
der Flugphase. Eine pauschale Prüfung meldet mitten im Salto einen Fehler, der keiner
ist.

**Fehlerfreiheit ist kein Erfolg.** Es braucht neben der Fehlerprüfung eine
Erfolgsprüfung. Eine Animation, in der nichts passiert, besteht jede Fehlerprüfung.

**Der Löser korrigiert, der Validator prüft die Nachbedingung.** Nicht beides
gleichzeitig als Garantie und als Prüfung behandeln — ein Löser kann scheitern, und
genau dann muss der Validator etwas melden.

**Alle Toleranzen relativ zur Körperhöhe.** Absolute Zentimeterwerte in Schwellen sind
ein Fehler: Für eine 60 cm große Figur bedeuten 50 cm etwas anderes als für eine
2,40 m große.

## Arbeitsteilung

Kritische Rechenlogik und alles Sichtbare baut Opus, über die Subagents `kern`,
`oberflaeche` und `festgefahren` in `.claude/agents/`. Abgegrenzte Arbeitspakete gehen
an Qwen 3.8 Flash über Command Code und an GLM 5.3 Flash über Ollama — beides starke
Modelle, die echte Pakete bekommen, keinen Kleinkram.

Kein Auftrag an ein externes Modell ohne Abnahmetest mit Negativfall. Einzelheiten und
getestete Befehlszeilen in `docs/flotte.md`.

## Aufbau des Repos

```
VISION.md                    Idee, Problem, Anspruch
AGENTS.md                    diese Datei
CLAUDE.md                    Verweis hierher
docs/challenge.md            offizielle Wettbewerbsfakten
docs/flotte.md               Arbeitsteilung und Aufrufe der Agents
docs/superpowers/specs/      Design-Plan
.claude/agents/              Opus-Subagents: kern, oberflaeche, festgefahren
spikes/                      Wegwerfcode aus Vorabtests, nicht Teil des Produkts
  test-a-webmcp/             gemessene WebMCP-Grenzen -> ERGEBNIS.md
  test-b-motion/             gescheiterter Animationsversuch mit rohen Keyframes
```

Alles unter `spikes/` ist Wegwerfcode. Nichts davon gehört ins Produkt. Die
**Ergebnisse** daraus gehören sehr wohl in den Plan.

## WebMCP, gemessene Fakten

```js
await document.modelContext.registerTool({
  name: 'beispiel',
  description: 'Was das Werkzeug tut, in ganzen Sätzen.',
  inputSchema: { type: 'object', properties: { /* ... */ }, required: [] },
  async execute(args) {
    return { content: [{ type: 'text', text: 'Antwort' }] };
  }
});
```

- Nachträgliches Registrieren funktioniert — Werkzeuge dürfen nach dem Modell-Upload
  entstehen.
- Antworten bis 512 KB kommen vollständig durch, in 5 ms. Messreports müssen nicht
  knapp gehalten werden.
- Ein Werkzeug darf auf einen Klick des Menschen warten. Die Antwort kommt im selben
  Aufruf zurück.
- Die Seite kann ihre eigenen Werkzeuge aufrufen:
  `executeTool(toolObjekt, argumenteAlsJsonString)`, Rückgabe ist ein String. Damit sind
  Regressionsläufe ohne Agent möglich.

Details: `spikes/test-a-webmcp/ERGEBNIS.md`.

## Sprache

Code-Bezeichner englisch. Kommentare, Dokumentation, Werkzeugbeschreibungen und
Fehlermeldungen deutsch, außer die Werkzeugbeschreibungen richten sich an einen Agenten,
der in der Sprache des Nutzers arbeitet — dann deutsch, weil die Nutzeroberfläche
deutsch ist.

## Was nicht gebaut wird

Vierbeiner und Fabelwesen, Text-to-Motion-Modelle im Browser, Ragdoll-Simulation,
mehrere Figuren, Kleidung, Gesichtsanimation. Begründungen im Design-Plan. Wer eines
davon anfängt, arbeitet am Plan vorbei.
