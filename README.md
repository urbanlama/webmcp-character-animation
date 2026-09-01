# Charakteranimation für Agenten

Eine Web-Oberfläche, in der ein KI-Agent einen geriggten 3D-Charakter animiert — und
dabei zum ersten Mal sieht, was er tut.

Beitrag zur [OpenAI WebMCP Challenge](https://webmcp.devpost.com).

- **Live ausprobieren:** https://urbanlama.github.io/webmcp-character-animation/
- **Code:** https://github.com/urbanlama/webmcp-character-animation (MIT)

## Das Problem

Wer schon einmal versucht hat, einen KI-Agenten in Blender animieren zu lassen, kennt
das Ergebnis: Der Ellbogen steckt im Gesicht. Die Füße lösen sich vom Boden und
schweben. Arme wachsen durch den Brustkorb. Ein Rückwärtssalto aus dem Stand scheitert
meist, bevor er begonnen hat.

Das liegt nicht an mangelnder Intelligenz der Modelle. Es liegt daran, dass sie blind
arbeiten. 3D-Software ist für menschliche Augen gebaut. Am Ende jeder Aktion steht ein
gerendertes Bild — und darauf ist nicht zu erkennen, dass der Körperschwerpunkt aus der
Standfläche kippt, dass ein Fuß 18 Millimeter im Boden steckt oder dass ein Kniegelenk
in eine Richtung gebogen wurde, die es anatomisch nicht gibt.

## Die Idee

Eine Seite, die den Agenten sehend macht.

**Sie vermisst das Modell selbst.** Lade ein beliebiges geriggtes Humanoid hoch — egal
welche Rig-Konvention, egal wie viele Knochen, egal welches Namensschema. Die Seite
misst Körperhöhe, Massenverteilung, Fußsohlen, Gelenkachsen und Blickrichtung aus dem
Modell. Kein manuelles Zuordnen von Knochen.

**Sie gibt Zahlen statt Vermutungen.** Nach jedem Schritt bekommt der Agent einen
Messbericht: wo etwas den Boden durchdringt, in Zentimetern. Wo der Schwerpunkt kippt.
Welcher Fuß in welchem Frame rutscht. Dazu einen Bildstreifen aus mehreren
Blickwinkeln — beides, nie nur eins.

**Sie lässt ihn in Bewegungen denken, nicht in Winkeln.** Der Agent bestellt Abschnitte:
absenken, ausholen, abspringen, drehen, landen, abfedern. Die Seite rechnet daraus die
Körperhaltung aus — über Schwerpunkt und Fußkontakte, sodass Bodendurchdringung und
verdrehte Gelenke gar nicht erst entstehen können.

**Sie fragt nach, wenn es um Geschmack geht.** Zwei Varianten nebeneinander, ein Klick.
Kein Fachwissen nötig. Das ist der Teil, den nur WebMCP ermöglicht: Mensch und Agent
sitzen vor derselben laufenden Seite.

## Warum WebMCP

Messwerte und Löser könnte auch ein herkömmlicher MCP-Server liefern. Was nur WebMCP
kann, ist die gemeinsame Situation: Der Agent hält mitten in der Arbeit an, zeigt dir
zwei Landungen, wartet auf deinen Klick und baut mit deiner Antwort weiter. Ein
Server-Prozess kann das nicht — er hat keine Oberfläche, vor der du sitzt.

## Stand

Stand vom 31. August 2026, abends. `node --test "src/**/*.test.mjs"`: **319 Tests,
alle grün.** `node tools/browser-test.mjs` über Playwright: **13 Tests, alle grün.**

**Echtes WebMCP, nachgemessen.** In Chrome 151 mit
`--enable-features=WebMCP` liegt `document.modelContext` vor, mit
`registerTool`, `getTools` und `executeTool`. Die Seite registriert darüber ihre
18 sichtbaren Werkzeuge, meldet `connected`, und ein Agent von außen ruft sie über
genau diesen Weg auf — nicht über einen Ersatzpfad. Zwei Eigenheiten der echten
Schnittstelle, die dabei zutage kamen: `getTools()` liefert Objekte mit Funktionen
(sie müssen abgeflacht werden, sonst lehnt die Serialisierung ab), und
`executeTool` erwartet das **Werkzeugobjekt**, nicht seinen Namen.

**So arbeitet der Agent.** Er setzt Haltungen, Gelenk für Gelenk, auf einzelne
Frames; dazwischen wird überblendet. Ein Sprung entsteht, indem er zusätzlich die
Wurzel bewegt — Position in Metern und Drehung je Achse. Gemessen an einem
selbst gebauten Rückwärtssalto über 48 Frames:

| Frame | Zustand | Becken | Drehung |
|---|---|---|---|
| 0 | kontakt | 1,04 m | 0° |
| 8 | kontakt | 0,76 m | 0° |
| 16 | flug | 1,39 m | −90° |
| 26 | flug | 1,59 m | −250° |
| 36 | kontakt | 0,84 m | −360° |

Der Bewegungszustand wird dabei aus der gelösten Haltung **gemessen**, nicht
übernommen: hebt eine Haltung die Figur vom Boden, gilt der Frame als Flug, und
die Balance- und Rutschprüfungen greifen dort nicht mehr.

Gemessen und belegt:

- **Vermessung am Xbot** (67 Knochen, 28 374 Vertices): 18 Gelenke, 14 Segmente,
  8 Sohlenpunkte, 0 Warnungen, Körperhöhe 1,8093 m. Die Werkzeuge liefern diese
  Werte real, keine Attrappen: `describe_world` → 1,8093 m, Bodenebene
  −0,00323 m; `describe_body` → 14 Segmente, 8 Sohlen, 151,88 kg, Rumpfradius
  0,169 m.
- **Werkzeugkatalog**: 22 Einträge, davon 19 für den Agenten sichtbar. Die drei
  übrigen sind eine Bibliothek fertiger Bewegungen, bewusst ausgeblendet —
  gemessen in zwei Agentenläufen: liegt sie neben `set_pose`, baut der Agent die
  ganze Bewegung daraus und setzt keine einzige eigene Haltung.
- **Der Agent misst selbst.** Statt fertiger Urteile liefert `measure` acht
  geometrische Grundmessungen, die er beliebig kombiniert — Höhe, Abstand,
  Abstand vorne/seitlich/hoch, Winkel, Neigung, Tempo. „Steht das Knie vor dem
  Zeh" ist damit keine eingebaute Prüfung, sondern eine Frage, die er stellt.
  An einer absichtlich schlechten Hocke gemessen: Knie 10,9 cm vor dem Zeh,
  Rumpf nur 5,9° geneigt.
- **WebMCP-Transport** (Chrome 151): Werkzeuge lassen sich nach dem Upload zur
  Laufzeit erzeugen; Antworten bis 512 KB kommen in 5 Millisekunden vollständig
  durch; ein Werkzeug kann auf den Klick des Menschen warten und die Antwort im
  selben Aufruf liefern (gemessen 3,1 s); Bilder funktionieren neben Text in
  derselben Antwort.
- **Gemessene Körpergeometrie schlägt geschätzte**: geschätzte Radien, Massen und
  Kontaktpunkte erzeugten 269 Fehlalarme auf einem Clip, in dem die Figur ruhig
  steht; nach der Umstellung auf Vermessung verschwanden Bodendurchdringung und
  Balancefehler vollständig.
- **Antwortgrößen für den Agenten**: `describe_rig` lieferte 52 599 Bytes, ein
  Agent schrieb sie in eine Datei und durchsuchte sie mit Shell-Aufrufen. Als
  Tabelle sind es 3 176 Bytes, mit der Zahl der Gelenke oben, damit er
  Vollständigkeit selbst prüfen kann; die Vollfassung gibt es auf Anfrage.
- **Export**: 1 943 856 Bytes glTF für 48 Frames, mit Wurzelbewegung, und der
  Mensch bekommt die Datei als Download.

Nicht fertig ist: der aufgezeichnete Demolauf für den Wettbewerb, und die
Zusage „beliebiges fremdes Rig" — von zehn geriggten Fremdmodellen laufen drei
durch die volle Kette. Details in [`docs/abgabe.md`](docs/abgabe.md).

## Aufbau

| Datei | Inhalt |
|---|---|
| [`VISION.md`](VISION.md) | das Ziel in kurz |
| [`docs/plan.md`](docs/plan.md) | Design, Datenformate, Architektur |
| [`docs/challenge.md`](docs/challenge.md) | Bedingungen des Wettbewerbs |
| [`AGENTS.md`](AGENTS.md) | Arbeitsanweisungen für alle, die hier mitbauen |
| `spikes/` | Wegwerfcode aus Vorabtests, samt Messergebnissen |

## Lizenz

MIT, siehe [LICENSE](LICENSE).