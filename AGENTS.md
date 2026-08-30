# Arbeitsanweisungen für Agents

Beitrag zur OpenAI WebMCP Challenge. Eine Web-Oberfläche, in der ein Agent geriggte
3D-Charaktere animiert, ohne blind zu sein.

Vor der ersten Zeile Code lesen:

- `VISION.md` — was gebaut wird und warum
- `docs/challenge.md` — Fristen, Abgabeanforderungen, Bewertungskriterien
- `docs/superpowers/specs/` — der Design-Plan

## Die eine Regel

**Keine Körpergröße wird gesetzt. Jede wird gemessen.**

Radien, Massen, Kontaktpunkte, Gelenkachsen, Blickrichtung, Toleranzen — alles wird aus
dem geladenen Modell abgeleitet. Wer eine Zahl in den Code tippt, weil sie plausibel
klingt, baut genau den Fehler ein, den dieses Projekt beheben soll.

Belegt: Geschätzte Körpermaße erzeugten 269 Fehlalarme auf einem Clip, in dem eine Figur
ruhig dasteht. Gemessene erzeugten null.

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

## Aufbau des Repos

```
VISION.md                    Idee, Problem, Anspruch
AGENTS.md                    diese Datei
CLAUDE.md                    Verweis hierher
docs/challenge.md            offizielle Wettbewerbsfakten
docs/superpowers/specs/      Design-Plan
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
