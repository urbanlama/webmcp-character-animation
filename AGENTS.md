# Arbeitsanweisungen

Beitrag zur OpenAI WebMCP Challenge. Eine Web-Oberfläche, in der ein Agent geriggte
3D-Charaktere animiert, ohne blind zu sein.

Lies `VISION.md` für das Ziel und `docs/plan.md` für die technischen Festlegungen —
Datenformate, Werkzeugkatalog, Architektur.

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

Konkret: Entwickelt wird nur auf `idle`, `walk`, `agree`, `sad_pose`. Die drei
übrigen Referenzclips (`run`, `headShake`, `sneak_pose`) bleiben der Abnahme
vorbehalten — nicht ansehen, nicht kalibrieren, nicht als Beispiel benutzen.

**Zusatz:** Zahlen ohne Bild sind unvollständig. Widersprechen sich Zahl und Bild,
gewinnt das Bild.

---

## Handwerkliches

**Fehlermeldungen enthalten immer eine Zahl.** Nicht "ungültige Eingabe", sondern
"Frame 34 liegt außerhalb der Timeline von 0 bis 60".

**Werkzeugbeschreibungen sind das Handbuch für den Agenten, der die fertige Seite
bedient.** Jede nennt das Bezugssystem und die Einheiten ihrer Parameter.

**Jede Prüfung ist phasenabhängig.** Balance gilt nur bei Bodenkontakt, Ballistik nur im
Flug.

**Fehlerfreiheit ist kein Erfolg.** Eine Animation, in der nichts passiert, besteht jede
Fehlerprüfung.

**Der Löser korrigiert, der Validator prüft die Nachbedingung.** Ein Löser kann
scheitern — genau dann muss der Validator etwas melden.

**Alle Toleranzen relativ zur Körperhöhe.** 50 cm bedeuten für eine 60 cm große Figur
etwas anderes als für eine 2,40 m große.

---

## Testen

**Runner ist der eingebaute:** `node --test`. Testdateien liegen neben dem Code, im
Verzeichnis des eigenen Pakets, Muster `*.test.mjs`, mit `node:test` und
`node:assert`. Dreistellig genau:

    node --test "src/**/*.test.mjs"

Mit Anführungszeichen — ohne sie schreibt Git Bash den Pfad um, und der Aufruf
scheitert mit `MODULE_NOT_FOUND`, was kein Fehler im Test ist.

**Node ist der Standard:** alles Rechnerische — Schemata, Vermessung, Erkennung,
Prüfungen, Löser — läuft ohne Browser. **Browser nur, wo Pixel entstehen** (Ansicht,
Bildstreifen); diese laufen über Playwright. `npm test` führt beide Hälften aus.

**Bezugsmaterial:** Referenzclips sind die sieben Animationen in
`spikes/test-b-motion/assets/Xbot.glb` (`agree`, `headShake`, `idle`, `run`,
`sad_pose`, `sneak_pose`, `walk`) — siehe Regel 3, wer womit arbeitet.

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
- Die Seite kann ihre eigenen Werkzeuge aufrufen: `getTools()` liefert die Liste,
  `executeTool(werkzeug, argumenteAlsJsonString)` ruft auf, die Rückgabe ist ein String

---

## Aufbau des Repos

```
README.md         was das Projekt ist, für Menschen
VISION.md         das Ziel in kurz
AGENTS.md         diese Datei — wie hier gearbeitet wird
CLAUDE.md         Verweis auf AGENTS.md
docs/plan.md      Datenformate, Werkzeugkatalog, Architektur
docs/challenge.md offizielle Wettbewerbsfakten
docs/abgabe.md    der Abgabetext
docs/video.md     Demo-Video (Abgabepflicht)
spikes/           Wegwerfcode aus Vorabtests, nicht Teil des Produkts
```

---

## Was nicht gebaut wird

Vierbeiner und Fabelwesen, Text-to-Motion-Modelle im Browser, Ragdoll-Simulation,
mehrere Figuren, Kleidung, Gesichtsanimation. Begründungen in `docs/plan.md`.